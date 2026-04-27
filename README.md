# BrandoChat

BrandoChat is an open-source WhatsApp team workspace and automation platform.

Website: [brandochat.com](https://brandochat.com)  

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
- `DATABASE_URL` (optional, enables one-click schema bootstrap from Docker Compose)
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

## Demo setup (same UI, local demo DB)

BrandoChat supports a demo environment that uses the same frontend/backend code, but runs against a local Supabase stack with seeded dummy data.

### What this gives you

- Same production UI/UX
- Same backend logic
- Separate demo data and credentials
- Easy reset/reseed flow

### Demo files in this repo

- `docker-compose.demo.yml`
- `.env.demo.example`
- `scripts/demo/init-demo-db.sh`
- `scripts/demo/bootstrap-local-demo.sh`
- `scripts/demo/seed-demo-data.sh`
- `scripts/demo/stop-demo.sh`

### Prerequisites

- Docker + Docker Compose
- Supabase CLI
- `jq`
- `curl`

### Start demo locally

```bash
bash scripts/demo/bootstrap-local-demo.sh
```

This script will:
1. Start local Supabase OSS stack (`supabase start` runs official open-source Docker services)
2. Generate `.env.demo` from local Supabase keys
3. Reset local DB with migrations
4. Seed demo user/workspace/sample records
5. Start demo frontend + backend containers

Demo URLs:
- Frontend: `http://localhost:15173`
- Backend: `http://localhost:13847`

Demo login:
- Email: `demo@brandochat.local`
- Password: `DemoPass123!`
- In demo mode, the login page also shows a **Use demo account** button.

### One-click auto bootstrap on deploy

You can make first deploy self-initializing (schema + demo data) with Docker Compose:

1. Set `DATABASE_URL` in `.env` (or `.env.demo`) to your Postgres endpoint.
2. Run `docker compose up -d --build` (or demo compose variant).
3. Compose runs a one-shot `db-init` service before backend:
   - checks `public.workspaces`,
   - runs `supabase/migrations/*.sql` if schema is missing,
   - runs `scripts/demo/seed-demo-data.sh`.

If schema already exists, migrations are skipped and seed runs idempotently.

### How demo Supabase is set up

- Supabase is not mocked. It runs locally via Supabase OSS Docker services started by CLI.
- Database schema comes from your real migrations (`supabase/migrations/*`).
- Demo records are inserted by `scripts/demo/seed-demo-data.sh` including:
  - multiple contacts,
  - conversations and message events,
  - contact lists and tags (+ memberships),
  - automations and automation run logs,
  - workspace labels and conversation labels,
  - integration logs.
- Every reset/restart can recreate a clean demo state.

### Demo deployment branch strategy

- Keep this demo stack on a dedicated branch (e.g. `demo` or `demo-stack`).
- Deploy your demo environment from that branch.
- Keep production branch clean and merge demo changes selectively.

### Why demo still uses Supabase

The current frontend reads/writes many entities directly via Supabase client + RLS.
To avoid maintaining a second demo UI/backend codebase, demo mode keeps this same architecture and uses:
- dedicated demo Supabase data,
- seeded demo user/workspace,
- one-click demo login helper in the UI.

### Stop demo

```bash
bash scripts/demo/stop-demo.sh
```

### Reseed demo data only

```bash
bash scripts/demo/seed-demo-data.sh
```

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

Create `.env` in the **repository root** (copy from `.env.demo.example` or start empty):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

#### B) Backend `.env` (server/runtime secrets)

Create `automation-platform/backend/.env` (see `automation-platform/backend/.env.example`):

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

This repository is **open source**: do not commit real API keys, Supabase **service_role** keys, database passwords, Calendly tokens, or WhatsApp session data.

- Keep **service_role** and database URLs **backend-only**; never bake them into the frontend bundle.
- Never commit `.env` files (they are gitignored); use only `.env.example` / `.env.demo.example` with placeholders.
- Keep `supabase/config.toml` **project_id** as a placeholder locally; run `supabase link` for your real ref (that ref is not a signing key but identifies your project).
- Demo login defaults (`demo@brandochat.local` / `DemoPass123!`) are **intentionally public** for the hosted demo only—change them for any private deployment.
- Persist and protect WhatsApp auth state storage (`WA_AUTH_ROOT`); do not commit `data/wa_sessions/`.

## Project status

BrandoChat is actively evolving. Some modules are production-ready, others are still being expanded.

If you deploy to production:
- apply migrations first,
- verify env vars,
- test one full WhatsApp flow end-to-end before scaling.
