// api/cron.js - 24/7 Background Scheduler executed via cron-job.org or Vercel Cron
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq43d3TxNxQ8bdG_Ih_n0K0gfhQNkW6oTQ6uSo_FxsQCkUh3_m4xHQ5Z_xZsJWAxEv/exec';

function postRequest(url, data, isJson = true, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    let u;
    try {
      let target = (url || '').trim();
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
      u = new URL(target);
    } catch (e) {
      return reject(new Error('Invalid URL: ' + url));
    }

    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = isJson ? JSON.stringify(data) : data.toString();

    const headers = {
      'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    const req = client.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: headers,
      agent: isHttps ? new https.Agent({ rejectUnauthorized: false, keepAlive: true }) : undefined,
      timeout: 25000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, u.href).toString();
        res.resume();
        // If Google Apps Script redirects with 302, it redirects to a GET endpoint
        if (isJson && (res.statusCode === 301 || res.statusCode === 302)) {
          https.get(nextUrl, (redir) => {
            let out = '';
            redir.on('data', d => out += d);
            redir.on('end', () => resolve(out));
          }).on('error', reject);
          return;
        }
        return resolve(postRequest(nextUrl, data, isJson, redirectCount + 1));
      }

      let out = '';
      res.setEncoding('utf8');
      res.on('data', d => out += d);
      res.on('end', () => resolve(out));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const now = Date.now();
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;

  try {
    // 1. Ask Google Apps Script for due steps (status == 'pending' AND run_at <= now)
    const rawDue = await postRequest(scriptUrl, { action: 'get_due_steps', now: now }, true);
    let dueSteps = [];
    try {
      const parsed = JSON.parse(rawDue);
      dueSteps = parsed.steps || [];
    } catch {
      dueSteps = [];
    }

    if (!dueSteps.length) {
      return res.status(200).json({ status: 'ok', dispatched: 0, message: 'No steps due' });
    }

    const results = [];

    // 2. Dispatch each due step to SMM panel
    for (const step of dueSteps) {
      const { step_id, api_url, api_key, service_id, link, quantity } = step;

      try {
        const payload = new URLSearchParams();
        payload.append('key', api_key);
        payload.append('action', 'add');
        payload.append('service', service_id);
        payload.append('link', link);
        payload.append('quantity', quantity);

        const panelResp = await postRequest(api_url, payload, false);
        let orderId = null;
        let isSuccess = false;
        let errorMsg = '';

        try {
          const pData = JSON.parse(panelResp);
          if (pData.order) {
            orderId = pData.order;
            isSuccess = true;
          } else if (pData.error) {
            errorMsg = pData.error;
          }
        } catch {
          errorMsg = panelResp.substring(0, 100);
        }

        // 3. Report result back to Google Sheet
        await postRequest(scriptUrl, {
          action: 'update_step',
          step_id: step_id,
          status: isSuccess ? 'sent' : 'failed',
          order_id: orderId || '',
          error: errorMsg || ''
        }, true);

        results.push({ step_id, success: isSuccess, order: orderId, error: errorMsg });
      } catch (stepErr) {
        await postRequest(scriptUrl, {
          action: 'update_step',
          step_id: step_id,
          status: 'failed',
          error: stepErr.message
        }, true);
        results.push({ step_id, success: false, error: stepErr.message });
      }
    }

    res.status(200).json({
      status: 'ok',
      dispatched: results.length,
      timestamp: new Date().toISOString(),
      results: results
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
