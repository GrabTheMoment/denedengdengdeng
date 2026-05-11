-- AI 个性签名（可被后台任务用模型小幅更新）
alter table public.app_profile add column if not exists ai_signature text not null default '';

notify pgrst, 'reload schema';
