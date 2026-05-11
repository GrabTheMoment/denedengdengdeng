const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { readProxyFromEnv, maskProxyUrl } = require('./lib/fetchWithProxy');
const _px = readProxyFromEnv();
if (_px) {
  console.log(`[silas] 已从 .env 读取代理: ${maskProxyUrl(_px)}`);
  console.log('[silas] 若发消息仍失败，可把 .env 里改成 socks5://127.0.0.1:同端口 再试（与 SakuraCat 端口一致）');
} else {
  console.log('[silas] 未读取到 HTTPS_PROXY / HTTP_PROXY，OpenAI 将直连；国内环境常会 [openai] fetch failed');
}

const { authRequired } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const contactsRouter = require('./routes/contacts');
const messagesRouter = require('./routes/messages');
const chatRouter = require('./routes/chat');
const momentsRouter = require('./routes/moments');
const settingsRouter = require('./routes/settings');
const memoryRouter = require('./routes/memory');
const conversationsRouter = require('./routes/conversations');
const { listConversations, createConversation } = require('./routes/conversations');

const momentPollMs = Math.min(Math.max(Number(process.env.MOMENT_AI_POLL_INTERVAL_MS) || 60000, 15000), 600000);
const { startRandomAiSelfProfileTimers } = require('./lib/aiSelfProfile');
const { startSilasProactiveTimers } = require('./lib/silasProactive');
const { getOpenAiModel } = require('./lib/openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '512kb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms) ip=${req.ip || req.socket.remoteAddress}`);
  });
  next();
});

/** 不鉴权：用于手机排查「能不能连上这台电脑」（浏览器直接打开或 POST 均可） */
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, pong: true, method: 'GET', time: new Date().toISOString() });
});
app.post('/api/ping', (req, res) => {
  res.json({ ok: true, pong: true, method: 'POST', time: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Silas backend is running' });
});

app.use('/api/auth', authRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/messages', messagesRouter);
/** 顶层注册，避免部分环境下子 router 对「无尾斜杠」的 GET /api/conversations 匹配不到而出现 Cannot GET */
app.get('/api/conversations', authRequired, listConversations);
app.post('/api/conversations', authRequired, createConversation);
app.use('/api/conversations', conversationsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/moments', momentsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/memory', memoryRouter);

const publicDir = path.join(__dirname, '../public');
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(publicDir, 'manifest.webmanifest'));
});

app.use(express.static(publicDir));

function listLanIpv4() {
  const rows = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!addrs) continue;
    for (const a of addrs) {
      const fam = a.family === 'IPv4' || a.family === 4;
      if (fam && !a.internal) {
        rows.push({ name, address: a.address });
      }
    }
  }
  const low = (s) => s.toLowerCase();
  const deprior = (name) =>
    /vmware|virtualbox|vbox|hyper-v|docker|vethernet|tap-windows|zerotier|wg|tun/i.test(name);
  rows.sort((a, b) => {
    const da = deprior(a.name) ? 1 : 0;
    const db = deprior(b.name) ? 1 : 0;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`\n✅ Silas 后端已启动`);
  console.log(`   [openai] 当前模型: ${getOpenAiModel()}（GPT-4o mini 对应 id 为 gpt-4o-mini；可在 .env 设置 OPENAI_MODEL）`);
  console.log(`   [silas] 若手机打开 /api/ping 显示 Cannot GET，说明跑的不是本仓库最新代码：请确认在本项目目录运行 npm run dev，并已保存含 GET /api/ping 的 src/app.js`);
  console.log(`   [silas] 诊断: GET/POST http://localhost:${port}/api/ping  （手机把 localhost 换成电脑局域网 IP）`);
  console.log(`   本机浏览器: http://localhost:${port}`);
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY && !process.env.OPENAI_BASE_URL) {
    console.log(
      `   [silas] 若终端出现 [openai] 连不上 API / fetch failed：多为本机访问不了 api.openai.com。可在 .env 设置 HTTPS_PROXY=http://127.0.0.1:7890（Clash 等 HTTP 代理端口），或设 OPENAI_BASE_URL 为可用的兼容 API 地址。`
    );
  }
  const lan = listLanIpv4();
  if (lan.length) {
    console.log(`\n📱 手机请与电脑连同一 WiFi，然后在手机浏览器中打开下面任一地址（优先试列表最上面）：`);
    for (const { name, address } of lan) {
      console.log(`   http://${address}:${port}    (${name})`);
    }
  } else {
    console.log(`\n📱 未检测到可用的局域网 IPv4（请确认已连接 WiFi 或网线）`);
  }
  const delayMin =
    process.env.MOMENT_AI_DELAY_MINUTES !== undefined && String(process.env.MOMENT_AI_DELAY_MINUTES) !== ''
      ? Number(process.env.MOMENT_AI_DELAY_MINUTES)
      : 10;
  console.log(
    `   [moments] 朋友圈 AI 互动约在发布后 ${Number.isFinite(delayMin) ? delayMin : 10} 分钟触发，轮询每 ${momentPollMs / 1000}s（进程需保持运行）`
  );
  if (process.env.AI_SELF_UPDATE_ENABLED !== '0') {
    console.log(
      '   [ai-self] 个性签名/头像约每月最多更新一次（可配 AI_SELF_UPDATE_MIN_GAP_MS）；随机定时约一月；事件触发亦受间隔限制（需 OPENAI_API_KEY）'
    );
  }
  setInterval(() => {
    momentsRouter.processDueMomentAiReactions?.().catch((e) => console.error('[moments] poll', e.message));
  }, momentPollMs);
  setTimeout(() => {
    momentsRouter.processDueMomentAiReactions?.().catch(() => {});
  }, 5000);
  startRandomAiSelfProfileTimers();
  startSilasProactiveTimers();
  console.log('');
});
