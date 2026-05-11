/**
 * 前端连接后端 API：
 * - 默认：与页面同源的相对路径（如本机 http://localhost:3000 即请求同机的 /api）
 * - 若静态页与 Node 不在同一域名：在 index.html 里设置
 *   <meta name="silas-api-base" content="https://你的后端域名" />
 *   不要末尾斜杠。后端需开启 CORS（本仓库已 app.use(cors())）。
 *
 * 注意：不要用 localhost 作为 API 地址却在「手机通过局域网 IP」打开的页面上使用——
 * 那样请求会发到手机自己，导致发送失败。下面会在检测到这种情况时自动忽略错误配置。
 */
function stripTrailingSlash(s) {
  return s.replace(/\/$/, '');
}

function apiHostIsLoopback(base) {
  try {
    const u = base.startsWith('http') ? new URL(base) : new URL(`http://${base}`);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getApiBase() {
  const meta = document.querySelector('meta[name="silas-api-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  let b = '';
  if (fromMeta) b = stripTrailingSlash(fromMeta);
  else if (typeof window !== 'undefined' && window.__SILAS_API_BASE__) {
    b = stripTrailingSlash(String(window.__SILAS_API_BASE__));
  }
  if (!b || typeof location === 'undefined') return b;

  const pageIsLoopback =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!pageIsLoopback && apiHostIsLoopback(b)) {
    console.warn(
      '[Silas] API 基址指向 localhost，但当前页面是从局域网/IP 打开的，已忽略该设置并改用同源（避免手机请求打到手机自己）。请把 index.html 里 silas-api-base 的 content 留空，或改成电脑的局域网地址。'
    );
    return '';
  }
  return b;
}

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const b = getApiBase();
  if (!b) return p;
  return `${b}${p}`;
}
