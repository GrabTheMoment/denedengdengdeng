-- 朋友圈配图（可选）
alter table public.moments add column if not exists image_url text not null default '';
