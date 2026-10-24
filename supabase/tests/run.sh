#!/usr/bin/env bash
# Runs the pgTAP database tests against the local Supabase stack.
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/gen-recurrence-sql-test.mjs
supabase test db
