const { supabase } = require('../db/supabase');
const { getProfile } = require('./profile');
const { chatCompletion } = require('./openai');
const { withDeadline } = require('./deadline');
const { DEFAULT_CONVERSATION_ID } = require('./conversationConstants');
const { RECENT_WINDOW } = require('./memorySummarizer');
const { hintifySupabaseError } = require('./supabaseErrorHint');

const DB_STEP_MS = 20000;

function envBool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v !== '0' && String(v).toLowerCase() !== 'false';
}

function numEnv(name, def, min, max) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function randomIntInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomBetweenMs(minMs, maxMs) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return randomIntInclusive(lo, hi);
}

function splitAssistantParts(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [t];
}

function clockMinutesInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  let h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  let m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  if (!Number.isFinite(h)) h = 0;
  if (!Number.isFinite(m)) m = 0;
  return h * 60 + m;
}

function isPeakHours(date, timeZone, startMinutes, endMinutes) {
  const mins = clockMinutesInTz(date, timeZone);
  return mins >= startMinutes && mins <= endMinutes;
}

function parseHmToMinutes(hm) {
  const s = String(hm || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

async function touchConversationUpdated(convId) {
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
}

let timer = null;

function clearProactiveTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNextSilasTick(delayMs) {
  clearProactiveTimer();
  timer = setTimeout(runSilasProactiveTick, delayMs);
}

async function runSilasProactiveTick() {
  const enabled = envBool('SILAS_PROACTIVE_ENABLED', false);
  const tz = (process.env.SILAS_PROACTIVE_TZ || 'Asia/Shanghai').trim() || 'Asia/Shanghai';

  const peakStart = parseHmToMinutes(process.env.SILAS_PROACTIVE_PEAK_START) ?? 10 * 60;
  const peakEnd = parseHmToMinutes(process.env.SILAS_PROACTIVE_PEAK_END) ?? 23 * 60 + 30;

  let peakMinMs = numEnv('SILAS_PROACTIVE_PEAK_MIN_MS', 30 * 60 * 1000, 5 * 60 * 1000, 3 * 60 * 60 * 1000);
  let peakMaxMs = numEnv('SILAS_PROACTIVE_PEAK_MAX_MS', 60 * 60 * 1000, peakMinMs, 6 * 60 * 60 * 1000);
  if (peakMaxMs < peakMinMs) [peakMinMs, peakMaxMs] = [peakMaxMs, peakMinMs];

  let offMinMs = numEnv('SILAS_PROACTIVE_OFF_MIN_MS', 3 * 60 * 60 * 1000, 30 * 60 * 1000, 24 * 60 * 60 * 1000);
  let offMaxMs = numEnv('SILAS_PROACTIVE_OFF_MAX_MS', 6 * 60 * 60 * 1000, offMinMs, 48 * 60 * 60 * 1000);
  if (offMaxMs < offMinMs) [offMinMs, offMaxMs] = [offMaxMs, offMinMs];

  const idleMinutes = numEnv('SILAS_PROACTIVE_IDLE_MINUTES', 25, 0, 180);
  const convId = (process.env.SILAS_PROACTIVE_CONVERSATION_ID || '').trim() || DEFAULT_CONVERSATION_ID;

  const nextPeakDelay = () => randomBetweenMs(peakMinMs, peakMaxMs);
  const nextOffDelay = () => randomBetweenMs(offMinMs, offMaxMs);

  if (!enabled) {
    scheduleNextSilasTick(60 * 60 * 1000);
    return;
  }

  let peak = isPeakHours(new Date(), tz, peakStart, peakEnd);

  if (!process.env.OPENAI_API_KEY) {
    scheduleNextSilasTick(60 * 60 * 1000);
    return;
  }

  try {
    const { data: lastRows, error: lastErr } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lastErr) {
      console.error('[silas-proactive] 读取最近消息失败:', lastErr.message);
      scheduleNextSilasTick(15 * 60 * 1000);
      return;
    }

    const lastAt = lastRows?.[0]?.created_at;
    if (lastAt && idleMinutes > 0) {
      const ageMs = Date.now() - new Date(lastAt).getTime();
      if (ageMs < idleMinutes * 60 * 1000) {
        scheduleNextSilasTick(randomBetweenMs(8 * 60 * 1000, 18 * 60 * 1000));
        return;
      }
    }

    const profile = await withDeadline(getProfile(), DB_STEP_MS, 'getProfile');

    const recentLimit = Math.min(
      Math.max(Number(process.env.CHAT_HISTORY_MESSAGES) || RECENT_WINDOW, 8),
      80
    );

    const { data: history, error: histErr } = await withDeadline(
      supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(recentLimit),
      DB_STEP_MS,
      'history'
    );

    if (histErr) {
      console.error('[silas-proactive] 历史失败:', histErr.message);
      scheduleNextSilasTick(15 * 60 * 1000);
      return;
    }

    const chronological = (history || [])
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant');

    const memParts = [];
    const uNotes = (profile.memory_user_notes || '').trim();
    const digest = (profile.memory_auto_digest || '').trim();
    if (uNotes) memParts.push(`【用户写下的长期记忆】\n${uNotes}`);
    if (digest) memParts.push(`【更早对话的自动摘要（定期合并）】\n${digest}`);
    const memoryBlock = memParts.length
      ? `${memParts.join('\n\n')}\n\n以上供你自然参考，不要向用户复述「摘要里写了什么」除非用户问起。`
      : '';

    const aiName = profile.ai_display_name || 'Silas';
    const system = [
      profile.persona_system || '',
      memoryBlock,
      `你的名字是「${aiName}」。用户显示名为「${profile.user_display_name}」。`,
      '此刻是「你主动找用户说话」，用户可能没有在聊天界面、也没有刚发消息。',
      '内容要自然、像熟人随手发微信：关心一句、分享小事、轻松问近况都可以；不要写「系统提示」「作为AI」等元话语。',
      '本次输出随机用 1～4 条短消息：若想分多条发，请用「单独一个空行」分隔每一段，每一段会显示为独立气泡；若只想说一件事就只写一段。不要编号。',
    ]
      .filter(Boolean)
      .join('\n');

    const assistantText = await chatCompletion({
      system,
      messages: chronological,
      user: '请现在按系统说明主动对用户说话。（不要复述本句。）',
    });

    const parts = splitAssistantParts(assistantText).slice(0, 4);

    for (const part of parts) {
      const ins = await withDeadline(
        supabase.from('messages').insert({ role: 'assistant', content: part, conversation_id: convId }),
        DB_STEP_MS,
        'insert assistant'
      );
      if (ins.error) {
        console.error('[silas-proactive] 写入失败:', hintifySupabaseError(ins.error.message));
        scheduleNextSilasTick(15 * 60 * 1000);
        return;
      }
    }

    if (parts.length) {
      await touchConversationUpdated(convId);
      console.log(`[silas-proactive] 已写入 ${parts.length} 条主动消息 → ${convId}`);
    }

    peak = isPeakHours(new Date(), tz, peakStart, peakEnd);
    scheduleNextSilasTick(peak ? nextPeakDelay() : nextOffDelay());
  } catch (e) {
    if (e.code === 'NO_OPENAI_KEY') {
      scheduleNextSilasTick(60 * 60 * 1000);
      return;
    }
    console.error('[silas-proactive]', e.message || e);
    scheduleNextSilasTick(15 * 60 * 1000);
  }
}

function startSilasProactiveTimers() {
  const enabled = envBool('SILAS_PROACTIVE_ENABLED', false);
  if (!enabled) {
    console.log(
      '   [silas-proactive] 未开启：在 .env 设 SILAS_PROACTIVE_ENABLED=1 并重启；默认高峰 10:00–23:30（时区 SILAS_PROACTIVE_TZ）约每 30–60 分钟尝试一次，夜间间隔更长'
    );
    return;
  }
  const jitter = randomBetweenMs(45 * 1000, 3 * 60 * 1000);
  console.log(
    `   [silas-proactive] 已开启：约 ${Math.round(jitter / 1000)}s 后首次尝试，之后按高峰/低谷随机间隔（需进程常驻 + OPENAI_API_KEY）`
  );
  scheduleNextSilasTick(jitter);
}

module.exports = { startSilasProactiveTimers };
