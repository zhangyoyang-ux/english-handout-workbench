-- Phase 10.1 follow-up: retain the transactional restore contract while adding
-- a temporary, server-side stage marker for diagnosing failed restores.
-- The marker is only returned through the Edge Function while this migration is
-- being verified and is removed by the next 10.1 migration.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;

  function_definition := replace(
    function_definition,
    'perform set_config(''app.full_restore'', ''on'', true);',
    'perform set_config(''app.full_restore'', ''on'', true); perform set_config(''app.restore_stage'', ''restore'', true);'
  );
  function_definition := replace(function_definition, 'delete from public.stage1_notes current_row', 'perform set_config(''app.restore_stage'', ''stage1'', true); delete from public.stage1_notes current_row');
  function_definition := replace(function_definition, 'update public.chapters', 'perform set_config(''app.restore_stage'', ''chapters'', true); update public.chapters');
  function_definition := replace(function_definition, 'update public.knowledge_points', 'perform set_config(''app.restore_stage'', ''knowledge_points'', true); update public.knowledge_points');
  function_definition := replace(function_definition, 'insert into public.knowledge_point_contents', 'perform set_config(''app.restore_stage'', ''contents'', true); insert into public.knowledge_point_contents');
  function_definition := replace(function_definition, 'update public.knowledge_point_placements', 'perform set_config(''app.restore_stage'', ''placements'', true); update public.knowledge_point_placements');
  function_definition := replace(function_definition, 'delete from public.knowledge_point_tags;', 'perform set_config(''app.restore_stage'', ''relations'', true); delete from public.knowledge_point_tags;');
  function_definition := replace(function_definition, 'delete from public.knowledge_point_versions;', 'perform set_config(''app.restore_stage'', ''history'', true); delete from public.knowledge_point_versions;');
  function_definition := replace(function_definition, 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'';', 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED: %'', current_setting(''app.restore_stage'', true);');

  execute function_definition;
end;
$$;
