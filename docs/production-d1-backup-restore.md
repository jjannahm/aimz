# Production D1 backup and restore

## Before every migration batch

1. Export the remote database to an encrypted, access-controlled operator location:

   `npx wrangler d1 export aimz-production-db --remote --env production --output <dated-private-path>.sql --skip-confirmation`

2. Restore the export into a disposable SQLite database:

   `sqlite3 <disposable-path>.sqlite ".read <dated-private-path>.sql"`

3. Require `PRAGMA integrity_check;` to return `ok`, verify `d1_migrations`, and compare critical table row counts with the source.
4. Apply migrations only after the restore test passes.
5. Export again after migration and repeat the integrity and migration-ledger checks.

Backups can contain account, family, player, health, finance, and authentication data. Never commit them, place them in a shared folder, or retain them on an unmanaged device. Encrypt retained exports, restrict them to designated operators, record creation/deletion, and use the retention period approved by the privacy owner.

## Recovery

Do not overwrite the production database while the Worker is accepting writes. Disable writes, create a replacement D1 database, import the last verified export, apply any later reviewed migrations, validate counts and authentication invariants, update the production binding, deploy, smoke-test, and only then restore traffic. Keep the prior database intact until the recovery is accepted.

The pre-launch rehearsal on 14 September 2026 exported production and restored it into disposable local SQLite. `PRAGMA integrity_check` returned `ok`, and the migration ledger ended at `0044_fee_invoices.sql`. Three migrations were then applied from an unmerged working copy: `0045_rate_limits.sql`, `0046_refresh_session_families.sql` and `0047_atomic_finance_attendance.sql`. The first never reached `main`; `0048_drop_unused_rate_limits.sql` removes the table it created. Production's ledger therefore also records `0045_rate_limits.sql`, and `0045_coach_staff_role.sql` is applied with `0048` on the next migration run. The database held no accounts or player data at the time.
