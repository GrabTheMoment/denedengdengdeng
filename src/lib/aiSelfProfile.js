const { chatCompletion, tryParseJsonObject } = require('./openai');
const { getProfile, updateProfile } = require('./profile');

const DAY_MS = 24 * 60 * 60 * 1000;
/** 任意触发（聊天/朋友圈/随机）之间至少间隔多久才允许再次改头像签名；默认约一个月 */
function resolveMinGapMs() {
  const n = Number(process.env.AI_SELF_UPDATE_MIN_GAP_MS);
  if (Number.isFinite(n) && n >= 60 * 60 * 1000) return Math.min(n, 365 * DAY_MS);
  return 30 * DAY_MS;
}
const MIN_GAP_MS = resolveMinGapMs();

let running = false;
let lastRunAt = 0;

function defaultAvatarCandidates() {
  return [
    'https://api.dicebear.com/9.x/avataaars/svg?seed=Silas01&backgroundColor=b6e3f4',
    'https://api.dicebear.com/9.x/avataaars/svg?seed=Silas02&backgroundColor=c0aede',
    'https://api.dicebear.com/9.x/avataaars/svg?seed=Silas03&backgroundColor=d1d4f9',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=silasA&backgroundColor=ffdfbf',
    'https://api.dicebear.com/9.x/bottts/svg?seed=silasBot&backgroundColor=ffd5dc',
  ];
}

function avatarCandidates() {
  const raw = process.env.AI_AVATAR_CANDIDATES || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  return fromEnv.length ? fromEnv : defaultAvatarCandidates();
}

/** 为 true 时不应用模型对签名文案的修改（仍可更新头像，除非头像也已关掉） */
function skipAiSignatureAutoUpdate() {
  return process.env.AI_SELF_UPDATE_SIGNATURE === '0';
}

/** 为 true 时不应用模型对头像的修改（仍可更新签名，除非签名也已关掉） */
function skipAiAvatarAutoUpdate() {
  return process.env.AI_SELF_UPDATE_AVATAR === '0';
}

/**
 * 当前头像若是「用户自己在设置里填的」自定义 URL（不在候选列表内），则永不自动替换，
 * 避免把手动上传的头像改成 Dicebear 等候选图。
 */
function isUserCustomAiAvatar(currentUrl, candidates) {
  const u = String(currentUrl || '').trim();
  if (!u) return false;
  return !candidates.includes(u);
}

/** 异步触发，不阻塞 HTTP；失败只打日志 */
function scheduleAiSelfProfileUpdate(reason) {
  setImmediate(() => {
    runAiSelfProfileUpdate(reason).catch((e) => console.error('[ai-self]', reason, e.message));
  });
}

async function runAiSelfProfileUpdate(reason) {
  if (process.env.AI_SELF_UPDATE_ENABLED === '0') return;
  if (running) return;
  const now = Date.now();
  if (now - lastRunAt < MIN_GAP_MS) return;

  running = true;
  try {
    const candidates = avatarCandidates();

    let profile;
    try {
      profile = await getProfile();
    } catch {
      return;
    }

    const customAvatarLocked = isUserCustomAiAvatar(profile.ai_avatar_url, candidates);
    const avatarAutoOff = skipAiAvatarAutoUpdate();
    const signatureAutoOff = skipAiSignatureAutoUpdate();

    const system = [
      '你是「AI 自我展示」维护模块，只负责更新头像 URL 与个性签名文案。',
      `角色的显示名必须是「${profile.ai_display_name}」——不要改名字，JSON 里也不要出现 ai_display_name。`,
      '根据触发原因，更新「个性签名 ai_signature」和/或从候选里选一个「头像 ai_avatar_url」。',
      '个性签名：一句中文为主、可少量英文，8～36 字，像社交软件简介，贴合人设、自然不鸡汤。',
      '头像：必须**完整等于**候选列表中的某一项 URL；若不想改头像，输出空字符串。',
      '禁止编造 URL。禁止 markdown。只输出 JSON：{"ai_signature":"...","ai_avatar_url":""}',
    ].join('\n');

    const user = JSON.stringify({
      trigger: reason,
      current_signature: profile.ai_signature || '',
      current_avatar_url: profile.ai_avatar_url || '',
      avatar_candidates: candidates,
    });

    let raw;
    try {
      raw = await chatCompletion({ system, user });
    } catch (e) {
      console.error('[ai-self] OpenAI', e.message);
      return;
    }

    const parsed = tryParseJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return;

    const sig = String(parsed.ai_signature || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    let av = String(parsed.ai_avatar_url || '').trim();
    if (av && !candidates.includes(av)) av = '';

    const patch = {};
    if (!signatureAutoOff && sig && sig !== (profile.ai_signature || '')) patch.ai_signature = sig;
    /** 空字符串表示「不改头像」；用户自定义 URL 或 AI_SELF_UPDATE_AVATAR=0 时不改头像 */
    if (!avatarAutoOff && !customAvatarLocked && av && av !== (profile.ai_avatar_url || '')) {
      patch.ai_avatar_url = av;
    }

    if (!Object.keys(patch).length) return;

    await updateProfile(patch);
    console.log('[ai-self] updated', Object.keys(patch).join(','), 'reason=', reason);
    lastRunAt = Date.now();
  } finally {
    running = false;
  }
}

function scheduleNextRandomAiSelfTimer() {
  const envMin = Number(process.env.AI_SELF_UPDATE_MIN_MS);
  const envMax = Number(process.env.AI_SELF_UPDATE_MAX_MS);
  const minMs = Number.isFinite(envMin) && envMin >= DAY_MS ? envMin : 26 * DAY_MS;
  const maxMs = Number.isFinite(envMax) && envMax >= minMs ? envMax : 34 * DAY_MS;
  const delay = minMs + Math.random() * (maxMs - minMs);
  setTimeout(() => {
    scheduleAiSelfProfileUpdate('random_timer');
    scheduleNextRandomAiSelfTimer();
  }, delay);
}

function startRandomAiSelfProfileTimers() {
  if (process.env.AI_SELF_UPDATE_ENABLED === '0') return;
  /** 首次随机触发也在约一月量级内，避免启动后很快打一次模型 */
  const firstDelay = DAY_MS + Math.random() * 6 * DAY_MS;
  setTimeout(() => scheduleNextRandomAiSelfTimer(), firstDelay);
}

module.exports = {
  scheduleAiSelfProfileUpdate,
  runAiSelfProfileUpdate,
  startRandomAiSelfProfileTimers,
};
