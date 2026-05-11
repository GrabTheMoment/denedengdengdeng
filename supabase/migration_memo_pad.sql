-- 会话列表「备忘录」正文：跨设备同步（单用户 app_profile 一行），不参与 AI 对话与长期记忆摘要。
-- 在 Supabase SQL Editor 执行一次即可（云上与本地同一迁移文件）。

alter table public.app_profile add column if not exists memo_pad text not null default '';

notify pgrst, 'reload schema';
