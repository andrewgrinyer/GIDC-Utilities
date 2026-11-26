#!/bin/bash
# Tests the files in sql/ against a local stand in for the live database.
# Needs a throwaway local Postgres on socket /tmp/pg port 5499. Never
# points at Supabase.
#
#   run.sh null    security-tighten.sql two-sided-access.sql email-verification.sql
#   run.sh notnull security-tighten.sql        (role declared not null)
#
# Prints what each kind of login can see. A stranger signing up after the
# files have run must see nothing.
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
mode=$1; shift
$P -c "drop database if exists t" -c "create database t" postgres
if [ "$mode" = notnull ]; then sed 's/NOTNULL_HERE/not null/' "$(dirname "$0")"/mock-live-shape.sql; else sed 's/NOTNULL_HERE//' "$(dirname "$0")"/mock-live-shape.sql; fi | $P t >/dev/null || exit 1
for f in "$@"; do echo "== $f"; $P t -f "$(dirname "$0")"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL; cat /tmp/gidc-sql-err; exit 1; }; grep -i "error" /tmp/gidc-sql-err; done
$P t -c "insert into auth.users(id,email) values (md5('stranger')::uuid,'stranger@x.ca')" || echo "SIGNUP FAILED"
$P t -f "$(dirname "$0")"/access-matrix.sql
