// api/panel.js - Proxies SMM Panel API to bypass browser CORS restrictions
const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  // Enable CORS for frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { apiUrl, apiKey, action, service, link, quantity } = body || {};

    if (!apiUrl || !apiKey) {
      return res.status(400).json({ error: 'Missing apiUrl or apiKey' });
    }

    const payload = new URLSearchParams();
    payload.append('key', apiKey);
    payload.append('action', action || 'services');
    if (service) payload.append('service', service);
    if (link) payload.append('link', link);
    if (quantity) payload.append('quantity', quantity);

    const client = apiUrl.startsWith('https') ? https : http;
    const postData = payload.toString();

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'AnoxyCloud/1.0'
      },
      timeout: 15000
    };

    const proxyReq = client.request(apiUrl, options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk) => { data += chunk; });
      proxyRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.status(proxyRes.statusCode || 200).json(parsed);
        } catch (e) {
          res.status(200).json({ raw: data });
        }
      });
    });

    proxyReq.on('error', (err) => {
      res.status(502).json({ error: 'Failed to connect to panel', details: err.message });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Panel API request timed out' });
    });

    proxyReq.write(postData);
    proxyReq.end();
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
