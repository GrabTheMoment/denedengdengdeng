const { getFetch } = require('./fetchWithProxy');

/** GPT-4o mini；可用环境变量 OPENAI_MODEL 覆盖（须为 API 支持的 model id） */
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getOpenAiModel() {
  const m = (process.env.OPENAI_MODEL || '').trim();
  return m || DEFAULT_OPENAI_MODEL;
}

function openaiChatCompletionsUrl() {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return `${base}/chat/completions`;
}

async function chatCompletion({ system, user, messages }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error('OPENAI_API_KEY is not set');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }
  const model = getOpenAiModel();
  const bodyMessages = [];
  if (system) bodyMessages.push({ role: 'system', content: system });
  if (Array.isArray(messages)) {
    for (const m of messages) {
      bodyMessages.push({ role: m.role, content: m.content });
    }
  }
  if (user !== undefined && user !== null) bodyMessages.push({ role: 'user', content: user });

  const timeoutMs = Math.min(Math.max(Number(process.env.OPENAI_TIMEOUT_MS) || 55000, 5000), 120000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const OPENAI_URL = openaiChatCompletionsUrl();

  let res;
  try {
    res = await getFetch()(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: Number(process.env.OPENAI_TEMPERATURE) || 0.7,
        messages: bodyMessages,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`OpenAI 请求超过 ${timeoutMs / 1000}s 未返回（网络或墙导致）。可在 .env 设置 OPENAI_TIMEOUT_MS。`);
      err.code = 'OPENAI_TIMEOUT';
      throw err;
    }
    console.error('[openai] 连不上 API（本机到 OpenAI 的网络）:', e.message);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || res.statusText || 'OpenAI request failed';
    console.error('[openai] HTTP', res.status, msg, json.error?.type ? `type=${json.error.type}` : '');
    const err = new Error(msg);
    err.code = 'OPENAI_HTTP';
    err.status = res.status;
    throw err;
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error('Empty model response');
    err.code = 'OPENAI_EMPTY';
    throw err;
  }
  return text.trim();
}

function tryParseJsonObject(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = { chatCompletion, tryParseJsonObject, getOpenAiModel, DEFAULT_OPENAI_MODEL };
