#!/usr/bin/env bash
# InwardsFlow — run the pgTAP suites on a plain PostgreSQL (Phase 10).
#
# Applies the Supabase platform stubs, then every migration in order, then
# the Supabase-style grants the suites assume, then pg_prove over
# supabase/tests/*.sql. Connection comes from the standard PG* environment
# (PGHOST, PGPORT, PGUSER, PGDATABASE). Requires: psql, pg_prove, and the
# pgtap extension available on the server (Debian/Ubuntu: postgresql-16-pgtap).
#
# NEVER point this at production: the stubs recreate platform objects and
# the suites create throwaway users and data (each suite rolls back).
set -euo pipefail
cd "$(dirname "$0")/.."

export PGDATABASE="${PGDATABASE:-postgres}"

echo "== platform stubs =="
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/platform-stubs.sql

echo "== migrations =="
for f in supabase/migrations/*.sql; do
  echo "-- $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "== supabase-parity grants =="
psql -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_receipt_learning(UUID) FROM PUBLIC, anon, authenticated;
SQL

echo "== pgTAP suites =="
pg_prove --host "${PGHOST:-localhost}" --port "${PGPORT:-5432}" \
         --username "${PGUSER:-postgres}" --dbname "$PGDATABASE" \
         supabase/tests/phase*.sql
