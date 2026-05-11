-- 已有数据库执行一次：用户发朋友圈后延迟再由 AI 点赞/评论
alter table public.moments add column if not exists ai_reaction_ready_at timestamptz;
alter table public.moments add column if not exists ai_reaction_done boolean not null default false;

comment on column public.moments.ai_reaction_ready_at is '用户动态：到此时间后才由后台任务触发 AI 互动；AI 发动态可为 null';
comment on column public.moments.ai_reaction_done is '用户动态：AI 是否已完成点赞/评论';
