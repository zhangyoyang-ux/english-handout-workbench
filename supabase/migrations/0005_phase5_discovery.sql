-- Phase 5: server-side discovery and lightweight personal access metadata.
-- This migration is additive. It does not remove or recreate Phase 1-4 data.

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_length check (char_length(name) between 1 and 80)
);

create table if not exists public.knowledge_point_tags (
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete restrict,
  tag_id uuid not null references public.tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (knowledge_point_id, tag_id)
);

create table if not exists public.favorite_items (
  knowledge_point_id uuid primary key references public.knowledge_points(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.pinned_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null,
  item_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint pinned_item_type_check check (item_type in ('chapter', 'knowledge_point')),
  constraint pinned_item_identity unique (item_type, item_id)
);

create index if not exists knowledge_point_tags_tag_idx
  on public.knowledge_point_tags(tag_id, knowledge_point_id);

create index if not exists favorite_items_created_idx
  on public.favorite_items(created_at desc);

create index if not exists pinned_items_order_idx
  on public.pinned_items(sort_order, created_at);

create or replace function public.set_phase5_tag_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at
before update on public.tags
for each row
execute function public.set_phase5_tag_updated_at();

alter table public.tags enable row level security;
alter table public.knowledge_point_tags enable row level security;
alter table public.favorite_items enable row level security;
alter table public.pinned_items enable row level security;

do $$
declare
  inserted_count integer;
begin
  insert into public.workbench_initialization(key)
  values ('phase5_default_tags')
  on conflict (key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.tags(name)
    values ('高频'), ('易错'), ('基础'), ('提高'), ('真题常考')
    on conflict (name) do nothing;
  end if;
end;
$$;

-- Search remains on the server. The browser never downloads all rich content
-- to perform a local search. ILIKE gives useful Chinese and English substring
-- matching (for example, "hardl" matches "hardly") without a required
-- extension or a second search service.
create or replace function public.search_workbench(
  p_query text,
  p_status text default null,
  p_tag_id uuid default null
)
returns table (
  point_id uuid,
  title text,
  status text,
  updated_at timestamptz,
  placement_id uuid,
  chapter_id uuid,
  match_type text,
  match_text text,
  tag_name text
)
language sql
stable
security definer
set search_path = public
as $$
with active_points as (
  select
    point.id,
    point.title,
    point.status,
    greatest(point.updated_at, coalesce(content.updated_at, point.updated_at)) as updated_at,
    content.explanation::text as explanation_text,
    content.exercises::text as exercises_text,
    content.supplement::text as supplement_text,
    content.inspiration::text as inspiration_text
  from public.knowledge_points point
  left join public.knowledge_point_contents content
    on content.knowledge_point_id = point.id
  where point.deleted_at is null
    and (p_status is null or point.status = p_status)
    and (
      p_tag_id is null
      or exists (
        select 1
        from public.knowledge_point_tags selected_tag
        where selected_tag.knowledge_point_id = point.id
          and selected_tag.tag_id = p_tag_id
      )
    )
), query_value as (
  select lower(trim(coalesce(p_query, ''))) as q
)
select point.id, point.title, point.status, point.updated_at, null::uuid, null::uuid,
  'title', point.title, null::text
from active_points point, query_value
where query_value.q <> '' and lower(point.title) like '%' || query_value.q || '%'
union all
select point.id, point.title, point.status, point.updated_at, null::uuid, null::uuid,
  'explanation', point.explanation_text, null::text
from active_points point, query_value
where query_value.q <> '' and lower(coalesce(point.explanation_text, '')) like '%' || query_value.q || '%'
union all
select point.id, point.title, point.status, point.updated_at, null::uuid, null::uuid,
  'exercises', point.exercises_text, null::text
from active_points point, query_value
where query_value.q <> '' and lower(coalesce(point.exercises_text, '')) like '%' || query_value.q || '%'
union all
select point.id, point.title, point.status, point.updated_at, null::uuid, null::uuid,
  'supplement', point.supplement_text, null::text
from active_points point, query_value
where query_value.q <> '' and lower(coalesce(point.supplement_text, '')) like '%' || query_value.q || '%'
union all
select point.id, point.title, point.status, point.updated_at, null::uuid, null::uuid,
  'inspiration', point.inspiration_text, null::text
from active_points point, query_value
where query_value.q <> '' and lower(coalesce(point.inspiration_text, '')) like '%' || query_value.q || '%'
union all
select point.id, point.title, point.status, point.updated_at,
  placement.id, placement.chapter_id, 'chapter_note', placement.chapter_note::text, null::text
from active_points point
join public.knowledge_point_placements placement
  on placement.knowledge_point_id = point.id and placement.deleted_at is null
join public.chapters chapter
  on chapter.id = placement.chapter_id and chapter.deleted_at is null
cross join query_value
where query_value.q <> '' and lower(placement.chapter_note::text) like '%' || query_value.q || '%'
union all
select distinct point.id, point.title, point.status, point.updated_at,
  null::uuid, null::uuid, 'tag', tag.name, tag.name
from active_points point
join public.knowledge_point_tags point_tag on point_tag.knowledge_point_id = point.id
join public.tags tag on tag.id = point_tag.tag_id
cross join query_value
where query_value.q <> '' and lower(tag.name) like '%' || query_value.q || '%';
$$;

create or replace function public.recent_workbench_edits(p_limit integer default 6)
returns table (
  item_type text,
  item_id uuid,
  title text,
  status text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
select item_type, item_id, title, status, updated_at
from (
  select 'chapter'::text as item_type, chapter.id as item_id, chapter.title,
    null::text as status, chapter.updated_at
  from public.chapters chapter
  where chapter.deleted_at is null
  union all
  select 'knowledge_point'::text, point.id, point.title, point.status,
    greatest(point.updated_at, coalesce(content.updated_at, point.updated_at))
  from public.knowledge_points point
  left join public.knowledge_point_contents content
    on content.knowledge_point_id = point.id
  where point.deleted_at is null
) recent
order by updated_at desc
limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;
