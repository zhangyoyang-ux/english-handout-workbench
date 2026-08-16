-- Phase 10.1 fix: Supabase's safe-update setting requires an explicit WHERE
-- clause even for intentional full-table replacement inside the transaction.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;

  function_definition := replace(function_definition, 'delete from public.knowledge_point_tags;', 'delete from public.knowledge_point_tags where true;');
  function_definition := replace(function_definition, 'delete from public.favorite_items;', 'delete from public.favorite_items where true;');
  function_definition := replace(function_definition, 'delete from public.pinned_items;', 'delete from public.pinned_items where true;');
  function_definition := replace(function_definition, 'delete from public.knowledge_point_versions;', 'delete from public.knowledge_point_versions where true;');
  function_definition := replace(function_definition, 'delete from public.placement_note_versions;', 'delete from public.placement_note_versions where true;');

  execute function_definition;
end;
$$;
