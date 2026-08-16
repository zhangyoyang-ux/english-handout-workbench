-- Phase 10.1 final cleanup: remove temporary diagnostics while preserving the
-- formal migration history and the safe-update-compatible restore statements.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;

  function_definition := replace(function_definition, 'soft_deleted_placements integer := 0; restore_stage text := ''restore'';', 'soft_deleted_placements integer := 0;');
  function_definition := regexp_replace(function_definition, 'restore_stage := ''[^'']+'';[[:space:]]*', '', 'g');
  function_definition := regexp_replace(function_definition, 'perform set_config\(''app.restore_stage'', ''[^'']+'', true\);[[:space:]]*', '', 'g');
  function_definition := replace(function_definition, 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'' using errcode = ''P8001'', detail = restore_stage;', 'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'';');

  execute function_definition;
end;
$$;

drop function if exists public.debug_restore_relation_delete();
