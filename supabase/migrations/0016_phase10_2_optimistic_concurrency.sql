-- Phase 10.2: server-side optimistic concurrency control.
-- Revisions are runtime safety metadata and are intentionally not part of the
-- Phase 10.1 backup model. Full restore invalidates stale editors separately.
alter table public.knowledge_points
  add column if not exists core_revision bigint not null default 1;

alter table public.knowledge_point_placements
  add column if not exists note_revision bigint not null default 1;

alter table public.chapters
  add column if not exists overview_revision bigint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_points_core_revision_positive') then
    alter table public.knowledge_points add constraint knowledge_points_core_revision_positive check (core_revision > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_point_placements_note_revision_positive') then
    alter table public.knowledge_point_placements add constraint knowledge_point_placements_note_revision_positive check (note_revision > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chapters_overview_revision_positive') then
    alter table public.chapters add constraint chapters_overview_revision_positive check (overview_revision > 0);
  end if;
end;
$$;

create or replace function public.update_knowledge_point_core(
  p_knowledge_point_id uuid,
  p_expected_revision bigint,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  point_row public.knowledge_points%rowtype;
  content_row public.knowledge_point_contents%rowtype;
  default_document jsonb := jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
  );
  has_content_patch boolean;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'EDIT_REVISION_INVALID';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'KNOWLEDGE_POINT_PAYLOAD_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_patch) as key
    where key not in ('title', 'status', 'explanation', 'exercises', 'supplement', 'inspiration')
  ) then
    raise exception 'KNOWLEDGE_POINT_PAYLOAD_INVALID';
  end if;
  if p_patch ? 'title' and (
    jsonb_typeof(p_patch -> 'title') <> 'string'
    or length(trim(p_patch ->> 'title')) = 0
    or length(p_patch ->> 'title') > 200
  ) then
    raise exception 'KNOWLEDGE_POINT_TITLE_INVALID';
  end if;
  if p_patch ? 'status' and (
    jsonb_typeof(p_patch -> 'status') <> 'string'
    or p_patch ->> 'status' not in ('draft', 'needs_improvement', 'organized')
  ) then
    raise exception 'KNOWLEDGE_POINT_STATUS_INVALID';
  end if;
  has_content_patch := p_patch ?| array['explanation', 'exercises', 'supplement', 'inspiration'];
  if exists (
    select 1
    from jsonb_object_keys(p_patch) as key
    where key in ('explanation', 'exercises', 'supplement', 'inspiration')
      and (
        jsonb_typeof(p_patch -> key) <> 'object'
        or p_patch -> key ->> 'type' <> 'doc'
      )
  ) then
    raise exception 'CONTENT_PAYLOAD_INVALID';
  end if;
  if not (p_patch ? 'title' or p_patch ? 'status' or has_content_patch) then
    raise exception 'KNOWLEDGE_POINT_PAYLOAD_INVALID';
  end if;

  select * into point_row
  from public.knowledge_points
  where id = p_knowledge_point_id and deleted_at is null
  for update;
  if not found then
    raise exception 'KNOWLEDGE_POINT_NOT_FOUND';
  end if;

  if point_row.core_revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'entity', 'knowledge_point_core',
      'current_revision', point_row.core_revision,
      'updated_at', point_row.updated_at
    );
  end if;

  select * into content_row
  from public.knowledge_point_contents
  where knowledge_point_id = p_knowledge_point_id
  for update;
  if not found then
    insert into public.knowledge_point_contents(
      knowledge_point_id, explanation, exercises, supplement, inspiration
    ) values (
      p_knowledge_point_id, default_document, default_document, default_document, default_document
    ) returning * into content_row;
  end if;

  if has_content_patch then
    update public.knowledge_point_contents
    set explanation = case when p_patch ? 'explanation' then p_patch -> 'explanation' else explanation end,
        exercises = case when p_patch ? 'exercises' then p_patch -> 'exercises' else exercises end,
        supplement = case when p_patch ? 'supplement' then p_patch -> 'supplement' else supplement end,
        inspiration = case when p_patch ? 'inspiration' then p_patch -> 'inspiration' else inspiration end
    where knowledge_point_id = p_knowledge_point_id
    returning * into content_row;
  end if;

  update public.knowledge_points
  set title = case when p_patch ? 'title' then trim(p_patch ->> 'title') else title end,
      status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
      core_revision = core_revision + 1
  where id = p_knowledge_point_id
  returning * into point_row;

  return jsonb_build_object(
    'conflict', false,
    'knowledge_point', to_jsonb(point_row),
    'content', to_jsonb(content_row)
  );
end;
$$;

create or replace function public.update_placement_note(
  p_placement_id uuid,
  p_expected_revision bigint,
  p_chapter_note jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  placement_row public.knowledge_point_placements%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'EDIT_REVISION_INVALID';
  end if;
  if p_chapter_note is null or jsonb_typeof(p_chapter_note) <> 'object' or p_chapter_note ->> 'type' <> 'doc' then
    raise exception 'CHAPTER_NOTE_INVALID';
  end if;

  select * into placement_row
  from public.knowledge_point_placements
  where id = p_placement_id and deleted_at is null
  for update;
  if not found then
    raise exception 'PLACEMENT_NOT_FOUND';
  end if;

  if placement_row.note_revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'entity', 'placement_note',
      'current_revision', placement_row.note_revision,
      'updated_at', null
    );
  end if;

  update public.knowledge_point_placements
  set chapter_note = p_chapter_note,
      note_revision = note_revision + 1
  where id = p_placement_id
  returning * into placement_row;

  return jsonb_build_object('conflict', false, 'placement', to_jsonb(placement_row));
end;
$$;

create or replace function public.update_chapter_overview(
  p_chapter_id uuid,
  p_expected_revision bigint,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chapter_row public.chapters%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'EDIT_REVISION_INVALID';
  end if;
  if p_content is null or length(p_content) > 100000 then
    raise exception 'CHAPTER_CONTENT_INVALID';
  end if;

  select * into chapter_row
  from public.chapters
  where id = p_chapter_id and deleted_at is null
  for update;
  if not found then
    raise exception 'CHAPTER_NOT_FOUND';
  end if;

  if chapter_row.overview_revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'entity', 'chapter_overview',
      'current_revision', chapter_row.overview_revision,
      'updated_at', chapter_row.updated_at
    );
  end if;

  update public.chapters
  set content = p_content,
      overview_revision = overview_revision + 1
  where id = p_chapter_id
  returning * into chapter_row;

  return jsonb_build_object('conflict', false, 'chapter', to_jsonb(chapter_row));
end;
$$;

revoke all on function public.update_knowledge_point_core(uuid, bigint, jsonb) from public;
revoke all on function public.update_placement_note(uuid, bigint, jsonb) from public;
revoke all on function public.update_chapter_overview(uuid, bigint, text) from public;
grant execute on function public.update_knowledge_point_core(uuid, bigint, jsonb) to service_role;
grant execute on function public.update_placement_note(uuid, bigint, jsonb) to service_role;
grant execute on function public.update_chapter_overview(uuid, bigint, text) to service_role;

-- A full restore is an administrative state replacement. Bump every runtime
-- revision after the existing 10.1 post-check so pages opened before restore
-- cannot write over the restored state.
do $$
declare
  function_definition text;
  return_marker text := '  return jsonb_build_object(' || chr(10)
    || '    ''valid'', true,' || chr(10)
    || '    ''applied'', true,';
  revision_updates text := '  update public.chapters set overview_revision = overview_revision + 1 where true;' || chr(10)
    || '  update public.knowledge_points set core_revision = core_revision + 1 where true;' || chr(10)
    || '  update public.knowledge_point_placements set note_revision = note_revision + 1 where true;' || chr(10);
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;
  function_definition := replace(function_definition, return_marker, revision_updates || return_marker);
  execute function_definition;
end;
$$;
