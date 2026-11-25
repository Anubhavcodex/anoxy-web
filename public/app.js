// Anoxy Schedular — Complete Web Engine (Exact match to Desktop App)
(function () {
  'use strict';

  // --- APPLICATION STATE ---
  const state = {
    user: null,
    services: {},
    balance: null,
    currency: '',
    connected: false,
    activeTab: 'auto',
    activePreset: '10k',
    scheduleRuns: [],     // Array of [delayMinutes, viewsQty]
    companionLikes: {},   // Map of { runIndex: likesQty }
    plans: [],
    steps: [],
    selectedPlanId: null
  };

  const PRESETS = {
    '1k':     { views: 1000,  duration: '3h',  runs: 8,   variance: 15, label: '1,000 views · 3h · 8 runs (~125 views per drop, every ~22m)' },
    '5k':     { views: 5000,  duration: '12h', runs: 32,  variance: 15, label: '5,000 views · 12h · 32 runs (~156 views per drop, every ~22m)' },
    '10k':    { views: 10000, duration: '24h', runs: 65,  variance: 15, label: '10,000 views · 24h · 65 runs (~154 views per drop, every ~22m)' },
    '20k':    { views: 20000, duration: '48h', runs: 130, variance: 15, label: '20,000 views · 48h · 130 runs (~154 views per drop, every ~22m)' },
    '50k':    { views: 50000, duration: '72h', runs: 200, variance: 15, label: '50,000 views · 72h · 200 runs (~250 views per drop, every ~22m)' },
    'custom': { views: 5000,  duration: '12h', runs: 30,  variance: 15, label: 'Custom views · delivery schedule' }
  };

  const el = (id) => document.getElementById(id);

  // --- INIT ---
  window.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initTabs();
    initSetup();
    initOrder();
    initAutoPlan();
    initPlans();
    initModal();

    // Check saved credentials for auto-login
    const savedU = localStorage.getItem('anoxy_u');
    const savedP = localStorage.getItem('anoxy_p');
    if (savedU && savedP) {
      el('login-user').value = savedU;
      el('login-pass').value = savedP;
      el('login-status').textContent = 'Auto-logging in...';
      setTimeout(() => performLogin(savedU, savedP, true), 200);
    }
  });

  // --- ACTIVITY LOG (EXACT TERMINAL LOG AS APP) ---
  function log(msg) {
    const box = el('log-box');
    if (!box) return;

    const low = msg.toLowerCase();
    let level = 'info';
    if (low.includes('fail') || low.includes('error')) level = 'err';
    else if (low.includes('sent') || low.includes('connected') || low.includes('started')) level = 'ok';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.textContent = `[${timeStr}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  // --- 1. LOGIN SCREEN ---
  function initLogin() {
    el('btn-login').addEventListener('click', () => {
      const u = el('login-user').value.trim().toLowerCase();
      const p = el('login-pass').value.trim();
      if (!u || !p) {
        el('login-status').textContent = 'Enter username and password';
        return;
      }
      performLogin(u, p, false);
    });

    el('login-pass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el('btn-login').click();
    });

    el('btn-logout').addEventListener('click', () => {
      if (confirm('Sign out and remove saved login?')) {
        localStorage.removeItem('anoxy_u');
        localStorage.removeItem('anoxy_p');
        state.user = null;
        el('main-app').style.display = 'none';
        el('login-screen').style.display = 'flex';
        el('login-user').value = '';
        el('login-pass').value = '';
        el('login-status').textContent = '';
      }
    });
  }

  async function performLogin(u, p, isAuto) {
    const btn = el('btn-login');
    const status = el('login-status');
    btn.disabled = true;
    status.textContent = isAuto ? 'Auto-logging in...' : 'Verifying with server...';

    // Device ID per browser session
    let deviceId = localStorage.getItem('anoxy_device_id');
    if (!deviceId) {
      deviceId = 'web_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('anoxy_device_id', deviceId);
    }

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, device_id: deviceId })
      });
      const data = await res.json();

      if (data.status === 'ok') {
        state.user = u;
        if (el('login-save').checked) {
          localStorage.setItem('anoxy_u', u);
          localStorage.setItem('anoxy_p', p);
        } else {
          localStorage.removeItem('anoxy_u');
          localStorage.removeItem('anoxy_p');
        }

        el('login-screen').style.display = 'none';
        el('main-app').style.display = 'flex';
        log(`Signed in as ${u}.`);

        // Load saved panel settings and auto-connect
        const savedUrl = localStorage.getItem('anoxy_panel_url');
        const savedKey = localStorage.getItem('anoxy_panel_key');
        if (savedUrl) el('setup-url').value = savedUrl;
        if (savedKey) el('setup-key').value = savedKey;

        if (savedUrl && savedKey) {
          connectToPanel(true);
        } else {
          switchTab('setup');
        }
      } else {
        status.textContent = data.message || 'Invalid username or password';
      }
    } catch (err) {
      status.textContent = 'Server connection error: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // --- NOTEBOOK TABS ---
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tabId}`);
    });
    if (tabId === 'plans') refreshPlans();
  }

  // --- TAB 1: SETUP ---
  function initSetup() {
    el('setup-show-key').addEventListener('change', (e) => {
      el('setup-key').type = e.target.checked ? 'text' : 'password';
    });

    el('btn-save-connect').addEventListener('click', () => {
      const url = el('setup-url').value.trim();
      const key = el('setup-key').value.trim();
      if (!url || !key) {
        alert('Enter the API URL and API key.');
        return;
      }
      localStorage.setItem('anoxy_panel_url', url);
      localStorage.setItem('anoxy_panel_key', key);
      connectToPanel(false);
    });
  }

  async function connectToPanel(silent = false) {
    const url = el('setup-url').value.trim();
    const key = el('setup-key').value.trim();
    if (!url || !key) return;

    if (!silent) el('setup-status').textContent = 'Connecting...';

    try {
      // 1. Fetch balance
      const balRes = await fetch('/api/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: url, apiKey: key, action: 'balance' })
      });
      const balData = await balRes.json();

      if (balData.balance !== undefined) {
        state.balance = balData.balance;
        state.currency = balData.currency || '';
        state.connected = true;
      }

      // 2. Fetch services
      const svcRes = await fetch('/api/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: url, apiKey: key, action: 'services' })
      });
      const svcData = await svcRes.json();

      if (Array.isArray(svcData)) {
        state.services = {};
        svcData.forEach(s => {
          state.services[parseInt(s.service)] = {
            id: parseInt(s.service),
            name: String(s.name || ''),
            category: String(s.category || ''),
            rate: parseFloat(s.rate || 0),
            min: parseInt(s.min || 0),
            max: parseInt(s.max || 1000000000)
          };
        });

        const count = Object.keys(state.services).length;
        el('conn-dot').className = 'status-dot connected';
        el('topbar-title').textContent = 'Connected';
        el('topbar-sub').textContent = `Balance ${state.balance} ${state.currency}   •   ${count} services`;
        el('setup-status').textContent = 'Connected';
        el('setup-status').style.color = 'var(--success)';
        log('Connected to panel.');

        renderOrderServices();
      }
    } catch (err) {
      el('conn-dot').className = 'status-dot';
      el('topbar-title').textContent = 'Connection Error';
      el('setup-status').textContent = 'Failed to connect: ' + err.message;
      el('setup-status').style.color = 'var(--danger)';
      log('Error connecting to panel: ' + err.message);
    }
  }

  // --- TAB 2: NEW ORDER ---
  function initOrder() {
    el('order-search').addEventListener('input', renderOrderServices);

    el('btn-order-preview').addEventListener('click', () => {
      const r = buildRawPlan();
      if (!r) return;
      const { sid, plan } = r;
      const lines = summaryRawPlan(sid, plan);
      el('order-prev-box').value = lines.join('\n') + '\n(random ranges are picked again when you start)';
    });

    el('btn-order-start').addEventListener('click', async () => {
      const r = buildRawPlan();
      if (!r) return;
      const { sid, link, plan } = r;

      const now = Date.now();
      const steps = plan.map(([delayMin, qty], i) => ({
        step_no: i + 1,
        run_at: now + delayMin * 60000,
        service_id: sid,
        link: link,
        quantity: qty
      }));

      await savePlanToCloud(`Order #${sid} (${steps.length} steps)`, sid, link, steps);
    });
  }

  function renderOrderServices() {
    const tbody = el('order-tree-body');
    const query = (el('order-search').value || '').toLowerCase().trim();
    const svcs = Object.values(state.services);

    if (!svcs.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--muted);">No services loaded.</td></tr>';
      return;
    }

    const filtered = svcs.filter(s =>
      String(s.id).includes(query) ||
      s.category.toLowerCase().includes(query) ||
      s.name.toLowerCase().includes(query)
    ).slice(0, 300);

    let html = '';
    filtered.forEach((s, idx) => {
      html += `
        <tr data-sid="${s.id}" class="svc-row" style="cursor: pointer;">
          <td style="font-weight: 700;">${s.id}</td>
          <td style="color: var(--muted);">${s.category}</td>
          <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis;">${s.name}</td>
          <td style="font-weight: 700;">${s.rate}</td>
          <td>${s.min}</td>
          <td>${s.max}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Row click selection
    tbody.querySelectorAll('.svc-row').forEach(row => {
      row.addEventListener('click', () => {
        tbody.querySelectorAll('.svc-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');

        const sid = parseInt(row.dataset.sid);
        const s = state.services[sid];
        if (s) {
          el('order-sid').value = sid;
          el('order-svc-info').textContent = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
          // Also sync to auto-plan
          el('auto-sid').value = sid;
          el('auto-svc-info').textContent = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
        }
      });
    });
  }

  function parsePlanSyntax(text, defaultGap = '1h') {
    const tokens = text.split(/\s+/).filter(Boolean);
    const plan = [];
    let curDelay = 0;

    for (const t of tokens) {
      if (t.match(/^\d+$/)) {
        plan.push([curDelay, parseInt(t)]);
        curDelay += parseGapString(defaultGap);
      } else {
        curDelay += parseGapString(t);
      }
    }
    return plan;
  }

  function parseGapString(g) {
    if (g.endsWith('m')) return parseInt(g);
    if (g.endsWith('h')) return parseInt(g) * 60;
    if (g.endsWith('d')) return parseInt(g) * 1440;
    return parseInt(g) || 60;
  }

  function buildRawPlan() {
    const sid = parseInt(el('order-sid').value.trim());
    if (!sid || isNaN(sid)) {
      alert('Pick a service or type its numeric ID.');
      return null;
    }
    const link = el('order-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return null;
    }
    const plan = parsePlanSyntax(el('order-plan').value, el('order-gap').value);
    return { sid, link, plan };
  }

  function summaryRawPlan(sid, plan) {
    const now = Date.now();
    const total = plan.reduce((sum, [, q]) => sum + q, 0);
    const lines = plan.map(([d, q], i) => {
      const t = new Date(now + d * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Step ${i + 1}: ${q} at ${t} (+${d} min)`;
    });
    const s = state.services[sid];
    if (s) {
      const cost = (total * s.rate) / 1000;
      lines.push(`Total ${total}  |  estimated cost ${cost.toFixed(4)} ${state.currency}`);
    } else {
      lines.push(`Total ${total}`);
    }
    return lines;
  }

  // --- TAB 3: AUTO PLAN ---
  function initAutoPlan() {
    document.querySelectorAll('#tab-auto .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#tab-auto .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyAutoPreset(pill.dataset.preset);
      });
    });

    el('btn-toggle-adv').addEventListener('click', () => {
      const box = el('adv-pattern-box');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });

    el('auto-var-slider').addEventListener('input', (e) => {
      el('auto-var-lbl').textContent = `±${e.target.value}%`;
    });

    el('comp-enabled').addEventListener('change', (e) => {
      el('comp-box').style.display = e.target.checked ? 'flex' : 'none';
      generateAutoSchedule();
    });

    el('comp-var-slider').addEventListener('input', (e) => {
      el('comp-var-lbl').textContent = `±${e.target.value}%`;
    });

    el('auto-sid').addEventListener('input', () => {
      const sid = parseInt(el('auto-sid').value.trim());
      const s = state.services[sid];
      el('auto-svc-info').textContent = s ? `min ${s.min} max ${s.max} rate ${s.rate}` : '';
      updateAutoStats();
    });

    el('comp-sid').addEventListener('input', () => {
      const sid = parseInt(el('comp-sid').value.trim());
      const s = state.services[sid];
      el('comp-svc-info').textContent = s ? `min ${s.min} max ${s.max} rate ${s.rate}` : '';
      updateAutoStats();
    });

    el('btn-auto-generate').addEventListener('click', generateAutoSchedule);
    el('btn-auto-start').addEventListener('click', startAutoPlan);

    // Initial generation
    applyAutoPreset('10k');
  }

  function applyAutoPreset(key) {
    state.activePreset = key;
    const p = PRESETS[key];
    if (!p) return;

    el('auto-cycle-lbl').textContent = p.label;
    el('auto-dur-select').value = p.duration;
    el('auto-runs-val').value = p.runs;
    el('auto-var-slider').value = p.variance;
    el('auto-var-lbl').textContent = `±${p.variance}%`;

    generateAutoSchedule();
  }

  function generateAutoSchedule() {
    const preset = PRESETS[state.activePreset] || PRESETS['10k'];
    const totalViews = preset.views;
    const durationMin = parseGapString(el('auto-dur-select').value);
    const numRuns = Math.max(2, parseInt(el('auto-runs-val').value) || 65);
    const variancePct = (parseInt(el('auto-var-slider').value) || 15) / 100;

    // Even distribution with variance
    const avg = totalViews / numRuns;
    let quantities = [];
    let sum = 0;

    for (let i = 0; i < numRuns; i++) {
      const factor = 1 + (Math.random() * 2 - 1) * variancePct;
      const q = Math.max(5, Math.round(avg * factor));
      quantities.push(q);
      sum += q;
    }
    // Mathematical remainder correction
    quantities[quantities.length - 1] += (totalViews - sum);

    // Delays
    const avgGap = durationMin / (numRuns - 1);
    let delays = [0];
    let cur = 0;
    for (let i = 1; i < numRuns; i++) {
      cur += avgGap * (1 + (Math.random() * 0.4 - 0.2));
      delays.push(Math.round(cur));
    }

    state.scheduleRuns = delays.map((d, i) => [d, quantities[i]]);

    // Companion likes
    state.companionLikes = {};
    if (el('comp-enabled').checked) {
      const totalLikes = parseInt(el('comp-total-qty').value) || 500;
      const mode = el('comp-time-mode').value;

      let likeIndices = [];
      if (mode === 'match') {
        likeIndices = state.scheduleRuns.map((_, i) => i);
      } else {
        const interval = mode === '2h' ? 120 : 60;
        let last = -999;
        state.scheduleRuns.forEach(([min], i) => {
          if (min - last >= interval * 0.75) {
            likeIndices.push(i);
            last = min;
          }
        });
      }

      if (!likeIndices.length) likeIndices = [0];

      const avgLikes = totalLikes / likeIndices.length;
      let lSum = 0;
      likeIndices.forEach(idx => {
        const lq = Math.max(1, Math.round(avgLikes * (1 + (Math.random() * 0.4 - 0.2))));
        state.companionLikes[idx] = lq;
        lSum += lq;
      });
      const lastIdx = likeIndices[likeIndices.length - 1];
      state.companionLikes[lastIdx] += (totalLikes - lSum);
    }

    renderAutoTable();
    updateAutoStats();
  }

  function renderAutoTable() {
    const tbody = el('auto-tree-body');
    if (!state.scheduleRuns.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 60px; color: var(--muted);">No schedule yet.</td></tr>';
      return;
    }

    const now = Date.now();
    let totalAccum = 0;
    let html = '';

    state.scheduleRuns.forEach(([d, q], i) => {
      totalAccum += q;
      const dt = new Date(now + d * 60000);
      const whenStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                      dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let gapStr = i === 0 ? (d < 0.5 ? 'now' : `in ${d}m`) : `+${d - state.scheduleRuns[i - 1][0]}m`;

      const likes = state.companionLikes[i];
      const likesBadge = likes
        ? `<span class="h-badge" onclick="window.anoxyEditStep(${i})">♥+${likes}</span>`
        : (el('comp-enabled').checked ? `<span class="h-add" onclick="window.anoxyAddLikes(${i})">+♥</span>` : '');

      html += `
        <tr>
          <td>${i + 1}</td>
          <td>${whenStr}</td>
          <td style="color: var(--muted);">${gapStr}</td>
          <td style="font-weight: 700;">+${q} ${likesBadge}</td>
          <td style="color: var(--muted);">${totalAccum}</td>
          <td>
            <button class="btn-small" style="padding: 2px 8px; font-weight: 700;" onclick="window.anoxyEditStep(${i})">✎ Edit</button>
            <button class="btn-small" style="padding: 2px 7px; color: var(--danger);" onclick="window.anoxyDeleteStep(${i})">✕</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function updateAutoStats() {
    const runs = state.scheduleRuns;
    const n = runs.length;
    el('stat-runs').textContent = n ? n : '–';

    if (!n) {
      el('stat-gap').textContent = '–';
      el('stat-finish').textContent = '–';
      el('stat-total').textContent = '–';
      el('stat-cost').textContent = '–';
      return;
    }

    const totalViews = runs.reduce((s, [, q]) => s + q, 0);
    const lastD = runs[n - 1][0];
    const avgGap = lastD / (n - 1);
    el('stat-gap').textContent = `${Math.round(avgGap)}m`;

    const fin = new Date(Date.now() + lastD * 60000);
    el('stat-finish').textContent = fin.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                                    fin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const totalLikes = Object.values(state.companionLikes).reduce((a, b) => a + b, 0);
    el('stat-total').textContent = totalLikes > 0 ? `${totalViews} (+${totalLikes}♥)` : String(totalViews);

    const sid = parseInt(el('auto-sid').value.trim());
    const s = state.services[sid];
    if (s) {
      let cost = (totalViews * s.rate) / 1000;
      const compSid = parseInt(el('comp-sid').value.trim());
      const compS = state.services[compSid];
      if (compS && totalLikes > 0) cost += (totalLikes * compS.rate) / 1000;
      el('stat-cost').textContent = `${cost.toFixed(4)} ${state.currency}`;
    } else {
      el('stat-cost').textContent = '–';
    }
  }

  async function startAutoPlan() {
    const sid = parseInt(el('auto-sid').value.trim());
    if (!sid || isNaN(sid)) {
      alert('Enter a valid numeric Service ID.');
      return;
    }
    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return;
    }
    if (!state.scheduleRuns.length) {
      alert('Generate a schedule first.');
      return;
    }

    const now = Date.now();
    const steps = [];

    state.scheduleRuns.forEach(([d, q], i) => {
      steps.push({
        step_no: steps.length + 1,
        run_at: now + d * 60000,
        service_id: sid,
        link: link,
        quantity: q
      });

      const likes = state.companionLikes[i];
      const compSid = parseInt(el('comp-sid').value.trim());
      if (likes && compSid) {
        steps.push({
          step_no: steps.length + 1,
          run_at: now + d * 60000,
          service_id: compSid,
          link: link,
          quantity: likes
        });
      }
    });

    await savePlanToCloud(`Auto ${state.activePreset.toUpperCase()} Plan (${steps.length} drops)`, sid, link, steps);
  }

  // --- SAVE TO 24/7 CLOUD ---
  async function savePlanToCloud(name, sid, link, steps) {
    const url = localStorage.getItem('anoxy_panel_url');
    const key = localStorage.getItem('anoxy_panel_key');

    if (!url || !key) {
      alert('Please configure Panel API credentials in Setup first.');
      switchTab('setup');
      return;
    }

    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_name: name,
          service_id: sid,
          link: link,
          api_url: url,
          api_key: key,
          steps: steps
        })
      });
      const data = await res.json();
      if (data.status === 'ok' || data.plan_id) {
        log(`Plan started with ${steps.length} scheduled step(s) in 24/7 Cloud.`);
        alert('Plan started successfully in 24/7 Cloud!\n\nYou can now turn off your PC. Cloud will execute all drops automatically.');
        switchTab('plans');
      } else {
        alert('Plan response: ' + JSON.stringify(data));
      }
    } catch (err) {
      alert('Error dispatching plan to cloud: ' + err.message);
    }
  }

  // --- TAB 4: MY PLANS ---
  function initPlans() {
    el('btn-plan-refresh').addEventListener('click', refreshPlans);
    el('btn-plan-cancel').addEventListener('click', cancelSelectedPlan);
  }

  async function refreshPlans() {
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      state.plans = data.plans || [];
      state.steps = data.steps || [];

      renderPlansTable();
    } catch (err) {
      log('Error syncing plans: ' + err.message);
    }
  }

  function renderPlansTable() {
    const tbody = el('plans-tree-body');
    if (!state.plans.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--muted);">No plans scheduled yet.</td></tr>';
      el('steps-tree-body').innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--muted);">Select a plan above.</td></tr>';
      return;
    }

    let html = '';
    state.plans.forEach(p => {
      const pSteps = state.steps.filter(s => s.plan_id === p.id);
      const pending = pSteps.filter(s => s.status === 'pending').length;
      const sent = pSteps.filter(s => s.status === 'sent').length;
      const totalQty = pSteps.reduce((acc, s) => acc + (parseInt(s.quantity) || 0), 0);
      const nextStep = pSteps.find(s => s.status === 'pending');
      const nextStr = nextStep ? new Date(nextStep.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Done';

      html += `
        <tr data-pid="${p.id}" class="plan-row" style="cursor: pointer;">
          <td style="font-weight: 700;">${p.name || p.id}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${p.link}</td>
          <td>${p.service_id}</td>
          <td>${pSteps.length}</td>
          <td style="color: var(--warning); font-weight: 700;">${pending}</td>
          <td style="color: var(--success); font-weight: 700;">${sent}</td>
          <td>${totalQty}</td>
          <td>${nextStr}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    tbody.querySelectorAll('.plan-row').forEach(row => {
      row.addEventListener('click', () => {
        tbody.querySelectorAll('.plan-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        state.selectedPlanId = row.dataset.pid;
        renderStepsTable(state.selectedPlanId);
      });
    });

    // Select first plan by default
    if (state.plans.length && !state.selectedPlanId) {
      tbody.querySelector('.plan-row').click();
    }
  }

  function renderStepsTable(planId) {
    const tbody = el('steps-tree-body');
    const pSteps = state.steps.filter(s => s.plan_id === planId);

    if (!pSteps.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--muted);">No steps in this plan.</td></tr>';
      return;
    }

    let html = '';
    pSteps.forEach(s => {
      const whenStr = new Date(s.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      let statusColor = 'var(--muted)';
      if (s.status === 'sent') statusColor = 'var(--success)';
      else if (s.status === 'pending') statusColor = 'var(--warning)';
      else if (s.status === 'sending') statusColor = 'var(--accent)';
      else if (s.status === 'failed') statusColor = 'var(--danger)';

      html += `
        <tr>
          <td>${s.step_no}</td>
          <td>${s.service_id}</td>
          <td style="font-weight: 700;">${s.quantity}</td>
          <td>${whenStr}</td>
          <td style="color: ${statusColor}; font-weight: 700;">${s.status}</td>
          <td>Panel API</td>
          <td>${s.order_id || '–'}</td>
          <td style="color: var(--muted);">${s.status === 'sent' ? 'Order dispatched' : ''}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  async function cancelSelectedPlan() {
    if (!state.selectedPlanId) {
      alert('Select a plan first.');
      return;
    }
    if (!confirm('Cancel this plan and abort all pending drops?')) return;

    try {
      await fetch('/api/plans', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: state.selectedPlanId })
      });
      log(`Plan ${state.selectedPlanId} cancelled.`);
      refreshPlans();
    } catch (err) {
      alert('Failed to cancel plan: ' + err.message);
    }
  }

  // --- MODAL DIALOG ---
  let editStepIdx = -1;

  function initModal() {
    el('btn-edit-cancel').addEventListener('click', () => el('modal-edit').classList.add('hidden'));
    el('btn-edit-save').addEventListener('click', () => {
      if (editStepIdx < 0) return;
      const vQty = parseInt(el('edit-views-qty').value) || 10;
      const dMin = parseInt(el('edit-delay').value) || 0;
      const lQty = parseInt(el('edit-likes-qty').value) || 0;

      state.scheduleRuns[editStepIdx] = [dMin, vQty];
      if (lQty > 0) state.companionLikes[editStepIdx] = lQty;
      else delete state.companionLikes[editStepIdx];

      state.scheduleRuns.sort((a, b) => a[0] - b[0]);
      el('modal-edit').classList.add('hidden');
      renderAutoTable();
      updateAutoStats();
    });
  }

  window.anoxyEditStep = function (i) {
    editStepIdx = i;
    el('edit-views-qty').value = state.scheduleRuns[i][1];
    el('edit-delay').value = state.scheduleRuns[i][0];
    el('edit-likes-qty').value = state.companionLikes[i] || 0;
    el('modal-edit').classList.remove('hidden');
  };

  window.anoxyAddLikes = function (i) {
    const def = Math.round((parseInt(el('comp-total-qty').value) || 500) / 10);
    state.companionLikes[i] = def;
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyDeleteStep = function (i) {
    state.scheduleRuns.splice(i, 1);
    delete state.companionLikes[i];
    renderAutoTable();
    updateAutoStats();
  };

})();
