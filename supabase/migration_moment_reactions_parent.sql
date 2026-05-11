-- 朋友圈评论楼中楼：回复某条评论（parent_reaction_id）
alter table public.moment_reactions
  add column if not exists parent_reaction_id uuid references public.moment_reactions (id) on delete cascade;

create index if not exists moment_reactions_parent_idx on public.moment_reactions (parent_reaction_id);

notify pgrst, 'reload schema';
