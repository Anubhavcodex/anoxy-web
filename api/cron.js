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

function extractJson(raw) {
  if (!raw) return null;
  const str = String(raw).trim().replace(/^\uFEFF/, '');
  try {
    return JSON.parse(str);
  } catch {
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
      } catch {}
    }
    return null;
  }
}

async function pollPanelOrderStatus({ api_url, api_key, order_id }) {
  if (!api_url || !api_key || !order_id) return '';
  try {
    const payload = new URLSearchParams();
    payload.append('key', api_key);
    payload.append('action', 'status');
    payload.append('order', String(order_id));
    const resp = await postRequest(api_url, payload, false);
    const parsed = extractJson(resp);
    if (parsed && parsed.status) {
      return String(parsed.status);
    }
  } catch {}
  return '';
}

async function placePanelOrder({ api_url, api_key, service_id, link, quantity, comments }) {
  const payload = new URLSearchParams();
  payload.append('key', api_key);
  payload.append('action', 'add');
  payload.append('service', service_id);
  payload.append('link', link);
  if (comments && String(comments).trim()) {
    payload.append('comments', String(comments).trim());
  } else {
    payload.append('quantity', quantity);
  }

  const panelResp = await postRequest(api_url, payload, false);
  let orderId = null;
  let isSuccess = false;
  let errorMsg = '';

  const pData = extractJson(panelResp);
  if (pData && pData.order) {
    orderId = pData.order;
    isSuccess = true;
  } else {
    errorMsg = (pData && pData.error) ? String(pData.error) : String(panelResp || '').substring(0, 140);
    const dupMatch = errorMsg.match(/order\s*#?(\d+)/i);
    if (dupMatch) {
      orderId = dupMatch[1];
      isSuccess = true;
      errorMsg = '';
    }
  }

  let newStatus = isSuccess ? 'sent' : 'failed';
  let nextRunAt = null;
  let providerStatus = '';

  if (isSuccess && orderId) {
    providerStatus = await pollPanelOrderStatus({ api_url, api_key, order_id: orderId });
  } else if (errorMsg) {
    const low = errorMsg.toLowerCase();
    if (low.includes('wait') || low.includes('in progress') || low.includes('duplicate')) {
      newStatus = 'pending';
      nextRunAt = Date.now() + 120000;
      errorMsg = 'Retrying in 2m: ' + errorMsg;
    }
  }

  return { isSuccess, status: newStatus, orderId, providerStatus, errorMsg, nextRunAt };
}

async function dispatchDueSteps(targetScriptUrl) {
  const now = Date.now();
  const scriptUrl = targetScriptUrl || process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;

  // 1. Ask Google Apps Script for due steps (atomically claimed inside ScriptLock when updated script is deployed)
  const rawDue = await postRequest(scriptUrl, { action: 'get_due_steps', now: now }, true);
  let dueSteps = [];
  const parsed = extractJson(rawDue);
  if (parsed && Array.isArray(parsed.steps)) {
    dueSteps = parsed.steps;
  }

  if (!dueSteps.length) {
    return { status: 'ok', dispatched: 0, message: 'No steps due', results: [] };
  }

  const results = [];

  // 2. Dispatch each due step to SMM panel
  for (const step of dueSteps) {
    const { step_id, api_url, api_key, service_id, link, quantity, comments } = step;

    try {
      const outcome = await placePanelOrder({ api_url, api_key, service_id, link, quantity, comments });

      // 3. Report result back to Google Sheet
      await postRequest(scriptUrl, {
        action: 'update_step',
        step_id: step_id,
        status: outcome.status,
        order_id: outcome.orderId || '',
        provider_status: outcome.providerStatus || '',
        error: outcome.errorMsg || '',
        ...(outcome.nextRunAt ? { run_at: outcome.nextRunAt } : {})
      }, true);

      results.push({
        step_id,
        status: outcome.status,
        success: outcome.isSuccess,
        order: outcome.orderId,
        provider_status: outcome.providerStatus,
        run_at: outcome.nextRunAt,
        error: outcome.errorMsg
      });
    } catch (stepErr) {
      const isTimeout = stepErr.message && stepErr.message.toLowerCase().includes('timeout');
      const errStatus = isTimeout ? 'unknown' : 'failed';
      const errText = isTimeout ? 'No clear reply from panel. Check panel orders.' : stepErr.message;
      await postRequest(scriptUrl, {
        action: 'update_step',
        step_id: step_id,
        status: errStatus,
        error: errText
      }, true);
      results.push({ step_id, status: errStatus, success: false, error: errText });
    }
  }

  return {
    status: 'ok',
    dispatched: results.length,
    timestamp: new Date().toISOString(),
    results: results
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const scriptUrl = (req.query && (req.query.script_url || req.query.scriptUrl)) ||
                    (req.body && (req.body.script_url || req.body.scriptUrl)) ||
                    process.env.GOOGLE_SCRIPT_URL ||
                    DEFAULT_SCRIPT_URL;

  try {
    const out = await dispatchDueSteps(scriptUrl);
    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

module.exports.dispatchDueSteps = dispatchDueSteps;
module.exports.placePanelOrder = placePanelOrder;
module.exports.pollPanelOrderStatus = pollPanelOrderStatus;
module.exports.postRequest = postRequest;
module.exports.extractJson = extractJson;
