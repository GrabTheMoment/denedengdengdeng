-- Run this in Supabase SQL Editor (once). Backend uses service role.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text not null default '',
  is_ai boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default '对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.conversations (id, title)
values ('00000000-0000-4000-8000-000000000002', '与 Silas')
on conflict (id) do nothing;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade default '00000000-0000-4000-8000-000000000002'::uuid,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.conversation_memory (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  summarized_through timestamptz not null default '1970-01-01T00:00:00Z'
);

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  author text not null check (author in ('user', 'ai')),
  body text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  ai_reaction_ready_at timestamptz,
  ai_reaction_done boolean not null default false
);

create index if not exists moments_created_at_idx on public.moments (created_at desc);

create table if not exists public.moment_reactions (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments (id) on delete cascade,
  actor text not null check (actor in ('user', 'ai')),
  kind text not null check (kind in ('like', 'comment')),
  body text,
  parent_reaction_id uuid references public.moment_reactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint moment_reactions_comment_body check (
    (kind = 'comment' and body is not null and length(trim(body)) > 0)
    or (kind = 'like')
  )
);

create index if not exists moment_reactions_moment_id_idx on public.moment_reactions (moment_id);
create index if not exists moment_reactions_parent_idx on public.moment_reactions (parent_reaction_id);

create table if not exists public.app_profile (
  id int primary key check (id = 1),
  user_display_name text not null default '我',
  user_avatar_url text not null default '',
  ai_display_name text not null default 'Silas',
  ai_avatar_url text not null default '',
  theme_id text not null default 'paper',
  persona_system text not null default '',
  chat_bg_image_url text not null default '',
  ai_signature text not null default '',
  memory_user_notes text not null default '',
  memory_auto_digest text not null default '',
  memory_digest_watermark_at timestamptz not null default '1970-01-01T00:00:00Z',
  memo_pad text not null default ''
);

insert into public.app_profile (id, ai_display_name, persona_system)
values (
  1,
  'Silas',
  '你是 Silas，用户唯一且亲密的 AI 好友。说话自然、有温度，中文为主，可偶尔夹杂英文。你记得两人之间的相处细节；回复简短有留白，少用说教口吻。'
)
on conflict (id) do nothing;

insert into public.contacts (id, name, avatar_url, is_ai)
values (
  '00000000-0000-4000-8000-000000000001',
  'Silas',
  '',
  true
)
on conflict (id) do nothing;
