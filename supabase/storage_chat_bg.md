# Supabase Storage：手机上传聊天背景（推荐云上部署）

1. 打开 Supabase 控制台 → **Storage** → **New bucket**
2. 名称与 `.env` 里 **`CHAT_BG_STORAGE_BUCKET`** 一致，例如：`silas-chat-bg`
3. 勾选 **Public bucket**（便于浏览器直接加载背景图 URL）
4. 保存后，后端会用 **service role** 上传文件，无需额外 Storage RLS 策略即可写入

若不上传 Storage，仅在本机 / 有持久磁盘的 VPS 上，`CHAT_BG_STORAGE_BUCKET` **留空**，图片会落在项目的 `public/uploads/`（部分云平台磁盘不持久，重启会丢，请优先用 Storage）。

## 拿到图片 URL 供「头像」字段使用

同一 bucket 里上传任意图片后，在对象详情里复制 **公开 URL**（与聊天背景上传接口返回的格式一致），粘贴到「我」→ **AI 头像 URL** 或 **我的头像 URL** 即可。也可在 Storage 文件列表中选中文件 → 复制链接。

