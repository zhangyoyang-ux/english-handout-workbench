-- Phase 3: one structured core-content record per knowledge point.
-- Content is kept separate from placements so the future reference system can
-- reuse the same core content without mixing in chapter-specific supplements.

create table if not exists public.knowledge_point_contents (
  id uuid primary key default gen_random_uuid(),
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete restrict,
  explanation jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  exercises jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  supplement jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  inspiration jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_point_contents_one_per_point unique (knowledge_point_id)
);

create index if not exists knowledge_point_contents_updated_idx
  on public.knowledge_point_contents(updated_at desc);

create or replace function public.set_phase3_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_point_contents_set_updated_at on public.knowledge_point_contents;
create trigger knowledge_point_contents_set_updated_at
before update on public.knowledge_point_contents
for each row
execute function public.set_phase3_content_updated_at();

alter table public.knowledge_point_contents enable row level security;
