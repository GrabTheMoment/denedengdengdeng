const { verifyToken } = require('../lib/tokens');

function authRequired(req, res, next) {
  if (!process.env.APP_PASSWORD) {
    return next();
  }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload || payload.sub !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { authRequired };
