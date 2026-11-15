const express = require('express');
const cors = require('cors');
const path = require('path');
const verify = require('./verify');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 1. Serve the frontend (index.html and assets/ only, so server code is never downloadable)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 1b. Account ownership verification (see verify.js)
app.set('trust proxy', 1);
const wrap = fn => async (req, res) => {
  try {
    const r = await fn(req.body || {}, req.ip);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Verification failed. Try again.' });
  }
};
app.post('/api/verify/start', wrap(verify.start));
app.post('/api/verify/check', wrap(verify.check));
app.post('/api/session', wrap(verify.session));

// 2. Proxy route (replaces Cloudflare proxy/worker.js)
// Usage from frontend: fetch('/proxy?url=' + encodeURIComponent(targetUrl))
app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing ?url= query parameter' });
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': req.headers['accept'] || '*/*'
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
      fetchOptions.headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.status(response.status).send(buffer);
  } catch (err) {
    res.status(502).json({ error: 'Proxy request failed', details: err.message });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
