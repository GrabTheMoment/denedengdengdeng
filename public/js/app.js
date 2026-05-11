import { api, getToken, setToken, apiUrl } from './api.js';
import { applyChatBackdropTintFromImageUrl, clearChatBackdropTint } from './chatBackdropTint.js';

let profile = {};
let authDisabled = false;
let momentsRefreshTimer = null;
/** 会话线程打开时轮询消息，便于收到 Silas 服务端主动推送的多条气泡 */
let chatThreadPollTimer = null;

/** 与迁移默认会话 id 一致 */
const DEFAULT_CONVERSATION_ID = '00000000-0000-4000-8000-000000000002';
let currentConversationId = DEFAULT_CONVERSATION_ID;
const conversationTitleById = new Map();

/** 最近一次摘要预览（用于「稍后」后立即二次确认文案） */
let lastMemoryDigestPreview = null;

/** 旧版仅本机备忘；若服务端 memo_pad 仍为空则迁移一次后删除 */
const LEGACY_MEMO_PAD_STORAGE_KEY = 'silas_local_memo_pad_v1';
let memoPadSaveTimer = null;

function setMemoryDigestPanels(mode) {
  const normal = document.getElementById('memory-digest-panel-normal');
  const skip = document.getElementById('memory-digest-panel-skip');
  if (normal) normal.classList.toggle('hidden', mode !== 'normal');
  if (skip) skip.classList.toggle('hidden', mode !== 'skip');
}

const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  const long = typeof msg === 'string' && (msg.length > 100 || msg.includes('本次请求：'));
  toast._t = setTimeout(() => el.classList.add('hidden'), long ? 8000 : 2800);
}

function openErrorSheet(fullText) {
  const sheet = document.getElementById('error-sheet');
  const pre = document.getElementById('error-sheet-text');
  if (!sheet || !pre) return;
  pre.textContent = fullText;
  console.error('[Silas 诊断]', fullText);
  sheet.classList.remove('hidden');
}

function closeErrorSheet() {
  document.getElementById('error-sheet')?.classList.add('hidden');
}

document.getElementById('error-sheet-close')?.addEventListener('click', closeErrorSheet);
document.getElementById('error-sheet-backdrop')?.addEventListener('click', closeErrorSheet);

function showMomentPostedModal() {
  document.getElementById('moment-success-sheet')?.classList.remove('hidden');
}

function hideMomentPostedModal() {
  document.getElementById('moment-success-sheet')?.classList.add('hidden');
  refreshProfileFromServer().then(() => {
    const threadPane = document.getElementById('chat-thread-pane');
    const inThread = threadPane && !threadPane.classList.contains('hidden');
    if (inThread) loadMessages().catch(() => {});
  });
}

document.getElementById('moment-success-ok')?.addEventListener('click', hideMomentPostedModal);
document.getElementById('moment-success-backdrop')?.addEventListener('click', hideMomentPostedModal);

async function refreshProfileFromServer() {
  try {
    profile = await api('/api/settings');
    applyChatBackgroundFromProfile();
    syncMomentsAvatar();
    $('#set-ai-signature').value = profile.ai_signature || '';
    $('#set-user-avatar').value = profile.user_avatar_url || '';
    $('#set-ai-name').value = profile.ai_display_name || '';
    $('#set-ai-avatar').value = profile.ai_avatar_url || '';
    $('#set-memory-user-notes') && ($('#set-memory-user-notes').value = profile.memory_user_notes || '');
    $('#set-memory-auto-digest') && ($('#set-memory-auto-digest').value = profile.memory_auto_digest || '');
    updateHeader();
  } catch (_) {
    /* ignore */
  }
}

document.getElementById('silas-force-update')?.addEventListener('click', async () => {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs?.length) await Promise.all(regs.map((r) => r.unregister()));
  } catch (_) {
    /* ignore */
  }
  location.reload();
});

function absoluteApiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const u = apiUrl(p);
  if (u.startsWith('http')) return u;
  if (typeof location !== 'undefined') return `${location.origin}${u}`;
  return u;
}

function looksLikeNetworkFailure(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('网络请求失败') ||
    m.includes('本次请求：') ||
    m.includes('failed to fetch') ||
    m.includes('fetch failed') ||
    m.includes('load failed') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('err_connection') ||
    m === 'typeerror: failed to fetch'
  );
}

/**
 * @param {unknown} err
 * @param {string} [apiPath] 例如 /api/chat，用于在弹窗里打印浏览器实际会请求的完整 URL
 */
function notifyError(err, apiPath = '') {
  const msg = err?.message || String(err);
  const urlLine = apiPath ? `【本次接口完整地址】\n${absoluteApiUrl(apiPath)}` : '';
  const pageLine = `【当前页面地址】\n${typeof location !== 'undefined' ? location.href : '(unknown)'}`;
  const footer = [urlLine, pageLine].filter(Boolean).join('\n\n');
  const full = footer ? `${msg}\n\n${footer}` : msg;
  /** 勿因传入 apiPath 就强制大弹窗，否则「聊天成功、仅刷新列表失败」等短错误也会挡全屏 */
  const showSheet = looksLikeNetworkFailure(msg) || msg.length > 140;
  if (showSheet) {
    openErrorSheet(full);
    toast('出错：请看中间弹窗（可长按灰色区域复制）');
  } else {
    toast(msg);
  }
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return t;
  return `${d.getMonth() + 1}/${d.getDate()} ${t}`;
}

function avatarHtml(url, initial) {
  if (url && /^https?:\/\//i.test(url)) {
    return `<span class="avatar"><img src="${escapeAttr(url)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="avatar">${escapeHtml((initial || '?').slice(0, 1))}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** 界面固定为纸本主题（不再提供切换） */
const THEME_FIXED = 'paper';

function applyTheme() {
  document.body.dataset.theme = THEME_FIXED;
  syncChatPhotoLayer();
}

/** 聊天背景：设置里的 http(s) 图 URL（相册上传后由服务端写入 profile） */
function applyChatBackgroundFromProfile() {
  const u = (profile.chat_bg_image_url || '').trim();
  if (u && /^https?:\/\//i.test(u)) {
    document.documentElement.style.setProperty('--chat-bg-image', `url(${JSON.stringify(u)})`);
    applyChatBackdropTintFromImageUrl(u).catch(() => {});
  } else {
    document.documentElement.style.removeProperty('--chat-bg-image');
    clearChatBackdropTint();
  }
  syncChatPhotoLayer();
}

/** 有聊天背景图时：主壳铺满壁纸，对话/朋友圈/我 共用毛玻璃与取色（不再仅限对话 Tab） */
function syncChatPhotoLayer() {
  const main = document.getElementById('main-app');
  if (!main) return;
  const u = (profile.chat_bg_image_url || '').trim();
  const hasBg = u && /^https?:\/\//i.test(u);
  main.dataset.photoChat = hasBg ? 'on' : '';
}

async function tryBootstrap() {
  const token = getToken();
  if (token) {
    try {
      profile = await api('/api/settings');
      authDisabled = false;
      showMain();
      return;
    } catch {
      setToken(null);
    }
  }
  const r = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j = await r.json().catch(() => ({}));
  if (j.authDisabled) {
    authDisabled = true;
    try {
      profile = await api('/api/settings');
    } catch (e) {
      toast(e.message || '无法加载设置，请确认已执行 supabase/schema.sql');
      profile = {};
    }
    showMain();
    return;
  }
  $('#login-screen').classList.remove('hidden');
  $('#main-app').classList.add('hidden');
}

function showMain() {
  $('#login-screen').classList.add('hidden');
  $('#main-app').classList.remove('hidden');
  applyTheme();
  profile.theme_id = THEME_FIXED;
  $('#set-user-name').value = profile.user_display_name || '';
  $('#set-user-avatar').value = profile.user_avatar_url || '';
  $('#set-ai-name').value = profile.ai_display_name || '';
  $('#set-ai-avatar').value = profile.ai_avatar_url || '';
  $('#set-ai-signature').value = profile.ai_signature || '';
  $('#set-chat-bg-url').value = profile.chat_bg_image_url || '';
  $('#set-persona').value = profile.persona_system || '';
  $('#set-memory-user-notes').value = profile.memory_user_notes || '';
  $('#set-memory-auto-digest').value = profile.memory_auto_digest || '';
  applyChatBackgroundFromProfile();
  updateHeader();
  syncMomentsAvatar();
  switchTab('chat');
  syncChatPhotoLayer();
}

function updateHeader() {
  const t = $('#app-title');
  const sig = $('#app-ai-signature');
  const newBtn = document.getElementById('header-chat-new');
  const tab = document.querySelector('.tab.active')?.dataset.tab;
  const threadPane = document.getElementById('chat-thread-pane');
  const memoPane = document.getElementById('chat-memo-pane');
  const inThread = threadPane && !threadPane.classList.contains('hidden');
  const inMemo = memoPane && !memoPane.classList.contains('hidden');
  if (newBtn) {
    newBtn.classList.toggle('hidden', tab !== 'chat' || inThread || inMemo);
  }
  if (tab === 'moments') {
    t.textContent = '朋友圈';
    sig.classList.add('hidden');
    sig.textContent = '';
  } else if (tab === 'me') {
    t.textContent = '我';
    sig.classList.add('hidden');
    sig.textContent = '';
  } else if (tab === 'chat') {
    if (inMemo) {
      t.textContent = '备忘录';
      sig.textContent = '';
      sig.classList.add('hidden');
    } else if (inThread) {
      t.textContent = conversationTitleById.get(currentConversationId) || profile.ai_display_name || 'Silas';
      const s = (profile.ai_signature || '').trim();
      if (s) {
        sig.textContent = s;
        sig.classList.remove('hidden');
      } else {
        sig.textContent = '';
        sig.classList.add('hidden');
      }
    } else {
      t.textContent = '消息';
      sig.classList.add('hidden');
      sig.textContent = '';
    }
  } else {
    t.textContent = 'Silas';
    sig.classList.add('hidden');
    sig.textContent = '';
  }
}

const SILAS_HEART_POS_KEY = 'silas_chat_back_heart_pos';

function clampChatBackHeart() {
  const pane = document.getElementById('chat-thread-pane');
  const wrap = document.getElementById('chat-back-heart-wrap');
  if (!pane || !wrap || pane.classList.contains('hidden')) return;
  const composer = document.getElementById('chat-composer');
  const pad = 4;
  const pw = pane.clientWidth;
  const ph = pane.clientHeight;
  const ww = wrap.offsetWidth;
  const wh = wrap.offsetHeight;
  const ch = composer ? composer.offsetHeight : 56;
  let left = parseFloat(wrap.style.left);
  let top = parseFloat(wrap.style.top);
  if (!Number.isFinite(left)) left = wrap.offsetLeft;
  if (!Number.isFinite(top)) top = wrap.offsetTop;
  left = Math.max(pad, Math.min(left, pw - ww - pad));
  top = Math.max(pad, Math.min(top, ph - wh - ch - pad));
  wrap.style.left = `${left}px`;
  wrap.style.top = `${top}px`;
  wrap.style.right = 'auto';
}

function restoreChatBackHeartPosition() {
  const wrap = document.getElementById('chat-back-heart-wrap');
  if (!wrap) return;
  let raw = null;
  try {
    raw = JSON.parse(sessionStorage.getItem(SILAS_HEART_POS_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (raw && typeof raw.left === 'number' && typeof raw.top === 'number') {
    wrap.style.left = `${raw.left}px`;
    wrap.style.top = `${raw.top}px`;
  } else {
    wrap.style.left = '10px';
    wrap.style.top = '10px';
  }
  requestAnimationFrame(() => clampChatBackHeart());
}

function initChatBackHeartDrag() {
  const wrap = document.getElementById('chat-back-heart-wrap');
  const pane = document.getElementById('chat-thread-pane');
  const btn = document.getElementById('chat-back-inbox');
  if (!wrap || !pane || !btn || wrap.dataset.heartDrag === '1') return;
  wrap.dataset.heartDrag = '1';

  let down = false;
  let moved = false;
  let sx = 0;
  let sy = 0;
  let sl = 0;
  let st = 0;
  let suppressNextClick = false;

  btn.addEventListener('click', (e) => {
    if (suppressNextClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick = false;
      return;
    }
    showChatInbox();
    loadConversationList().catch(() => {});
  });

  wrap.addEventListener('click', (e) => {
    if (suppressNextClick) return;
    if (e.target === wrap) {
      showChatInbox();
      loadConversationList().catch(() => {});
    }
  });

  wrap.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      down = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      const pl = parseFloat(wrap.style.left);
      const pt = parseFloat(wrap.style.top);
      sl = Number.isFinite(pl) ? pl : wrap.offsetLeft;
      st = Number.isFinite(pt) ? pt : wrap.offsetTop;
    },
    true
  );

  const onMove = (e) => {
    if (!down) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) moved = true;
    if (!moved) return;
    e.preventDefault();
    wrap.style.left = `${sl + dx}px`;
    wrap.style.top = `${st + dy}px`;
    wrap.style.right = 'auto';
    clampChatBackHeart();
  };

  const onUp = () => {
    if (!down) return;
    down = false;
    if (moved) {
      suppressNextClick = true;
      clampChatBackHeart();
      const left = parseFloat(wrap.style.left) || 0;
      const top = parseFloat(wrap.style.top) || 0;
      try {
        sessionStorage.setItem(SILAS_HEART_POS_KEY, JSON.stringify({ left, top }));
      } catch {
        /* ignore */
      }
    }
    moved = false;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', () => clampChatBackHeart());
}

function stopChatThreadPoll() {
  if (chatThreadPollTimer) {
    clearInterval(chatThreadPollTimer);
    chatThreadPollTimer = null;
  }
}

/** 打开某会话线程时调用：后台可能写入主动消息，定时拉取以刷新列表 */
function ensureChatThreadPoll() {
  if (chatThreadPollTimer) return;
  chatThreadPollTimer = setInterval(() => {
    const pane = document.getElementById('chat-thread-pane');
    if (!pane || pane.classList.contains('hidden')) return;
    if (document.hidden) return;
    loadMessages().catch(() => {});
  }, 60000);
}

function showChatInbox() {
  stopChatThreadPoll();
  document.getElementById('chat-inbox')?.classList.remove('hidden');
  document.getElementById('chat-thread-pane')?.classList.add('hidden');
  document.getElementById('chat-memo-pane')?.classList.add('hidden');
  updateHeader();
}

function showChatThread() {
  document.getElementById('chat-inbox')?.classList.add('hidden');
  document.getElementById('chat-thread-pane')?.classList.remove('hidden');
  document.getElementById('chat-memo-pane')?.classList.add('hidden');
  updateHeader();
  ensureChatThreadPoll();
  requestAnimationFrame(() => restoreChatBackHeartPosition());
}

/** 备忘录写入 Supabase（app_profile.memo_pad），与 AI 记忆无关；失败时回落到本机 key 便于稍后重试 */
async function persistMemoPadToServer(options = {}) {
  const { silent = false } = options;
  const ta = document.getElementById('chat-memo-body');
  const memoPane = document.getElementById('chat-memo-pane');
  if (!ta || memoPane?.classList.contains('hidden')) return;

  const text = ta.value.slice(0, 20000);
  try {
    const updated = await api('/api/settings', { method: 'PATCH', body: { memo_pad: text } });
    if (updated && typeof updated === 'object') Object.assign(profile, updated);
    try {
      localStorage.removeItem(LEGACY_MEMO_PAD_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } catch (e) {
    try {
      localStorage.setItem(LEGACY_MEMO_PAD_STORAGE_KEY, text);
    } catch {
      /* ignore */
    }
    if (!silent) notifyError(e, '/api/settings');
  }
}

function scheduleMemoPadSave() {
  clearTimeout(memoPadSaveTimer);
  memoPadSaveTimer = setTimeout(() => {
    persistMemoPadToServer({ silent: true }).catch(() => {});
  }, 450);
}

async function showMemoPane() {
  stopChatThreadPoll();
  document.getElementById('chat-inbox')?.classList.add('hidden');
  document.getElementById('chat-thread-pane')?.classList.add('hidden');
  document.getElementById('chat-memo-pane')?.classList.remove('hidden');
  updateHeader();

  const ta = document.getElementById('chat-memo-body');
  try {
    await refreshProfileFromServer();
    let legacy = '';
    try {
      legacy = localStorage.getItem(LEGACY_MEMO_PAD_STORAGE_KEY) || '';
    } catch {
      legacy = '';
    }
    if (legacy.trim() && !(profile.memo_pad || '').trim()) {
      const updated = await api('/api/settings', {
        method: 'PATCH',
        body: { memo_pad: legacy.slice(0, 20000) },
      });
      if (updated && typeof updated === 'object') Object.assign(profile, updated);
      try {
        localStorage.removeItem(LEGACY_MEMO_PAD_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    if (ta) ta.value = profile.memo_pad || '';
  } catch (e) {
    notifyError(e, '/api/settings');
    if (ta) {
      try {
        ta.value =
          localStorage.getItem(LEGACY_MEMO_PAD_STORAGE_KEY) ?? (profile.memo_pad || '');
      } catch {
        ta.value = profile.memo_pad || '';
      }
    }
  }
  if (ta) requestAnimationFrame(() => ta.focus());
}

function getFallbackConversationList() {
  return [{ id: DEFAULT_CONVERSATION_ID, title: '与 Silas', updated_at: null, _fallback: true }];
}

/** 会话列表 404 时打日志：地址「看起来对」但仍常是端口上不是本仓库 Node、或反代未转发 /api */
function diagnoseConversations404() {
  const pingUrl = absoluteApiUrl('/api/ping');
  const listUrl = absoluteApiUrl('/api/conversations');
  fetch(apiUrl('/api/ping'), { method: 'GET' })
    .then(async (r) => {
      const raw = await r.text();
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep string */
      }
      console.warn('[Silas 诊断] 会话列表不可用（多为 404）。请求地址对照：', { listUrl, pingUrl, pingHttpStatus: r.status, pingBody: body });
      if (r.ok) {
        console.warn(
          '[Silas] /api/ping 正常：本机有 Node，但 /api/conversations 仍失败。请在电脑的项目目录确认已保存含会话路由的代码并重启进程（npm run dev）；若用 nginx，确认把 /api 转到该 Node。'
        );
      } else {
        console.warn(
          '[Silas] /api/ping 也不可用：手机访问的「这个 IP:端口」多半不是本项目的后端（例如只部署了静态文件、或其它程序占用了端口）。请在本机浏览器打开上述 ping 地址对照排查。'
        );
      }
    })
    .catch((err) => {
      console.warn('[Silas 诊断] 无法完成 /api/ping 检测：', err?.message, { listUrl, pingUrl });
    });
}

function convRowAvatarHtml(c) {
  const aiName = profile.ai_display_name || 'Silas';
  if (c.id === DEFAULT_CONVERSATION_ID) {
    return avatarHtml(profile.ai_avatar_url, aiName);
  }
  const initial = (c.title || '对话').trim().slice(0, 1) || '?';
  return avatarHtml('', initial);
}

function renderConversationListItems(list) {
  const root = document.getElementById('chat-conversation-list');
  if (!root) return;
  root.innerHTML = '';
  for (const c of list) {
    conversationTitleById.set(c.id, c.title || '对话');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-conv-row';
    btn.dataset.id = c.id;
    const title = escapeHtml(c.title || '对话');
    const timeStr = c.updated_at ? escapeHtml(formatTime(c.updated_at)) : '';
    const av = convRowAvatarHtml(c);
    btn.innerHTML = `
      <div class="chat-conv-avatar">${av}</div>
      <div class="chat-conv-main">
        <div class="chat-conv-top">
          <span class="chat-conv-title">${title}</span>
          ${timeStr ? `<span class="chat-conv-time">${timeStr}</span>` : ''}
        </div>
      </div>`;
    btn.addEventListener('click', () => openConversation(c.id));
    root.appendChild(btn);
  }
}

async function loadConversationList() {
  const root = document.getElementById('chat-conversation-list');
  if (!root) return;
  root.innerHTML = '';
  let list;
  try {
    list = await api('/api/conversations');
  } catch (e) {
    const st = e?.status;
    const msg = String(e?.message || '');
    const is404ish = st === 404 || /not\s*found/i.test(msg);
    const softFail = is404ish || looksLikeNetworkFailure(msg) || st === 502 || st === 503;
    if (softFail) {
      if (is404ish) diagnoseConversations404();
      list = getFallbackConversationList();
    } else {
      root.innerHTML = `<div class="empty-hint chat-inbox-error" style="padding:16px">${escapeHtml(msg || '加载失败')}</div>`;
      return;
    }
  }
  if (!list?.length) {
    root.innerHTML =
      '<div class="empty-hint" style="padding:16px">暂无会话。请在 Supabase 执行 <code>supabase/migration_conversations.sql</code>（或完整 <code>schema.sql</code>）后刷新。</div>';
    return;
  }
  renderConversationListItems(list);
}

function openConversation(id) {
  currentConversationId = id;
  showChatThread();
  loadMessages().catch((e) => notifyError(e, '/api/messages'));
}

function switchTab(name) {
  const prevTab = document.querySelector('.tab.active')?.dataset.tab;
  if (prevTab === name) {
    if (name === 'chat') {
      loadConversationList().catch(() => {});
    }
    syncChatPhotoLayer();
    return;
  }
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  $('#view-chat').classList.toggle('hidden', name !== 'chat');
  $('#view-moments').classList.toggle('hidden', name !== 'moments');
  $('#view-me').classList.toggle('hidden', name !== 'me');
  updateHeader();
  syncChatPhotoLayer();
  if (name !== 'chat') {
    stopChatThreadPoll();
  }
  if (name === 'chat') {
    showChatInbox();
    loadConversationList().catch(() => {});
  }
  if (name === 'moments') {
    syncMomentsAvatar();
    loadMomentsWithRetry().catch((e) => notifyError(e, '/api/moments'));
    if (momentsRefreshTimer) clearInterval(momentsRefreshTimer);
    momentsRefreshTimer = setInterval(() => {
      if (!document.getElementById('view-moments')?.classList.contains('hidden')) {
        loadMoments().catch(() => {});
      }
    }, 45000);
  } else if (momentsRefreshTimer) {
    clearInterval(momentsRefreshTimer);
    momentsRefreshTimer = null;
  }
}

function syncMomentsAvatar() {
  const slot = document.getElementById('moments-me-avatar');
  if (!slot) return;
  const meName = profile.user_display_name || '我';
  const wrap = document.createElement('div');
  wrap.innerHTML = avatarHtml(profile.user_avatar_url, meName);
  slot.replaceChildren(wrap.firstElementChild || document.createElement('span'));
}

function buildMessageRow(isUser, content) {
  const aiName = profile.ai_display_name || 'Silas';
  const meName = profile.user_display_name || '我';
  const row = document.createElement('div');
  row.className = `msg-row ${isUser ? 'me' : ''}`;
  const avWrap = document.createElement('div');
  avWrap.innerHTML = isUser
    ? avatarHtml(profile.user_avatar_url, meName)
    : avatarHtml(profile.ai_avatar_url, aiName);
  const av = avWrap.firstElementChild;
  if (!isUser && av) {
    av.classList.add('avatar-chat-ai-tap');
    av.setAttribute('role', 'button');
    av.setAttribute('tabindex', '0');
    av.setAttribute('aria-label', `查看 ${aiName} 的资料`);
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAiProfileSheet();
    };
    av.addEventListener('click', open);
    av.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }
  const bubble = document.createElement('div');
  /** p1=我，p2=AI（样式见 app.css .bubble-p1 / .bubble-p2） */
  bubble.className = `bubble ${isUser ? 'me' : 'other'} ${isUser ? 'bubble-p1' : 'bubble-p2'}`;
  bubble.textContent = content;
  /* .msg-row.me 使用 row-reverse：DOM 顺序须为「头像 → 气泡」，视觉上才是右侧「气泡 | 头像」 */
  if (isUser) {
    row.appendChild(av);
    row.appendChild(bubble);
  } else {
    row.appendChild(av);
    row.appendChild(bubble);
  }
  return row;
}

function closeAiProfileSheet() {
  document.getElementById('ai-profile-sheet')?.classList.add('hidden');
}

function reactionDepthForMoment(reactions, rid) {
  let d = 0;
  const byId = new Map((reactions || []).map((r) => [r.id, r]));
  let cur = byId.get(rid);
  while (cur?.parent_reaction_id) {
    d += 1;
    cur = byId.get(cur.parent_reaction_id);
    if (d > 24) break;
  }
  return d;
}

async function openAiProfileSheet() {
  const sheet = document.getElementById('ai-profile-sheet');
  const body = document.getElementById('ai-profile-body');
  if (!sheet || !body) return;
  await refreshProfileFromServer().catch(() => {});
  const aiName = profile.ai_display_name || 'Silas';
  const sig = (profile.ai_signature || '').trim();
  const av = avatarHtml(profile.ai_avatar_url, aiName);
  const sigSection = sig
    ? `<div class="ai-profile-sig-block"><p class="ai-profile-sig-label">个性签名</p><div class="ai-profile-sig">${escapeHtml(sig)}</div></div>`
    : `<div class="ai-profile-sig-block"><p class="ai-profile-sig-label">个性签名</p><p class="ai-profile-sig ai-profile-sig--empty">尚未设置。打开底部「我」→「AI 个性签名」，填写后点保存。</p></div>`;
  let previews = '';
  try {
    const list = await api('/api/moments');
    const aiMoments = (Array.isArray(list) ? list : []).filter((m) => m.author === 'ai').slice(0, 3);
    if (aiMoments.length) {
      previews = `<div class="ai-profile-previews"><p class="ai-profile-previews-title">朋友圈预览</p><ul>${aiMoments
        .map((m) => {
          const t = (m.body || '').trim().slice(0, 72);
          return `<li>${escapeHtml(t || '（图片动态）')}</li>`;
        })
        .join('')}</ul></div>`;
    } else {
      previews = '<p class="ai-profile-empty">暂无 Ta 的朋友圈</p>';
    }
  } catch {
    previews = '<p class="ai-profile-empty">朋友圈预览加载失败</p>';
  }
  body.innerHTML = `
    <div class="ai-profile-head">${av}<div class="ai-profile-names"><div class="ai-profile-name">${escapeHtml(aiName)}</div></div></div>
    ${sigSection}
    ${previews}`;
  sheet.classList.remove('hidden');
}

function renderMoments(list) {
  const root = $('#moments-list');
  root.innerHTML = '';
  if (!list?.length) {
    root.innerHTML = '<div class="empty-hint">还没有动态。在上方发一条，Silas 会看到并点赞、评论。</div>';
    return;
  }
  const aiName = profile.ai_display_name || 'Silas';
  const meName = profile.user_display_name || '我';
  for (const m of list) {
    const isAi = m.author === 'ai';
    const card = document.createElement('div');
    card.className = `moment-card ${isAi ? 'moment-card--ai' : 'moment-card--user'}`;
    const name = isAi ? aiName : meName;
    const av = isAi ? profile.ai_avatar_url : profile.user_avatar_url;
    const initial = name;
    const reactions = Array.isArray(m.reactions) ? [...m.reactions] : [];
    reactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const userLiked = reactions.some((r) => r.actor === 'user' && r.kind === 'like');
    const pendingAi =
      !isAi &&
      !m.ai_reaction_done &&
      m.ai_reaction_ready_at &&
      new Date(m.ai_reaction_ready_at) > new Date();
    const waitingAi =
      !isAi &&
      !m.ai_reaction_done &&
      m.ai_reaction_ready_at &&
      new Date(m.ai_reaction_ready_at) <= new Date();
    let pendingHtml = '';
    if (pendingAi) {
      pendingHtml = `<p class="moment-pending-hint">${escapeHtml(aiName)} 大约在 <strong>${formatTime(m.ai_reaction_ready_at)}</strong> 后来点赞、评论</p>`;
    } else if (waitingAi && !reactions.some((r) => r.actor === 'ai')) {
      pendingHtml = `<p class="moment-pending-hint">${escapeHtml(aiName)} 互动即将出现…</p>`;
    }
    const bodyText = (m.body || '').trim();
    const bodyBlock = bodyText ? `<div class="moment-body">${escapeHtml(m.body)}</div>` : '';
    const imgUrl = (m.image_url || '').trim();
    const imgBlock =
      imgUrl && /^https?:\/\//i.test(imgUrl)
        ? `<div class="moment-media"><img src="${escapeAttr(imgUrl)}" alt="" loading="lazy" /></div>`
        : '';

    let actionsHtml = '';
    if (isAi && !userLiked) {
      actionsHtml = `<button type="button" class="btn moment-like" data-id="${m.id}">点赞</button>`;
    } else if (isAi && userLiked) {
      actionsHtml = '<span class="pill">已赞</span>';
    }

    card.innerHTML = `
      <div class="moment-head">
        <div class="moment-who">${avatarHtml(av, initial)}<div class="moment-who-text"><span class="moment-author">${escapeHtml(name)}</span><span class="moment-badge">${isAi ? 'AI' : '我'}</span></div></div>
        <span class="moment-time">${formatTime(m.created_at)}</span>
      </div>
      ${bodyBlock}${imgBlock}
      ${pendingHtml}
      <div class="moment-actions">${actionsHtml}</div>
      <div class="reaction-block" data-reactions></div>
      <div class="moment-comment-box" data-moment-id="${m.id}">
        <div class="moment-reply-hint hidden" data-reply-hint></div>
        <div class="moment-inline-row">
          <input type="text" class="moment-comment-input" maxlength="2000" placeholder="写评论…" aria-label="评论" />
          <button type="button" class="btn primary moment-comment-send">发送</button>
        </div>
      </div>
    `;

    const rb = card.querySelector('[data-reactions]');
    if (!reactions.length) {
      rb.innerHTML = '<div class="reaction-line reaction-line--muted">暂无互动</div>';
    } else {
      for (const r of reactions) {
        const depth = reactionDepthForMoment(reactions, r.id);
        const row = document.createElement('div');
        row.className = 'reaction-line';
        row.style.marginInlineStart = `${depth * 14}px`;
        if (r.kind === 'like') {
          if (r.actor === 'ai') {
            row.innerHTML = `<span class="reaction-like">♥ ${escapeHtml(aiName)}</span>`;
          } else {
            row.innerHTML = `<span class="reaction-like">♥ ${escapeHtml(meName)}</span>`;
          }
        } else {
          const who = r.actor === 'ai' ? aiName : meName;
          row.innerHTML = `<span class="reaction-comment"><span class="reaction-comment-who">${escapeHtml(who)}：</span>${escapeHtml(r.body || '')}</span> <button type="button" class="btn-link moment-reply-btn" data-reply-to="${r.id}">回复</button>`;
        }
        rb.appendChild(row);
      }
    }

    const box = card.querySelector('.moment-comment-box');
    const hintEl = box?.querySelector('[data-reply-hint]');
    const input = box?.querySelector('.moment-comment-input');
    const sendBtn = box?.querySelector('.moment-comment-send');

    const clearReplyTarget = () => {
      card.dataset.replyParent = '';
      if (hintEl) {
        hintEl.classList.add('hidden');
        hintEl.textContent = '';
      }
    };

    card.querySelectorAll('.moment-reply-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.getAttribute('data-reply-to');
        card.dataset.replyParent = rid || '';
        if (hintEl) {
          hintEl.textContent = '正在回复该条评论';
          hintEl.classList.remove('hidden');
        }
        input?.focus();
      });
    });

    sendBtn?.addEventListener('click', async () => {
      const text = (input?.value || '').trim();
      if (!text) return;
      const parent = (card.dataset.replyParent || '').trim() || null;
      try {
        await api(`/api/moments/${m.id}/reactions`, {
          method: 'POST',
          body: { kind: 'comment', body: text, parent_reaction_id: parent },
        });
        if (input) input.value = '';
        clearReplyTarget();
        await loadMomentsWithRetry();
      } catch (e) {
        notifyError(e, `/api/moments/${m.id}/reactions`);
      }
    });

    root.appendChild(card);
  }

  root.querySelectorAll('.moment-like').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        await api(`/api/moments/${id}/reactions`, { method: 'POST', body: { kind: 'like' } });
        await loadMomentsWithRetry();
      } catch (e) {
        notifyError(e, `/api/moments/${id}/reactions`);
      }
    });
  });
}

function removeOptimisticChatRows() {
  $('#chat-thread')
    .querySelectorAll('[data-optimistic]')
    .forEach((el) => el.remove());
}

/** 实际滚动的是 #view-chat，不是 #chat-thread（后者无 overflow，设 scrollTop 无效） */
function scrollChatToBottom() {
  const run = () => {
    const threadPane = document.getElementById('chat-thread-pane');
    const inThread = threadPane && !threadPane.classList.contains('hidden');
    const scrollEl = inThread
      ? document.getElementById('chat-thread-scroll')
      : document.getElementById('chat-inbox') || document.getElementById('view-chat');
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  };
  run();
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

/** 发送后立即显示我的气泡（不等接口返回） */
function appendOptimisticUserBubble(userText) {
  const thread = $('#chat-thread');
  const empty = $('#chat-empty');
  empty.classList.add('hidden');

  const userRow = buildMessageRow(true, userText);
  userRow.dataset.optimistic = 'user';
  thread.appendChild(userRow);

  scrollChatToBottom();
}

async function loadMessages() {
  const cid = encodeURIComponent(currentConversationId || DEFAULT_CONVERSATION_ID);
  const list = await api(`/api/messages?limit=120&conversation_id=${cid}`);
  const thread = $('#chat-thread');
  const empty = $('#chat-empty');
  thread.innerHTML = '';
  if (!list?.length) {
    empty.classList.remove('hidden');
    scrollChatToBottom();
    refreshMemoryDigestFloat().catch(() => {});
    return;
  }
  empty.classList.add('hidden');
  for (const m of list) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const isUser = m.role === 'user';
    thread.appendChild(buildMessageRow(isUser, m.content));
  }
  scrollChatToBottom();
  refreshMemoryDigestFloat().catch(() => {});
}

function hideMemoryDigestFloat() {
  document.getElementById('memory-digest-float')?.classList.add('hidden');
  setMemoryDigestPanels('normal');
  lastMemoryDigestPreview = null;
}

async function refreshMemoryDigestFloat() {
  const pane = document.getElementById('chat-thread-pane');
  const float = document.getElementById('memory-digest-float');
  if (!pane || !float || pane.classList.contains('hidden')) return;

  const skipPanel = document.getElementById('memory-digest-panel-skip');
  const showingSkipConfirm = skipPanel && !skipPanel.classList.contains('hidden');

  try {
    const p = await api('/api/memory/preview');
    if (!p?.ready) {
      lastMemoryDigestPreview = null;
      float.classList.add('hidden');
      setMemoryDigestPanels('normal');
      return;
    }

    lastMemoryDigestPreview = p;
    const rounds = p.batchRounds ?? 100;

    const body = document.getElementById('memory-digest-float-body');
    if (body) {
      body.textContent = `所有会话合计已满 ${rounds} 轮对话（一轮 = 你发一条 + Silas 的回复），准备合并约 ${p.batchCount} 条消息进入长期记忆；待处理池里大约还有 ${p.pendingRounds} 轮。点「确认生成摘要」会写入「我」里的自动摘要。不会删除聊天内容。`;
      if (p.previewSnippet) {
        body.textContent += `\n\n${p.previewSnippet}`;
      }
    }

    if (showingSkipConfirm) {
      const skipBody = document.getElementById('memory-digest-skip-body');
      if (skipBody) {
        skipBody.textContent = `请确认是否暂不合并长期记忆。若点「确认放弃」：不会删除任何聊天记录，也不会调用模型；只会跳过当前这一轮（已满 ${rounds} 轮对话）的长期记忆合并，并从其后重新累计下一轮，同一批对话不会重复计入。误触可点「返回」。`;
      }
      float.classList.remove('hidden');
      return;
    }

    setMemoryDigestPanels('normal');
    float.classList.remove('hidden');
  } catch {
    lastMemoryDigestPreview = null;
    float.classList.add('hidden');
    setMemoryDigestPanels('normal');
  }
}

/** 发消息后偶发列表请求失败时重试，避免误报（聊天已成功写入库） */
async function loadMessagesWithRetry(maxAttempts = 3, baseDelayMs = 250) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await loadMessages();
      return;
    } catch (e) {
      lastErr = e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

async function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  const btn = $('#chat-send');
  input.value = '';
  btn.disabled = true;
  appendOptimisticUserBubble(text);
  try {
    await api('/api/chat', {
      method: 'POST',
      body: { content: text, conversation_id: currentConversationId || DEFAULT_CONVERSATION_ID },
    });
  } catch (e) {
    removeOptimisticChatRows();
    await loadMessages().catch(() => {});
    notifyError(e, '/api/chat');
    input.value = text;
    btn.disabled = false;
    return;
  }
  try {
    await loadMessagesWithRetry();
  } catch (e) {
    removeOptimisticChatRows();
    const recovered = await loadMessages().then(() => true).catch(() => false);
    if (!recovered) notifyError(e, '/api/messages');
  } finally {
    btn.disabled = false;
    refreshMemoryDigestFloat().catch(() => {});
    loadConversationList().catch(() => {});
  }
}

async function loadMoments() {
  const raw = await api('/api/moments');
  const list = Array.isArray(raw) ? raw : [];
  if (raw != null && !Array.isArray(raw)) {
    console.warn('[Silas] /api/moments 期望 JSON 数组，实际为', typeof raw);
  }
  renderMoments(list);
}

async function loadMomentsWithRetry(maxAttempts = 3, baseDelayMs = 250) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await loadMoments();
      return;
    } catch (e) {
      lastErr = e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

function clearMomentImageDraft() {
  const inp = document.getElementById('moment-image-file');
  const prev = document.getElementById('moment-image-preview');
  if (inp) inp.value = '';
  if (prev) {
    prev.classList.add('hidden');
    prev.innerHTML = '';
  }
}

async function postMoment() {
  const body = $('#moment-draft').value.trim();
  const fileInp = document.getElementById('moment-image-file');
  const file = fileInp?.files?.[0];
  let imageUrl = '';
  if (file) {
    try {
      toast('正在上传配图…');
      const fd = new FormData();
      fd.append('image', file);
      const j = await api('/api/moments/upload-image', { method: 'POST', body: fd });
      imageUrl = (j?.url || '').trim();
      if (!imageUrl) throw new Error('未返回图片地址');
    } catch (e) {
      notifyError(e, '/api/moments/upload-image');
      return;
    }
  }
  if (!body && !imageUrl) return toast('写点文字或选一张图片再发布');
  try {
    $('#moment-post').disabled = true;
    await api('/api/moments', { method: 'POST', body: { body, image_url: imageUrl } });
    $('#moment-draft').value = '';
    clearMomentImageDraft();
    showMomentPostedModal();
    await loadMomentsWithRetry();
  } catch (e) {
    notifyError(e, '/api/moments');
  } finally {
    $('#moment-post').disabled = false;
  }
}

async function saveSettings() {
  try {
    profile = await api('/api/settings', {
      method: 'PATCH',
      body: {
        theme_id: THEME_FIXED,
        user_display_name: $('#set-user-name').value.trim() || '我',
        user_avatar_url: $('#set-user-avatar').value.trim(),
        ai_display_name: $('#set-ai-name').value.trim() || 'Silas',
        ai_avatar_url: $('#set-ai-avatar').value.trim(),
        ai_signature: $('#set-ai-signature').value.trim().slice(0, 80),
        persona_system: $('#set-persona').value,
        chat_bg_image_url: $('#set-chat-bg-url').value.trim(),
        memory_user_notes: $('#set-memory-user-notes').value,
        memory_auto_digest: $('#set-memory-auto-digest').value,
      },
    });
    applyTheme();
    $('#set-chat-bg-url').value = profile.chat_bg_image_url || '';
    applyChatBackgroundFromProfile();
    toast('已保存');
    updateHeader();
    syncMomentsAvatar();
    if (isChatThreadOpen()) {
      await loadMessages().catch(() => {});
    }
  } catch (e) {
    notifyError(e, '/api/settings');
  }
}

function isChatThreadOpen() {
  const p = document.getElementById('chat-thread-pane');
  return p && !p.classList.contains('hidden');
}

$('#tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

$('#login-submit').addEventListener('click', async () => {
  const pw = $('#login-password').value;
  $('#login-error').textContent = '';
  try {
    const j = await api('/api/auth/login', { method: 'POST', body: { password: pw } });
    if (j.token) setToken(j.token);
    profile = await api('/api/settings');
    showMain();
  } catch (e) {
    $('#login-error').textContent = e.message || '登录失败';
  }
});

$('#chat-send').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

initChatBackHeartDrag();

document.getElementById('memory-digest-dismiss')?.addEventListener('click', async () => {
  let p = lastMemoryDigestPreview;
  if (!p?.ready) {
    try {
      p = await api('/api/memory/preview');
    } catch {
      return;
    }
  }
  if (!p?.ready) return;
  const rounds = p.batchRounds ?? 100;
  const skipBody = document.getElementById('memory-digest-skip-body');
  if (skipBody) {
    skipBody.textContent = `请确认是否暂不合并长期记忆。若点「确认放弃」：不会删除任何聊天记录，也不会调用模型；只会跳过当前这一轮（已满 ${rounds} 轮对话）的长期记忆合并，并从其后重新累计下一轮，同一批对话不会重复计入。误触可点「返回」。`;
  }
  setMemoryDigestPanels('skip');
});

document.getElementById('memory-digest-confirm')?.addEventListener('click', async () => {
  const btn = document.getElementById('memory-digest-confirm');
  if (btn) btn.disabled = true;
  try {
    await api('/api/memory/summarize', { method: 'POST', body: { confirm: true } });
    hideMemoryDigestFloat();
    toast('摘要已写入「我」→ 长期记忆 · 自动摘要');
    await refreshProfileFromServer();
  } catch (e) {
    notifyError(e, '/api/memory/summarize');
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('memory-digest-skip-cancel')?.addEventListener('click', () => {
  setMemoryDigestPanels('normal');
});

document.getElementById('memory-digest-skip-confirm')?.addEventListener('click', async () => {
  const btn = document.getElementById('memory-digest-skip-confirm');
  if (btn) btn.disabled = true;
  try {
    await api('/api/memory/skip', { method: 'POST', body: { confirm: true } });
    hideMemoryDigestFloat();
    toast('已跳过本轮摘要合并，将从下一轮重新计数');
    await refreshProfileFromServer();
  } catch (e) {
    notifyError(e, '/api/memory/skip');
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('header-chat-new')?.addEventListener('click', async () => {
  try {
    const row = await api('/api/conversations', { method: 'POST', body: { title: '新对话' } });
    if (row?.id) {
      conversationTitleById.set(row.id, row.title || '新对话');
      openConversation(row.id);
    }
  } catch (err) {
    notifyError(err, '/api/conversations');
  }
});

document.getElementById('chat-memo-entry')?.addEventListener('click', () => {
  showMemoPane().catch((e) => notifyError(e, '/api/settings'));
});
document.getElementById('chat-memo-back')?.addEventListener('click', async () => {
  await persistMemoPadToServer({ silent: false }).catch(() => {});
  showChatInbox();
  loadConversationList().catch(() => {});
});
document.getElementById('chat-memo-body')?.addEventListener('input', scheduleMemoPadSave);
document.getElementById('chat-memo-body')?.addEventListener('blur', () => {
  persistMemoPadToServer({ silent: false }).catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isChatThreadOpen()) {
    loadMessages().catch(() => {});
  }
  if (document.visibilityState !== 'hidden') return;
  const memoPane = document.getElementById('chat-memo-pane');
  if (memoPane && !memoPane.classList.contains('hidden')) {
    persistMemoPadToServer({ silent: true }).catch(() => {});
  }
});
window.addEventListener('pagehide', () => {
  const ta = document.getElementById('chat-memo-body');
  const memoPane = document.getElementById('chat-memo-pane');
  if (!ta || memoPane?.classList.contains('hidden')) return;
  try {
    localStorage.setItem(LEGACY_MEMO_PAD_STORAGE_KEY, ta.value);
  } catch {
    /* ignore */
  }
  persistMemoPadToServer({ silent: true }).catch(() => {});
});

$('#moment-post').addEventListener('click', postMoment);
$('#moment-refresh').addEventListener('click', () =>
  loadMomentsWithRetry().catch((e) => notifyError(e, '/api/moments'))
);
document.getElementById('moment-ai-publish')?.addEventListener('click', async () => {
  const hint = window.prompt('想让 Silas 大致发什么？（可留空）', '') || '';
  try {
    toast('正在生成…');
    await api('/api/moments/ai-publish', { method: 'POST', body: { hint: hint.trim() } });
    toast('已发布');
    await loadMomentsWithRetry();
  } catch (e) {
    notifyError(e, '/api/moments/ai-publish');
  }
});
document.getElementById('ai-profile-close')?.addEventListener('click', closeAiProfileSheet);
document.getElementById('ai-profile-backdrop')?.addEventListener('click', closeAiProfileSheet);
document.getElementById('ai-profile-go-moments')?.addEventListener('click', () => {
  closeAiProfileSheet();
  switchTab('moments');
});
document.getElementById('moment-image-pick')?.addEventListener('click', () => {
  document.getElementById('moment-image-file')?.click();
});
document.getElementById('moment-image-file')?.addEventListener('change', (e) => {
  const input = e.target;
  const f = input?.files?.[0];
  const prev = document.getElementById('moment-image-preview');
  if (!prev) return;
  const old = prev.querySelector('img');
  if (old?.src?.startsWith('blob:')) URL.revokeObjectURL(old.src);
  if (!f) {
    prev.classList.add('hidden');
    prev.innerHTML = '';
    return;
  }
  prev.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`;
  prev.classList.remove('hidden');
});
$('#settings-save').addEventListener('click', saveSettings);

$('#chat-bg-pick').addEventListener('click', () => {
  $('#chat-bg-file').click();
});

$('#chat-bg-file').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    toast('正在上传背景…');
    const fd = new FormData();
    fd.append('image', file);
    profile = await api('/api/settings/chat-bg', { method: 'POST', body: fd });
    $('#set-chat-bg-url').value = profile.chat_bg_image_url || '';
    applyChatBackgroundFromProfile();
    switchTab('chat');
    toast('背景图已更新');
  } catch (err) {
    notifyError(err, '/api/settings/chat-bg');
  }
});

window.addEventListener('silas-unauthorized', () => {
  setToken(null);
  toast('登录已失效');
  if (!authDisabled) {
    $('#main-app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }
});

/** PWA：安装提示 + Service Worker */
let deferredInstallPrompt = null;
const installBtn = document.getElementById('pwa-install');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn?.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    toast('请用 Chrome 或 Edge 打开，或使用系统菜单中的「安装」');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

tryBootstrap().catch((e) => notifyError(e));
