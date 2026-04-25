create table if not exists public.workspace_contact_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#10b981',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.contact_list_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null references public.workspace_contact_lists (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);

create table if not exists public.workspace_contact_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text not null default '#0ea5e9',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.contact_tag_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tag_id uuid not null references public.workspace_contact_tags (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, contact_id)
);

create index if not exists workspace_contact_lists_workspace_idx
  on public.workspace_contact_lists (workspace_id, name);

create index if not exists contact_list_members_workspace_idx
  on public.contact_list_members (workspace_id, contact_id);

create index if not exists workspace_contact_tags_workspace_idx
  on public.workspace_contact_tags (workspace_id, name);

create index if not exists contact_tag_members_workspace_idx
  on public.contact_tag_members (workspace_id, contact_id);

create trigger workspace_contact_lists_updated_at
  before update on public.workspace_contact_lists
  for each row execute procedure public.set_updated_at();

create trigger workspace_contact_tags_updated_at
  before update on public.workspace_contact_tags
  for each row execute procedure public.set_updated_at();

alter table public.workspace_contact_lists enable row level security;
alter table public.contact_list_members enable row level security;
alter table public.workspace_contact_tags enable row level security;
alter table public.contact_tag_members enable row level security;

create policy workspace_contact_lists_all_member
  on public.workspace_contact_lists for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy contact_list_members_all_member
  on public.contact_list_members for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy workspace_contact_tags_all_member
  on public.workspace_contact_tags for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy contact_tag_members_all_member
  on public.contact_tag_members for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
