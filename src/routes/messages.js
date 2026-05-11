const express = require('express');
const { supabase } = require('../db/supabase');
const { authRequired } = require('../middleware/auth');
const { hintifySupabaseError } = require('../lib/supabaseErrorHint');
const { DEFAULT_CONVERSATION_ID } = require('../lib/conversationConstants');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const cid = (req.query.conversation_id || DEFAULT_CONVERSATION_ID).trim();

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', cid)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: hintifySupabaseError(error.message) });
  res.json(data || []);
});

module.exports = router;
