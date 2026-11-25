// api/cron.js - 24/7 Background Scheduler executed via cron-job.org or Vercel Cron
const https = require('https');
const http = require('http');

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq43d3TxNxQ8bdG_Ih_n0K0gfhQNkW6oTQ6uSo_FxsQCkUh3_m4xHQ5Z_xZsJWAxEv/exec';

function postRequest(url, data, isJson = true) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const body = isJson ? JSON.stringify(data) : data.toString();

    const headers = {
      'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'AnoxyCron/1.0'
    };

    const req = client.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: headers,
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (redir) => {
          let out = '';
          redir.on('data', d => out += d);
          redir.on('end', () => resolve(out));
        }).on('error', reject);
        return;
      }
      let out = '';
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
