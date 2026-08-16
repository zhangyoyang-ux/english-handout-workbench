-- Phase 8: reversible history snapshots and recycle-bin metadata.
-- This migration is additive. It never drops, truncates, reseeds, or changes
-- existing UUIDs.

alter table public.chapters
  add column if not exists deletion_batch_id uuid;

alter table public.knowledge_points
  add column if not exists deletion_batch_id uuid;

alter table public.knowledge_point_placements
  add column if not exists deletion_batch_id uuid;

create index if not exists chapters_deleted_batch_idx
  on public.chapters(deletion_batch_id)
  where deleted_at is not null;

create index if not exists knowledge_points_deleted_batch_idx
  on public.knowledge_points(deletion_batch_id)
  where deleted_at is not null;

create index if not exists placements_deleted_batch_idx
  on public.knowledge_point_placements(deletion_batch_id)
  where deleted_at is not null;

create table if not exists public.knowledge_point_versions (
  id uuid primary key default gen_random_uuid(),
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete restrict,
  snapshot jsonb not null,
  content_hash text not null,
  version_source text not null default 'edit_session',
  created_at timestamptz not null default now(),
  constraint knowledge_point_versions_hash_length check (char_length(content_hash) between 1 and 128),
  constraint knowledge_point_versions_source_length check (char_length(version_source) between 1 and 40),
  constraint knowledge_point_versions_unique_hash unique (knowledge_point_id, content_hash)
);

create table if not exists public.placement_note_versions (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.knowledge_point_placements(id) on delete restrict,
  chapter_note_snapshot jsonb not null,
  content_hash text not null,
  version_source text not null default 'edit_session',
  created_at timestamptz not null default now(),
  constraint placement_note_versions_hash_length check (char_length(content_hash) between 1 and 128),
  constraint placement_note_versions_source_length check (char_length(version_source) between 1 and 40),
  constraint placement_note_versions_unique_hash unique (placement_id, content_hash)
);

create index if not exists knowledge_point_versions_created_idx
  on public.knowledge_point_versions(knowledge_point_id, created_at desc);

create index if not exists placement_note_versions_created_idx
  on public.placement_note_versions(placement_id, created_at desc);

alter table public.knowledge_point_versions enable row level security;
alter table public.placement_note_versions enable row level security;

-- The Edge Function calls this function with the service-role client. The
-- unique hash constraint makes repeated autosave/session requests harmless.
create or replace function public.soft_delete_chapter_tree(
  p_chapter_id uuid,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chapter_ids uuid[];
  placement_count integer;
  child_count integer;
  deletion_batch uuid;
  deleted_at_value timestamptz := now();
begin
  if not exists (
    select 1 from public.chapters
    where id = p_chapter_id and deleted_at is null
  ) then
    raise exception 'CHAPTER_NOT_FOUND';
  end if;

  with recursive descendants(id) as (
    select id from public.chapters where id = p_chapter_id and deleted_at is null
    union all
    select child.id
    from public.chapters child
    join descendants parent_node on child.parent_id = parent_node.id
    where child.deleted_at is null
  )
  select array_agg(id order by id) into chapter_ids from descendants;

  select count(*) into child_count
  from unnest(chapter_ids) as ids(id)
  where ids.id <> p_chapter_id;
  select count(*) into placement_count
  from public.knowledge_point_placements placement
  where placement.chapter_id = any(chapter_ids)
    and placement.deleted_at is null;

  if not p_confirm and (child_count > 0 or placement_count > 0) then
    return jsonb_build_object(
      'blocked', true,
      'child_count', child_count,
      'knowledge_point_count', placement_count
    );
  end if;

  deletion_batch := gen_random_uuid();

  update public.chapters
  set deleted_at = deleted_at_value,
      deletion_batch_id = deletion_batch
  where id = any(chapter_ids)
    and deleted_at is null;

  update public.knowledge_point_placements
  set deleted_at = deleted_at_value,
      deletion_batch_id = deletion_batch
  where chapter_id = any(chapter_ids)
    and deleted_at is null;

  return jsonb_build_object(
    'blocked', false,
    'child_count', child_count,
    'knowledge_point_count', placement_count,
    'deletion_batch_id', deletion_batch
  );
end;
$$;

create or replace function public.soft_delete_knowledge_point(
  p_knowledge_point_id uuid,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  placement_count integer;
  deletion_batch uuid;
  deleted_at_value timestamptz := now();
begin
  if not exists (
    select 1 from public.knowledge_points
    where id = p_knowledge_point_id and deleted_at is null
  ) then
    raise exception 'KNOWLEDGE_POINT_NOT_FOUND';
  end if;

  select count(*) into placement_count
  from public.knowledge_point_placements
  where knowledge_point_id = p_knowledge_point_id
    and deleted_at is null;

  if not p_confirm and placement_count > 1 then
    return jsonb_build_object('blocked', true, 'placement_count', placement_count);
  end if;

  deletion_batch := gen_random_uuid();

  update public.knowledge_points
  set deleted_at = deleted_at_value,
      deletion_batch_id = deletion_batch
  where id = p_knowledge_point_id
    and deleted_at is null;

  update public.knowledge_point_placements
  set deleted_at = deleted_at_value,
      deletion_batch_id = deletion_batch
  where knowledge_point_id = p_knowledge_point_id
    and deleted_at is null;

  return jsonb_build_object(
    'blocked', false,
    'placement_count', placement_count,
    'deletion_batch_id', deletion_batch
  );
end;
$$;

create or replace function public.restore_knowledge_point_version(
  p_knowledge_point_id uuid,
  p_version_id uuid,
  p_current_snapshot jsonb,
  p_current_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_snapshot jsonb;
  target_content jsonb;
  target_title text;
  target_status text;
begin
  select snapshot into target_snapshot
  from public.knowledge_point_versions
  where id = p_version_id
    and knowledge_point_id = p_knowledge_point_id;

  if target_snapshot is null then
    raise exception 'HISTORY_VERSION_NOT_FOUND';
  end if;

  insert into public.knowledge_point_versions(
    knowledge_point_id, snapshot, content_hash, version_source
  )
  values (
    p_knowledge_point_id, p_current_snapshot, p_current_hash, 'before_restore'
  )
  on conflict (knowledge_point_id, content_hash) do nothing;

  target_title := target_snapshot ->> 'title';
  target_status := target_snapshot ->> 'status';
  target_content := coalesce(target_snapshot -> 'content', '{}'::jsonb);

  if target_title is null or target_status not in ('draft', 'needs_improvement', 'organized') then
    raise exception 'HISTORY_SNAPSHOT_INVALID';
  end if;

  update public.knowledge_points
  set title = target_title,
      status = target_status
  where id = p_knowledge_point_id
    and deleted_at is null;

  if not found then
    raise exception 'KNOWLEDGE_POINT_NOT_FOUND';
  end if;

  insert into public.knowledge_point_contents(
    knowledge_point_id, explanation, exercises, supplement, inspiration
  )
  values (
    p_knowledge_point_id,
    coalesce(target_content -> 'explanation', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
    coalesce(target_content -> 'exercises', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
    coalesce(target_content -> 'supplement', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
    coalesce(target_content -> 'inspiration', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb)
  )
  on conflict (knowledge_point_id) do update set
    explanation = excluded.explanation,
    exercises = excluded.exercises,
    supplement = excluded.supplement,
    inspiration = excluded.inspiration;

  return jsonb_build_object('restored', true, 'knowledge_point_id', p_knowledge_point_id);
end;
$$;

create or replace function public.restore_placement_note_version(
  p_placement_id uuid,
  p_version_id uuid,
  p_current_snapshot jsonb,
  p_current_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_snapshot jsonb;
begin
  select chapter_note_snapshot into target_snapshot
  from public.placement_note_versions
  where id = p_version_id
    and placement_id = p_placement_id;

  if target_snapshot is null then
    raise exception 'HISTORY_VERSION_NOT_FOUND';
  end if;

  insert into public.placement_note_versions(
    placement_id, chapter_note_snapshot, content_hash, version_source
  )
  values (
    p_placement_id, p_current_snapshot, p_current_hash, 'before_restore'
  )
  on conflict (placement_id, content_hash) do nothing;

  update public.knowledge_point_placements
  set chapter_note = target_snapshot
  where id = p_placement_id
    and deleted_at is null;

  if not found then
    raise exception 'PLACEMENT_NOT_FOUND';
  end if;

  return jsonb_build_object('restored', true, 'placement_id', p_placement_id);
end;
$$;

create or replace function public.restore_chapter_tree(
  p_chapter_id uuid,
  p_restore_parent_chain boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_batch uuid;
  parent_deleted boolean;
  restored_chapters integer := 0;
  restored_placements integer := 0;
begin
  select deletion_batch_id into target_batch
  from public.chapters
  where id = p_chapter_id and deleted_at is not null;

  if not found then
    raise exception 'RECYCLE_ITEM_NOT_FOUND';
  end if;

  with recursive ancestors(id, parent_id, deleted_at) as (
    select id, parent_id, deleted_at from public.chapters where id = p_chapter_id
    union all
    select parent.id, parent.parent_id, parent.deleted_at
    from public.chapters parent
    join ancestors child on parent.id = child.parent_id
  )
  select exists(select 1 from ancestors where id <> p_chapter_id and deleted_at is not null)
  into parent_deleted;

  if parent_deleted and not p_restore_parent_chain then
    raise exception 'PARENT_CHAIN_DELETED';
  end if;

  if target_batch is not null then
    update public.chapters
    set deleted_at = null
    where deletion_batch_id = target_batch
      and deleted_at is not null;
    get diagnostics restored_chapters = row_count;

    update public.knowledge_point_placements placement
    set deleted_at = null,
        deletion_batch_id = null
    where placement.deletion_batch_id = target_batch
      and placement.deleted_at is not null
      and exists (
        select 1 from public.chapters chapter
        where chapter.id = placement.chapter_id and chapter.deleted_at is null
      )
      and exists (
        select 1 from public.knowledge_points point
        where point.id = placement.knowledge_point_id and point.deleted_at is null
      );
    get diagnostics restored_placements = row_count;
  else
    with recursive subtree(id) as (
      select id from public.chapters where id = p_chapter_id
      union all
      select child.id from public.chapters child join subtree parent_node on child.parent_id = parent_node.id
    ), ancestors(id) as (
      select id from public.chapters where id = p_chapter_id
      union all
      select parent.id from public.chapters parent join ancestors child on parent.id = child.parent_id
    )
    update public.chapters
    set deleted_at = null
    where id in (select id from subtree union select id from ancestors)
      and deleted_at is not null;
    get diagnostics restored_chapters = row_count;

    update public.knowledge_point_placements placement
    set deleted_at = null
    where placement.chapter_id in (
      with recursive subtree(id) as (
        select id from public.chapters where id = p_chapter_id
        union all
        select child.id from public.chapters child join subtree parent_node on child.parent_id = parent_node.id
      ) select id from subtree
    )
    and placement.deleted_at is not null
    and exists (select 1 from public.chapters chapter where chapter.id = placement.chapter_id and chapter.deleted_at is null)
    and exists (select 1 from public.knowledge_points point where point.id = placement.knowledge_point_id and point.deleted_at is null);
    get diagnostics restored_placements = row_count;
  end if;

  return jsonb_build_object(
    'restored', true,
    'chapters_restored', restored_chapters,
    'placements_restored', restored_placements
  );
end;
$$;

create or replace function public.restore_knowledge_point_with_placements(
  p_knowledge_point_id uuid,
  p_target_chapter_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_batch uuid;
  restored_placements integer := 0;
  skipped_placements integer := 0;
  active_placements integer := 0;
  target_placement_id uuid;
begin
  select deletion_batch_id into target_batch
  from public.knowledge_points
  where id = p_knowledge_point_id and deleted_at is not null;

  if not found then
    raise exception 'RECYCLE_ITEM_NOT_FOUND';
  end if;

  update public.knowledge_points
  set deleted_at = null
  where id = p_knowledge_point_id;

  if target_batch is not null then
    update public.knowledge_point_placements placement
    set deleted_at = null,
        deletion_batch_id = null
    where placement.knowledge_point_id = p_knowledge_point_id
      and placement.deletion_batch_id = target_batch
      and placement.deleted_at is not null
      and exists (
        select 1 from public.chapters chapter
        where chapter.id = placement.chapter_id and chapter.deleted_at is null
      );
    get diagnostics restored_placements = row_count;

    select count(*) into skipped_placements
    from public.knowledge_point_placements placement
    where placement.knowledge_point_id = p_knowledge_point_id
      and placement.deletion_batch_id = target_batch
      and placement.deleted_at is not null;
  else
    update public.knowledge_point_placements placement
    set deleted_at = null
    where placement.knowledge_point_id = p_knowledge_point_id
      and placement.deleted_at is not null
      and exists (
        select 1 from public.chapters chapter
        where chapter.id = placement.chapter_id and chapter.deleted_at is null
      );
    get diagnostics restored_placements = row_count;
  end if;

  select count(*) into active_placements
  from public.knowledge_point_placements placement
  join public.chapters chapter on chapter.id = placement.chapter_id and chapter.deleted_at is null
  where placement.knowledge_point_id = p_knowledge_point_id
    and placement.deleted_at is null;

  if active_placements = 0 then
    if p_target_chapter_id is null then
      raise exception 'RESTORE_TARGET_REQUIRED';
    end if;
    if not exists (select 1 from public.chapters where id = p_target_chapter_id and deleted_at is null) then
      raise exception 'CHAPTER_NOT_FOUND';
    end if;

    select id into target_placement_id
    from public.knowledge_point_placements
    where knowledge_point_id = p_knowledge_point_id
      and chapter_id = p_target_chapter_id;

    if target_placement_id is null then
      insert into public.knowledge_point_placements(knowledge_point_id, chapter_id, sort_order)
      values (p_knowledge_point_id, p_target_chapter_id, 0)
      returning id into target_placement_id;
    else
      update public.knowledge_point_placements
      set deleted_at = null,
          deletion_batch_id = null
      where id = target_placement_id;
    end if;
    restored_placements := restored_placements + 1;
  end if;

  return jsonb_build_object(
    'restored', true,
    'placements_restored', restored_placements,
    'placements_skipped', skipped_placements
  );
end;
$$;
