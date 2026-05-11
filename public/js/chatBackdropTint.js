/**
 * 从聊天背景图采样主色，驱动顶栏/底栏/输入栏/气泡的毛玻璃与文字对比度。
 * 同域图可直接读像素；跨域需图站带 CORS，否则回退为纸本默认色。
 */

const CHROME_KEYS = [
  '--chat-bg-overlay',
  '--chat-bg-solid',
  '--chat-chrome-fill',
  '--chat-chrome-border',
  '--chat-chrome-shadow',
  '--chat-chrome-text',
  '--chat-chrome-text-muted',
  '--chat-chrome-accent',
  '--chat-bubble-me-bg',
  '--chat-bubble-me-border',
  '--chat-bubble-other-bg',
  '--chat-bubble-other-border',
  '--chat-composer-fill',
  '--chat-composer-input-bg',
  '--chat-send-bg',
];

let lastTintedImageUrl = '';

export function clearChatBackdropTint() {
  lastTintedImageUrl = '';
  const root = document.documentElement;
  for (const k of CHROME_KEYS) {
    root.style.removeProperty(k);
  }
}

function resolveAbsoluteUrl(u) {
  if (!u || typeof u !== 'string') return '';
  const t = u.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (typeof location !== 'undefined' && t.startsWith('/')) return `${location.origin}${t}`;
  return t;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function applyDarkChrome(r, g, b) {
  const root = document.documentElement;
  const t = 0.35;
  const br = Math.round(r * t + 18 * (1 - t));
  const bg = Math.round(g * t + 20 * (1 - t));
  const bb = Math.round(b * t + 28 * (1 - t));

  root.style.setProperty('--chat-bg-solid', `rgb(${br},${bg},${bb})`);
  root.style.setProperty(
    '--chat-bg-overlay',
    `linear-gradient(180deg, rgba(${clamp(r + 20, 0, 255)},${clamp(g + 15, 0, 255)},${clamp(b + 25, 0, 255)},0.42) 0%, rgba(12,14,22,0.72) 55%, rgba(6,8,14,0.88) 100%)`
  );
  root.style.setProperty('--chat-chrome-fill', `rgba(18,20,28,0.52)`);
  root.style.setProperty('--chat-chrome-border', `rgba(255,255,255,0.14)`);
  root.style.setProperty('--chat-chrome-shadow', `0 8px 32px rgba(0,0,0,0.35)`);
  root.style.setProperty('--chat-chrome-text', `rgba(252,250,248,0.95)`);
  root.style.setProperty('--chat-chrome-text-muted', `rgba(255,255,255,0.55)`);
  root.style.setProperty(
    '--chat-chrome-accent',
    `rgb(${clamp(Math.round(r * 0.55 + 140), 120, 255)},${clamp(Math.round(g * 0.55 + 180), 160, 255)},${clamp(Math.round(b * 0.55 + 220), 200, 255)})`
  );
  root.style.setProperty(
    '--chat-bubble-me-bg',
    `rgba(${clamp(r + 40, 0, 255)},${clamp(g + 30, 0, 255)},${clamp(b + 45, 0, 255)},0.38)`
  );
  root.style.setProperty('--chat-bubble-me-border', `rgba(255,255,255,0.22)`);
  root.style.setProperty('--chat-bubble-other-bg', `rgba(255,255,255,0.16)`);
  root.style.setProperty('--chat-bubble-other-border', `rgba(255,255,255,0.2)`);
  root.style.setProperty('--chat-composer-fill', `rgba(12,14,22,0.48)`);
  root.style.setProperty('--chat-composer-input-bg', `rgba(255,255,255,0.08)`);
  root.style.setProperty(
    '--chat-send-bg',
    `linear-gradient(135deg, rgba(${clamp(r + 80, 0, 255)},${clamp(g + 100, 0, 255)},${clamp(b + 140, 0, 255)},0.95) 0%, rgba(170,130,220,0.88) 100%)`
  );
}

function applyLightChrome(r, g, b) {
  const root = document.documentElement;
  root.style.setProperty('--chat-bg-solid', `rgb(${Math.round(r * 0.25 + 190)},${Math.round(g * 0.25 + 182)},${Math.round(b * 0.25 + 168)})`);
  root.style.setProperty(
    '--chat-bg-overlay',
    `linear-gradient(180deg, rgba(255,252,248,0.55) 0%, rgba(${clamp(r + 230, 0, 255)},${clamp(g + 220, 0, 255)},${clamp(b + 200, 0, 255)},0.42) 45%, rgba(200,188,170,0.55) 100%)`
  );
  root.style.setProperty('--chat-chrome-fill', `rgba(255,252,246,0.58)`);
  root.style.setProperty('--chat-chrome-border', `rgba(60,40,25,0.14)`);
  root.style.setProperty('--chat-chrome-shadow', `0 10px 36px rgba(40,30,20,0.14)`);
  root.style.setProperty('--chat-chrome-text', `rgba(43,34,24,0.94)`);
  root.style.setProperty('--chat-chrome-text-muted', `rgba(43,34,24,0.55)`);
  root.style.setProperty(
    '--chat-chrome-accent',
    `rgb(${clamp(Math.round(r * 0.4 + 90), 60, 160)},${clamp(Math.round(g * 0.35 + 55), 40, 120)},${clamp(Math.round(b * 0.3 + 40), 30, 100)})`
  );
  root.style.setProperty(
    '--chat-bubble-me-bg',
    `rgba(${clamp(Math.round(r * 0.35 + 210), 180, 248)},${clamp(Math.round(g * 0.3 + 200), 170, 240)},${clamp(Math.round(b * 0.28 + 210), 175, 245)},0.52)`
  );
  root.style.setProperty('--chat-bubble-me-border', `rgba(120,70,90,0.28)`);
  root.style.setProperty(
    '--chat-bubble-other-bg',
    `rgba(${clamp(Math.round(r * 0.2 + 200), 170, 235)},${clamp(Math.round(g * 0.25 + 210), 175, 238)},${clamp(Math.round(b * 0.35 + 225), 190, 248)},0.52)`
  );
  root.style.setProperty('--chat-bubble-other-border', `rgba(80,110,140,0.32)`);
  root.style.setProperty('--chat-composer-fill', `rgba(255,250,242,0.72)`);
  root.style.setProperty('--chat-composer-input-bg', `rgba(255,253,248,0.88)`);
  root.style.setProperty(
    '--chat-send-bg',
    `linear-gradient(135deg, rgb(${clamp(Math.round(r * 0.25 + 110), 80, 150)},${clamp(Math.round(g * 0.2 + 70), 50, 110)},${clamp(Math.round(b * 0.15 + 50), 35, 90)}) 0%, rgb(92,64,48) 100%)`
  );
}

/**
 * @param {string} imageUrl
 */
export async function applyChatBackdropTintFromImageUrl(imageUrl) {
  const abs = resolveAbsoluteUrl(imageUrl);
  if (!abs) {
    clearChatBackdropTint();
    return;
  }
  /** 避免切 Tab 时重复采样导致整页色系闪一下 */
  if (abs === lastTintedImageUrl) return;

  return new Promise((resolve) => {
    const img = new Image();
    try {
      const u = new URL(abs, typeof location !== 'undefined' ? location.href : undefined);
      if (typeof location !== 'undefined' && u.origin !== location.origin) {
        img.crossOrigin = 'anonymous';
      }
    } catch {
      /* ignore */
    }

    const done = () => resolve();

    img.onload = () => {
      try {
        const w = 48;
        const h = 48;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) {
          done();
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 12) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
        if (!n) {
          done();
          return;
        }
        r = r / n;
        g = g / n;
        b = b / n;
        const L = luminance(r, g, b);
        if (L < 118) applyDarkChrome(r, g, b);
        else applyLightChrome(r, g, b);
        lastTintedImageUrl = abs;
      } catch {
        /* tainted canvas 等 */
      }
      done();
    };

    img.onerror = () => done();
    img.src = abs;
  });
}
