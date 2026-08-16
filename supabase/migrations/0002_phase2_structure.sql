-- Phase 2: chapters, knowledge points, placements, and one-time seed.
-- This migration is the only schema source for the formal handout structure.

create table if not exists public.workbench_initialization (
  key text primary key,
  initialized_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  parent_id uuid references public.chapters(id) on delete restrict,
  sort_order integer not null default 0,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chapters_title_length check (char_length(title) between 1 and 200)
);

create table if not exists public.knowledge_points (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint knowledge_points_title_length check (char_length(title) between 1 and 200),
  constraint knowledge_points_status_check check (status in ('draft', 'needs_improvement', 'organized'))
);

create table if not exists public.knowledge_point_placements (
  id uuid primary key default gen_random_uuid(),
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete restrict,
  chapter_id uuid not null references public.chapters(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint knowledge_point_one_placement_per_chapter unique (knowledge_point_id, chapter_id)
);

create index if not exists chapters_parent_sort_idx
  on public.chapters(parent_id, sort_order, created_at);

create index if not exists chapters_active_parent_idx
  on public.chapters(parent_id)
  where deleted_at is null;

create index if not exists knowledge_points_active_idx
  on public.knowledge_points(updated_at desc)
  where deleted_at is null;

create index if not exists placements_chapter_sort_idx
  on public.knowledge_point_placements(chapter_id, sort_order, created_at);

create index if not exists placements_knowledge_point_idx
  on public.knowledge_point_placements(knowledge_point_id);

create or replace function public.set_phase2_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chapters_set_updated_at on public.chapters;
create trigger chapters_set_updated_at
before update on public.chapters
for each row
execute function public.set_phase2_updated_at();

drop trigger if exists knowledge_points_set_updated_at on public.knowledge_points;
create trigger knowledge_points_set_updated_at
before update on public.knowledge_points
for each row
execute function public.set_phase2_updated_at();

create or replace function public.prevent_chapter_cycle()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'CHAPTER_CYCLE';
  end if;

  if exists (
    with recursive descendants(id) as (
      select id
      from public.chapters
      where id = new.id
      union all
      select child.id
      from public.chapters child
      join descendants parent_node on child.parent_id = parent_node.id
      where child.deleted_at is null
    )
    select 1
    from descendants
    where id = new.parent_id
  ) then
    raise exception 'CHAPTER_CYCLE';
  end if;

  return new;
end;
$$;

drop trigger if exists chapters_prevent_cycle on public.chapters;
create trigger chapters_prevent_cycle
before insert or update of parent_id on public.chapters
for each row
execute function public.prevent_chapter_cycle();

create or replace function public.create_knowledge_point_with_placement(
  p_title text,
  p_chapter_id uuid
)
returns table (knowledge_point_id uuid, placement_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_knowledge_point_id uuid;
  new_placement_id uuid;
  next_sort_order integer;
begin
  if not exists (
    select 1 from public.chapters
    where id = p_chapter_id and deleted_at is null
  ) then
    raise exception 'CHAPTER_NOT_FOUND';
  end if;

  select coalesce(max(sort_order) + 1, 0)
  into next_sort_order
  from public.knowledge_point_placements
  where chapter_id = p_chapter_id;

  insert into public.knowledge_points(title)
  values (p_title)
  returning id into new_knowledge_point_id;

  insert into public.knowledge_point_placements(
    knowledge_point_id,
    chapter_id,
    sort_order
  )
  values (
    new_knowledge_point_id,
    p_chapter_id,
    next_sort_order
  )
  returning id into new_placement_id;

  return query select new_knowledge_point_id, new_placement_id;
end;
$$;

create or replace function public.reorder_chapter_siblings(
  p_parent_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  select count(*) into expected_count
  from public.chapters
  where parent_id is not distinct from p_parent_id
    and deleted_at is null;

  if expected_count <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'INVALID_CHAPTER_ORDER';
  end if;

  if exists (
    select id
    from unnest(p_ids) as item(id)
    group by id
    having count(*) > 1
  ) then
    raise exception 'INVALID_CHAPTER_ORDER';
  end if;

  update public.chapters chapter
  set sort_order = ordered.position - 1
  from unnest(p_ids) with ordinality as ordered(id, position)
  where chapter.id = ordered.id
    and chapter.parent_id is not distinct from p_parent_id
    and chapter.deleted_at is null;
end;
$$;

create or replace function public.reorder_knowledge_point_placements(
  p_chapter_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  select count(*) into expected_count
  from public.knowledge_point_placements placement
  join public.knowledge_points point on point.id = placement.knowledge_point_id
  where placement.chapter_id = p_chapter_id
    and point.deleted_at is null;

  if expected_count <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'INVALID_KNOWLEDGE_POINT_ORDER';
  end if;

  if exists (
    select id
    from unnest(p_ids) as item(id)
    group by id
    having count(*) > 1
  ) then
    raise exception 'INVALID_KNOWLEDGE_POINT_ORDER';
  end if;

  update public.knowledge_point_placements placement
  set sort_order = ordered.position - 1
  from unnest(p_ids) with ordinality as ordered(id, position)
  where placement.id = ordered.id
    and placement.chapter_id = p_chapter_id
    and exists (
      select 1
      from public.knowledge_points point
      where point.id = placement.knowledge_point_id
        and point.deleted_at is null
    );
end;
$$;

alter table public.workbench_initialization enable row level security;
alter table public.chapters enable row level security;
alter table public.knowledge_points enable row level security;
alter table public.knowledge_point_placements enable row level security;

do $$
declare
  inserted_count integer;
begin
  insert into public.workbench_initialization(key)
  values ('phase2_default_chapters')
  on conflict (key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.chapters(title, parent_id, sort_order)
    values
      ('名词', null, 0),
      ('冠词', null, 1),
      ('代词', null, 2),
      ('形容词副词', null, 3),
      ('数词', null, 4),
      ('介词', null, 5),
      ('连词', null, 6),
      ('动词', null, 7),
      ('时态', null, 8),
      ('语态', null, 9),
      ('非谓语动词', null, 10),
      ('定语从句', null, 11),
      ('状语从句', null, 12),
      ('名词性从句', null, 13),
      ('特殊句式', null, 14),
      ('主谓一致', null, 15),
      ('虚拟语气', null, 16),
      ('其他专题', null, 17);
  end if;
end;
$$;
