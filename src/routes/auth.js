const express = require('express');
const { signToken } = require('../lib/tokens');

const router = express.Router();

router.post('/login', (req, res) => {
  if (!process.env.APP_PASSWORD) {
    return res.json({ ok: true, authDisabled: true });
  }
  const password = req.body?.password;
  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const token = signToken({ sub: 'user', exp });
  if (!token) {
    return res.status(500).json({ error: 'Token 配置错误，请设置 JWT_SECRET 或 APP_PASSWORD' });
  }
  return res.json({ ok: true, token });
});

module.exports = router;
