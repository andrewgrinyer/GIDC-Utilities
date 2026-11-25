#!/bin/bash
# Tests sql/dealer-split-move.sql (portal 2.24) against the same throwaway
# local Postgres as run.sh (socket /tmp/pg, port 5499). Never points at
# Supabase. Runs the file twice, splits a Benech shaped order three ways,
# then moves doors back and forth between the parts.
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(dirname "$0")"
$P -c "drop database if exists t" -c "create database t" postgres
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -f "$D"/mock-dealer-sync.sql >/dev/null || exit 1
$P t -f "$D"/mock-split-shape.sql >/dev/null || exit 1
for f in dealer-order-number.sql dealer-invoicing.sql dealer-split-order.sql dealer-split-move.sql dealer-split-move.sql; do
  echo "== $f"; $P t -f "$D"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL; cat /tmp/gidc-sql-err; exit 1; }
done
$P t -f "$D"/split-move-checks.sql
