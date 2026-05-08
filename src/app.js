const express = require('express');
const cors = require('cors');
require('dotenv').config();

const contactsRouter = require('./routes/contacts');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Silas backend is running' });
});

app.use('/contacts', contactsRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});