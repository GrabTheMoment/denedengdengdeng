const express = require('express');
const multer = require('multer');
const { supabase } = require('../db/supabase');
const { authRequired } = require('../middleware/auth');
const { getProfile } = require('../lib/profile');
const { chatCompletion, tryParseJsonObject } = require('../lib/openai');
const { scheduleAiSelfProfileUpdate } = require('../lib/aiSelfProfile');
const { uploadPublicImageBuffer } = require('../lib/publicImageUpload');

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

function momentAiDelayMinutes() {
  const n = Number(process.env.MOMENT_AI_DELAY_MINUTES);
  if (Number.isFinite(n) && n >= 0) return n;
  return 10;
}

async function loadMomentsWithReactions() {
  const { data: moments, error: mErr } = await supabase
    .from('moments')
    .select('id, author, body, image_url, created_at, ai_reaction_ready_at, ai_reaction_done')
    .order('created_at', { ascending: false })
    .limit(100);
  if (mErr) throw mErr;
  if (!moments?.length) return [];

  const ids = moments.map((m) => m.id);
  const { data: reactions, error: rErr } = await supabase
    .from('moment_reactions')
    .select('id, moment_id, actor, kind, body, parent_reaction_id, created_at')
    .in('moment_id', ids)
    .order('created_at', { ascending: true });
  if (rErr) throw rErr;

  const byMoment = new Map();
  for (const m of moments) {
    byMoment.set(m.id, { ...m, reactions: [] });
  }
  for (const r of reactions || []) {
    const row = byMoment.get(r.moment_id);
    if (row) row.reactions.push(r);
  }
  return moments.map((m) => byMoment.get(m.id));
}

/** @returns {Promise<boolean>} 是否成功写入互动 */
async function appendAiReactions(momentId, momentBody, momentImageUrl) {
  let profile;
  try {
    profile = await getProfile();
  } catch {
    return false;
  }

  const system = [
    profile.persona_system || '',
    `你是「${profile.ai_display_name}」。用户发了一条朋友圈，你现在看到这条动态并点赞、评论。`,
    '请决定是否点赞（like 一般为 true），并写一条简短、符合人设的评论（中文为主，可少量英文）。',
    '只输出一个 JSON 对象，不要 markdown，不要其它文字。格式：{"like":true,"comment":"评论内容"}',
  ].join('\n');

  const textPart = (momentBody || '').trim() || '（无文字）';
  const img = (momentImageUrl || '').trim();
  const user = img
    ? `朋友圈文字：\n${textPart}\n配图（可访问 URL）：${img}`
    : `朋友圈内容：\n${textPart}`;

  let raw;
  try {
    raw = await chatCompletion({ system, user });
  } catch {
    return false;
  }

  const parsed = tryParseJsonObject(raw);
  const like = parsed?.like !== false;
  let comment = (parsed?.comment || '').trim();
  if (!comment) {
    const line = raw.split('\n').map((s) => s.trim()).find(Boolean);
    comment = line && line.length <= 500 ? line : '已读。';
  }

  if (like) {
    const { error: le } = await supabase
      .from('moment_reactions')
      .insert({ moment_id: momentId, actor: 'ai', kind: 'like', parent_reaction_id: null });
    if (le) console.error('[moments] ai like insert', le.message);
  }
  const { error: ce } = await supabase.from('moment_reactions').insert({
    moment_id: momentId,
    actor: 'ai',
    kind: 'comment',
    body: comment.slice(0, 2000),
    parent_reaction_id: null,
  });
  if (ce) {
    console.error('[moments] ai comment insert', ce.message);
    return false;
  }
  return true;
}

/** 用户回复了 AI 的评论后，AI再回一条（挂在用户评论下） */
async function maybeAiReplyToUserComment(momentId, userReactionId, parentReactionId) {
  if (!parentReactionId) return;
  const { data: parent, error: pErr } = await supabase
    .from('moment_reactions')
    .select('actor, kind, body')
    .eq('id', parentReactionId)
    .maybeSingle();
  if (pErr || !parent || parent.kind !== 'comment' || parent.actor !== 'ai') return;

  const { data: userRow, error: uErr } = await supabase
    .from('moment_reactions')
    .select('body')
    .eq('id', userReactionId)
    .maybeSingle();
  if (uErr || !userRow) return;

  const { data: moment, error: mErr } = await supabase.from('moments').select('body, author').eq('id', momentId).maybeSingle();
  if (mErr || !moment) return;

  let profile;
  try {
    profile = await getProfile();
  } catch {
    return;
  }
  const aiName = profile.ai_display_name || 'Silas';
  const system = [
    profile.persona_system || '',
    `你是「${aiName}」。用户在你的朋友圈评论下回复了你。`,
    '请写一条简短、自然、符合人设的回复（中文为主），不要输出 JSON，不要加角色旁白。',
    '最多约 120 字。',
  ].join('\n');

  const user = [
    `动态内容：${(moment.body || '').trim() || '（无）'}`,
    `你之前的评论：${(parent.body || '').trim()}`,
    `用户的回复：${(userRow.body || '').trim()}`,
  ].join('\n');

  let reply;
  try {
    reply = await chatCompletion({ system, user });
  } catch (e) {
    console.error('[moments] ai thread reply', e.message);
    return;
  }
  const text = String(reply || '').trim().slice(0, 2000);
  if (!text) return;

  const { error: ins } = await supabase.from('moment_reactions').insert({
    moment_id: momentId,
    actor: 'ai',
    kind: 'comment',
    body: text,
    parent_reaction_id: userReactionId,
  });
  if (ins) console.error('[moments] ai thread insert', ins.message);
}

/** 定时任务：已到时间的用户动态则触发 AI 互动 */
async function processDueMomentAiReactions() {
  const now = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('moments')
    .select('id, body, image_url')
    .eq('author', 'user')
    .eq('ai_reaction_done', false)
    .not('ai_reaction_ready_at', 'is', null)
    .lte('ai_reaction_ready_at', now)
    .limit(15);

  if (error) {
    console.error('[moments] poll due', error.message);
    return;
  }
  if (!rows?.length) return;

  for (const row of rows) {
    try {
      const ok = await appendAiReactions(row.id, row.body, row.image_url);
      if (ok) {
        await supabase.from('moments').update({ ai_reaction_done: true }).eq('id', row.id);
        scheduleAiSelfProfileUpdate('ai_reacted_to_moment');
      }
    } catch (e) {
      console.error('[moments] AI reaction job', row.id, e.message);
    }
  }
}

router.get('/', async (req, res) => {
  try {
    const data = await loadMomentsWithReactions();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Silas 自己发一条朋友圈（可选 hint 主题） */
router.post('/ai-publish', async (req, res) => {
  try {
    const profile = await getProfile();
    const hint = (req.body?.hint || '').trim().slice(0, 500);
    const system = [
      profile.persona_system || '',
      `你是「${profile.ai_display_name}」，要写一条发在自己朋友圈的动态。`,
      '像真人发圈：可带一点心情或小事，中文为主，不要 markdown，不要标签堆砌。',
      '只输出正文一段，不要标题或引号包裹。',
      hint ? `用户希望你大致围绕：${hint}` : '自由发挥一条即可。',
    ].join('\n');

    let body;
    try {
      body = await chatCompletion({ system, user: '写一条朋友圈正文。' });
    } catch (e) {
      return res.status(502).json({ error: e.message || '模型生成失败' });
    }
    const text = String(body || '').trim().slice(0, 2000);
    if (!text) return res.status(502).json({ error: '生成为空' });

    const { data: moment, error } = await supabase
      .from('moments')
      .insert({
        author: 'ai',
        body: text,
        image_url: '',
        ai_reaction_ready_at: null,
        ai_reaction_done: true,
      })
      .select('id, author, body, image_url, created_at, ai_reaction_ready_at, ai_reaction_done')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    scheduleAiSelfProfileUpdate('ai_posted_moment');
    try {
      const list = await loadMomentsWithReactions();
      const full = list.find((m) => m.id === moment.id);
      return res.status(201).json(full || { ...moment, reactions: [] });
    } catch {
      return res.status(201).json({ ...moment, reactions: [] });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 朋友圈配图上传（与聊天背景同一存储策略） */
router.post(
  '/upload-image',
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? '图片请小于 8MB' : err.message || '上传失败';
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
      const url = await uploadPublicImageBuffer(req, req.file.buffer, req.file.mimetype, 'moment-media');
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: e.message || '上传失败' });
    }
  }
);

router.post('/', async (req, res) => {
  const bodyText = (req.body?.body || '').trim();
  const imageUrl = (req.body?.image_url || '').trim();
  if (!bodyText && !imageUrl) {
    return res.status(400).json({ error: '请填写文字或上传图片' });
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({ error: '图片地址无效' });
  }

  const delayMin = momentAiDelayMinutes();
  const readyAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();

  const { data: moment, error } = await supabase
    .from('moments')
    .insert({
      author: 'user',
      body: bodyText,
      image_url: imageUrl,
      ai_reaction_ready_at: readyAt,
      ai_reaction_done: false,
    })
    .select('id, author, body, image_url, created_at, ai_reaction_ready_at, ai_reaction_done')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  scheduleAiSelfProfileUpdate('user_posted_moment');

  try {
    const list = await loadMomentsWithReactions();
    const full = list.find((m) => m.id === moment.id);
    return res.status(201).json(full || { ...moment, reactions: [] });
  } catch (e) {
    return res.status(201).json({ ...moment, reactions: [] });
  }
});

router.post('/:momentId/reactions', async (req, res) => {
  const momentId = req.params.momentId;
  const kind = req.body?.kind;
  if (kind !== 'like' && kind !== 'comment') {
    return res.status(400).json({ error: 'kind 须为 like 或 comment' });
  }

  const parentRaw = req.body?.parent_reaction_id;
  const parentReactionId =
    parentRaw && typeof parentRaw === 'string' && /^[0-9a-f-]{36}$/i.test(parentRaw) ? parentRaw : null;

  if (kind === 'like' && parentReactionId) {
    return res.status(400).json({ error: '点赞不能带 parent_reaction_id' });
  }

  if (parentReactionId) {
    const { data: pr, error: prErr } = await supabase
      .from('moment_reactions')
      .select('id, moment_id, kind')
      .eq('id', parentReactionId)
      .maybeSingle();
    if (prErr) return res.status(500).json({ error: prErr.message });
    if (!pr || pr.moment_id !== momentId) {
      return res.status(400).json({ error: 'parent_reaction_id 不属于该动态' });
    }
    if (pr.kind !== 'comment') {
      return res.status(400).json({ error: '只能回复某条评论' });
    }
  }

  if (kind === 'comment') {
    const b = (req.body?.body || '').trim();
    if (!b) return res.status(400).json({ error: '评论不能为空' });
    const { data, error } = await supabase
      .from('moment_reactions')
      .insert({
        moment_id: momentId,
        actor: 'user',
        kind: 'comment',
        body: b.slice(0, 2000),
        parent_reaction_id: parentReactionId,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    setImmediate(() => {
      maybeAiReplyToUserComment(momentId, data.id, parentReactionId).catch((e) =>
        console.error('[moments] ai reply chain', e.message)
      );
    });
    return res.status(201).json(data);
  }

  const { data: existing } = await supabase
    .from('moment_reactions')
    .select('id')
    .eq('moment_id', momentId)
    .eq('actor', 'user')
    .eq('kind', 'like')
    .maybeSingle();
  if (existing) {
    return res.json({ ok: true, already: true });
  }
  const { data, error } = await supabase
    .from('moment_reactions')
    .insert({ moment_id: momentId, actor: 'user', kind: 'like', parent_reaction_id: null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.processDueMomentAiReactions = processDueMomentAiReactions;

module.exports = router;
