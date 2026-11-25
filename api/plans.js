// api/plans.js - Manages saving and listing scheduled plans
const https = require('https');

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq43d3TxNxQ8bdG_Ih_n0K0gfhQNkW6oTQ6uSo_FxsQCkUh3_m4xHQ5Z_xZsJWAxEv/exec';

function postGoogle(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
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
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const scriptUrl = process.env.GOOGLE_SCRIPT_URL || DEFAULT_SCRIPT_URL;

  try {
    if (req.method === 'POST') {
      // Save new plan with steps
      const { plan_name, service_id, link, api_url, api_key, steps } = req.body || {};
      if (!steps || !steps.length) {
        return res.status(400).json({ error: 'No steps provided' });
      }

      const payload = {
        action: 'save_plan',
        plan: {
          id: 'plan_' + Date.now(),
          name: plan_name || `Plan ${new Date().toLocaleString()}`,
          service_id: service_id,
          link: link,
          api_url: api_url,
          api_key: api_key,
          created_at: Date.now()
        },
        steps: steps.map((s, idx) => ({
          step_no: idx + 1,
          run_at: s.run_at, // timestamp in ms
          service_id: s.service_id || service_id,
          link: s.link || link,
          quantity: s.quantity,
          status: 'pending',
          api_url: api_url,
          api_key: api_key
        }))
      };

      const out = await postGoogle(scriptUrl, payload);
      try {
        res.status(200).json(JSON.parse(out));
      } catch {
        res.status(200).json({ status: 'ok', plan_id: payload.plan.id });
      }
    } else if (req.method === 'GET') {
      // Fetch active plans and steps
      const payload = { action: 'get_plans' };
      const out = await postGoogle(scriptUrl, payload);
      try {
        res.status(200).json(JSON.parse(out));
      } catch {
        res.status(200).json({ plans: [], steps: [] });
      }
    } else if (req.method === 'DELETE') {
      const { plan_id } = req.body || req.query || {};
      const payload = { action: 'cancel_plan', plan_id: plan_id };
      const out = await postGoogle(scriptUrl, payload);
      try {
        res.status(200).json(JSON.parse(out));
      } catch {
        res.status(200).json({ status: 'ok' });
      }
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
