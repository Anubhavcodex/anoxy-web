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

  // ================================================================
  //  DURATION / GAP PARSER  (exact match to desktop parse_duration, parse_gap)
  // ================================================================
  const UNITS = { s: 1 / 60, m: 1, h: 60, d: 1440 };
  const DUR_RE = /(?:\d+[smhd])+/;
  const GAP_RE = new RegExp(`${DUR_RE.source}(?:-${DUR_RE.source})?`);

  function parseDuration(tok) {
    // '1h30m' -> 90, '24h' -> 1440, '45m' -> 45, '90s' -> 1.5
    let total = 0;
    const matches = tok.toLowerCase().matchAll(/(\d+)([smhd])/g);
    for (const m of matches) total += parseInt(m[1]) * UNITS[m[2]];
    return total;
  }

  function parseGap(tok) {
    // '30m' -> 30 ; '20m-45m' -> random between 20..45
    tok = tok.toLowerCase().trim();
    if (!GAP_RE.test(tok)) throw new Error(`Bad time '${tok}'. Use 30m, 2h, 1h30m, 20m-45m`);
    if (tok.includes('-')) {
      const [a, b] = tok.split('-');
      const lo = parseDuration(a), hi = parseDuration(b);
      return lo + Math.random() * (hi - lo);
    }
    return parseDuration(tok);
  }

  function fmtGap(minutes) {
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    const mins = Math.round(minutes);
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return `${h}h ${String(m).padStart(2, '0')}m`;
    return h ? `${h}h` : `${m}m`;
  }

  // ================================================================
  //  CYCLE PARSER  (exact match to desktop parse_cycle)
  // ================================================================
  function parseCycle(text) {
    // '3 50m 5 60m 7 65m' -> [[3,[50,50]], [5,[60,60]], [7,[65,65]]]
    const tokens = text.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    const items = [];
    let i = 0;
    while (i < tokens.length) {
      if (!/^\d+$/.test(tokens[i]) || parseInt(tokens[i]) < 1) {
        throw new Error(`Expected a quantity (1 or more), got '${tokens[i]}'`);
      }
      const qty = parseInt(tokens[i]);
      i++;
      let gap = null;
      if (i < tokens.length && GAP_RE.test(tokens[i]) && !/^\d+$/.test(tokens[i])) {
        const tok = tokens[i];
        if (tok.includes('-')) {
          const [a, b] = tok.split('-');
          const lo = parseDuration(a), hi = parseDuration(b);
          gap = [Math.min(lo, hi), Math.max(lo, hi)];
        } else {
          const v = parseDuration(tok);
          gap = [v, v];
        }
        i++;
      }
      items.push([qty, gap]);
    }
    if (!items.length) throw new Error("No quantities found. Example: 3 50m 5 60m 7 65m");
    return items;
  }

  // ================================================================
  //  SCHEDULE GENERATORS  (exact match to desktop)
  // ================================================================
  function generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns = 800) {
    const def = [defaultGapMinutes, defaultGapMinutes];
    const filled = cycle.map(([q, g]) => [q, g || def]);
    const v = Math.max(0, variancePct) / 100;
    const runs = [];
    let elapsed = 0, idx = 0;
    while (elapsed < durationMinutes && runs.length < maxRuns) {
      const [q, [lo, hi]] = filled[idx % filled.length];
      const qty = Math.max(1, Math.round(q * (v ? (1 + (Math.random() * 2 - 1) * v) : 1)));
      runs.push([elapsed, qty]);
      let gap;
      if (hi > lo) {
        gap = lo + Math.random() * (hi - lo);
      } else if (v) {
        gap = lo * (1 + (Math.random() * 2 - 1) * v);
      } else {
        gap = lo;
      }
      elapsed += Math.max(1, gap);
      idx++;
    }
    return runs;
  }

  function fitTotal(runs, total, minQ = 1, maxQ = 1e9) {
    const out = [];
    let acc = 0;
    for (const [d, q] of runs) {
      if (acc >= total) break;
      const clamped = Math.min(q, total - acc);
      out.push([d, clamped]);
      acc += clamped;
    }
    if (out.length && acc < total) out[out.length - 1][1] += total - acc;
    if (out.length > 1 && out[out.length - 1][1] < minQ &&
        out[out.length - 2][1] + out[out.length - 1][1] <= maxQ) {
      out[out.length - 2][1] += out.pop()[1];
    }
    return out;
  }

  function generateForTotal(cycle, durationMinutes, variancePct, defaultGapMinutes, total,
                             minQ = 1, maxQ = 1e9, spread = false, maxRuns = 800) {
    const v = Math.max(0, variancePct) / 100;
    if (spread) {
      const qtys = [];
      let idx = 0, acc = 0;
      while (acc < total) {
        let q = cycle[idx % cycle.length][0];
        q = Math.max(1, Math.round(q * (v ? (1 + (Math.random() * 2 - 1) * v) : 1)));
        q = Math.max(minQ, Math.min(q, maxQ));
        if (qtys.length >= maxRuns - 1) q = total - acc;
        else q = Math.min(q, total - acc);
        qtys.push(q);
        acc += q;
        idx++;
      }
      if (qtys.length > 1 && qtys[qtys.length - 1] < minQ &&
          qtys[qtys.length - 2] + qtys[qtys.length - 1] <= maxQ) {
        qtys[qtys.length - 2] += qtys.pop();
      }
      const step = durationMinutes / qtys.length;
      const runs = [];
      let last = -1;
      qtys.forEach((q, i) => {
        const d = i === 0 ? 0 : Math.max(last + 1, i * step + (Math.random() * 2 - 1) * v * step);
        runs.push([d, q]);
        last = d;
      });
      return runs;
    }

    const clamp = (rs) => { rs.forEach(r => { r[1] = Math.max(minQ, Math.min(r[1], maxQ)); }); return rs; };
    let runs = clamp(generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
    const natural = runs.reduce((s, [, q]) => s + q, 0);
    if (natural < total) {
      const factor = total / Math.max(1, natural);
      const scaled = cycle.map(([q, g]) => [q * factor, g]);
      runs = clamp(generateSchedule(scaled, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
    }
    return fitTotal(runs, total, minQ, maxQ);
  }

  function generateForRuns(cycle, durationMinutes, variancePct, nRuns, total = null,
                            minQ = 1, maxQ = 1e9) {
    const v = Math.max(0, variancePct) / 100;
    const n = nRuns;
    if (durationMinutes / n < 1) throw new Error(`${n} runs is too many for this delivery time.`);
    const weights = [];
    for (let i = 0; i < n; i++) {
      weights.push(cycle[i % cycle.length][0] * (v ? (1 + (Math.random() * 2 - 1) * v) : 1));
    }
    let qtys;
    if (total === null) {
      qtys = weights.map(w => Math.max(minQ, Math.min(maxQ, Math.max(1, Math.round(w)))));
    } else {
      if (total < n * minQ) throw new Error(`Total ${total} is too small for ${n} runs (each needs at least ${minQ}).`);
      const rem = total - n * minQ;
      const sw = weights.reduce((a, b) => a + b, 0);
      const raw = weights.map(w => rem * w / sw);
      qtys = raw.map(x => minQ + Math.floor(x));
      // distribute remainder
      const remainder = total - qtys.reduce((a, b) => a + b, 0);
      const indices = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < remainder; k++) qtys[indices[k][1]]++;
      // respect max
      for (let i = 0; i < n; i++) {
        while (qtys[i] > maxQ) {
          const j = qtys.indexOf(Math.min(...qtys));
          if (qtys[j] >= maxQ) throw new Error(`Total ${total} does not fit into ${n} runs of at most ${maxQ}.`);
          const move = Math.min(qtys[i] - maxQ, maxQ - qtys[j]);
          qtys[i] -= move;
          qtys[j] += move;
        }
      }
    }
    const step = durationMinutes / n;
    const runs = [];
    let last = -1;
    qtys.forEach((q, i) => {
      const d = i === 0 ? 0 : Math.max(last + 1, i * step + (Math.random() * 2 - 1) * v * step);
      runs.push([d, q]);
      last = d;
    });
    return runs;
  }

  // ================================================================
  //  SERVICE VALIDATION  (exact match to desktop check_qty)
  // ================================================================
  function checkQty(sid, qty) {
    const s = state.services[sid];
    if (s && (qty < s.min || qty > s.max)) {
      return `Quantity ${qty} is outside this service's limits (${s.min} to ${s.max}).`;
    }
    return null;
  }

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
      const balRes = await fetch('/api/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: url, apiKey: key, action: 'balance' })
      });
      const balData = await balRes.json();

      if (balData.balance !== undefined) {
        state.balance = parseFloat(balData.balance);
        state.currency = balData.currency || '';
        state.connected = true;
      }

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

      // Validate every quantity against service min/max
      for (const [, qty] of plan) {
        const err = checkQty(sid, qty);
        if (err) { alert(err); return; }
      }

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
    ).slice(0, 500);

    let html = '';
    filtered.forEach(s => {
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

    tbody.querySelectorAll('.svc-row').forEach(row => {
      row.addEventListener('click', () => {
        tbody.querySelectorAll('.svc-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');

        const sid = parseInt(row.dataset.sid);
        const s = state.services[sid];
        if (s) {
          el('order-sid').value = sid;
          el('order-svc-info').textContent = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
          el('auto-sid').value = sid;
          el('auto-svc-info').textContent = `min ${s.min} max ${s.max} rate ${s.rate}`;
        }
      });
    });
  }

  function parsePlanSyntax(text, defaultGap = '1h') {
    // exact match to desktop parse_plan: handles random ranges like 20m-45m
    const defGap = parseGap(defaultGap);
    const tokens = text.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    const plan = [];
    let elapsed = 0, gap = null;
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        if (plan.length) {
          elapsed += gap !== null ? gap : defGap;
        } else {
          elapsed += gap || 0;
        }
        plan.push([elapsed, parseInt(tok)]);
        gap = null;
      } else if (GAP_RE.test(tok)) {
        gap = (gap || 0) + parseGap(tok);
      } else {
        throw new Error(`Can't understand '${tok}'`);
      }
    }
    if (!plan.length) throw new Error("No quantities found. Example: 2 1h 5 30m 10");
    return plan;
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
    try {
      const plan = parsePlanSyntax(el('order-plan').value, el('order-gap').value || '1h');
      // Validate quantities against service limits
      for (const [, qty] of plan) {
        const err = checkQty(sid, qty);
        if (err) { alert(err); return null; }
      }
      return { sid, link, plan };
    } catch (e) {
      alert(e.message);
      return null;
    }
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
      if (state.balance !== null) lines.push(`Balance ${state.balance} ${state.currency}`);
    } else {
      lines.push(`Total ${total}`);
    }
    return lines;
  }

  // ================================================================
  //  TAB 3: AUTO PLAN  (exact match to desktop)
  // ================================================================
  function getSelectedPillVal(containerId) {
    const active = document.querySelector(`#${containerId} .pill-item.active`);
    if (!active) return null;
    return active.dataset.dur || active.dataset.runs || active.dataset.cdur ||
           active.dataset.cruns || active.dataset.cint || active.dataset.preset || null;
  }

  function setSelectedPill(containerId, value) {
    let found = false;
    document.querySelectorAll(`#${containerId} .pill-item`).forEach(p => {
      const v = p.dataset.dur || p.dataset.runs || p.dataset.cdur ||
                p.dataset.cruns || p.dataset.cint || p.dataset.preset;
      if (v === value) { p.classList.add('active'); found = true; }
      else p.classList.remove('active');
    });
    if (!found) {
      document.querySelectorAll(`#${containerId} .pill-item`).forEach(p => {
        const v = p.dataset.dur || p.dataset.runs || p.dataset.cdur ||
                  p.dataset.cruns || p.dataset.cint || p.dataset.preset;
        p.classList.toggle('active', v === 'custom');
      });
    }
  }

  function getDeliveryDurationMinutes() {
    const pill = getSelectedPillVal('auto-dur-pills');
    if (pill === 'custom') return parseDuration(el('auto-custom-dur').value.trim() || '24h');
    return parseDuration(pill || '24h');
  }

  function getNumberOfRuns() {
    const pill = getSelectedPillVal('auto-runs-pills');
    if (pill === 'custom') return Math.max(2, parseInt(el('auto-custom-runs').value.trim()) || 65);
    if (pill === 'auto') return null; // signal: use pattern/auto logic
    return Math.max(2, parseInt(pill) || 25);
  }

  function autoScaleFromTotal() {
    const totTxt = (el('auto-total-views').value || '').trim();
    const tot = parseInt(totTxt);
    if (!tot || isNaN(tot) || tot < 1) {
      el('auto-cycle-lbl').textContent = "Enter a total quantity to auto-scale schedule.";
      el('auto-cycle-lbl').style.background = "#f5f7fc";
      el('auto-cycle-lbl').style.color = "var(--muted)";
      return;
    }
    // exact formula from desktop: runs = max(4, round(tot / 155)), hours = max(1, round(runs * 22.1 / 60))
    const runs = Math.max(4, Math.round(tot / 155));
    const hours = Math.max(1, Math.round(runs * 22.1 / 60));
    const dur = `${hours}h`;

    if (['6h', '12h', '24h', '48h'].includes(dur)) setSelectedPill('auto-dur-pills', dur);
    else { setSelectedPill('auto-dur-pills', 'custom'); el('auto-custom-dur').value = dur; }

    setSelectedPill('auto-runs-pills', 'custom');
    el('auto-custom-runs').value = runs;
    el('auto-spread-chk').checked = true;

    // Update preset pill to Custom
    document.querySelectorAll('#tab-auto [data-preset]').forEach(p => {
      p.classList.toggle('active', p.dataset.preset === 'custom');
    });
    state.activePreset = 'custom';

    const avgQ = Math.round(tot / runs);
    const avgGap = Math.round((hours * 60) / runs);
    el('auto-cycle-lbl').textContent = `★ Auto-scaled: ${tot.toLocaleString()} Views over ${dur} across ${runs} runs (~${avgQ} views every ~${avgGap}m)`;
    el('auto-cycle-lbl').style.background = "#eefaf3";
    el('auto-cycle-lbl').style.color = "var(--success)";

    generateAutoSchedule();
  }

  function initAutoPlan() {
    // Preset pills (excludes inner groups)
    document.querySelectorAll('#tab-auto .pill-group:not(#auto-dur-pills):not(#auto-runs-pills):not(#comp-dur-pills):not(#comp-runs-pills):not(#comp-int-pills) .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.parentElement.querySelectorAll('.pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.preset) applyAutoPreset(pill.dataset.preset);
      });
    });

    // Delivery time pills
    document.querySelectorAll('#auto-dur-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#auto-dur-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.dur === 'custom') el('auto-custom-dur').focus();
        generateAutoSchedule();
      });
    });
    el('auto-custom-dur').addEventListener('input', () => {
      setSelectedPill('auto-dur-pills', 'custom');
      generateAutoSchedule();
    });

    // Number of runs pills
    document.querySelectorAll('#auto-runs-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#auto-runs-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.runs === 'custom') el('auto-custom-runs').focus();
        // Spread is only usable when runs = auto (desktop: on_nruns_pick)
        el('auto-spread-chk').disabled = (pill.dataset.runs !== 'auto');
        generateAutoSchedule();
      });
    });
    el('auto-custom-runs').addEventListener('input', () => {
      setSelectedPill('auto-runs-pills', 'custom');
      el('auto-spread-chk').disabled = true;
      generateAutoSchedule();
    });

    // Total quantity & Auto-scale
    el('btn-auto-scale').addEventListener('click', autoScaleFromTotal);
    el('auto-total-views').addEventListener('input', generateAutoSchedule);
    el('auto-spread-chk').addEventListener('change', generateAutoSchedule);

    // Companion pills
    document.querySelectorAll('#comp-dur-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-dur-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.cdur === 'custom') el('comp-custom-dur').focus();
        rePairCompanion();
      });
    });
    el('comp-custom-dur').addEventListener('input', () => { setSelectedPill('comp-dur-pills', 'custom'); rePairCompanion(); });

    document.querySelectorAll('#comp-runs-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-runs-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.cruns === 'custom') el('comp-custom-runs').focus();
        // Show/dim interval section based on auto vs number
        const intSec = el('comp-interval-section');
        if (intSec) intSec.style.opacity = (pill.dataset.cruns === 'auto' ? '1' : '0.5');
        rePairCompanion();
      });
    });
    el('comp-custom-runs').addEventListener('input', () => {
      setSelectedPill('comp-runs-pills', 'custom');
      const intSec = el('comp-interval-section');
      if (intSec) intSec.style.opacity = '0.5';
      rePairCompanion();
    });

    document.querySelectorAll('#comp-int-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-int-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.cint === 'custom') el('comp-custom-int').focus();
        rePairCompanion();
      });
    });
    el('comp-custom-int').addEventListener('input', () => { setSelectedPill('comp-int-pills', 'custom'); rePairCompanion(); });

    el('comp-total-qty').addEventListener('input', rePairCompanion);
    el('comp-drop-qty').addEventListener('input', rePairCompanion);
    el('btn-comp-repair').addEventListener('click', rePairCompanion);

    el('btn-toggle-adv').addEventListener('click', () => {
      const box = el('adv-pattern-box');
      const btn = el('btn-toggle-adv');
      if (box.style.display === 'none') {
        box.style.display = 'block';
        btn.textContent = '▾ Advanced: Custom Pattern';
      } else {
        box.style.display = 'none';
        btn.textContent = '▸ Advanced: Custom Pattern';
      }
    });

    el('auto-var-slider').addEventListener('input', (e) => {
      el('auto-var-lbl').textContent = `±${e.target.value}%`;
      generateAutoSchedule();
    });

    el('comp-enabled').addEventListener('change', (e) => {
      el('comp-box').style.display = e.target.checked ? 'flex' : 'none';
      rePairCompanion();
    });

    el('comp-var-slider').addEventListener('input', (e) => {
      el('comp-var-lbl').textContent = `±${e.target.value}%`;
      rePairCompanion();
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

    // Initial preset
    applyAutoPreset('10k');
  }

  function applyAutoPreset(key) {
    state.activePreset = key;
    if (key === 'custom') {
      autoScaleFromTotal();
      return;
    }
    // exact presets from desktop on_view_preset_pick
    const presets = {
      '1k':  { tot: 1000,  dur: '6h',  runs: 10 },
      '5k':  { tot: 5000,  dur: '12h', runs: 32 },
      '10k': { tot: 10000, dur: '24h', runs: 65 },
      '20k': { tot: 20000, dur: '48h', runs: 130 },
      '50k': { tot: 50000, dur: '72h', runs: 320 },
    };
    const p = presets[key];
    if (!p) return;

    el('auto-total-views').value = p.tot;
    if (['6h', '12h', '24h', '48h'].includes(p.dur)) setSelectedPill('auto-dur-pills', p.dur);
    else { setSelectedPill('auto-dur-pills', 'custom'); el('auto-custom-dur').value = p.dur; }

    setSelectedPill('auto-runs-pills', 'custom');
    el('auto-custom-runs').value = p.runs;
    el('auto-spread-chk').checked = true;
    el('auto-spread-chk').disabled = true; // custom runs => spread disabled

    const durMins = parseDuration(p.dur);
    const avgQ = Math.round(p.tot / p.runs);
    const avgGap = Math.round(durMins / p.runs);
    el('auto-cycle-lbl').textContent = `★ ${p.tot.toLocaleString()} Views over ${p.dur} across ${p.runs} runs (~${avgQ} views every ~${avgGap}m)`;
    el('auto-cycle-lbl').style.background = "#eefaf3";
    el('auto-cycle-lbl').style.color = "var(--success)";

    generateAutoSchedule();
  }

  // ================================================================
  //  generateAutoSchedule — exact match to desktop generate_auto
  // ================================================================
  function generateAutoSchedule() {
    // 1. Read the total views from the input (NOT from preset)
    const totalViews = Math.max(1, parseInt(el('auto-total-views').value.trim()) || 10000);

    // 2. Read pattern
    let cycle;
    const advBox = el('adv-pattern-box');
    const advVisible = advBox && advBox.style.display !== 'none';
    const rawPattern = el('auto-raw-pattern') ? el('auto-raw-pattern').value.trim() : '';
    if (advVisible && rawPattern) {
      try { cycle = parseCycle(rawPattern); }
      catch (e) {
        el('auto-cycle-lbl').textContent = e.message;
        el('auto-cycle-lbl').style.background = "#fde8e9";
        el('auto-cycle-lbl').style.color = "var(--danger)";
        return;
      }
    } else {
      cycle = [[3, [50, 50]], [5, [60, 60]], [7, [65, 65]]]; // default pattern
    }

    // 3. Read duration
    const durationMin = getDeliveryDurationMinutes();

    // 4. Read runs choice
    const nRunsChoice = getSelectedPillVal('auto-runs-pills');
    let nRuns = getNumberOfRuns(); // null if auto, else number

    // 5. Read variance
    const variancePct = parseInt(el('auto-var-slider').value) || 15;

    // 6. Read spread
    const spread = el('auto-spread-chk').checked;

    // 7. Read service limits
    const sid = parseInt(el('auto-sid').value.trim());
    const s = state.services[sid];
    const minQ = s ? s.min : 1;
    const maxQ = s ? s.max : 1e9;

    // 8. Compute the default gap from pattern
    const mids = cycle.filter(([, g]) => g !== null).map(([, g]) => (g[0] + g[1]) / 2);
    const defaultGap = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 60;

    // 9. Generate (exact match to desktop generate_auto logic)
    let runs;
    try {
      if (nRuns !== null) {
        // Fixed number of runs
        runs = generateForRuns(cycle, durationMin, variancePct, nRuns, totalViews, minQ, maxQ);
      } else if (totalViews) {
        // Auto runs with total
        runs = generateForTotal(cycle, durationMin, variancePct, defaultGap, totalViews, minQ, maxQ, spread);
      } else {
        // Pure auto
        runs = generateSchedule(cycle, durationMin, variancePct, defaultGap);
        if (s) runs.forEach(r => { r[1] = Math.min(Math.max(r[1], minQ), maxQ); });
      }
    } catch (e) {
      alert(e.message);
      return;
    }

    state.scheduleRuns = runs;
    log(`Schedule built: ${runs.length} run(s), ${runs.reduce((a, [, q]) => a + q, 0)} total, last one ${fmtGap(runs.length ? runs[runs.length - 1][0] : 0)} from the start.`);

    // Auto re-pair companion if enabled
    rePairCompanion();
  }

  // ================================================================
  //  rePairCompanion — exact match to desktop re_pair_companion
  // ================================================================
  function rePairCompanion() {
    state.companionLikes = {};
    if (!el('comp-enabled').checked || !state.scheduleRuns.length) {
      renderAutoTable();
      updateAutoStats();
      return;
    }

    // 1. Companion Delivery Time
    const durChoice = getSelectedPillVal('comp-dur-pills');
    const viewsDurMin = state.scheduleRuns[state.scheduleRuns.length - 1][0];
    let compDurMin;
    if (durChoice === 'match') compDurMin = viewsDurMin;
    else if (durChoice === 'custom') compDurMin = parseDuration(el('comp-custom-dur').value.trim() || '18h');
    else compDurMin = parseDuration(durChoice || '24h');

    // Eligible view runs within companion delivery time
    const eligible = [];
    state.scheduleRuns.forEach(([min], i) => {
      if (min <= compDurMin + 0.001) eligible.push(i);
    });
    if (!eligible.length) eligible.push(0);

    // 2. Number of Runs or Auto (Interval) — exact desktop logic
    const nrunsChoice = getSelectedPillVal('comp-runs-pills');
    let chosenIndices = [];

    if (nrunsChoice !== 'auto') {
      // Fixed number of companion runs — evenly pick from eligible
      const nTxt = nrunsChoice === 'custom' ? (el('comp-custom-runs').value.trim() || '8') : nrunsChoice;
      const targetN = Math.max(1, Math.min(parseInt(nTxt) || 5, eligible.length));
      if (targetN === 1) {
        chosenIndices = [eligible[0]];
      } else {
        for (let step = 0; step < targetN; step++) {
          const idxInEl = Math.round(step * (eligible.length - 1) / (targetN - 1));
          if (!chosenIndices.includes(eligible[idxInEl])) chosenIndices.push(eligible[idxInEl]);
        }
      }
    } else {
      // Auto: drop by interval — exact desktop logic
      const intChoice = getSelectedPillVal('comp-int-pills');
      const intervalStr = intChoice === 'custom' ? (el('comp-custom-int').value.trim() || '45m') : (intChoice || '1h');
      const intervalMins = parseDuration(intervalStr);
      chosenIndices = [eligible[0]];
      let lastT = state.scheduleRuns[eligible[0]][0];
      for (let i = 1; i < eligible.length; i++) {
        const runIdx = eligible[i];
        if (state.scheduleRuns[runIdx][0] - lastT >= intervalMins - 0.001) {
          chosenIndices.push(runIdx);
          lastT = state.scheduleRuns[runIdx][0];
        }
      }
    }

    // 3. Total Quantity or Qty per drop — exact desktop logic
    const totalTxt = el('comp-total-qty').value.trim();
    const baseQty = parseInt(el('comp-drop-qty').value.trim()) || 25;
    const compTotal = totalTxt && !isNaN(parseInt(totalTxt)) && parseInt(totalTxt) >= 1 ? parseInt(totalTxt) : null;
    const variancePct = (parseInt(el('comp-var-slider').value) || 20) / 100;
    const k = chosenIndices.length;

    // Service limits for companion
    const compSid = parseInt(el('comp-sid').value.trim());
    const compS = state.services[compSid];
    const sMin = compS ? compS.min : 1;
    const sMax = compS ? compS.max : 1e9;

    let quantities = [];
    if (compTotal !== null) {
      if (k === 1) {
        quantities = [compTotal];
      } else if (variancePct > 0) {
        const rawWeights = chosenIndices.map(() => 1 - variancePct + Math.random() * 2 * variancePct);
        const weightSum = rawWeights.reduce((a, b) => a + b, 0);
        let rawQtys = rawWeights.map(w => Math.max(sMin, Math.round(compTotal * w / Math.max(1, weightSum))));
        let diff = compTotal - rawQtys.reduce((a, b) => a + b, 0);
        let ptr = 0;
        const step = diff > 0 ? 1 : -1;
        while (diff !== 0 && ptr < k * 10) {
          const tgt = ptr % k;
          if (step > 0 || rawQtys[tgt] > sMin) {
            rawQtys[tgt] += step;
            diff -= step;
          }
          ptr++;
        }
        quantities = rawQtys;
      } else {
        const baseQ = Math.max(sMin, Math.floor(compTotal / k));
        const rem = compTotal - baseQ * k;
        quantities = chosenIndices.map((_, i) => baseQ + (i < rem ? 1 : 0));
      }
    } else {
      quantities = chosenIndices.map(() => {
        const factor = variancePct > 0 ? (1 - variancePct + Math.random() * 2 * variancePct) : 1;
        return Math.max(sMin, Math.min(sMax, Math.round(baseQty * factor)));
      });
    }

    chosenIndices.forEach((runIdx, i) => {
      state.companionLikes[runIdx] = quantities[i];
    });

    const totAssigned = Object.values(state.companionLikes).reduce((a, b) => a + b, 0);
    log(`Paired 2nd service: ${chosenIndices.length} drops, total ${totAssigned} likes (±${Math.round(variancePct * 100)}% variance).`);

    renderAutoTable();
    updateAutoStats();
  }

  function renderAutoTable() {
    const tbody = el('auto-tree-body');
    if (!state.scheduleRuns.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 60px; color: var(--muted);">No schedule yet.<br>Pick a pattern and press "Generate schedule".</td></tr>';
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

      let gapStr;
      if (i === 0) gapStr = d < 0.5 ? 'now' : `in ${fmtGap(d)}`;
      else gapStr = `+${fmtGap(d - state.scheduleRuns[i - 1][0])}`;

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
    const gaps = [];
    for (let k = 0; k < n - 1; k++) gaps.push(runs[k + 1][0] - runs[k][0]);
    el('stat-gap').textContent = gaps.length ? fmtGap(gaps.reduce((a, b) => a + b, 0) / gaps.length) : '–';

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

  // ================================================================
  //  startAutoPlan — exact match to desktop auto_start_plan
  // ================================================================
  async function startAutoPlan() {
    const sid = parseInt(el('auto-sid').value.trim());
    if (!sid || isNaN(sid)) {
      alert('Pick a service, or type its numeric ID, on the New order tab.');
      return;
    }
    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return;
    }
    if (!state.scheduleRuns.length) {
      alert('Click "Generate schedule" first.');
      return;
    }

    // Validate every view quantity against service limits
    for (const [, qty] of state.scheduleRuns) {
      const err = checkQty(sid, qty);
      if (err) { alert(err); return; }
    }

    // Validate companion quantities
    const compSid = parseInt(el('comp-sid').value.trim());
    if (el('comp-enabled').checked && Object.keys(state.companionLikes).length) {
      if (!compSid || isNaN(compSid)) {
        alert('Please enter a valid numeric 2nd Service ID.');
        return;
      }
      for (const cq of Object.values(state.companionLikes)) {
        const err = checkQty(compSid, cq);
        if (err) { alert(err); return; }
      }
    }

    // Cost check
    const totalViews = state.scheduleRuns.reduce((a, [, q]) => a + q, 0);
    const s = state.services[sid];
    let cost = s ? (totalViews * s.rate / 1000) : null;
    const totalLikes = Object.values(state.companionLikes).reduce((a, b) => a + b, 0);
    if (cost !== null && el('comp-enabled').checked && totalLikes) {
      const compS = state.services[compSid];
      if (compS) cost += totalLikes * compS.rate / 1000;
    }
    if (cost !== null && state.balance !== null && cost > state.balance) {
      if (!confirm(`Estimated cost ${cost.toFixed(4)} is higher than your balance ${state.balance}.\nLater runs may fail. Continue anyway?`)) return;
    }

    const totalSteps = state.scheduleRuns.length + (el('comp-enabled').checked ? Object.keys(state.companionLikes).length : 0);
    if (!confirm(`${state.scheduleRuns.length} primary runs` +
                 (el('comp-enabled').checked && totalLikes ? ` + ${Object.keys(state.companionLikes).length} paired companion runs` : '') +
                 ` over this schedule.\n\nTotal views: ${totalViews}` +
                 (totalLikes ? ` + ${totalLikes} likes` : '') +
                 (cost !== null ? `\nEstimated cost: ${cost.toFixed(4)} ${state.currency}` : '') +
                 (state.balance !== null ? `\nBalance: ${state.balance} ${state.currency}` : ''))) return;

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

      if (el('comp-enabled').checked && state.companionLikes[i] && compSid) {
        steps.push({
          step_no: steps.length + 1,
          run_at: now + d * 60000,
          service_id: compSid,
          link: link,
          quantity: state.companionLikes[i]
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

      const svc = state.services[s.service_id];
      const svcTxt = svc ? `#${s.service_id} (${svc.name.substring(0, 14)}…)` : `#${s.service_id}`;

      html += `
        <tr>
          <td>${s.step_no}</td>
          <td>${svcTxt}</td>
          <td style="font-weight: 700;">${s.quantity}</td>
          <td>${whenStr}</td>
          <td style="color: ${statusColor}; font-weight: 700;">${s.status}</td>
          <td>Panel API</td>
          <td>${s.order_id || '–'}</td>
          <td style="color: var(--muted);">${s.error || (s.status === 'sent' ? 'Order dispatched' : '')}</td>
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
    if (!confirm('Cancel all pending steps of this plan?\nSteps already sent to the panel cannot be recalled from here.')) return;

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

      // Validate against service limits
      const sid = parseInt(el('auto-sid').value.trim());
      const err = checkQty(sid, vQty);
      if (err) { alert(err); return; }

      if (lQty > 0) {
        const compSid = parseInt(el('comp-sid').value.trim());
        const cerr = checkQty(compSid, lQty);
        if (cerr) { alert(cerr); return; }
      }

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
    const defQ = parseInt(el('comp-drop-qty').value.trim()) || 25;
    state.companionLikes[i] = defQ;
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyDeleteStep = function (i) {
    state.scheduleRuns.splice(i, 1);
    // Re-index companion map (shift keys down)
    const newMap = {};
    for (const [k, v] of Object.entries(state.companionLikes)) {
      const ki = parseInt(k);
      if (ki < i) newMap[ki] = v;
      else if (ki > i) newMap[ki - 1] = v;
      // ki === i is the deleted one, skip
    }
    state.companionLikes = newMap;
    renderAutoTable();
    updateAutoStats();
  };

})();
