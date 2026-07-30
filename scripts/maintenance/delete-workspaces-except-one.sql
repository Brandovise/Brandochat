-- Keep a single workspace and delete all others (children cascade via FK).
--
-- Run in Supabase Dashboard → SQL Editor, or: psql "$DATABASE_URL" -f thisfile.sql
-- Use a role that bypasses RLS (dashboard / postgres), not the anon key from the browser.
--
-- 1) List workspaces — decide which id or slug to KEEP.
-- 2) Run one of the transactions below after substituting your keeper.

SELECT id, name, slug, created_at
FROM public.workspaces
ORDER BY created_at;

-- Example A — keep one UUID, delete all others:
--
-- BEGIN;
-- DELETE FROM public.workspaces
-- WHERE id <> 'YOUR-WORKSPACE-UUID-HERE'::uuid;
-- COMMIT;

-- Example B — keep by slug (e.g. demo seed uses brandochat-demo):
--
-- BEGIN;
-- DELETE FROM public.workspaces
-- WHERE slug IS DISTINCT FROM 'brandochat-demo';
-- COMMIT;
