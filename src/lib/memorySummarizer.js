const { supabase } = require('../db/supabase');
const { getProfile, updateProfile } = require('./profile');
const { chatCompletion } = require('./openai');

/** 跨会话时间线：末尾保留多少条消息永不进入「待摘要」池 */
const RECENT_GLOBAL = Math.min(Math.max(Number(process.env.MEMORY_RECENT_GLOBAL_MESSAGES) || 32, 10), 120);
const DIGEST_MAX = Math.min(Math.max(Number(process.env.MEMORY_AUTO_DIGEST_MAX_CHARS) || 3500, 500), 12000);

/** 累计多少轮对话后提示合并长期记忆（一轮 = 用户一条 + 其后连续助手消息直到下一条用户） */
function digestBatchRounds() {
  const n = Number(process.env.MEMORY_DIGEST_BATCH_ROUNDS);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return Math.floor(n);
  return 100;
}

function iso(d) {
  return new Date(d).toISOString();
}

/**
 * 拉取全库 user/assistant 消息（跨会话），按时间排序。
 * @returns {Promise<Array<{role:string,content:string,created_at:string,conversation_id:string,conv_title?:string}>>}
 */
async function fetchAllChatMessagesTimeline() {
  const { data: msgs, error: mErr } = await supabase
    .from('messages')
    .select('role, content, created_at, conversation_id')
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });
  if (mErr) throw mErr;
  const { data: convs, error: cErr } = await supabase.from('conversations').select('id, title');
  if (cErr) throw cErr;
  const titleById = new Map((convs || []).map((c) => [c.id, (c.title || '').trim() || '对话']));
  return (msgs || []).map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at,
    conversation_id: r.conversation_id,
    conv_title: titleById.get(r.conversation_id) || '对话',
  }));
}

function getWatermarkMs(profile) {
  const w = profile?.memory_digest_watermark_at;
  if (!w) return new Date('1970-01-01T00:00:00.000Z').getTime();
  return new Date(w).getTime();
}

/** 去掉时间线开头孤立的助手消息（水印可能落在两轮中间时会出现） */
function trimLeadingAssistants(messages) {
  let i = 0;
  while (i < messages.length && messages[i].role === 'assistant') i++;
  return messages.slice(i);
}

/**
 * 一轮 = 一条 user 及其后连续的 assistant，直到下一条 user。
 * @returns {number} 完整轮数（仅统计以 user 开头的轮）
 */
function countRounds(messages) {
  let n = 0;
  let i = 0;
  while (i < messages.length) {
    if (messages[i].role === 'assistant') {
      i++;
      continue;
    }
    if (messages[i].role === 'user') {
      n++;
      i++;
      while (i < messages.length && messages[i].role === 'assistant') i++;
    } else {
      i++;
    }
  }
  return n;
}

/**
 * 从时间线头部截取前 nRounds 轮的全部消息（user + 其后 assistants），顺序不变。
 */
function takeFirstNRounds(messages, nRounds) {
  const out = [];
  let i = 0;
  let rounds = 0;
  while (i < messages.length && rounds < nRounds) {
    if (messages[i].role === 'assistant') {
      i++;
      continue;
    }
    if (messages[i].role !== 'user') {
      i++;
      continue;
    }
    out.push(messages[i]);
    i++;
    while (i < messages.length && messages[i].role === 'assistant') {
      out.push(messages[i]);
      i++;
    }
    rounds++;
  }
  return out;
}

function watermarkFromBatch(batch) {
  if (!batch?.length) return null;
  let maxT = -Infinity;
  let maxIso = batch[0].created_at;
  for (const m of batch) {
    const t = new Date(m.created_at).getTime();
    if (t >= maxT) {
      maxT = t;
      maxIso = m.created_at;
    }
  }
  return maxIso;
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string, pending?: any[], batch?: any[], pendingRounds?: number, pendingCount?: number }>}
 */
async function computeDigestBatchState(profile) {
  const batchRounds = digestBatchRounds();
  const all = await fetchAllChatMessagesTimeline();
  if (all.length <= RECENT_GLOBAL) {
    return { ok: false, reason: 'no_foldable', pendingRounds: 0, pendingCount: 0 };
  }
  const foldable = all.slice(0, -RECENT_GLOBAL);
  const cut = getWatermarkMs(profile);
  let pending = foldable.filter((m) => new Date(m.created_at).getTime() > cut);
  pending = trimLeadingAssistants(pending);
  const pendingRounds = countRounds(pending);
  const pendingCount = pending.length;
  if (pendingRounds < batchRounds) {
    return { ok: false, reason: 'below_rounds', pendingRounds, pendingCount, batchRounds };
  }
  const batch = takeFirstNRounds(pending, batchRounds);
  return { ok: true, pending, batch, pendingRounds, pendingCount, batchRounds };
}

/**
 * 计算当前是否可提示用户生成摘要（不调用 OpenAI）。
 */
async function getMemoryDigestPreview() {
  const profile = await getProfile();
  const st = await computeDigestBatchState(profile);
  const batchRounds = digestBatchRounds();
  if (!st.ok || st.reason === 'no_foldable') {
    return {
      ready: false,
      pendingCount: st.pendingCount || 0,
      pendingRounds: st.pendingRounds || 0,
      batchCount: 0,
      batchRounds,
      previewSnippet: '',
    };
  }
  if (!st.batch?.length) {
    return {
      ready: false,
      pendingCount: st.pendingCount || 0,
      pendingRounds: st.pendingRounds || 0,
      batchCount: 0,
      batchRounds,
      previewSnippet: '',
    };
  }
  const snippet = st.batch
    .slice(0, 3)
    .map((m) => `[${m.conv_title}] ${m.role === 'user' ? '用户' : '助手'}：${String(m.content || '').trim().slice(0, 60)}…`)
    .join('\n');
  return {
    ready: true,
    pendingCount: st.pendingCount,
    pendingRounds: st.pendingRounds,
    batchCount: st.batch.length,
    batchRounds,
    previewSnippet: snippet,
  };
}

/**
 * 用户确认后：将一批跨会话旧消息合并进 memory_auto_digest，并推进全局水印。
 */
async function runMemoryDigestMergeConfirmed() {
  const profile = await getProfile();
  const st = await computeDigestBatchState(profile);
  if (!st.ok || !st.batch?.length) {
    return { ok: false, reason: st.reason || 'below_rounds', merged: 0 };
  }

  const pending = st.batch;
  const existingDigest = (profile.memory_auto_digest || '').trim();
  const userNotes = (profile.memory_user_notes || '').trim();

  const transcript = pending
    .map(
      (m) =>
        `【${m.conv_title}】${m.role === 'user' ? '用户' : '助手'}：${String(m.content || '').trim()}`
    )
    .join('\n');

  const system = [
    '你是「长期记忆」维护模块，只输出摘要正文，不要标题、不要 Markdown、不要客套。',
    '用简明中文要点（可分段换行），总长度不超过约 1200 汉字。',
    '对话来自多个会话，请在要点中适当标注是哪类话题或哪条线（不必每条都写会话名）。',
    '融合「已有自动摘要」与「新对话片段」：保留对用户重要的事实、称呼、偏好、约定、反复出现的话题；去掉寒暄与无信息废话。',
    '不要编造对话里没有的内容。若与「用户手写记忆」冲突，以对话事实为准并在摘要中温和体现。',
    '输出中不要写「摘要：」「如下」等前缀。',
  ].join('\n');

  const userBlock = [
    '【当前自动摘要】',
    existingDigest || '（尚无）',
    '',
    '【用户手写记忆（供对齐，勿逐字复述）】',
    userNotes || '（无）',
    '',
    '【待合并的新对话片段（跨多个会话）】',
    transcript,
    '',
    '请输出合并后的新自动摘要。',
  ].join('\n');

  const merged = await chatCompletion({
    system,
    messages: [{ role: 'user', content: userBlock }],
  });

  let out = String(merged || '').trim();
  if (out.length > DIGEST_MAX) {
    out = `${out.slice(0, DIGEST_MAX)}\n…（已截断，可在「我」中编辑自动摘要）`;
  }

  const throughIso = watermarkFromBatch(pending);

  await updateProfile({
    memory_auto_digest: out,
    memory_digest_watermark_at: throughIso,
  });

  return { ok: true, merged: pending.length };
}

/**
 * 放弃本轮摘要：不调用模型，仅把水印推进到本批（约 batchRounds 轮）最后一条消息之后，
 * 下一轮从其后继续计数，同一批消息不会再次进入待摘要池。
 */
async function runMemoryDigestSkipConfirmed() {
  const profile = await getProfile();
  const st = await computeDigestBatchState(profile);
  if (!st.ok || !st.batch?.length) {
    return { ok: false, reason: st.reason || 'below_rounds', skipped: 0 };
  }
  const throughIso = watermarkFromBatch(st.batch);
  await updateProfile({
    memory_digest_watermark_at: throughIso,
  });
  return { ok: true, skipped: st.batch.length };
}

/** 与「当前会话送进模型的条数」对齐的常量（供 chat 路由 import） */
const RECENT_WINDOW = Math.min(Math.max(Number(process.env.MEMORY_RECENT_MESSAGES) || 18, 6), 60);

module.exports = {
  getMemoryDigestPreview,
  runMemoryDigestMergeConfirmed,
  runMemoryDigestSkipConfirmed,
  digestBatchRounds,
  RECENT_WINDOW,
};
