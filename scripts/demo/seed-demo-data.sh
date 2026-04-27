#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.demo" ]]; then
  echo ".env.demo not found. Run scripts/demo/bootstrap-local-demo.sh first."
  exit 1
fi

# shellcheck disable=SC1091
source .env.demo

if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  echo "curl and jq are required."
  exit 1
fi

DEMO_EMAIL="${DEMO_EMAIL:-demo@brandochat.local}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPass123!}"

echo "Creating demo auth user..."
USER_JSON="$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${DEMO_EMAIL}\",\"password\":\"${DEMO_PASSWORD}\",\"email_confirm\":true}")"

USER_ID="$(echo "$USER_JSON" | jq -r '.id // empty')"
if [[ -z "${USER_ID}" ]]; then
  # If already exists, query by email
  USERS_JSON="$(curl -sS "${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")"
  USER_ID="$(echo "$USERS_JSON" | jq -r ".users[]? | select(.email==\"${DEMO_EMAIL}\") | .id" | head -n1)"
fi

if [[ -z "${USER_ID}" ]]; then
  echo "Failed to create/find demo auth user."
  exit 1
fi

echo "Using demo user id: ${USER_ID}"

WORKSPACE_ID="11111111-1111-4111-8111-111111111111"

echo "Upserting demo workspace..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspaces" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d "[{\"id\":\"${WORKSPACE_ID}\",\"name\":\"BrandoChat Demo Workspace\",\"slug\":\"brandochat-demo\"}]" >/dev/null

echo "Upserting workspace membership..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_members" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[{\"workspace_id\":\"${WORKSPACE_ID}\",\"user_id\":\"${USER_ID}\",\"role\":\"owner\"}]" >/dev/null

echo "Inserting demo contacts..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/contacts" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "[
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000001@s.whatsapp.net\",\"phone_e164\":\"+491700000001\",\"display_name\":\"Demo Lead 1\",\"notes\":\"Interested in onboarding\",\"metadata\":{\"source\":\"demo\"}},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000002@s.whatsapp.net\",\"phone_e164\":\"+491700000002\",\"display_name\":\"Demo Lead 2\",\"notes\":\"Needs follow-up\",\"metadata\":{\"source\":\"demo\"}},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000003@s.whatsapp.net\",\"phone_e164\":\"+491700000003\",\"display_name\":\"Demo Lead 3\",\"notes\":\"Requested callback\",\"metadata\":{\"source\":\"demo\"}}
  ]" >/dev/null

echo "Inserting demo automation..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/automations" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "[{\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"Demo Welcome Flow\",\"description\":\"Sample demo automation\",\"is_active\":true,\"entry_node_id\":\"start\",\"graph\":{\"entry\":\"start\",\"nodes\":[]}}]" >/dev/null

echo "Ensuring default WhatsApp instance row..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/whatsapp_instances" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[{\"workspace_id\":\"${WORKSPACE_ID}\",\"pairing_status\":\"disconnected\",\"phone_label\":\"Demo Number\"}]" >/dev/null

echo "Demo seed complete."
