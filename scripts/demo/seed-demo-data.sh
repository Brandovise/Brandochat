#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.demo}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} not found. Set ENV_FILE or create ${ENV_FILE}."
  exit 1
fi

# shellcheck disable=SC1091
source "${ENV_FILE}"
SUPABASE_API_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  echo "curl and jq are required."
  exit 1
fi

DEMO_EMAIL="${DEMO_EMAIL:-demo@brandochat.local}"
DEMO_PASSWORD="${DEMO_PASSWORD:-DemoPass123!}"

echo "Creating demo auth user..."
USER_JSON="$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${DEMO_EMAIL}\",\"password\":\"${DEMO_PASSWORD}\",\"email_confirm\":true}")"

USER_ID="$(echo "$USER_JSON" | jq -r '.id // empty')"
if [[ -z "${USER_ID}" ]]; then
  # If already exists, query by email
  USERS_JSON="$(curl -sS "${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200" \
    -H "apikey: ${SUPABASE_API_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")"
  USER_ID="$(echo "$USERS_JSON" | jq -r ".users[]? | select(.email==\"${DEMO_EMAIL}\") | .id" | head -n1)"
fi

if [[ -z "${USER_ID}" ]]; then
  echo "Failed to create/find demo auth user."
  exit 1
fi

echo "Using demo user id: ${USER_ID}"

# Some DB triggers rely on auth.uid(). For REST writes, build a service_role JWT
# with sub=<demo user id> when JWT_SECRET is available.
if [[ -n "${JWT_SECRET:-}" ]] && command -v python3 >/dev/null 2>&1; then
  REST_TOKEN="$(
    USER_ID="$USER_ID" JWT_SECRET="$JWT_SECRET" python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

secret = os.environ["JWT_SECRET"].encode()
user_id = os.environ["USER_ID"]
now = int(time.time())
payload = {
    "role": "service_role",
    "sub": user_id,
    "iss": "supabase",
    "iat": now,
    "exp": now + 60 * 60,
}
header = {"alg": "HS256", "typ": "JWT"}

def enc(obj):
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=")

h = enc(header)
p = enc(payload)
s = base64.urlsafe_b64encode(hmac.new(secret, h + b"." + p, hashlib.sha256).digest()).rstrip(b"=")
print((h + b"." + p + b"." + s).decode())
PY
  )"

  if [[ -n "$REST_TOKEN" ]]; then
    SUPABASE_SERVICE_ROLE_KEY="$REST_TOKEN"
  fi
fi

WORKSPACE_ID="11111111-1111-4111-8111-111111111111"
INSTANCE_ID="11111111-1111-4111-8111-111111111112"

CONTACT_1_ID="11111111-1111-4111-8111-111111111201"
CONTACT_2_ID="11111111-1111-4111-8111-111111111202"
CONTACT_3_ID="11111111-1111-4111-8111-111111111203"
CONTACT_4_ID="11111111-1111-4111-8111-111111111204"
CONTACT_5_ID="11111111-1111-4111-8111-111111111205"
CONTACT_6_ID="11111111-1111-4111-8111-111111111206"
CONTACT_7_ID="11111111-1111-4111-8111-111111111207"

CONVERSATION_1_ID="11111111-1111-4111-8111-111111111301"
CONVERSATION_2_ID="11111111-1111-4111-8111-111111111302"
CONVERSATION_3_ID="11111111-1111-4111-8111-111111111303"
CONVERSATION_4_ID="11111111-1111-4111-8111-111111111304"
CONVERSATION_5_ID="11111111-1111-4111-8111-111111111305"

LIST_NEW_LEADS_ID="11111111-1111-4111-8111-111111111401"
LIST_FOLLOW_UP_ID="11111111-1111-4111-8111-111111111402"
TAG_HIGH_INTENT_ID="11111111-1111-4111-8111-111111111501"
TAG_BOOKED_CALL_ID="11111111-1111-4111-8111-111111111502"
TAG_NEEDS_DOCS_ID="11111111-1111-4111-8111-111111111503"

AUTOMATION_WELCOME_ID="11111111-1111-4111-8111-111111111601"
AUTOMATION_FOLLOWUP_ID="11111111-1111-4111-8111-111111111602"
RUN_1_ID="11111111-1111-4111-8111-111111111701"
RUN_2_ID="11111111-1111-4111-8111-111111111702"
RUN_3_ID="11111111-1111-4111-8111-111111111703"
RUN_4_ID="11111111-1111-4111-8111-111111111704"

LABEL_NEW_ID="11111111-1111-4111-8111-111111111801"
LABEL_WAITING_ID="11111111-1111-4111-8111-111111111802"
LABEL_ESCALATED_ID="11111111-1111-4111-8111-111111111803"

TEMPLATE_WELCOME_ID="11111111-1111-4111-8111-111111111901"
TEMPLATE_FOLLOWUP_ID="11111111-1111-4111-8111-111111111902"
TEMPLATE_PRICING_ID="11111111-1111-4111-8111-111111111903"

MSG_EVT_1_ID="11111111-1111-4111-8111-111111112001"
MSG_EVT_2_ID="11111111-1111-4111-8111-111111112002"
MSG_EVT_3_ID="11111111-1111-4111-8111-111111112003"
MSG_EVT_4_ID="11111111-1111-4111-8111-111111112004"
MSG_EVT_5_ID="11111111-1111-4111-8111-111111112005"
MSG_EVT_6_ID="11111111-1111-4111-8111-111111112006"
MSG_EVT_7_ID="11111111-1111-4111-8111-111111112007"
MSG_EVT_8_ID="11111111-1111-4111-8111-111111112008"

echo "Upserting demo workspace..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspaces" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d "[{\"id\":\"${WORKSPACE_ID}\",\"name\":\"BrandoChat Demo Workspace\",\"slug\":\"brandochat-demo\",\"description\":\"Seeded demo workspace with realistic sample data\",\"timezone\":\"Europe/Berlin\"}]" >/dev/null

echo "Upserting workspace membership..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_members" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[{\"workspace_id\":\"${WORKSPACE_ID}\",\"user_id\":\"${USER_ID}\",\"role\":\"owner\"}]" >/dev/null

echo "Inserting demo contacts..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/contacts" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${CONTACT_1_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000001@s.whatsapp.net\",\"phone_e164\":\"+491700000001\",\"display_name\":\"Anna Becker\",\"notes\":\"Wants onboarding this week\",\"metadata\":{\"source\":\"demo\",\"company\":\"Becker Finance\"}},
    {\"id\":\"${CONTACT_2_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000002@s.whatsapp.net\",\"phone_e164\":\"+491700000002\",\"display_name\":\"Luca Schmidt\",\"notes\":\"Needs follow-up next Tuesday\",\"metadata\":{\"source\":\"demo\",\"company\":\"Schmidt Immobilien\"}},
    {\"id\":\"${CONTACT_3_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000003@s.whatsapp.net\",\"phone_e164\":\"+491700000003\",\"display_name\":\"Miriam Roth\",\"notes\":\"Requested pricing PDF\",\"metadata\":{\"source\":\"demo\",\"company\":\"Roth Consulting\"}},
    {\"id\":\"${CONTACT_4_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000004@s.whatsapp.net\",\"phone_e164\":\"+491700000004\",\"display_name\":\"David Neumann\",\"notes\":\"Booked Calendly call\",\"metadata\":{\"source\":\"demo\",\"company\":\"Neumann Tax\"}},
    {\"id\":\"${CONTACT_5_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000005@s.whatsapp.net\",\"phone_e164\":\"+491700000005\",\"display_name\":\"Sara Klein\",\"notes\":\"Sent voice note, waiting on docs\",\"metadata\":{\"source\":\"demo\",\"company\":\"Klein Legal\"}},
    {\"id\":\"${CONTACT_6_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000006@s.whatsapp.net\",\"phone_e164\":\"+491700000006\",\"display_name\":\"Jonas Weber\",\"notes\":\"Needs CFO approval before signing\",\"metadata\":{\"source\":\"demo\",\"company\":\"Weber Logistics\"}},
    {\"id\":\"${CONTACT_7_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"wa_jid\":\"491700000007@s.whatsapp.net\",\"phone_e164\":\"+491700000007\",\"display_name\":\"Elena Vogt\",\"notes\":\"Asking for enterprise onboarding timeline\",\"metadata\":{\"source\":\"demo\",\"company\":\"Vogt Systems\"}}
  ]" >/dev/null

echo "Ensuring default WhatsApp instance row..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/whatsapp_instances" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[{\"id\":\"${INSTANCE_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"pairing_status\":\"connected\",\"phone_label\":\"Demo Number\"}]" >/dev/null

echo "Inserting demo conversations..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/conversations" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${CONVERSATION_1_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_1_ID}\",\"wa_chat_jid\":\"491700000001@s.whatsapp.net\",\"status\":\"open\",\"assignee\":\"Sales Team\",\"source_whatsapp_instance_id\":\"${INSTANCE_ID}\",\"last_message_at\":\"2026-04-20T10:15:00Z\"},
    {\"id\":\"${CONVERSATION_2_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_2_ID}\",\"wa_chat_jid\":\"491700000002@s.whatsapp.net\",\"status\":\"open\",\"assignee\":\"Ops Team\",\"source_whatsapp_instance_id\":\"${INSTANCE_ID}\",\"last_message_at\":\"2026-04-20T11:00:00Z\"},
    {\"id\":\"${CONVERSATION_3_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_4_ID}\",\"wa_chat_jid\":\"491700000004@s.whatsapp.net\",\"status\":\"closed\",\"assignee\":\"Sales Team\",\"source_whatsapp_instance_id\":\"${INSTANCE_ID}\",\"last_message_at\":\"2026-04-19T16:20:00Z\",\"closed_at\":\"2026-04-19T17:00:00Z\"},
    {\"id\":\"${CONVERSATION_4_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_6_ID}\",\"wa_chat_jid\":\"491700000006@s.whatsapp.net\",\"status\":\"open\",\"assignee\":\"Enterprise Team\",\"source_whatsapp_instance_id\":\"${INSTANCE_ID}\",\"last_message_at\":\"2026-04-21T09:45:00Z\"},
    {\"id\":\"${CONVERSATION_5_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_7_ID}\",\"wa_chat_jid\":\"491700000007@s.whatsapp.net\",\"status\":\"open\",\"assignee\":\"Support Team\",\"source_whatsapp_instance_id\":\"${INSTANCE_ID}\",\"last_message_at\":\"2026-04-21T12:30:00Z\"}
  ]" >/dev/null

echo "Inserting demo message templates..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/message_templates" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${TEMPLATE_WELCOME_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"welcome-intro\",\"body\":\"Hi {{first_name}}, thanks for reaching out to BrandoChat. I can help you get started right away.\"},
    {\"id\":\"${TEMPLATE_FOLLOWUP_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"follow-up-24h\",\"body\":\"Quick follow-up from our side: do you want me to reserve a setup slot for tomorrow?\"},
    {\"id\":\"${TEMPLATE_PRICING_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"pricing-request\",\"body\":\"Sure — sharing the pricing options now. Which plan size are you evaluating?\"}
  ]" >/dev/null

echo "Inserting demo automations..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/automations" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${AUTOMATION_WELCOME_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"Welcome & Qualify\",\"description\":\"Send welcome + ask qualification question\",\"is_active\":true,\"entry_node_id\":\"start\",\"trigger_type\":\"message.received\",\"graph\":{\"entry\":\"start\",\"nodes\":[]}},
    {\"id\":\"${AUTOMATION_FOLLOWUP_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"No-Reply Follow-up\",\"description\":\"Send reminder after delay\",\"is_active\":true,\"entry_node_id\":\"start\",\"trigger_type\":\"calendly.event\",\"graph\":{\"entry\":\"start\",\"nodes\":[]}}
  ]" >/dev/null

echo "Inserting demo automation run logs..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/automation_runs" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${RUN_1_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"automation_id\":\"${AUTOMATION_WELCOME_ID}\",\"contact_id\":\"${CONTACT_1_ID}\",\"conversation_id\":\"${CONVERSATION_1_ID}\",\"status\":\"completed\",\"current_node_id\":\"done\",\"variables\":{\"demo\":true},\"trigger_type\":\"message.received\",\"trigger_payload\":{\"channel\":\"whatsapp\"},\"started_at\":\"2026-04-20T10:16:00Z\",\"completed_at\":\"2026-04-20T10:16:08Z\"},
    {\"id\":\"${RUN_2_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"automation_id\":\"${AUTOMATION_FOLLOWUP_ID}\",\"contact_id\":\"${CONTACT_2_ID}\",\"conversation_id\":\"${CONVERSATION_2_ID}\",\"status\":\"running\",\"current_node_id\":\"wait_24h\",\"variables\":{\"demo\":true},\"trigger_type\":\"calendly.event\",\"trigger_payload\":{\"event\":\"invitee.created\"},\"started_at\":\"2026-04-20T11:03:00Z\"},
    {\"id\":\"${RUN_3_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"automation_id\":\"${AUTOMATION_WELCOME_ID}\",\"contact_id\":\"${CONTACT_6_ID}\",\"conversation_id\":\"${CONVERSATION_4_ID}\",\"status\":\"failed\",\"current_node_id\":\"send_pricing\",\"variables\":{\"demo\":true},\"trigger_type\":\"message.received\",\"trigger_payload\":{\"channel\":\"whatsapp\"},\"error\":\"Rate limit reached while sending outbound message\",\"started_at\":\"2026-04-21T09:46:00Z\"},
    {\"id\":\"${RUN_4_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"automation_id\":\"${AUTOMATION_FOLLOWUP_ID}\",\"contact_id\":\"${CONTACT_7_ID}\",\"conversation_id\":\"${CONVERSATION_5_ID}\",\"status\":\"paused\",\"current_node_id\":\"await_reply\",\"variables\":{\"demo\":true},\"trigger_type\":\"manual.wait\",\"trigger_payload\":{\"source\":\"agent\"},\"started_at\":\"2026-04-21T12:31:00Z\"}
  ]" >/dev/null

echo "Inserting demo message events..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/message_events" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${MSG_EVT_1_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_1_ID}\",\"conversation_id\":\"${CONVERSATION_1_ID}\",\"direction\":\"inbound\",\"wa_message_id\":\"demo-in-1\",\"wa_chat_jid\":\"491700000001@s.whatsapp.net\",\"body\":\"Hi, I'd like a quick onboarding call.\",\"created_at\":\"2026-04-20T10:15:00Z\"},
    {\"id\":\"${MSG_EVT_2_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_1_ID}\",\"conversation_id\":\"${CONVERSATION_1_ID}\",\"direction\":\"outbound\",\"wa_message_id\":\"demo-out-1\",\"wa_chat_jid\":\"491700000001@s.whatsapp.net\",\"body\":\"Great, I can help. Are you available tomorrow?\",\"automation_id\":\"${AUTOMATION_WELCOME_ID}\",\"node_id\":\"welcome_message\",\"created_at\":\"2026-04-20T10:16:02Z\"},
    {\"id\":\"${MSG_EVT_3_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_2_ID}\",\"conversation_id\":\"${CONVERSATION_2_ID}\",\"direction\":\"inbound\",\"wa_message_id\":\"demo-in-2\",\"wa_chat_jid\":\"491700000002@s.whatsapp.net\",\"body\":\"Can you share pricing first?\",\"created_at\":\"2026-04-20T11:00:00Z\"},
    {\"id\":\"${MSG_EVT_4_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_6_ID}\",\"conversation_id\":\"${CONVERSATION_4_ID}\",\"direction\":\"inbound\",\"wa_message_id\":\"demo-in-3\",\"wa_chat_jid\":\"491700000006@s.whatsapp.net\",\"body\":\"Can we do enterprise rollout in two regions?\",\"created_at\":\"2026-04-21T09:45:00Z\"},
    {\"id\":\"${MSG_EVT_5_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_6_ID}\",\"conversation_id\":\"${CONVERSATION_4_ID}\",\"direction\":\"outbound\",\"wa_message_id\":\"demo-out-3\",\"wa_chat_jid\":\"491700000006@s.whatsapp.net\",\"body\":\"Yes, we can stage rollout by region with separate teams.\",\"automation_id\":\"${AUTOMATION_WELCOME_ID}\",\"node_id\":\"enterprise_response\",\"created_at\":\"2026-04-21T09:45:30Z\"},
    {\"id\":\"${MSG_EVT_6_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_7_ID}\",\"conversation_id\":\"${CONVERSATION_5_ID}\",\"direction\":\"inbound\",\"wa_message_id\":\"demo-in-4\",\"wa_chat_jid\":\"491700000007@s.whatsapp.net\",\"body\":\"How long does migration usually take?\",\"created_at\":\"2026-04-21T12:30:00Z\"},
    {\"id\":\"${MSG_EVT_7_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_7_ID}\",\"conversation_id\":\"${CONVERSATION_5_ID}\",\"direction\":\"outbound\",\"wa_message_id\":\"demo-out-4\",\"wa_chat_jid\":\"491700000007@s.whatsapp.net\",\"body\":\"Most teams go live in 3-5 days depending on automation complexity.\",\"automation_id\":\"${AUTOMATION_FOLLOWUP_ID}\",\"node_id\":\"migration_eta\",\"created_at\":\"2026-04-21T12:31:10Z\"},
    {\"id\":\"${MSG_EVT_8_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"contact_id\":\"${CONTACT_3_ID}\",\"conversation_id\":\"${CONVERSATION_2_ID}\",\"direction\":\"outbound\",\"wa_message_id\":\"demo-out-5\",\"wa_chat_jid\":\"491700000003@s.whatsapp.net\",\"body\":\"Sharing the pricing PDF here for your review.\",\"automation_id\":\"${AUTOMATION_FOLLOWUP_ID}\",\"node_id\":\"send_pricing_pdf\",\"created_at\":\"2026-04-21T13:05:00Z\"}
  ]" >/dev/null

echo "Inserting demo lists/tags and memberships..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_contact_lists" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${LIST_NEW_LEADS_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"New Leads\",\"description\":\"Fresh inbound leads\",\"color\":\"#0ea5e9\"},
    {\"id\":\"${LIST_FOLLOW_UP_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"Follow-up Queue\",\"description\":\"Needs follow-up this week\",\"color\":\"#f59e0b\"}
  ]" >/dev/null

curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_contact_tags" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${TAG_HIGH_INTENT_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"high-intent\",\"color\":\"#22c55e\"},
    {\"id\":\"${TAG_BOOKED_CALL_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"booked-call\",\"color\":\"#a855f7\"},
    {\"id\":\"${TAG_NEEDS_DOCS_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"needs-docs\",\"color\":\"#ef4444\"}
  ]" >/dev/null

curl -sS -X POST "${SUPABASE_URL}/rest/v1/contact_list_members" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"list_id\":\"${LIST_NEW_LEADS_ID}\",\"contact_id\":\"${CONTACT_1_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"list_id\":\"${LIST_NEW_LEADS_ID}\",\"contact_id\":\"${CONTACT_2_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"list_id\":\"${LIST_FOLLOW_UP_ID}\",\"contact_id\":\"${CONTACT_3_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"list_id\":\"${LIST_FOLLOW_UP_ID}\",\"contact_id\":\"${CONTACT_5_ID}\"}
  ]" >/dev/null

curl -sS -X POST "${SUPABASE_URL}/rest/v1/contact_tag_members" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"tag_id\":\"${TAG_HIGH_INTENT_ID}\",\"contact_id\":\"${CONTACT_1_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"tag_id\":\"${TAG_BOOKED_CALL_ID}\",\"contact_id\":\"${CONTACT_4_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"tag_id\":\"${TAG_NEEDS_DOCS_ID}\",\"contact_id\":\"${CONTACT_5_ID}\"}
  ]" >/dev/null

echo "Inserting demo conversation labels..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_labels" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"id\":\"${LABEL_NEW_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"new\",\"color\":\"#06b6d4\"},
    {\"id\":\"${LABEL_WAITING_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"waiting\",\"color\":\"#f59e0b\"},
    {\"id\":\"${LABEL_ESCALATED_ID}\",\"workspace_id\":\"${WORKSPACE_ID}\",\"name\":\"escalated\",\"color\":\"#ef4444\"}
  ]" >/dev/null

curl -sS -X POST "${SUPABASE_URL}/rest/v1/conversation_labels" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "[
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"conversation_id\":\"${CONVERSATION_1_ID}\",\"label_id\":\"${LABEL_NEW_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"conversation_id\":\"${CONVERSATION_2_ID}\",\"label_id\":\"${LABEL_WAITING_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"conversation_id\":\"${CONVERSATION_4_ID}\",\"label_id\":\"${LABEL_ESCALATED_ID}\"}
  ]" >/dev/null

echo "Inserting demo integration logs..."
curl -sS -X POST "${SUPABASE_URL}/rest/v1/workspace_integration_logs" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "[
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"provider\":\"custom_api\",\"level\":\"info\",\"action\":\"demo_seed\",\"message\":\"Demo workspace initialized.\",\"context\":{\"seed\":\"v3\"},\"source\":\"backend\",\"created_by\":\"${USER_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"provider\":\"calendly\",\"level\":\"warn\",\"action\":\"webhook_retry\",\"message\":\"Calendly webhook retry simulated for demo.\",\"context\":{\"attempt\":2},\"source\":\"backend\",\"created_by\":\"${USER_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"provider\":\"chatgpt\",\"level\":\"info\",\"action\":\"draft_reply\",\"message\":\"AI generated a suggested reply draft.\",\"context\":{\"model\":\"gpt-4o-mini\",\"latency_ms\":842},\"source\":\"backend\",\"created_by\":\"${USER_ID}\"},
    {\"workspace_id\":\"${WORKSPACE_ID}\",\"provider\":\"webhook\",\"level\":\"error\",\"action\":\"post_failed\",\"message\":\"CRM webhook failed with HTTP 502.\",\"context\":{\"endpoint\":\"https://crm.example.local/hook\",\"status\":502},\"source\":\"backend\",\"created_by\":\"${USER_ID}\"}
  ]" >/dev/null

echo "Demo seed complete."
