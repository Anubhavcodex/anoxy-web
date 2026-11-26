// api/plans.js - Manages saving, listing, and updating scheduled plans
const { postRequest, placePanelOrder, extractJson } = require('./cron');

const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyq43d3TxNxQ8bdG_Ih_n0K0gfhQNkW6oTQ6uSo_FxsQCkUh3_m4xHQ5Z_xZsJWAxEv/exec';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const scriptUrl = (req.body && (req.body.script_url || req.body.scriptUrl)) ||
                    (req.query && (req.query.script_url || req.query.scriptUrl)) ||
                    process.env.GOOGLE_SCRIPT_URL ||
                    DEFAULT_SCRIPT_URL;

  try {
    if (req.method === 'POST') {
      // Check if POST is for add_step vs save_plan
      if (req.body && req.body.action === 'add_step') {
        const out = await postRequest(scriptUrl, req.body, true);
        return res.status(200).json(extractJson(out) || { status: 'ok' });
      }

      // Save new plan with steps & immediately dispatch any due-now steps
      const { plan_name, service_id, link, api_url, api_key, steps } = req.body || {};
      if (!steps || !steps.length) {
        return res.status(400).json({ error: 'No steps provided' });
      }

      const planId = 'plan_' + Date.now();
      const now = Date.now();
      const planObj = {
        id: planId,
        name: plan_name || `Plan ${new Date().toLocaleString()}`,
        service_id: service_id,
        link: link,
        api_url: api_url,
        api_key: api_key,
        created_at: now
      };

      const preparedSteps = steps.map((s, idx) => ({
        id: `${planId}_step_${s.step_no || (idx + 1)}`,
        plan_id: planId,
        step_no: s.step_no || (idx + 1),
        run_at: Number(s.run_at),
        service_id: s.service_id || service_id,
        link: s.link || link,
        quantity: s.quantity,
        status: 'pending',
        order_id: '',
        provider_status: '',
        error: '',
        api_url: api_url,
        api_key: api_key
      }));

      // Dispatch steps already due right now (run_at <= now + 5s) IMMEDIATELY before saving
      const immediateSteps = [];
      for (const st of preparedSteps) {
        if (st.run_at <= Date.now() + 5000 && api_url && api_key) {
          try {
            const outcome = await placePanelOrder({
              api_url,
              api_key,
              service_id: st.service_id,
              link: st.link,
              quantity: st.quantity
            });
            st.status = outcome.status;
            st.order_id = outcome.orderId || '';
            st.provider_status = outcome.providerStatus || '';
            st.error = outcome.errorMsg || '';
            if (outcome.nextRunAt) st.run_at = outcome.nextRunAt;
            immediateSteps.push(st);
          } catch (dispErr) {
            const isTimeout = dispErr.message && dispErr.message.toLowerCase().includes('timeout');
            st.status = isTimeout ? 'unknown' : 'failed';
            st.error = dispErr.message;
            immediateSteps.push(st);
          }
        }
      }

      const payload = {
        action: 'save_plan',
        plan: planObj,
        steps: preparedSteps
      };

      const out = await postRequest(scriptUrl, payload, true);
      const savedJson = extractJson(out);

      if (savedJson && savedJson.status === 'error') {
        return res.status(200).json(savedJson);
      }

      // Backward compatibility: if an older Apps Script ignored status/order_id during save_plan,
      // push explicit update_step calls for steps that were just dispatched immediately
      if (immediateSteps.length && (!savedJson || !savedJson.supports_status)) {
        await Promise.all(immediateSteps.map(st =>
          postRequest(scriptUrl, {
            action: 'update_step',
            step_id: st.id,
            status: st.status,
            order_id: st.order_id || '',
            provider_status: st.provider_status || '',
            error: st.error || '',
            run_at: st.run_at
          }, true).catch(() => {})
        ));
      }

      res.status(200).json({
        status: 'ok',
        plan_id: planId,
        plan: { id: planId, name: planObj.name, service_id, link, created_at: now },
        steps: preparedSteps.map(({ api_url: _u, api_key: _k, ...rest }) => rest)
      });
    } else if (req.method === 'GET') {
      // Fetch active plans and steps
      const payload = { action: 'get_plans' };
      const out = await postRequest(scriptUrl, payload, true);
      res.status(200).json(extractJson(out) || { plans: [], steps: [] });
    } else if (req.method === 'PUT') {
      // Update individual step or batch provider statuses
      const actionName = (req.body && req.body.action) || 'update_step';
      const payload = { action: actionName, ...(req.body || {}) };
      const out = await postRequest(scriptUrl, payload, true);
      res.status(200).json(extractJson(out) || { status: 'ok' });
    } else if (req.method === 'DELETE') {
      const { plan_id, action } = req.body || req.query || {};
      const payload = { action: action === 'remove_plan' ? 'remove_plan' : 'cancel_plan', plan_id: plan_id };
      const out = await postRequest(scriptUrl, payload, true);
      res.status(200).json(extractJson(out) || { status: 'ok' });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
