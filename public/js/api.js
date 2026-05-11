import { apiUrl } from './config.js';

const LS = 'silas_token';

export function getToken() {
  return localStorage.getItem(LS);
}

export function setToken(t) {
  if (t) localStorage.setItem(LS, t);
  else localStorage.removeItem(LS);
}

export { apiUrl };

export async function api(path, options = {}) {
  const url = apiUrl(path);
  const headers = { ...options.headers };
  if (!headers['Content-Type'] && options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const body =
    options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : options.body;

  let res;
  try {
    res = await fetch(url, { ...options, headers, body });
  } catch (e) {
    const abs =
      typeof url === 'string' && url.startsWith('http')
        ? url
        : `${typeof location !== 'undefined' ? location.origin : ''}${url}`;
    const msg = [
      '网络请求失败（浏览器未连上服务器）。请逐项检查：',
      '1）运行后端的电脑是否已执行 npm run dev 且终端没有报错；',
      '2）浏览器打开的地址是否就是后端那一台（例如本机用 http://localhost:3000，手机用 http://电脑局域网IP:3000）；',
      '3）若页面是 https 而接口是 http，浏览器会拦截，需改为同源或全程 https；',
      '4）若改过 index.html 里的 silas-api-base，确认地址正确且无多余斜杠。',
      `本次请求：${abs}`,
    ].join('');
    const err = new Error(msg);
    err.cause = e;
    throw err;
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401 && !url.includes('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent('silas-unauthorized'));
  }
  if (!res.ok) {
    let msg;
    if (typeof data === 'object' && data !== null && data.error != null) {
      msg = String(data.error);
    } else if (typeof data === 'string') {
      const stripped = data.replace(/<[^>]+>/g, '').trim().slice(0, 200);
      msg = stripped || res.statusText || '请求失败';
    } else {
      msg = res.statusText || '请求失败';
    }
    if (res.status === 404 && /^not\s*found$/i.test(String(msg).trim())) {
      msg =
        '接口不存在(404)。请用手机访问运行后端的同一地址（例 http://电脑IP:3000），并确认已部署含 /api/conversations 的最新代码。';
    }
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
