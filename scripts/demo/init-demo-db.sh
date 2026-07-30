#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for DB initialization."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Skipping automatic DB bootstrap."
  exit 0
fi

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing. Skipping automatic DB bootstrap."
  exit 0
fi

echo "Checking whether schema is already initialized..."
set +e
HAS_WORKSPACES_RAW="$(
  psql "$DATABASE_URL" -tAc "
    select to_regclass('public.workspaces') is not null;
  " 2>&1
)"
PSQL_STATUS=$?
set -e

if [[ $PSQL_STATUS -ne 0 ]]; then
  echo "Could not connect to DATABASE_URL. Skipping automatic DB bootstrap."
  echo "psql error: ${HAS_WORKSPACES_RAW}"
  echo "Set a reachable DATABASE_URL to enable migration bootstrap."
  exit 0
fi

HAS_WORKSPACES="$(echo "$HAS_WORKSPACES_RAW" | tr -d '[:space:]')"

if [[ "${HAS_WORKSPACES}" != "t" ]]; then
  echo "Schema not found. Applying migrations..."
  for file in $(ls -1 supabase/migrations/*.sql | sort); do
    echo "Applying migration: ${file}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  done
else
  echo "Schema already exists. Skipping migration phase."
fi

echo "Running demo seed..."
ENV_FILE="${ENV_FILE:-.env}" bash scripts/demo/seed-demo-data.sh
echo "DB init complete."
