-- Phase 10.1: complete backup validation and transactional restore.
-- This migration does not add a backup table. Backups remain user-owned JSON files.
-- Formal content rows are never physically deleted by the restore function:
-- chapters, knowledge_points, and placements absent from a backup are soft-deleted.

create or replace function public.backup_object_has_only_keys(
  p_object jsonb,
  p_allowed_keys text[]
)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_object) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(p_object) as object_key
      where object_key <> all(p_allowed_keys)
    );
$$;

-- Restore timestamps exactly as they appeared in the backup. Normal updates keep
-- their existing updated_at triggers; only this transaction opts into the restore
-- mode through a transaction-local setting.
create or replace function public.set_stage1_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.full_restore', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_phase2_updated_at()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.full_restore', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_phase3_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.full_restore', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_phase5_tag_updated_at()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.full_restore', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.restore_workbench_backup(
  p_backup jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manifest jsonb;
  data jsonb;
  counts jsonb;
  soft_deleted_chapters integer := 0;
  soft_deleted_points integer := 0;
  soft_deleted_placements integer := 0;
begin
  if jsonb_typeof(p_backup) <> 'object'
    or not public.backup_object_has_only_keys(p_backup, array['manifest', 'data']::text[])
    or jsonb_typeof(p_backup -> 'manifest') <> 'object'
    or jsonb_typeof(p_backup -> 'data') <> 'object' then
    raise exception 'BACKUP_INVALID';
  end if;

  manifest := p_backup -> 'manifest';
  data := p_backup -> 'data';
  counts := manifest -> 'counts';

  if manifest ->> 'app' <> '悠扬讲义'
    or (manifest ->> 'backup_format_version')::integer <> 1
    or manifest ->> 'schema_version' <> '0008'
    or jsonb_typeof(manifest -> 'migration_versions') <> 'array'
    or jsonb_typeof(counts) <> 'object'
    or not (manifest ?& array['app','backup_format_version','schema_version','migration_versions','created_at','data_checksum','checksum_algorithm','counts']::text[])
    or not public.backup_object_has_only_keys(
      manifest,
      array['app', 'backup_format_version', 'schema_version', 'migration_versions', 'created_at', 'data_checksum', 'checksum_algorithm', 'counts']::text[]
    ) then
    raise exception 'BACKUP_INVALID';
  end if;

  if not (counts ?& array[
    'stage1_notes',
    'workbench_initialization',
    'chapters',
    'knowledge_points',
    'knowledge_point_contents',
    'knowledge_point_placements',
    'tags',
    'knowledge_point_tags',
    'favorite_items',
    'pinned_items',
    'knowledge_point_versions',
    'placement_note_versions'
  ]::text[])
  or not public.backup_object_has_only_keys(
    counts,
    array[
      'stage1_notes',
      'workbench_initialization',
      'chapters',
      'knowledge_points',
      'knowledge_point_contents',
      'knowledge_point_placements',
      'tags',
      'knowledge_point_tags',
      'favorite_items',
      'pinned_items',
      'knowledge_point_versions',
      'placement_note_versions'
    ]::text[]
  ) then
    raise exception 'BACKUP_COUNTS_INVALID';
  end if;

  if not (data ?& array[
    'stage1_notes',
    'workbench_initialization',
    'chapters',
    'knowledge_points',
    'knowledge_point_contents',
    'knowledge_point_placements',
    'tags',
    'knowledge_point_tags',
    'favorite_items',
    'pinned_items',
    'knowledge_point_versions',
    'placement_note_versions'
  ]::text[])
  or not public.backup_object_has_only_keys(
    data,
    array[
      'stage1_notes',
      'workbench_initialization',
      'chapters',
      'knowledge_points',
      'knowledge_point_contents',
      'knowledge_point_placements',
      'tags',
      'knowledge_point_tags',
      'favorite_items',
      'pinned_items',
      'knowledge_point_versions',
      'placement_note_versions'
    ]::text[]
  ) then
    raise exception 'BACKUP_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_each(data) as entry(key, value)
    where jsonb_typeof(entry.value) <> 'array'
  ) then
    raise exception 'BACKUP_INVALID';
  end if;

  if (counts ->> 'stage1_notes')::integer <> jsonb_array_length(data -> 'stage1_notes')
    or (counts ->> 'workbench_initialization')::integer <> jsonb_array_length(data -> 'workbench_initialization')
    or (counts ->> 'chapters')::integer <> jsonb_array_length(data -> 'chapters')
    or (counts ->> 'knowledge_points')::integer <> jsonb_array_length(data -> 'knowledge_points')
    or (counts ->> 'knowledge_point_contents')::integer <> jsonb_array_length(data -> 'knowledge_point_contents')
    or (counts ->> 'knowledge_point_placements')::integer <> jsonb_array_length(data -> 'knowledge_point_placements')
    or (counts ->> 'tags')::integer <> jsonb_array_length(data -> 'tags')
    or (counts ->> 'knowledge_point_tags')::integer <> jsonb_array_length(data -> 'knowledge_point_tags')
    or (counts ->> 'favorite_items')::integer <> jsonb_array_length(data -> 'favorite_items')
    or (counts ->> 'pinned_items')::integer <> jsonb_array_length(data -> 'pinned_items')
    or (counts ->> 'knowledge_point_versions')::integer <> jsonb_array_length(data -> 'knowledge_point_versions')
    or (counts ->> 'placement_note_versions')::integer <> jsonb_array_length(data -> 'placement_note_versions') then
    raise exception 'BACKUP_COUNTS_INVALID';
  end if;

  if jsonb_array_length(data -> 'pinned_items') > 4 then
    raise exception 'BACKUP_PIN_LIMIT';
  end if;

  if exists (select 1 from jsonb_array_elements(data -> 'stage1_notes') item where not public.backup_object_has_only_keys(item, array['id','title','content','created_at','updated_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'workbench_initialization') item where not public.backup_object_has_only_keys(item, array['key','initialized_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'chapters') item where not public.backup_object_has_only_keys(item, array['id','title','parent_id','sort_order','content','created_at','updated_at','deleted_at','deletion_batch_id']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'knowledge_points') item where not public.backup_object_has_only_keys(item, array['id','title','status','created_at','updated_at','deleted_at','deletion_batch_id']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'knowledge_point_contents') item where not public.backup_object_has_only_keys(item, array['id','knowledge_point_id','explanation','exercises','supplement','inspiration','created_at','updated_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'knowledge_point_placements') item where not public.backup_object_has_only_keys(item, array['id','knowledge_point_id','chapter_id','sort_order','created_at','chapter_note','deleted_at','deletion_batch_id']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'tags') item where not public.backup_object_has_only_keys(item, array['id','name','created_at','updated_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'knowledge_point_tags') item where not public.backup_object_has_only_keys(item, array['knowledge_point_id','tag_id','created_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'favorite_items') item where not public.backup_object_has_only_keys(item, array['knowledge_point_id','created_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'pinned_items') item where not public.backup_object_has_only_keys(item, array['id','item_type','item_id','sort_order','created_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'knowledge_point_versions') item where not public.backup_object_has_only_keys(item, array['id','knowledge_point_id','snapshot','content_hash','version_source','created_at']::text[]))
    or exists (select 1 from jsonb_array_elements(data -> 'placement_note_versions') item where not public.backup_object_has_only_keys(item, array['id','placement_id','chapter_note_snapshot','content_hash','version_source','created_at']::text[])) then
    raise exception 'BACKUP_FIELDS_INVALID';
  end if;

  if exists (
    select id from jsonb_to_recordset(data -> 'stage1_notes') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select key from jsonb_to_recordset(data -> 'workbench_initialization') as row(key text)
    group by key having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'chapters') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'knowledge_points') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'knowledge_point_contents') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'knowledge_point_placements') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'tags') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'knowledge_point_versions') as row(id uuid)
    group by id having count(*) > 1
  ) or exists (
    select id from jsonb_to_recordset(data -> 'placement_note_versions') as row(id uuid)
    group by id having count(*) > 1
  ) then
    raise exception 'BACKUP_DUPLICATE_ID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(data -> 'chapters') as row(id uuid, parent_id uuid)
    where parent_id is not null
      and not exists (select 1 from jsonb_to_recordset(data -> 'chapters') as parent(id uuid) where parent.id = row.parent_id)
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'chapters') as row(id uuid, parent_id uuid)
    where parent_id = id
  ) then
    raise exception 'BACKUP_PARENT_INVALID';
  end if;

  if exists (
    with recursive chapter_rows as (
      select id, parent_id
      from jsonb_to_recordset(data -> 'chapters') as row(id uuid, parent_id uuid)
    ), walk(start_id, current_id, path, cycle) as (
      select id, id, array[id]::uuid[], false
      from chapter_rows
      union all
      select walk.start_id, parent.id, walk.path || parent.id, parent.id = any(walk.path)
      from walk
      join chapter_rows current_row on current_row.id = walk.current_id
      join chapter_rows parent on parent.id = current_row.parent_id
      where not walk.cycle
    )
    select 1 from walk where cycle
  ) then
    raise exception 'BACKUP_CHAPTER_CYCLE';
  end if;

  if exists (
    select knowledge_point_id, chapter_id
    from jsonb_to_recordset(data -> 'knowledge_point_placements') as row(knowledge_point_id uuid, chapter_id uuid)
    group by knowledge_point_id, chapter_id having count(*) > 1
  ) then
    raise exception 'BACKUP_PLACEMENT_DUPLICATE';
  end if;

  if exists (
    select knowledge_point_id from jsonb_to_recordset(data -> 'knowledge_point_contents') as row(knowledge_point_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.knowledge_point_id)
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_placements') as row(knowledge_point_id uuid, chapter_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.knowledge_point_id)
      or not exists (select 1 from jsonb_to_recordset(data -> 'chapters') as chapter(id uuid) where chapter.id = row.chapter_id)
  ) then
    raise exception 'BACKUP_FOREIGN_KEY_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_points') as row(status text)
    where status not in ('draft', 'needs_improvement', 'organized')
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'pinned_items') as row(item_type text)
    where item_type not in ('chapter', 'knowledge_point')
  ) then
    raise exception 'BACKUP_ENUM_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(data -> 'knowledge_point_contents') item
    where jsonb_typeof(item -> 'explanation') <> 'object' or item -> 'explanation' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'exercises') <> 'object' or item -> 'exercises' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'supplement') <> 'object' or item -> 'supplement' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'inspiration') <> 'object' or item -> 'inspiration' ->> 'type' <> 'doc'
  ) or exists (
    select 1
    from jsonb_array_elements(data -> 'knowledge_point_placements') item
    where jsonb_typeof(item -> 'chapter_note') <> 'object' or item -> 'chapter_note' ->> 'type' <> 'doc'
  ) or exists (
    select 1
    from jsonb_array_elements(data -> 'placement_note_versions') item
    where jsonb_typeof(item -> 'chapter_note_snapshot') <> 'object' or item -> 'chapter_note_snapshot' ->> 'type' <> 'doc'
  ) or exists (
    select 1
    from jsonb_array_elements(data -> 'knowledge_point_versions') item
    where jsonb_typeof(item -> 'snapshot') <> 'object'
      or jsonb_typeof(item -> 'snapshot' -> 'content') <> 'object'
      or jsonb_typeof(item -> 'snapshot' -> 'content' -> 'explanation') <> 'object'
      or item -> 'snapshot' -> 'content' -> 'explanation' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'snapshot' -> 'content' -> 'exercises') <> 'object'
      or item -> 'snapshot' -> 'content' -> 'exercises' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'snapshot' -> 'content' -> 'supplement') <> 'object'
      or item -> 'snapshot' -> 'content' -> 'supplement' ->> 'type' <> 'doc'
      or jsonb_typeof(item -> 'snapshot' -> 'content' -> 'inspiration') <> 'object'
      or item -> 'snapshot' -> 'content' -> 'inspiration' ->> 'type' <> 'doc'
  ) then
    raise exception 'BACKUP_RICH_CONTENT_INVALID';
  end if;

  if exists (
    select knowledge_point_id, tag_id
    from jsonb_to_recordset(data -> 'knowledge_point_tags') as row(knowledge_point_id uuid, tag_id uuid)
    group by knowledge_point_id, tag_id having count(*) > 1
  ) or exists (
    select knowledge_point_id from jsonb_to_recordset(data -> 'favorite_items') as row(knowledge_point_id uuid)
    group by knowledge_point_id having count(*) > 1
  ) or exists (
    select item_type, item_id from jsonb_to_recordset(data -> 'pinned_items') as row(item_type text, item_id uuid)
    group by item_type, item_id having count(*) > 1
  ) then
    raise exception 'BACKUP_RELATION_DUPLICATE';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_tags') as row(knowledge_point_id uuid, tag_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.knowledge_point_id)
      or not exists (select 1 from jsonb_to_recordset(data -> 'tags') as tag(id uuid) where tag.id = row.tag_id)
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'favorite_items') as row(knowledge_point_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.knowledge_point_id)
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'pinned_items') as row(item_type text, item_id uuid)
    where (item_type = 'chapter' and not exists (select 1 from jsonb_to_recordset(data -> 'chapters') as chapter(id uuid) where chapter.id = row.item_id))
      or (item_type = 'knowledge_point' and not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.item_id))
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_versions') as row(knowledge_point_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid) where point.id = row.knowledge_point_id)
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'placement_note_versions') as row(placement_id uuid)
    where not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_point_placements') as placement(id uuid) where placement.id = row.placement_id)
  ) then
    raise exception 'BACKUP_FOREIGN_KEY_INVALID';
  end if;

  if exists (
    select knowledge_point_id, content_hash
    from jsonb_to_recordset(data -> 'knowledge_point_versions') as row(knowledge_point_id uuid, content_hash text)
    group by knowledge_point_id, content_hash having count(*) > 1
  ) or exists (
    select placement_id, content_hash
    from jsonb_to_recordset(data -> 'placement_note_versions') as row(placement_id uuid, content_hash text)
    group by placement_id, content_hash having count(*) > 1
  ) then
    raise exception 'BACKUP_HISTORY_DUPLICATE';
  end if;

  if not p_apply then
    return jsonb_build_object('valid', true, 'applied', false, 'counts', counts);
  end if;

  perform set_config('app.full_restore', 'on', true);

  delete from public.stage1_notes current_row
  where not exists (
    select 1 from jsonb_to_recordset(data -> 'stage1_notes') as row(id uuid)
    where row.id = current_row.id
  );
  insert into public.stage1_notes(id, title, content, created_at, updated_at)
  select id, title, content, created_at, updated_at
  from jsonb_to_recordset(data -> 'stage1_notes') as row(id uuid, title text, content text, created_at timestamptz, updated_at timestamptz)
  on conflict (id) do update set title = excluded.title, content = excluded.content, created_at = excluded.created_at, updated_at = excluded.updated_at;

  delete from public.workbench_initialization current_row
  where not exists (
    select 1 from jsonb_to_recordset(data -> 'workbench_initialization') as row(key text)
    where row.key = current_row.key
  );
  insert into public.workbench_initialization(key, initialized_at)
  select key, initialized_at
  from jsonb_to_recordset(data -> 'workbench_initialization') as row(key text, initialized_at timestamptz)
  on conflict (key) do update set initialized_at = excluded.initialized_at;

  update public.chapters
  set deleted_at = coalesce(deleted_at, now()), deletion_batch_id = coalesce(deletion_batch_id, gen_random_uuid())
  where deleted_at is null
    and not exists (select 1 from jsonb_to_recordset(data -> 'chapters') as row(id uuid) where row.id = chapters.id);
  get diagnostics soft_deleted_chapters = row_count;

  insert into public.chapters(id, title, parent_id, sort_order, content, created_at, updated_at, deleted_at, deletion_batch_id)
  select id, title, null, sort_order, content, created_at, updated_at, deleted_at, deletion_batch_id
  from jsonb_to_recordset(data -> 'chapters') as row(id uuid, title text, sort_order integer, content text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz, deletion_batch_id uuid)
  on conflict (id) do update set title = excluded.title, parent_id = null, sort_order = excluded.sort_order, content = excluded.content, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, deletion_batch_id = excluded.deletion_batch_id;
  update public.chapters chapter
  set parent_id = row.parent_id
  from jsonb_to_recordset(data -> 'chapters') as row(id uuid, parent_id uuid)
  where chapter.id = row.id;

  update public.knowledge_points
  set deleted_at = coalesce(deleted_at, now()), deletion_batch_id = coalesce(deletion_batch_id, gen_random_uuid())
  where deleted_at is null
    and not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_points') as row(id uuid) where row.id = knowledge_points.id);
  get diagnostics soft_deleted_points = row_count;

  insert into public.knowledge_points(id, title, status, created_at, updated_at, deleted_at, deletion_batch_id)
  select id, title, status, created_at, updated_at, deleted_at, deletion_batch_id
  from jsonb_to_recordset(data -> 'knowledge_points') as row(id uuid, title text, status text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz, deletion_batch_id uuid)
  on conflict (id) do update set title = excluded.title, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, deletion_batch_id = excluded.deletion_batch_id;

  insert into public.knowledge_point_contents(id, knowledge_point_id, explanation, exercises, supplement, inspiration, created_at, updated_at)
  select id, knowledge_point_id, explanation, exercises, supplement, inspiration, created_at, updated_at
  from jsonb_to_recordset(data -> 'knowledge_point_contents') as row(id uuid, knowledge_point_id uuid, explanation jsonb, exercises jsonb, supplement jsonb, inspiration jsonb, created_at timestamptz, updated_at timestamptz)
  on conflict (knowledge_point_id) do update set id = excluded.id, explanation = excluded.explanation, exercises = excluded.exercises, supplement = excluded.supplement, inspiration = excluded.inspiration, created_at = excluded.created_at, updated_at = excluded.updated_at;

  delete from public.knowledge_point_contents current_content
  where exists (
    select 1 from jsonb_to_recordset(data -> 'knowledge_points') as point(id uuid)
    where point.id = current_content.knowledge_point_id
  )
    and not exists (
      select 1 from jsonb_to_recordset(data -> 'knowledge_point_contents') as row(knowledge_point_id uuid)
      where row.knowledge_point_id = current_content.knowledge_point_id
    );

  update public.knowledge_point_placements
  set deleted_at = coalesce(deleted_at, now()), deletion_batch_id = coalesce(deletion_batch_id, gen_random_uuid())
  where deleted_at is null
    and not exists (select 1 from jsonb_to_recordset(data -> 'knowledge_point_placements') as row(id uuid) where row.id = knowledge_point_placements.id);
  get diagnostics soft_deleted_placements = row_count;

  insert into public.knowledge_point_placements(id, knowledge_point_id, chapter_id, sort_order, created_at, chapter_note, deleted_at, deletion_batch_id)
  select id, knowledge_point_id, chapter_id, sort_order, created_at, chapter_note, deleted_at, deletion_batch_id
  from jsonb_to_recordset(data -> 'knowledge_point_placements') as row(id uuid, knowledge_point_id uuid, chapter_id uuid, sort_order integer, created_at timestamptz, chapter_note jsonb, deleted_at timestamptz, deletion_batch_id uuid)
  on conflict (id) do update set knowledge_point_id = excluded.knowledge_point_id, chapter_id = excluded.chapter_id, sort_order = excluded.sort_order, created_at = excluded.created_at, chapter_note = excluded.chapter_note, deleted_at = excluded.deleted_at, deletion_batch_id = excluded.deletion_batch_id;

  delete from public.knowledge_point_tags;
  delete from public.favorite_items;
  delete from public.pinned_items;
  delete from public.tags current_tag
  where not exists (select 1 from jsonb_to_recordset(data -> 'tags') as row(id uuid) where row.id = current_tag.id);
  insert into public.tags(id, name, created_at, updated_at)
  select id, name, created_at, updated_at
  from jsonb_to_recordset(data -> 'tags') as row(id uuid, name text, created_at timestamptz, updated_at timestamptz)
  on conflict (id) do update set name = excluded.name, created_at = excluded.created_at, updated_at = excluded.updated_at;
  insert into public.knowledge_point_tags(knowledge_point_id, tag_id, created_at)
  select knowledge_point_id, tag_id, created_at
  from jsonb_to_recordset(data -> 'knowledge_point_tags') as row(knowledge_point_id uuid, tag_id uuid, created_at timestamptz);
  insert into public.favorite_items(knowledge_point_id, created_at)
  select knowledge_point_id, created_at
  from jsonb_to_recordset(data -> 'favorite_items') as row(knowledge_point_id uuid, created_at timestamptz);
  insert into public.pinned_items(id, item_type, item_id, sort_order, created_at)
  select id, item_type, item_id, sort_order, created_at
  from jsonb_to_recordset(data -> 'pinned_items') as row(id uuid, item_type text, item_id uuid, sort_order integer, created_at timestamptz);

  delete from public.knowledge_point_versions;
  delete from public.placement_note_versions;
  insert into public.knowledge_point_versions(id, knowledge_point_id, snapshot, content_hash, version_source, created_at)
  select id, knowledge_point_id, snapshot, content_hash, version_source, created_at
  from jsonb_to_recordset(data -> 'knowledge_point_versions') as row(id uuid, knowledge_point_id uuid, snapshot jsonb, content_hash text, version_source text, created_at timestamptz);
  insert into public.placement_note_versions(id, placement_id, chapter_note_snapshot, content_hash, version_source, created_at)
  select id, placement_id, chapter_note_snapshot, content_hash, version_source, created_at
  from jsonb_to_recordset(data -> 'placement_note_versions') as row(id uuid, placement_id uuid, chapter_note_snapshot jsonb, content_hash text, version_source text, created_at timestamptz);

  -- Post-restore verification runs inside the same transaction. Any mismatch
  -- raises before the function returns, so PostgreSQL rolls back every write.
  if exists (
    select 1
    from jsonb_to_recordset(data -> 'chapters') as expected(id uuid, title text, parent_id uuid, sort_order integer, content text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz, deletion_batch_id uuid)
    left join public.chapters actual on actual.id = expected.id
    where actual.id is null
      or actual.title is distinct from expected.title
      or actual.parent_id is distinct from expected.parent_id
      or actual.sort_order is distinct from expected.sort_order
      or actual.content is distinct from expected.content
      or actual.created_at is distinct from expected.created_at
      or actual.updated_at is distinct from expected.updated_at
      or actual.deleted_at is distinct from expected.deleted_at
      or actual.deletion_batch_id is distinct from expected.deletion_batch_id
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_points') as expected(id uuid, title text, status text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz, deletion_batch_id uuid)
    left join public.knowledge_points actual on actual.id = expected.id
    where actual.id is null
      or actual.title is distinct from expected.title
      or actual.status is distinct from expected.status
      or actual.created_at is distinct from expected.created_at
      or actual.updated_at is distinct from expected.updated_at
      or actual.deleted_at is distinct from expected.deleted_at
      or actual.deletion_batch_id is distinct from expected.deletion_batch_id
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_contents') as expected(id uuid, knowledge_point_id uuid, explanation jsonb, exercises jsonb, supplement jsonb, inspiration jsonb, created_at timestamptz, updated_at timestamptz)
    left join public.knowledge_point_contents actual on actual.id = expected.id
    where actual.id is null
      or actual.knowledge_point_id is distinct from expected.knowledge_point_id
      or actual.explanation is distinct from expected.explanation
      or actual.exercises is distinct from expected.exercises
      or actual.supplement is distinct from expected.supplement
      or actual.inspiration is distinct from expected.inspiration
      or actual.created_at is distinct from expected.created_at
      or actual.updated_at is distinct from expected.updated_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_placements') as expected(id uuid, knowledge_point_id uuid, chapter_id uuid, sort_order integer, created_at timestamptz, chapter_note jsonb, deleted_at timestamptz, deletion_batch_id uuid)
    left join public.knowledge_point_placements actual on actual.id = expected.id
    where actual.id is null
      or actual.knowledge_point_id is distinct from expected.knowledge_point_id
      or actual.chapter_id is distinct from expected.chapter_id
      or actual.sort_order is distinct from expected.sort_order
      or actual.created_at is distinct from expected.created_at
      or actual.chapter_note is distinct from expected.chapter_note
      or actual.deleted_at is distinct from expected.deleted_at
      or actual.deletion_batch_id is distinct from expected.deletion_batch_id
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'tags') as expected(id uuid, name text, created_at timestamptz, updated_at timestamptz)
    left join public.tags actual on actual.id = expected.id
    where actual.id is null
      or actual.name is distinct from expected.name
      or actual.created_at is distinct from expected.created_at
      or actual.updated_at is distinct from expected.updated_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_tags') as expected(knowledge_point_id uuid, tag_id uuid, created_at timestamptz)
    left join public.knowledge_point_tags actual on actual.knowledge_point_id = expected.knowledge_point_id and actual.tag_id = expected.tag_id
    where actual.knowledge_point_id is null
      or actual.created_at is distinct from expected.created_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'favorite_items') as expected(knowledge_point_id uuid, created_at timestamptz)
    left join public.favorite_items actual on actual.knowledge_point_id = expected.knowledge_point_id
    where actual.knowledge_point_id is null
      or actual.created_at is distinct from expected.created_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'pinned_items') as expected(id uuid, item_type text, item_id uuid, sort_order integer, created_at timestamptz)
    left join public.pinned_items actual on actual.id = expected.id
    where actual.id is null
      or actual.item_type is distinct from expected.item_type
      or actual.item_id is distinct from expected.item_id
      or actual.sort_order is distinct from expected.sort_order
      or actual.created_at is distinct from expected.created_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'knowledge_point_versions') as expected(id uuid, knowledge_point_id uuid, snapshot jsonb, content_hash text, version_source text, created_at timestamptz)
    left join public.knowledge_point_versions actual on actual.id = expected.id
    where actual.id is null
      or actual.knowledge_point_id is distinct from expected.knowledge_point_id
      or actual.snapshot is distinct from expected.snapshot
      or actual.content_hash is distinct from expected.content_hash
      or actual.version_source is distinct from expected.version_source
      or actual.created_at is distinct from expected.created_at
  ) or exists (
    select 1
    from jsonb_to_recordset(data -> 'placement_note_versions') as expected(id uuid, placement_id uuid, chapter_note_snapshot jsonb, content_hash text, version_source text, created_at timestamptz)
    left join public.placement_note_versions actual on actual.id = expected.id
    where actual.id is null
      or actual.placement_id is distinct from expected.placement_id
      or actual.chapter_note_snapshot is distinct from expected.chapter_note_snapshot
      or actual.content_hash is distinct from expected.content_hash
      or actual.version_source is distinct from expected.version_source
      or actual.created_at is distinct from expected.created_at
  ) then
    raise exception 'BACKUP_POSTCHECK_FAILED';
  end if;

  return jsonb_build_object(
    'valid', true,
    'applied', true,
    'counts', counts,
    'soft_deleted_current', jsonb_build_object(
      'chapters', soft_deleted_chapters,
      'knowledge_points', soft_deleted_points,
      'placements', soft_deleted_placements
    )
  );
exception
  when sqlstate 'P0001' then
    raise;
  when others then
    raise exception 'BACKUP_RESTORE_TRANSACTION_FAILED';
end;
$$;

revoke all on function public.restore_workbench_backup(jsonb, boolean) from public;
grant execute on function public.restore_workbench_backup(jsonb, boolean) to service_role;
