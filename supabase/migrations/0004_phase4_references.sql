-- Phase 4: multi-chapter references and placement-specific chapter notes.
-- This migration only adds nullable/forward-compatible placement metadata.

alter table public.knowledge_point_placements
  add column if not exists chapter_note jsonb not null
    default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;

alter table public.knowledge_point_placements
  add column if not exists deleted_at timestamptz;

create index if not exists placements_active_point_chapter_idx
  on public.knowledge_point_placements(knowledge_point_id, chapter_id)
  where deleted_at is null;

create index if not exists placements_active_chapter_sort_idx
  on public.knowledge_point_placements(chapter_id, sort_order, created_at)
  where deleted_at is null;

-- Keep the ordering RPC aware of soft-deleted placements.
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
    and placement.deleted_at is null
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
    and placement.deleted_at is null
    and exists (
      select 1
      from public.knowledge_points point
      where point.id = placement.knowledge_point_id
        and point.deleted_at is null
    );
end;
$$;
