-- Temporary Phase 10.1 diagnostic migration. This splits the relation stage
-- into individual statements so the failing statement can be isolated.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;

  function_definition := replace(function_definition, 'restore_stage := ''relations''; delete from public.knowledge_point_tags;', 'restore_stage := ''relations_knowledge_point_tags''; delete from public.knowledge_point_tags;');
  function_definition := replace(function_definition, 'delete from public.favorite_items;', 'restore_stage := ''relations_favorites''; delete from public.favorite_items;');
  function_definition := replace(function_definition, 'delete from public.pinned_items;', 'restore_stage := ''relations_pins''; delete from public.pinned_items;');
  function_definition := replace(function_definition, 'delete from public.tags current_tag', 'restore_stage := ''relations_tags_delete''; delete from public.tags current_tag');
  function_definition := replace(function_definition, 'insert into public.tags(id, name, created_at, updated_at)', 'restore_stage := ''relations_tags_insert''; insert into public.tags(id, name, created_at, updated_at)');
  function_definition := replace(function_definition, 'insert into public.knowledge_point_tags(knowledge_point_id, tag_id, created_at)', 'restore_stage := ''relations_knowledge_point_tags_insert''; insert into public.knowledge_point_tags(knowledge_point_id, tag_id, created_at)');
  function_definition := replace(function_definition, 'insert into public.favorite_items(knowledge_point_id, created_at)', 'restore_stage := ''relations_favorites_insert''; insert into public.favorite_items(knowledge_point_id, created_at)');
  function_definition := replace(function_definition, 'insert into public.pinned_items(id, item_type, item_id, sort_order, created_at)', 'restore_stage := ''relations_pins_insert''; insert into public.pinned_items(id, item_type, item_id, sort_order, created_at)');

  execute function_definition;
end;
$$;
