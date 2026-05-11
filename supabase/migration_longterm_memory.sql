-- 长期记忆：手写 + 按会话自动摘要，降低送入模型的历史 token
-- Supabase → SQL → 全文执行；然后 API → Reload schema（若报错）

alter table public.app_profile add column if not exists memory_user_notes text not null default '';
alter table public.app_profile add column if not exists memory_auto_digest text not null default '';
alter table public.app_profile add column if not exists memory_digest_watermark_at timestamptz not null default '1970-01-01T00:00:00Z';

create table if not exists public.conversation_memory (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  summarized_through timestamptz not null default '1970-01-01T00:00:00Z'
);

notify pgrst, 'reload schema';
