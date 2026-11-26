// api/panel.js - Proxies SMM Panel API to bypass browser CORS restrictions and SSL chain issues
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Follows redirects (301, 302, 303, 307, 308) up to maxRedirects
function makePanelRequest(targetUrl, postData, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects from panel URL'));
    }

    let urlObj;
    try {
      let u = (targetUrl || '').trim();
      if (!/^https?:\/\//i.test(u)) {
        u = 'https://' + u;
      }
      urlObj = new URL(u);
    } catch (e) {
      return reject(new Error('Invalid panel API URL: ' + targetUrl));
    }

    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      agent: isHttps ? new https.Agent({ rejectUnauthorized: false, keepAlive: true }) : undefined,
      timeout: 35000
    };

    const req = client.request(options, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlObj.href).toString();
        res.resume();
        return resolve(makePanelRequest(nextUrl, postData, redirectCount + 1));
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, raw });
      });
    });

    req.on('error', err => {
      reject(new Error(err.message || 'Network connection failed'));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Panel request timed out after 35s'));
    });

    req.write(postData);
    req.end();
  });
}

function extractJson(raw) {
  if (!raw) return null;
  const str = raw.trim().replace(/^\uFEFF/, ''); // strip BOM
  try {
    return JSON.parse(str);
  } catch (e1) {
    // Try finding JSON substring if panel outputted PHP notices or HTML before/after JSON
    const firstBrace = str.indexOf('{');
    const firstBracket = str.indexOf('[');
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = str.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = str.lastIndexOf(']');
    }
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(str.substring(start, end + 1));
      } catch (e2) {}
    }
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};
    const query = req.query || {};

    const apiUrl = (body.apiUrl || body.api_url || query.apiUrl || query.api_url || '').trim();
    const apiKey = (body.apiKey || body.api_key || query.apiKey || query.api_key || '').trim();
    const action = (body.action || query.action || 'services').trim();

    if (!apiUrl || !apiKey) {
      return res.status(400).json({ error: 'Missing API URL or API Key' });
    }

    const payload = new URLSearchParams();
    payload.append('key', apiKey);
    payload.append('action', action);

    // Forward any other query/body parameters (service, link, quantity, order, orders, runs, interval, etc.)
    const reserved = new Set(['key', 'apiKey', 'api_key', 'apiUrl', 'api_url', 'action']);
    const allParams = { ...query, ...body };
    for (const [k, v] of Object.entries(allParams)) {
      if (!reserved.has(k) && v !== undefined && v !== null && v !== '') {
        payload.append(k, String(v));
      }
    }

    const postData = payload.toString();
    const { statusCode, raw } = await makePanelRequest(apiUrl, postData);
    const parsed = extractJson(raw);

    if (parsed !== null) {
      return res.status(200).json(parsed);
    }

    const preview = (raw || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().substring(0, 150);
    return res.status(200).json({
      error: `Panel did not return JSON (HTTP ${statusCode})${preview ? ': ' + preview : ''}`,
      raw: (raw || '').substring(0, 500)
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to connect to panel: ' + err.message });
  }
};
