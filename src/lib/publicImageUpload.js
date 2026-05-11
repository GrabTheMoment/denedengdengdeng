const path = require('path');
const fs = require('fs');
const { supabase } = require('../db/supabase');

const mimeToExt = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * 上传到 Supabase Storage（配置了 bucket）或本地 public/uploads，返回可公网访问的 URL。
 * @param {import('express').Request} req
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} folderPrefix 如 chat-bg、moment-media（用作 Storage 路径前缀）
 */
async function uploadPublicImageBuffer(req, buffer, mimetype, folderPrefix) {
  const ext = mimeToExt[mimetype] || 'jpg';
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeFolder = String(folderPrefix || 'uploads').replace(/^\/+|\/+$/g, '');
  const objectPath = `${safeFolder}/${stamp}.${ext}`;

  const bucket = process.env.CHAT_BG_STORAGE_BUCKET?.trim();
  if (bucket) {
    const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
      contentType: mimetype,
      upsert: true,
    });
    if (upErr) throw new Error(`存储上传失败：${upErr.message}`);
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl || '';
    if (!publicUrl) throw new Error('无法生成公开访问 URL，请确认 Storage bucket 为 Public');
    return publicUrl;
  }

  const uploadsDir = path.join(__dirname, '../../public/uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fname = `${safeFolder.replace(/\//g, '-')}-${stamp}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, fname), buffer);
  const base = process.env.PUBLIC_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/uploads/${fname}`;
}

module.exports = { uploadPublicImageBuffer };
