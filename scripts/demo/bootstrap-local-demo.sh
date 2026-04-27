#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required. Install: https://supabase.com/docs/guides/cli"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for demo bootstrap."
  exit 1
fi

echo "Starting local Supabase stack..."
supabase start

echo "Reading local Supabase env..."
SUPABASE_ENV="$(supabase status -o env)"
API_URL="$(echo "$SUPABASE_ENV" | sed -n 's/^API_URL=//p')"
ANON_KEY="$(echo "$SUPABASE_ENV" | sed -n 's/^ANON_KEY=//p')"
SERVICE_ROLE_KEY="$(echo "$SUPABASE_ENV" | sed -n 's/^SERVICE_ROLE_KEY=//p')"

if [[ -z "${API_URL}" || -z "${ANON_KEY}" || -z "${SERVICE_ROLE_KEY}" ]]; then
  echo "Failed to read local Supabase env values from 'supabase status -o env'."
  exit 1
fi

cat > .env.demo <<EOF
SUPABASE_URL=${API_URL}
SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
PORT=3847
WA_AUTH_ROOT=/app/data/wa_sessions
WA_BACKUP_ENABLED=false
WA_BACKUP_BUCKET=wa-sessions
WA_BACKUP_ENCRYPTION_KEY=
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
DEMO_EMAIL=demo@brandochat.local
DEMO_PASSWORD=DemoPass123!
EOF

echo "Resetting local DB with migrations..."
supabase db reset --local

echo "Seeding demo records..."
bash scripts/demo/seed-demo-data.sh

echo "Building and starting demo app stack..."
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build

echo
echo "Demo is ready:"
echo "- Frontend: http://localhost:15173"
echo "- Backend:  http://localhost:13847"
echo "- Demo login: demo@brandochat.local / DemoPass123!"
