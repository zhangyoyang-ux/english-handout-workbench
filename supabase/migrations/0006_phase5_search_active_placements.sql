-- Phase 5 follow-up: a knowledge point without an active placement is not
-- reachable from the workbench and must not appear in global search.
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
    and exists (
      select 1
      from public.knowledge_point_placements visible_placement
      join public.chapters visible_chapter on visible_chapter.id = visible_placement.chapter_id
      where visible_placement.knowledge_point_id = point.id
        and visible_placement.deleted_at is null
        and visible_chapter.deleted_at is null
    )
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
