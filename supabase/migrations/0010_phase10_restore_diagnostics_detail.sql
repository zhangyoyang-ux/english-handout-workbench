-- Phase 10.1 diagnostics: expose only the internal restore stage as PostgreSQL
-- error detail while the Production failure is being isolated. 0011 removes it.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.restore_workbench_backup(jsonb,boolean)'::regprocedure)
  into function_definition;
  function_definition := replace(
    function_definition,
    'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED: %'', current_setting(''app.restore_stage'', true);',
    'raise exception ''BACKUP_RESTORE_TRANSACTION_FAILED'' using detail = current_setting(''app.restore_stage'', true);'
  );
  execute function_definition;
end;
$$;
