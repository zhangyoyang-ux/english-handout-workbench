-- Temporary diagnostic helper. It always raises so the DELETE is rolled back.
create or replace function public.debug_restore_relation_delete()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.knowledge_point_tags;
  raise exception 'DEBUG_DELETE_SUCCESS' using errcode = 'P8002';
exception when others then
  if sqlstate = 'P8002' then
    raise;
  end if;
  raise exception 'DEBUG_DELETE_FAILURE' using errcode = 'P8003', detail = sqlstate || ':' || sqlerrm;
end;
$$;

revoke all on function public.debug_restore_relation_delete() from public;
grant execute on function public.debug_restore_relation_delete() to service_role;
