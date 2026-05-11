const express = require('express');
const { authRequired } = require('../middleware/auth');
const { supabase } = require('../db/supabase');
const { hintifySupabaseError } = require('../lib/supabaseErrorHint');
const { DEFAULT_CONVERSATION_ID } = require('../lib/conversationConstants');
const router = express.Router();
router.use(authRequired);

function nestedMessageCount(row) {
  const agg = row.messages;
  if (!Array.isArray(agg) || agg.length === 0) return 0;
  const c = agg[0]?.count;
  if (typeof c === 'number') return c;
  if (typeof c === 'string') return Number(c) || 0;
  return 0;
}

/** 列表中不展示「从未发过消息」的新建会话；默认「与 Silas」始终展示 */
async function listConversations(req, res) {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, created_at, updated_at, messages(count)')
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: hintifySupabaseError(error.message) });
    const rows = data || [];
    const filtered = rows.filter((row) => {
      if (row.id === DEFAULT_CONVERSATION_ID) return true;
      return nestedMessageCount(row) > 0;
    });
    const out = filtered.map(({ messages: _m, ...rest }) => rest);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message) });
  }
}

async function createConversation(req, res) {
  try {
    const title = (req.body?.title || '新对话').trim().slice(0, 80) || '新对话';
    const { data, error } = await supabase
      .from('conversations')
      .insert({ title })
      .select('id, title, created_at, updated_at')
      .single();
    if (error) return res.status(500).json({ error: hintifySupabaseError(error.message) });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message) });
  }
}

router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const title = (req.body?.title || '').trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: '标题不能为空' });
    const { data, error } = await supabase
      .from('conversations')
      .update({ title })
      .eq('id', id)
      .select('id, title, created_at, updated_at')
      .single();
    if (error) return res.status(500).json({ error: hintifySupabaseError(error.message) });
    if (!data) return res.status(404).json({ error: '未找到' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: hintifySupabaseError(e.message) });
  }
});

module.exports = router;
module.exports.listConversations = listConversations;
module.exports.createConversation = createConversation;
