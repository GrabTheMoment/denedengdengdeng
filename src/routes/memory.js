const express = require('express');
const { authRequired } = require('../middleware/auth');
const { hintifySupabaseError } = require('../lib/supabaseErrorHint');
const {
  getMemoryDigestPreview,
  runMemoryDigestMergeConfirmed,
  runMemoryDigestSkipConfirmed,
} = require('../lib/memorySummarizer');

const router = express.Router();
router.use(authRequired);

router.get('/preview', async (req, res) => {
  try {
    const p = await getMemoryDigestPreview();
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message || '预览失败') });
  }
});

router.post('/summarize', async (req, res) => {
  try {
    if (!req.body?.confirm) {
      return res.status(400).json({ error: '需要 confirm: true' });
    }
    const r = await runMemoryDigestMergeConfirmed();
    if (!r.ok) {
      const msg =
        r.reason === 'below_rounds' ? '累计对话轮数不足，请再聊一些' : '当前没有可摘要的旧消息';
      return res.status(400).json({ error: msg, reason: r.reason, merged: r.merged });
    }
    res.json({ ok: true, merged: r.merged });
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message || '摘要失败') });
  }
});

/** 放弃本轮摘要：仅推进水印，不删消息、不调模型 */
router.post('/skip', async (req, res) => {
  try {
    if (!req.body?.confirm) {
      return res.status(400).json({ error: '需要 confirm: true' });
    }
    const r = await runMemoryDigestSkipConfirmed();
    if (!r.ok) {
      const msg =
        r.reason === 'below_rounds' ? '累计对话轮数不足，暂无可跳过的批次' : '当前没有可跳过的旧消息';
      return res.status(400).json({ error: msg, reason: r.reason, skipped: r.skipped });
    }
    res.json({ ok: true, skipped: r.skipped });
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message || '跳过失败') });
  }
});

module.exports = router;
