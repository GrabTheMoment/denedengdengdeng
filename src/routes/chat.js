const express = require('express');
const { supabase } = require('../db/supabase');
const { authRequired } = require('../middleware/auth');
const { getProfile } = require('../lib/profile');
const { chatCompletion } = require('../lib/openai');
const { withDeadline } = require('../lib/deadline');
const { scheduleAiSelfProfileUpdate } = require('../lib/aiSelfProfile');
const { DEFAULT_CONVERSATION_ID } = require('../lib/conversationConstants');
const { hintifySupabaseError } = require('../lib/supabaseErrorHint');
const { RECENT_WINDOW } = require('../lib/memorySummarizer');

const DB_STEP_MS = 20000;

const router = express.Router();
router.use(authRequired);

function splitAssistantParts(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [t];
}

async function touchConversationUpdated(convId) {
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
}

router.post('/', async (req, res) => {
  const content = (req.body?.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  const conversationId = (req.body?.conversation_id || DEFAULT_CONVERSATION_ID).trim();

  let userRow;
  let userErr;
  try {
    const r = await withDeadline(
      supabase
        .from('messages')
        .insert({ role: 'user', content, conversation_id: conversationId })
        .select('id, role, content, created_at')
        .single(),
      DB_STEP_MS,
      'Supabase 写入用户消息'
    );
    userRow = r.data;
    userErr = r.error;
  } catch (e) {
    return res.status(504).json({ error: e.message || '数据库超时' });
  }
  if (userErr) return res.status(500).json({ error: hintifySupabaseError(userErr.message) });

  let profile;
  try {
    profile = await withDeadline(getProfile(), DB_STEP_MS, 'Supabase 读取设置');
  } catch (e) {
    return res.status(504).json({ error: e.message });
  }

  const recentLimit = Math.min(Math.max(Number(process.env.CHAT_HISTORY_MESSAGES) || RECENT_WINDOW, 8), 80);

  let history;
  let histErr;
  try {
    const r = await withDeadline(
      supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(recentLimit),
      DB_STEP_MS,
      'Supabase 读取历史'
    );
    history = r.data;
    histErr = r.error;
  } catch (e) {
    return res.status(504).json({ error: e.message });
  }
  if (histErr) return res.status(500).json({ error: hintifySupabaseError(histErr.message) });

  const chronological = (history || []).reverse().filter((m) => m.role === 'user' || m.role === 'assistant');

  const memParts = [];
  /** app_profile.memo_pad（会话列表备忘录）仅供前端展示，不送入模型 */
  const uNotes = (profile.memory_user_notes || '').trim();
  const digest = (profile.memory_auto_digest || '').trim();
  if (uNotes) memParts.push(`【用户写下的长期记忆】\n${uNotes}`);
  if (digest) memParts.push(`【更早对话的自动摘要（定期合并）】\n${digest}`);
  const memoryBlock = memParts.length ? `${memParts.join('\n\n')}\n\n以上供你自然参考，回复中不要复述「摘要里写了什么」除非用户问起。` : '';

  const system = [
    profile.persona_system || '',
    memoryBlock,
    `你的名字是「${profile.ai_display_name}」。用户显示名为「${profile.user_display_name}」。`,
    '你在和用户私聊。请直接回复用户上一条消息，不要加角色旁白或括号舞台说明。',
    '若一次想发多条短消息，请用「单独一个空行」分隔每一段；每一段会显示为独立气泡。否则发一整段即可。',
  ]
    .filter(Boolean)
    .join('\n');

  let assistantText;
  try {
    assistantText = await chatCompletion({
      system,
      messages: chronological,
    });
  } catch (e) {
    console.error('[chat] OpenAI 失败:', e.code || '', e.status || '', e.message);
    if (e.code === 'NO_OPENAI_KEY') {
      return res.status(503).json({ error: '未配置 OPENAI_API_KEY', userMessage: userRow });
    }
    return res.status(502).json({ error: e.message || '模型调用失败', userMessage: userRow });
  }

  const parts = splitAssistantParts(assistantText);
  const assistantRows = [];

  for (const part of parts) {
    let assistantRow;
    let asstErr;
    try {
      const r = await withDeadline(
        supabase
          .from('messages')
          .insert({ role: 'assistant', content: part, conversation_id: conversationId })
          .select('id, role, content, created_at')
          .single(),
        DB_STEP_MS,
        'Supabase 写入助手消息'
      );
      assistantRow = r.data;
      asstErr = r.error;
    } catch (e) {
      return res.status(504).json({ error: e.message });
    }
    if (asstErr) return res.status(500).json({ error: hintifySupabaseError(asstErr.message) });
    assistantRows.push(assistantRow);
  }

  await touchConversationUpdated(conversationId);

  res.json({
    userMessage: userRow,
    assistantMessages: assistantRows,
    assistantMessage: assistantRows[0] || null,
  });
  setImmediate(() => scheduleAiSelfProfileUpdate('user_chatted'));
});

module.exports = router;
