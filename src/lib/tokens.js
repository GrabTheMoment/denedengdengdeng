const crypto = require('crypto');

function secret() {
  return process.env.JWT_SECRET || process.env.APP_PASSWORD || '';
}

function signToken(payload) {
  const s = secret();
  if (!s) return null;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', s).update(`${header}.${payloadStr}`).digest('base64url');
  return `${header}.${payloadStr}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const s2 = secret();
  if (!s2) return null;
  const sig = crypto.createHmac('sha256', s2).update(`${h}.${p}`).digest('base64url');
  if (sig !== s) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, secret };
