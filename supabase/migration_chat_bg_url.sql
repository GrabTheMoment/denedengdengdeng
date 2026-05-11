-- 已有库执行一次：聊天背景图改为存 HTTPS URL，便于部署到云服务器
alter table public.app_profile add column if not exists chat_bg_image_url text not null default '';
