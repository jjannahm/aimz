"""Import a Cloudflare D1 (SQLite) dump into the FastAPI Postgres database.

Stage 3 of the AWS migration. The Worker's D1 schema and this backend's Postgres
schema share almost every column name — the schemas were kept in step on purpose
— so rather than transcribe hundreds of columns by hand, this reads each target
table's columns off the SQLAlchemy models and pulls the same-named column out of
the SQLite source, coercing by the target column's type:

  * booleans: SQLite keeps 0/1, Postgres wants true/false
  * timestamps: SQLite keeps ISO text, Postgres wants an aware datetime
  * everything else (ids, enums-as-text, ints, nullable text) passes straight
    through, because the two schemas already agree on it.

The one genuine rename is ``users.password_hash`` (D1) -> ``hashed_password``
(here). Ephemeral rows — refresh sessions, password-reset codes, invite claims —
are not carried across: a fresh sign-in reissues them, and copying live tokens
into a new backend is a liability rather than a convenience.

Rows are inserted in foreign-key order with ``ON CONFLICT DO NOTHING``, so the
import is safe to re-run and can resume after a partial load. Nothing is deleted.

Source: materialise the D1 export into a SQLite file first, e.g.

    wrangler d1 export aimz-staging-db --remote --output d1.sql
    sqlite3 d1.db < d1.sql

Usage:

    DATABASE_URL=postgresql://... python -m scripts.import_d1 d1.db
    python -m scripts.import_d1 d1.db --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sqlite3
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Table, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import normalize_database_url
from app.db import models

# Target tables in foreign-key order: a row is only inserted after everything it
# points at is already in place. Ephemeral tables are omitted on purpose.
IMPORT_ORDER: list[type] = [
    models.Competition,
    models.CompetitionGroup,
    models.Team,
    models.Player,
    models.User,
    models.RegistrationInvite,
    models.InvitePlayer,
    models.UserChild,
    models.AccountExpiry,
    models.CalendarToken,
    models.Match,
    models.MatchEvent,
    models.MatchLineupEntry,
    models.PlayerMatchStat,
    models.PlayerContact,
    models.Announcement,
    models.TrainingSession,
    models.TrainingAvailability,
    models.EventAssignment,
    models.BracketSlot,
    models.AuditLog,
]

# target attribute -> source column, where the two schemas disagree on a name.
RENAMES: dict[str, dict[str, str]] = {
    "users": {"hashed_password": "password_hash"},
}

# Columns filled in a second pass so a row that points at another row in its own
# table (an event linked to an earlier event) does not fail the FK on insert.
DEFERRED_SELF_REFS: dict[str, list[str]] = {
    "match_events": ["related_event_id"],
}


def _coerce(column: Any, value: Any) -> Any:
    """One source value as the target column wants it."""
    if value is None:
        return None
    if isinstance(column.type, Boolean):
        return bool(value)
    if isinstance(column.type, DateTime):
        if isinstance(value, datetime):
            parsed = value
        else:
            text = str(value).replace("Z", "+00:00")
            parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return value


def _source_columns(source: sqlite3.Connection, table_name: str) -> set[str] | None:
    """The columns a source table has, or None when the table is absent."""
    exists = source.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    if exists is None:
        return None
    return {row[1] for row in source.execute(f'PRAGMA table_info("{table_name}")')}


def _rows_for(
    source: sqlite3.Connection, table: Table, deferred: list[str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
    """Every source row as (insert values, deferred patch) pairs, or None when
    the source has no such table."""
    table_name = table.name
    available = _source_columns(source, table_name)
    if available is None:
        return None
    renames = RENAMES.get(table_name, {})
    source.row_factory = sqlite3.Row
    raw = source.execute(f'SELECT * FROM "{table_name}"').fetchall()
    inserts: list[dict[str, Any]] = []
    patches: list[dict[str, Any]] = []
    pk_names = [column.name for column in table.primary_key.columns]
    for row in raw:
        keyed = dict(row)
        values: dict[str, Any] = {}
        patch: dict[str, Any] = {}
        for column in table.columns:
            source_key = renames.get(column.name, column.name)
            if source_key not in available:
                continue
            coerced = _coerce(column, keyed.get(source_key))
            if column.name in deferred:
                # Held back to a second pass; inserted as NULL first.
                patch[column.name] = coerced
                values[column.name] = None
            else:
                values[column.name] = coerced
        inserts.append(values)
        if any(patch.values()):
            patches.append({**{pk: values[pk] for pk in pk_names}, **patch})
    return inserts, patches


async def import_dump(sqlite_path: str, dry_run: bool) -> None:
    source = sqlite3.connect(sqlite_path)
    engine = create_async_engine(
        normalize_database_url(_require_database_url()), pool_pre_ping=True
    )
    try:
        async with engine.begin() as connection:
            for model in IMPORT_ORDER:
                table = model.__table__
                deferred = DEFERRED_SELF_REFS.get(table.name, [])
                prepared = _rows_for(source, table, deferred)
                if prepared is None:
                    print(f"  skip {table.name}: not present in source")
                    continue
                inserts, patches = prepared
                if not inserts:
                    print(f"  {table.name}: 0 rows")
                    continue
                if dry_run:
                    print(f"  {table.name}: {len(inserts)} rows (dry run)")
                    continue
                statement = pg_insert(table).on_conflict_do_nothing()
                await connection.execute(statement, inserts)
                for patch in patches:
                    await _apply_patch(connection, table, patch, deferred)
                print(
                    f"  {table.name}: {len(inserts)} rows"
                    + (f", {len(patches)} self-refs patched" if patches else "")
                )
            if dry_run:
                print("dry run: rolling back")
                raise _Rollback
    except _Rollback:
        pass
    finally:
        await engine.dispose()
        source.close()


async def _apply_patch(connection: Any, table: Table, patch: dict[str, Any], deferred: list[str]) -> None:
    where = [table.c[column.name] == patch[column.name] for column in table.primary_key.columns]
    values = {name: patch[name] for name in deferred if name in patch}
    if values:
        await connection.execute(update(table).where(*where).values(**values))


def _require_database_url() -> str:
    import os

    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL to the target Postgres database.")
    return url


class _Rollback(Exception):
    """Sentinel to roll back the transaction after a dry run."""


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a D1 SQLite dump into Postgres.")
    parser.add_argument("sqlite_path", help="Path to the materialised D1 SQLite database.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count what would be imported and roll back without writing.",
    )
    args = parser.parse_args()
    print(f"Importing {args.sqlite_path} -> {'(dry run)' if args.dry_run else 'Postgres'}")
    asyncio.run(import_dump(args.sqlite_path, args.dry_run))
    print("done")


if __name__ == "__main__":
    main()
