#!/usr/bin/env bash
# Applies every migration + seed to a throwaway Postgres (with PostGIS) and runs the RLS assertions.
# Needs a Postgres server you can create databases on:  PGHOST/PGUSER/PGPASSWORD set as usual.
# No Supabase CLI or Docker needed. Safe to run in CI.
set -euo pipefail
DB=${DB_NAME:-connectme_test}
cd "$(dirname "$0")/.."
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -d "$DB" -c "alter database $DB set search_path = public, extensions"
export PGOPTIONS='-c search_path=public,extensions'
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql supabase/seed.sql; do echo "apply $f"; psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -d "$DB" -c "grant execute on all functions in schema auth to anon, authenticated, service_role" -c "grant select on public.services, public.areas to anon"
for f in rls_assertions flow_assertions payments_assertions; do
  psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/$f.sql 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^.*NOTICE:  //'
done
echo "All database checks passed."
