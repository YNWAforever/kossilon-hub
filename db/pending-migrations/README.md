# Pending migrations

Migrations that are written but **not yet applied** to production stay here. They are deliberately outside
`db/migrations/`, `EXPECTED_MIGRATIONS` and `schema.sql`, so the maintenance/write schema guard never refuses to run
because code expects a migration the database does not have (incident 2026-11-09).

To apply one: move the file into `db/migrations/`, add its DDL to `src/server/db/schema.sql` and its ID to
`EXPECTED_MIGRATIONS`, apply it to production in one reviewed transaction, then merge/deploy the same commit.
Never leave a file in both places.
