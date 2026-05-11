const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { getProfile, updateProfile } = require('../lib/profile');
const { uploadPublicImageBuffer } = require('../lib/publicImageUpload');
const { hintifySupabaseError } = require('../lib/supabaseErrorHint');

const router = express.Router();
router.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error('仅支持 JPG / PNG / WebP / GIF 图片'));
      return;
    }
    cb(null, true);
  },
});

router.get('/', async (req, res) => {
  try {
    const profile = await getProfile();
    const envBg = process.env.CHAT_BG_IMAGE_URL?.trim();
    if (envBg && !(profile.chat_bg_image_url || '').trim()) {
      profile.chat_bg_image_url = envBg;
    }
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message) });
  }
});

router.patch('/', async (req, res) => {
  try {
    const profile = await updateProfile(req.body || {});
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message) });
  }
});

/** 手机相册选图上传 → 写入 Supabase Storage 或本地 public/uploads，并保存 chat_bg_image_url */
router.post(
  '/chat-bg',
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? '图片请小于 8MB'
            : err.message || '上传失败';
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: '请选择一张图片' });
    }

    const publicUrl = await uploadPublicImageBuffer(req, req.file.buffer, req.file.mimetype, 'chat-bg');

    await updateProfile({ chat_bg_image_url: publicUrl });

    const profile = await getProfile();
    const envBg = process.env.CHAT_BG_IMAGE_URL?.trim();
    if (envBg && !(profile.chat_bg_image_url || '').trim()) {
      profile.chat_bg_image_url = envBg;
    }
    res.json(profile);
  } catch (e) {
    const msg = e.message || '上传失败';
    const code = msg.includes('仅支持') ? 400 : 500;
    res.status(code).json({ error: msg });
  }
  }
);

module.exports = router;
