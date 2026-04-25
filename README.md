# BrandoChat Automation Platform

BrandoChat is a WhatsApp-first customer communication and automation platform built with:

- **Frontend**: React + Vite + Tailwind + Supabase JS
- **Backend**: Node.js + Express + Baileys + Supabase Service Role
- **Database**: Supabase Postgres with RLS + SQL migrations
- **AI**: OpenAI/ChatGPT API for reply routing and automation skills

It is designed for teams that want a single workspace to:

- manage WhatsApp conversations at scale,
- assign chats to teammates,
- automate actions/replies,
- connect external systems (Calendly, ChatGPT API, custom integrations),
- and keep a complete event/log trail.

---

## What this project can do

### Inbox and conversation management

- Unified inbox with:
  - all conversations,
  - assigned-to-me,
  - unread views.
- Contact-centric chat timeline with inbound/outbound message history.
- Manual and automatic read/unread handling.
- Assign chats to team members.
- Labels and status updates on conversations.

### Contact management

- Create/edit contacts with WhatsApp JID, phone, names, notes.
- Store rich custom attributes (string/date/datetime/url/integer).
- Organize contacts with:
  - **Lists**
  - **Tags**
- Bulk add selected contacts to lists/tags.

### WhatsApp integration (Baileys)

- Multi-instance WhatsApp support per workspace.
- Connect/disconnect sessions and monitor pairing state.
- Sync chat history and contact/message metadata.
- Send outbound WhatsApp messages via backend socket layer.

### Automation engine

- Trigger-based automation execution:
  - message/conversation triggers,
  - webhook triggers,
  - calendly event triggers.
- Graph-based workflow builder with nodes like:
  - send template,
  - condition,
  - branch/AI routing,
  - update contact,
  - assign conversation,
  - delay,
  - webhook response,
  - AI skill.
- Automation activity and execution trace visibility.

### Integrations

- Card-based integrations UX.
- Calendly integration:
  - token setup,
  - webhook subscription creation,
  - event ingestion,
  - logs and event monitoring.
- ChatGPT API integration settings:
  - api key,
  - base URL,
  - model.
- Extensible integration schema for future providers.

---

## Baileys / WhatsApp socket architecture

This project uses **Baileys** (from WhiskeySockets) as the WhatsApp Web protocol client in the backend.

At a high level:

1. Backend creates and maintains WhatsApp socket sessions per workspace instance.
2. Incoming WhatsApp events are normalized and written into Supabase (`message_events`, contact metadata updates, conversation state updates).
3. Outbound sends are executed through Baileys socket methods from backend routes/automation nodes.
4. Session auth files are stored on disk under `WA_AUTH_ROOT` (not in Supabase).

Important operational note:

- Supabase stores conversation/contact/message records and instance metadata.
- **Baileys auth/session keys are filesystem-based** and must be persisted as volume data in production.
- If you migrate servers and do not copy `WA_AUTH_ROOT`, sessions must be paired again.

References:

- [Baileys GitHub repository](https://github.com/WhiskeySockets/Baileys)
- [Baileys documentation site](https://baileys.wiki/)

---

## Repository layout

- `automation-platform/frontend` – React application
- `automation-platform/backend` – Express API + Baileys + automation engine
- `supabase/migrations` – database schema and feature migrations
- `docker-compose.yml` – deployment composition for frontend/backend

---

## Key data model highlights

- Workspace and team:
  - `workspaces`
  - `workspace_members`
  - `workspace_invitations`
- Conversations:
  - `contacts`
  - `conversations`
  - `message_events`
- Organization:
  - `workspace_labels`
  - `conversation_labels`
  - `workspace_contact_lists`
  - `contact_list_members`
  - `workspace_contact_tags`
  - `contact_tag_members`
- Integrations:
  - `workspace_integrations`
  - `workspace_integration_logs`
  - `workspace_calendly_webhooks`
  - `calendly_webhook_events`
- Automation:
  - `automations`
  - `automation_runs`
  - `webhook_triggers`

---

## Local development

### Prerequisites

- Node.js 20+ (22 recommended)
- npm
- Supabase CLI
- Access to your Supabase project

### 1) Install dependencies

```bash
cd automation-platform/backend && npm install
cd ../frontend && npm install
```

### 2) Configure environment

Backend env file:

- `automation-platform/backend/.env`

Required keys:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (optional for non-AI flows)
- `OPENAI_MODEL` (optional)
- `WA_AUTH_ROOT` (optional, defaults to `./data/wa_sessions`)

Frontend uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 3) Apply database migrations

```bash
supabase db push
```

### 4) Run backend and frontend

```bash
# backend
cd automation-platform/backend
npm run dev

# frontend (new terminal)
cd automation-platform/frontend
npm run dev
```

---

## Docker deployment (frontend + backend)

This repo includes:

- `docker-compose.yml`
- `automation-platform/backend/Dockerfile`
- `automation-platform/frontend/Dockerfile`
- Nginx config for frontend `/api` proxying to backend.

### 1) Configure root `.env`

Create root `.env` (for compose build args) from `.env.example`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Backend secrets stay in:

- `automation-platform/backend/.env`

### 2) Build and run

```bash
docker compose up -d --build
```

### 3) Endpoints

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3847`

### 4) Persisting WhatsApp sessions

`docker-compose.yml` mounts a named volume for:

- `/app/data/wa_sessions`

Back up/restore this volume when moving servers to keep paired sessions alive.

---

## Security and secret handling

- Service role keys and OpenAI keys are backend-only.
- Frontend should only use public Supabase anon credentials.
- `.gitignore` excludes sensitive files, env files, keys/certs, and auth/session data.
- Do not commit:
  - `.env*` secrets
  - service account JSON files
  - TLS private keys
  - Baileys session directories.

---

## Troubleshooting

### Error: `Could not find the table 'public.workspace_contact_lists' in the schema cache`

Cause:

- Migrations were not applied to the connected Supabase project.

Fix:

```bash
supabase db push
```

Then refresh the app.

### WhatsApp shows disconnected after server migration

Cause:

- `WA_AUTH_ROOT` files were not copied to new host/volume.

Fix:

- Restore/copy session folder to mounted volume path.
- Ensure one backend process owns a given session at a time.

### Calendly webhook not processing

Check:

- token saved correctly,
- webhook callback URL is reachable,
- signing key matches,
- events/scope are valid for Calendly API.

Inspect:

- integration logs in UI,
- `calendly_webhook_events` table.

---

## Current status

This is an actively evolving platform with rapid iteration across:

- inbox UX,
- automation capabilities,
- integrations,
- and deployment hardening.

If you are deploying to production, run migrations first, verify environment variables, and test one WhatsApp instance end-to-end before scaling.
