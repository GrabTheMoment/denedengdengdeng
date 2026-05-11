-- 多会话：消息归属 conversation；默认一条「与 Silas」
-- 在 Supabase：左侧 SQL → New query → 粘贴本文件全文 → Run。
-- 执行后若接口仍报 schema cache：Project settings → API → Reload schema（或等待约 1 分钟）。

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default '对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messages add column if not exists conversation_id uuid references public.conversations (id) on delete cascade;

insert into public.conversations (id, title)
values ('00000000-0000-4000-8000-000000000002', '与 Silas')
on conflict (id) do nothing;

update public.messages
set conversation_id = '00000000-0000-4000-8000-000000000002'
where conversation_id is null;

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);

-- 通知 PostgREST 刷新 schema 缓存（在 Supabase SQL Editor 中通常有权限执行）
notify pgrst, 'reload schema';
