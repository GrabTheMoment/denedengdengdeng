/**
 * 把 PostgREST / Supabase 常见英文报错转成可操作的简短中文（仍保留技术关键词便于搜索）。
 */
function hintifySupabaseError(raw) {
  const m = String(raw || '');
  if (!m) return m;
  if (m.includes('Could not find the table') && m.includes('conversations')) {
    return (
      '数据库里还没有「会话」表 conversations。请到 Supabase 控制台 → SQL → 新建查询，粘贴并执行本仓库文件 ' +
      'supabase/migration_conversations.sql 的全文，成功后刷新本应用。若仍提示 schema cache，到 Project settings → API 点 Reload schema，或等待约一分钟。'
    );
  }
  if (
    (m.includes('Could not find') && m.includes('conversation_id')) ||
    (m.includes('column') && m.includes('conversation_id') && m.includes('does not exist'))
  ) {
    return (
      'messages 表缺少 conversation_id 列。请在 Supabase SQL Editor 执行 supabase/migration_conversations.sql（会建 conversations 表并补列）。'
    );
  }
  if (m.includes('schema cache') && m.includes('conversations')) {
    return `${m} — 若表已建好：Supabase → Project settings → API → Reload schema，或稍等再试。`;
  }
  if (m.includes('conversation_memory') && (m.includes('does not exist') || m.includes('schema cache'))) {
    return (
      '缺少表 conversation_memory。请在 Supabase 执行 supabase/migration_longterm_memory.sql（或更新后的 schema.sql）。'
    );
  }
  if (
    (m.includes('memory_user_notes') ||
      m.includes('memory_auto_digest') ||
      m.includes('memory_digest_watermark')) &&
    (m.includes('does not exist') || m.includes('schema cache'))
  ) {
    return 'app_profile 缺少长期记忆相关列。请执行 supabase/migration_longterm_memory.sql（若已执行过旧版，再执行其中新增的 alter 语句）。';
  }
  if (m.includes('memo_pad') && (m.includes('does not exist') || m.includes('schema cache'))) {
    return 'app_profile 缺少备忘录列 memo_pad。请在 Supabase SQL Editor 执行本仓库 supabase/migration_memo_pad.sql 全文，然后在 Project settings → API 点 Reload schema。';
  }
  if (m.includes('ai_signature') && (m.includes('does not exist') || m.includes('schema cache'))) {
    return 'app_profile 缺少列 ai_signature（AI 个性签名）。请在 Supabase SQL Editor 执行本仓库 supabase/migration_ai_signature.sql 全文，然后在 Project settings → API 点 Reload schema。';
  }
  return m;
}

module.exports = { hintifySupabaseError };
