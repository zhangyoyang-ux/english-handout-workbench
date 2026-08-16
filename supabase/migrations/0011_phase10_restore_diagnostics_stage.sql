-- Phase 10.1 diagnostics: keep the stage in a PL/pgSQL variable and a
-- dedicated SQLSTATE so the Edge Function can identify the failing statement.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;
  function_definition := replace(function_definition, 'soft_deleted_placements integer := 0;', 'soft_deleted_placements integer := 0; restore_stage text := ''restore'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''stage1'', true);', 'restore_stage := ''stage1'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''chapters'', true);', 'restore_stage := ''chapters'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''knowledge_points'', true);', 'restore_stage := ''knowledge_points'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''contents'', true);', 'restore_stage := ''contents'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''placements'', true);', 'restore_stage := ''placements'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''relations'', true);', 'restore_stage := ''relations'';');
  function_definition := replace(function_definition, 'perform set_config(''app.restore_stage'', ''history'', true);', 'restore_stage := ''history'';');
  function_definition := replace(function_definition, 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'' using detail = current_setting(''app.restore_stage'', true);', 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'' using errcode = ''P8001'', detail = restore_stage;');
  execute function_definition;
end;
$$;
