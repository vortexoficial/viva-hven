const express = require('express');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(express.static(publicDir));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Viva Haven site rodando em http://localhost:${PORT}`);
});
