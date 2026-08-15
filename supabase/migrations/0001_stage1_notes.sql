-- 第一阶段只建立测试表，不提前建立正式讲义数据结构。
create extension if not exists pgcrypto;

create table if not exists public.stage1_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_stage1_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stage1_notes_set_updated_at on public.stage1_notes;

create trigger stage1_notes_set_updated_at
before update on public.stage1_notes
for each row
execute function public.set_stage1_notes_updated_at();

-- 浏览器不直接访问 Supabase；API 使用服务端 service-role key。
alter table public.stage1_notes enable row level security;
