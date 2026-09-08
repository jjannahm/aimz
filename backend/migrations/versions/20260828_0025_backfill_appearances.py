"""Appearances for matches that were already played.

Ported from the Worker migration 0022_backfill_appearances. ``appeared`` was only
ever written as a side effect of doing something — an event naming the player,
minutes typed in by hand, or being the keeper. Taking the field never wrote it,
so a player who turned out every week and never scored counted nil appearances.
The team sheet has held the answer all along; from here on ``recompute_pitch_stats``
keeps the flag right as a match is played, and this is the same rule applied
backwards, once, to everything already in the table.

Only ever sets the flag, never clears it: an appearance already recorded means
the player was on the pitch, and clearing would throw away the only record a
match scored without a team sheet has. ``minutes_played`` is left at nought on
any row this creates — it is not derivable from the sheet.

Revision ID: 20260828_0025
Revises: 20260828_0024
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260828_0025"
down_revision: str | None = "20260828_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Everyone who started a match that has kicked off.
    op.execute(
        """
        INSERT INTO player_match_stats
            (id, match_id, player_id, team_id, appeared, minutes_played, created_at, updated_at)
        SELECT gen_random_uuid()::text, l.match_id, l.player_id, l.team_id, true, 0,
               m.updated_at, m.updated_at
        FROM match_lineup_entries l
        JOIN matches m ON m.id = l.match_id
        WHERE l.is_starter = true AND m.status <> 'scheduled'
        ON CONFLICT (match_id, player_id) DO UPDATE SET
            appeared = true,
            team_id = COALESCE(player_match_stats.team_id, EXCLUDED.team_id),
            updated_at = EXCLUDED.updated_at
        """
    )
    # Everyone brought on. On a substitution, player_id is the arriving player;
    # whoever went off started, so the rule above already has them.
    op.execute(
        """
        INSERT INTO player_match_stats
            (id, match_id, player_id, team_id, appeared, minutes_played, created_at, updated_at)
        SELECT gen_random_uuid()::text, e.match_id, e.player_id, e.team_id, true, 0,
               m.updated_at, m.updated_at
        FROM match_events e
        JOIN matches m ON m.id = e.match_id
        WHERE e.type = 'substitution' AND e.player_id IS NOT NULL AND m.status <> 'scheduled'
        ON CONFLICT (match_id, player_id) DO UPDATE SET
            appeared = true,
            team_id = COALESCE(player_match_stats.team_id, EXCLUDED.team_id),
            updated_at = EXCLUDED.updated_at
        """
    )


def downgrade() -> None:
    # A backfill of a flag that means "was on the pitch"; there is nothing to
    # take back that could be told apart from an appearance recorded any other
    # way, so the down migration deliberately does nothing.
    pass
