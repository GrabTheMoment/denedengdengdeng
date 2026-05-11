/**
 * Node 自带 fetch 不读 HTTPS_PROXY。在 .env 设置 HTTPS_PROXY 后，用 undici 走代理。
 * SakuraCat 等若端口是「SOCKS5/HTTP」混合，可试：
 *   HTTPS_PROXY=http://127.0.0.1:7897
 *   仍 fetch failed 则试：HTTPS_PROXY=socks5://127.0.0.1:7897
 */
function maskProxyUrl(p) {
  if (!p) return '';
  try {
    const u = new URL(p);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(无效的代理地址)';
  }
}

function readProxyFromEnv() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    ''
  ).trim();
}

function createFetch() {
  const proxy = readProxyFromEnv();
  if (!proxy) {
    return global.fetch;
  }
  try {
    const { fetch: undiciFetch, ProxyAgent } = require('undici');
    const dispatcher = new ProxyAgent(proxy);
    console.log(`[openai] 使用代理访问外网: ${maskProxyUrl(proxy)}`);
    return (url, init = {}) => undiciFetch(url, { ...init, dispatcher });
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes('undici')) {
      console.warn('[openai] 未找到 undici 包，请在项目根目录执行: npm install');
    } else {
      console.warn('[openai] 无法启用 HTTPS_PROXY:', e.message);
    }
    return global.fetch;
  }
}

/** 延迟初始化：确保在 dotenv.config() 之后才第一次读取环境变量 */
let _impl;
function getFetch() {
  if (!_impl) {
    _impl = createFetch();
  }
  return _impl;
}

module.exports = { getFetch, readProxyFromEnv, maskProxyUrl };
