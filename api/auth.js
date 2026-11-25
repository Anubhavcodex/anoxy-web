// api/auth.js - Authenticates user via Google Apps Script backend
const https = require('https');

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq43d3TxNxQ8bdG_Ih_n0K0gfhQNkW6oTQ6uSo_FxsQCkUh3_m4xHQ5Z_xZsJWAxEv/exec';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, password, device_id, scriptUrl } = req.body || {};
    const targetUrl = scriptUrl || process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;

    const payload = JSON.stringify({
      username: username || '',
      password: password || '',
      device_id: device_id || 'web-browser'
    });

    // Google Apps Script redirects on POST, need to handle 302
    const doFetch = (url, body) => new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Follow redirect as GET or POST
          https.get(response.headers.location, (redirRes) => {
            let data = '';
            redirRes.on('data', chunk => data += chunk);
            redirRes.on('end', () => resolve(data));
          }).on('error', reject);
          return;
        }
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const raw = await doFetch(targetUrl, payload);
    try {
      const parsed = JSON.parse(raw);
      res.status(200).json(parsed);
    } catch {
      res.status(200).json({ status: 'ok', message: raw });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
