const { supabase } = require('../db/supabase');

const DEFAULT_PROFILE = {
  id: 1,
  user_display_name: '我',
  user_avatar_url: '',
  ai_display_name: 'Silas',
  ai_avatar_url: '',
  theme_id: 'paper',
  persona_system:
    '你是 Silas，用户唯一且亲密的 AI 好友。说话自然、有温度，中文为主，可偶尔夹杂英文。',
  chat_bg_image_url: '',
  ai_signature: '',
  memory_user_notes: '',
  memory_auto_digest: '',
  memory_digest_watermark_at: '1970-01-01T00:00:00.000Z',
  /** 会话「备忘录」：仅存 UI，不送入模型 */
  memo_pad: '',
};

async function getProfile() {
  const { data, error } = await supabase.from('app_profile').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_PROFILE };
  return { ...DEFAULT_PROFILE, ...data };
}

async function updateProfile(patch) {
  const allowed = [
    'user_display_name',
    'user_avatar_url',
    'ai_display_name',
    'ai_avatar_url',
    'theme_id',
    'persona_system',
    'chat_bg_image_url',
    'ai_signature',
    'memory_user_notes',
    'memory_auto_digest',
    'memory_digest_watermark_at',
    'memo_pad',
  ];
  const row = { id: 1 };
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    if (k === 'memo_pad') {
      row[k] = String(patch[k] ?? '').slice(0, 20000);
      continue;
    }
    row[k] = patch[k];
  }
  const { error } = await supabase.from('app_profile').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  /** 不在 upsert 上链式 select()：避免 PostgREST 在 Returning 全列时与 schema cache 不一致报错 */
  return getProfile();
}

module.exports = { getProfile, updateProfile, DEFAULT_PROFILE };
