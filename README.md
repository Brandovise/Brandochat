# BrandoChat

BrandoChat is an open-source WhatsApp team workspace and automation platform.

Website: [brandochat.com](https://brandochat.com)  
Website repo: [brandovise25/brandochat-website](https://github.com/brandovise25/brandochat-website)

## Our aim

We are building BrandoChat so everybody can automate repetitive communication work and collaborate in teams from one shared inbox.

Core idea:
- connect multiple WhatsApp numbers into one workspace,
- let teams work together (sales, support, ops),
- automate repetitive tasks and follow-ups,
- integrate with external tools via webhooks and connectors.

## What we are building

- Shared inbox with assignment, labels, status, unread views
- Contact management with tags, lists, and custom fields
- WhatsApp session management using Baileys
- Automation builder with triggers, conditions, routing, delay, actions
- Integration layer (Calendly, webhooks, and upcoming connectors)
- Activity logs and execution traces for team visibility

## Current stack

- **Frontend**: React + Vite + Supabase JS
- **Backend**: Node.js + Express + Baileys
- **Database**: Supabase Postgres + SQL migrations
- **Automation/AI**: rule engine + optional OpenAI integration

## How BrandoChat works (high level)

1. Messages arrive from connected WhatsApp accounts.
2. Conversations are stored and shown in a shared team inbox.
3. Team members can assign, reply, update status, and collaborate.
4. Automations can trigger actions (routing, updates, follow-ups, webhooks).
5. Logs keep all activity traceable.

## Repository structure

- `automation-platform/frontend` - React app
- `automation-platform/backend` - Express API, WhatsApp socket runtime, automations
- `supabase/migrations` - schema and migration history
- `docker-compose.yml` - local/prod-style composition

## Local development

### Prerequisites

- Node.js 20+ (22 recommended)
- npm
- Supabase CLI
- Supabase project access

### Install dependencies

```bash
cd automation-platform/backend && npm install
cd ../frontend && npm install
```

### Configure environment

Backend file:
- `automation-platform/backend/.env`

Required backend keys:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WA_AUTH_ROOT` (optional, default `./data/wa_sessions`)
- `OPENAI_API_KEY` (optional)
- `OPENAI_MODEL` (optional)

Frontend keys:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Run migrations

```bash
supabase db push
```

### Start app

```bash
# backend
cd automation-platform/backend
npm run dev

# frontend (new terminal)
cd automation-platform/frontend
npm run dev
```

## Docker

```bash
docker compose up -d --build
```

Default endpoints:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3847`

## Production deployment guide

This section covers the minimum setup to deploy BrandoChat with Supabase + Docker Compose.

### 1) Supabase project setup

1. Create or select your Supabase project.
2. Copy these values from Supabase project settings:
   - `Project URL` -> `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `anon public key` -> `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - `service_role key` -> `SUPABASE_SERVICE_ROLE_KEY` (backend only)
3. Ensure the target DB is the one your app will use in production.

### 2) Apply migrations to Supabase

From repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

If `supabase db push` fails, fix the error before deploying app containers.

### 3) Configure environment files

#### A) Root `.env` (used by Docker Compose / frontend build args)

Create `/home/jibran-shahid/Work/Documents/GitHub_Work/202604_Superchat_OpenSouurce/.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

#### B) Backend `.env` (server/runtime secrets)

Create `/home/jibran-shahid/Work/Documents/GitHub_Work/202604_Superchat_OpenSouurce/automation-platform/backend/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

# WhatsApp session storage path inside backend container/runtime
WA_AUTH_ROOT=./data/wa_sessions

# Optional AI settings
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Notes:
- `SUPABASE_SERVICE_ROLE_KEY` must stay backend-only.
- Do not expose backend `.env` in frontend builds.

### 4) Deploy with Docker Compose

From repository root:

```bash
docker compose up -d --build
```

Check status/logs:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

### 5) Post-deploy checklist

- Open frontend (`http://localhost:5173` or your domain).
- Verify backend health/API routes (`http://localhost:3847`).
- Test login/workspace access.
- Pair one WhatsApp instance and send/receive test messages.
- Trigger one automation and confirm run logs.

## In-app onboarding: what to accept

When setting up BrandoChat in the app UI, these are the main confirmations/permissions to accept:

1. **Workspace setup**
   - Create/select your workspace.
   - Confirm teammate access and roles for team collaboration.

2. **WhatsApp connection (Baileys pairing)**
   - Pair the WhatsApp account by scanning QR.
   - Confirm Linked Devices approval on the phone.
   - Keep session storage persistent (`WA_AUTH_ROOT`) so pairing remains active.

3. **Integration permissions**
   - **Calendly**: approve webhook/token permissions needed for events.
   - **Webhooks**: allow your endpoint URLs and verify signatures/secrets.
   - **OpenAI (optional)**: add API key and model only if AI features are required.

4. **Automation safety confirmations**
   - Start with one test flow first.
   - Validate trigger conditions and recipients before enabling full automation.
   - Keep logs enabled and monitor first production runs.

5. **Compliance and usage confirmations**
   - Use responsibly and follow local regulations/platform policies.
   - Avoid spam or abusive bulk messaging behavior.

### 6) Persistence and backups

- Persist WhatsApp auth/session data (`WA_AUTH_ROOT`) using durable volume/storage.
- Back up this data before host migration.
- If auth data is lost, WhatsApp instances must be paired again.

### 7) Updating production

```bash
git pull
supabase db push
docker compose up -d --build
```

Run migrations before or during deploy window to avoid schema drift.

## Important implementation notes

- BrandoChat uses **Baileys** for WhatsApp Web protocol integration.
- This is **not** WhatsApp Business API (WABA) usage.
- Persist `WA_AUTH_ROOT` storage when moving servers, or sessions must be re-paired.
- Use responsibly and comply with local regulations and platform policies.

## Security basics

- Keep service keys backend-only.
- Never commit `.env` secrets or session/auth directories.
- Persist and protect WhatsApp auth state storage.

## Project status

BrandoChat is actively evolving. Some modules are production-ready, others are still being expanded.

If you deploy to production:
- apply migrations first,
- verify env vars,
- test one full WhatsApp flow end-to-end before scaling.
