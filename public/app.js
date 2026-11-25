/**
 * Anoxy Schedular - Cloud Web App Client
 * Exact 1:1 Logic and Behavioral Parity with desktop anoxy_schedular.py
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    user: null,
    services: {},       // { [service_id]: { service, name, rate, min, max, category } }
    balance: null,
    currency: 'USD',
    scheduleRuns: [],   // [ [delayMinutes, quantity], ... ]
    companionLikes: {}, // { [runIndex]: quantity }
    activePreset: '10k',
    plans: [],
    steps: [],
    selectedPlanId: null,
    selectedStepId: null
  };

  const el = id => document.getElementById(id);

  function log(msg) {
    const box = el('log-box');
    if (!box) return;
    const time = new Date().toLocaleTimeString();
    box.textContent += `[${time}] ${msg}\n`;
    box.scrollTop = box.scrollHeight;
  }

  // ================================================================
  //  PARSERS & FORMATTERS (Exact Python desktop parity)
  // ================================================================

  function parseDuration(text) {
    if (!text) throw new Error("Duration cannot be empty");
    const s = String(text).trim().toLowerCase();
    const tokenRe = /(\d+(?:\.\d+)?)\s*([smhd]?)/g;
    let total = 0.0, matchedAny = false, lastIndex = 0, m;

    while ((m = tokenRe.exec(s)) !== null) {
      if (m.index !== lastIndex) {
        const skipped = s.slice(lastIndex, m.index).trim();
        if (skipped) throw new Error(`Unexpected text in duration: '${skipped}'`);
      }
      matchedAny = true;
      lastIndex = tokenRe.lastIndex;
      const val = parseFloat(m[1]);
      const unit = m[2] || 'm';
      if (unit === 's') total += val / 60.0;
      else if (unit === 'm' || unit === '') total += val;
      else if (unit === 'h') total += val * 60.0;
      else if (unit === 'd') total += val * 1440.0;
      else throw new Error(`Unknown time unit: '${unit}'`);
    }

    if (!matchedAny || lastIndex < s.length) {
      throw new Error(`Invalid duration: '${text}'`);
    }
    return Math.max(0, Math.round(total * 100) / 100);
  }

  function parseGap(tok) {
    const t = String(tok).trim().toLowerCase();
    if (t.includes('-')) {
      const parts = t.split('-');
      if (parts.length !== 2) throw new Error(`Invalid gap range '${tok}'`);
      const lo = parseDuration(parts[0]);
      const hi = parseDuration(parts[1]);
      if (lo > hi) throw new Error(`Gap range low > high in '${tok}'`);
      return [lo, hi];
    }
    const d = parseDuration(t);
    return [d, d];
  }

  function fmtGap(mins) {
    const m = Math.round(mins);
    if (m === 0) return '0m';
    const d = Math.floor(m / 1440);
    const rem = m % 1440;
    const h = Math.floor(rem / 60);
    const min = rem % 60;
    const out = [];
    if (d) out.push(`${d}d`);
    if (h) out.push(`${h}h`);
    if (min) out.push(`${min}m`);
    return out.join(' ') || '0m';
  }

  function gapToken(mins) {
    const m = Math.round(mins);
    if (m === 0) return '0m';
    if (m % 1440 === 0) return `${m / 1440}d`;
    if (m % 60 === 0) return `${m / 60}h`;
    return `${m}m`;
  }

  function parseCycle(text) {
    const toks = String(text).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) throw new Error("Pattern cannot be empty.");
    const cycle = [];
    let i = 0;
    while (i < toks.length) {
      const qtok = toks[i];
      const q = parseInt(qtok, 10);
      if (isNaN(q) || q <= 0 || String(q) !== qtok) {
        throw new Error(`Expected whole quantity at token ${i + 1}, got '${qtok}'.`);
      }
      i++;
      let gap = null;
      if (i < toks.length) {
        const nextTok = toks[i];
        if (/^\d+$/.test(nextTok)) {
          gap = null;
        } else {
          try {
            gap = parseGap(nextTok);
            i++;
          } catch (e) {
            gap = null;
          }
        }
      }
      cycle.push([q, gap]);
    }
    return cycle;
  }

  function parsePlanSyntax(text, defaultGapMins = 60) {
    const toks = String(text).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) throw new Error("Plan cannot be empty.");
    const plan = [];
    let curDelay = 0.0;
    let i = 0;
    while (i < toks.length) {
      const qtok = toks[i];
      const q = parseInt(qtok, 10);
      if (isNaN(q) || q <= 0 || String(q) !== qtok) {
        throw new Error(`Expected whole quantity at token ${i + 1}, got '${qtok}'.`);
      }
      i++;
      let gapMins = defaultGapMins;
      if (i < toks.length) {
        const nextTok = toks[i];
        if (!/^\d+$/.test(nextTok)) {
          const [lo, hi] = parseGap(nextTok);
          gapMins = lo === hi ? lo : (lo + Math.random() * (hi - lo));
          i++;
        }
      }
      plan.push([Math.round(curDelay * 100) / 100, q]);
      curDelay += gapMins;
    }
    return plan;
  }

  // ================================================================
  //  SCHEDULE GENERATORS (Exact desktop parity)
  // ================================================================

  function generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns = 800) {
    const vFrac = Math.max(0, variancePct) / 100.0;
    const runs = [];
    let t = 0.0;
    let stepIdx = 0;

    while (t <= durationMinutes && runs.length < maxRuns) {
      const [baseQ, gapSpec] = cycle[stepIdx % cycle.length];
      let q = baseQ;
      if (vFrac > 0) {
        const factor = 1.0 - vFrac + Math.random() * (2 * vFrac);
        q = Math.max(1, Math.round(baseQ * factor));
      }
      runs.push([Math.round(t * 100) / 100, q]);

      let gap;
      if (gapSpec === null) {
        gap = defaultGapMinutes;
        if (vFrac > 0) {
          const factor = 1.0 - vFrac + Math.random() * (2 * vFrac);
          gap = Math.max(1.0, gap * factor);
        }
      } else {
        const [lo, hi] = gapSpec;
        gap = lo === hi ? lo : (lo + Math.random() * (hi - lo));
      }

      t += Math.max(0.1, gap);
      stepIdx++;
    }

    if (runs.length && runs[runs.length - 1][0] > durationMinutes) {
      runs.pop();
    }
    return runs;
  }

  function fitTotal(runs, total, minQ = 1, maxQ = 1e9) {
    if (!runs.length) return runs;
    if (runs.length === 1) {
      runs[0][1] = Math.min(Math.max(total, minQ), maxQ);
      return runs;
    }
    const currentTotal = runs.reduce((acc, [, q]) => acc + q, 0);
    if (currentTotal === 0) return runs;

    const ratio = total / currentTotal;
    const scaled = runs.map(([d, q]) => [d, Math.min(Math.max(Math.round(q * ratio), minQ), maxQ)]);

    let diff = total - scaled.reduce((acc, [, q]) => acc + q, 0);
    const step = diff > 0 ? 1 : -1;
    let i = 0;
    const n = scaled.length;
    while (diff !== 0 && i < n * 10) {
      const tgt = i % n;
      if (step > 0 && scaled[tgt][1] < maxQ) {
        scaled[tgt][1] += 1;
        diff -= 1;
      } else if (step < 0 && scaled[tgt][1] > minQ) {
        scaled[tgt][1] -= 1;
        diff += 1;
      }
      i++;
    }
    return scaled;
  }

  function generateForTotal(cycle, durationMinutes, variancePct, defaultGapMinutes, total, minQ = 1, maxQ = 1e9, spread = true, maxRuns = 800) {
    const clamp = r => {
      r.forEach(item => { item[1] = Math.min(Math.max(item[1], minQ), maxQ); });
      return r;
    };

    if (!spread) {
      let runs = clamp(generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
      if (!runs.length) {
        const scaled = cycle.map(([q, g]) => [Math.max(q, minQ), g]);
        runs = clamp(generateSchedule(scaled, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
      }
      let running = 0;
      const kept = [];
      for (const [d, q] of runs) {
        if (running + q <= total) {
          kept.push([d, q]);
          running += q;
        } else {
          const rem = total - running;
          if (rem >= minQ) {
            kept.push([d, rem]);
            running += rem;
          } else if (kept.length) {
            kept[kept.length - 1][1] = Math.min(maxQ, kept[kept.length - 1][1] + rem);
            running += rem;
          }
          break;
        }
      }
      return kept.length ? kept : [[0.0, Math.min(Math.max(total, minQ), maxQ)]];
    }

    const runs = generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns);
    if (!runs.length) {
      return [[0.0, Math.min(Math.max(total, minQ), maxQ)]];
    }
    return fitTotal(runs, total, minQ, maxQ);
  }

  function generateForRuns(cycle, durationMinutes, variancePct, nRuns, total = null, minQ = 1, maxQ = 1e9) {
    if (nRuns < 1 || nRuns > 800) {
      throw new Error("Number of runs must be between 1 and 800.");
    }
    if (nRuns === 1) {
      const q = total !== null ? total : cycle[0][0];
      return [[0.0, Math.min(Math.max(q, minQ), maxQ)]];
    }

    const vFrac = Math.max(0, variancePct) / 100.0;
    const nominalGap = durationMinutes / (nRuns - 1);
    const gaps = [];
    for (let i = 0; i < nRuns - 1; i++) {
      if (vFrac > 0) {
        const factor = 1.0 - vFrac + Math.random() * (2 * vFrac);
        gaps.push(Math.max(0.5, nominalGap * factor));
      } else {
        gaps.push(nominalGap);
      }
    }
    const currentSpan = gaps.reduce((a, b) => a + b, 0);
    const rescale = currentSpan > 0 ? (durationMinutes / currentSpan) : 1.0;
    const delays = [0.0];
    let t = 0.0;
    for (const g of gaps) {
      t += g * rescale;
      delays.push(Math.round(t * 100) / 100);
    }
    delays[delays.length - 1] = Math.round(durationMinutes * 100) / 100;

    let quantities = [];
    if (total !== null) {
      if (vFrac > 0) {
        const rawWeights = [];
        for (let i = 0; i < nRuns; i++) {
          const baseQ = cycle[i % cycle.length][0];
          const factor = 1.0 - vFrac + Math.random() * (2 * vFrac);
          rawWeights.push(baseQ * factor);
        }
        const weightSum = rawWeights.reduce((a, b) => a + b, 0);
        let rawQtys = rawWeights.map(w => Math.max(minQ, Math.round(total * w / Math.max(1e-9, weightSum))));
        let diff = total - rawQtys.reduce((a, b) => a + b, 0);
        const step = diff > 0 ? 1 : -1;
        let ptr = 0;
        while (diff !== 0 && ptr < nRuns * 10) {
          const tgt = ptr % nRuns;
          if (step > 0 && rawQtys[tgt] < maxQ) {
            rawQtys[tgt] += 1;
            diff -= 1;
          } else if (step < 0 && rawQtys[tgt] > minQ) {
            rawQtys[tgt] -= 1;
            diff += 1;
          }
          ptr++;
        }
        quantities = rawQtys;
      } else {
        const baseQ = Math.max(minQ, Math.floor(total / nRuns));
        const rem = total - baseQ * nRuns;
        quantities = [];
        for (let i = 0; i < nRuns; i++) {
          quantities.push(baseQ + (i < rem ? 1 : 0));
        }
      }
    } else {
      quantities = [];
      for (let i = 0; i < nRuns; i++) {
        const baseQ = cycle[i % cycle.length][0];
        let q = baseQ;
        if (vFrac > 0) {
          const factor = 1.0 - vFrac + Math.random() * (2 * vFrac);
          q = Math.max(1, Math.round(baseQ * factor));
        }
        quantities.push(Math.min(Math.max(q, minQ), maxQ));
      }
    }

    const runs = [];
    for (let i = 0; i < nRuns; i++) {
      runs.push([delays[i], quantities[i]]);
    }
    return runs;
  }

  function checkQty(sid, qty) {
    const s = state.services[sid];
    if (s && (qty < s.min || qty > s.max)) {
      return `Quantity ${qty} is outside this service's limits (${s.min} to ${s.max}).`;
    }
    return null;
  }

  // ================================================================
  //  UI CONTROLS & PILL HELPERS
  // ================================================================

  function getSelectedPillVal(containerId) {
    const active = document.querySelector(`#${containerId} .pill-item.active`);
    if (!active) return null;
    return active.dataset.preset || active.dataset.dur || active.dataset.runs ||
           active.dataset.cdur || active.dataset.cruns || active.dataset.cint || null;
  }

  function setSelectedPill(containerId, value) {
    document.querySelectorAll(`#${containerId} .pill-item`).forEach(p => {
      const v = p.dataset.preset || p.dataset.dur || p.dataset.runs ||
                p.dataset.cdur || p.dataset.cruns || p.dataset.cint;
      p.classList.toggle('active', v === value);
    });
  }

  function getDeliveryDurationMinutes() {
    const pill = getSelectedPillVal('auto-dur-pills');
    if (pill === 'custom') {
      return parseDuration(el('auto-custom-dur').value.trim() || '24h');
    }
    return parseDuration(pill || '24h');
  }

  function getNumberOfRuns() {
    const pill = getSelectedPillVal('auto-runs-pills');
    if (pill === 'custom') {
      return Math.max(1, parseInt(el('auto-custom-runs').value.trim()) || 65);
    }
    if (pill === 'auto') return null;
    return Math.max(1, parseInt(pill) || 25);
  }

  // ================================================================
  //  INITIALIZATION
  // ================================================================

  document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTabs();
    initSetup();
    initOrder();
    initAutoPlan();
    initPlans();
    initModals();
  });

  // --- AUTH ---
  function initAuth() {
    const btn = el('btn-login');
    const userIn = el('login-user');
    const passIn = el('login-pass');
    const saveIn = el('login-save');
    const status = el('login-status');

    const savedUser = localStorage.getItem('anoxy_user');
    const savedPass = localStorage.getItem('anoxy_pass');
    if (savedUser && savedPass) {
      userIn.value = savedUser;
      passIn.value = savedPass;
      doLogin(savedUser, savedPass, true);
    }

    btn.addEventListener('click', () => {
      const u = userIn.value.trim();
      const p = passIn.value.trim();
      if (!u || !p) {
        status.textContent = 'Please enter both username and password.';
        return;
      }
      doLogin(u, p, saveIn.checked);
    });

    el('btn-logout').addEventListener('click', () => {
      localStorage.removeItem('anoxy_user');
      localStorage.removeItem('anoxy_pass');
      state.user = null;
      el('main-app').style.display = 'none';
      el('login-screen').style.display = 'flex';
      el('login-pass').value = '';
      el('login-status').textContent = '';
      log('User signed out.');
    });
  }

  async function doLogin(username, password, save) {
    const status = el('login-status');
    status.style.color = 'var(--text)';
    status.textContent = 'Signing in...';
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        if (save) {
          localStorage.setItem('anoxy_user', username);
          localStorage.setItem('anoxy_pass', password);
        }
        state.user = username;
        el('login-screen').style.display = 'none';
        el('main-app').style.display = 'flex';
        log(`Signed in as ${username}. Welcome to Anoxy Schedular.`);
        autoConnectPanel();
      } else {
        status.style.color = 'var(--danger)';
        status.textContent = data.message || 'Login failed. Check credentials.';
      }
    } catch (err) {
      status.style.color = 'var(--danger)';
      status.textContent = 'Connection error: ' + err.message;
    }
  }

  // --- TABS ---
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'plans') refreshPlans();
  }

  // --- TAB 1: SETUP ---
  function initSetup() {
    const savedUrl = localStorage.getItem('anoxy_panel_url');
    const savedKey = localStorage.getItem('anoxy_panel_key');
    if (savedUrl) el('setup-url').value = savedUrl;
    if (savedKey) el('setup-key').value = savedKey;

    el('setup-show-key').addEventListener('change', e => {
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
      connectPanel(url, key);
    });
  }

  function autoConnectPanel() {
    const url = localStorage.getItem('anoxy_panel_url');
    const key = localStorage.getItem('anoxy_panel_key');
    if (url && key) connectPanel(url, key);
  }

  async function connectPanel(url, key) {
    el('setup-status').textContent = 'Connecting...';
    el('setup-status').style.color = 'var(--warning)';
    el('conn-dot').style.color = 'var(--warning)';
    el('topbar-title').textContent = 'Connecting...';
    el('topbar-sub').textContent = '';

    try {
      const [balRes, svcRes] = await Promise.all([
        fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'balance', api_url: url, api_key: key })
        }),
        fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'services', api_url: url, api_key: key })
        })
      ]);

      const balData = await balRes.json();
      const svcData = await svcRes.json();

      if (balData.error) throw new Error('Balance API: ' + balData.error);
      if (svcData.error) throw new Error('Services API: ' + svcData.error);

      state.balance = parseFloat(balData.balance);
      state.currency = balData.currency || 'USD';

      if (Array.isArray(svcData)) {
        state.services = {};
        svcData.forEach(s => {
          state.services[parseInt(s.service)] = {
            service: parseInt(s.service),
            name: s.name,
            rate: parseFloat(s.rate),
            min: parseInt(s.min) || 1,
            max: parseInt(s.max) || 1e9,
            category: s.category || ''
          };
        });
        const count = Object.keys(state.services).length;
        el('setup-status').textContent = `Connected (${count} services, balance: ${state.balance} ${state.currency})`;
        el('setup-status').style.color = 'var(--success)';
        el('conn-dot').style.color = 'var(--success)';
        el('topbar-title').textContent = 'Connected';
        el('topbar-sub').textContent = `${count} services · balance ${state.balance} ${state.currency}`;
        log(`Connected to panel. Loaded ${count} services. Balance: ${state.balance} ${state.currency}.`);
        renderServicesTable();

        // Refresh service info if sid is already set
        const sid = parseInt(el('auto-sid').value.trim());
        if (sid && state.services[sid]) {
          const s = state.services[sid];
          el('auto-svc-info').textContent = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
          el('order-svc-info').textContent = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
        }
        const compSid = parseInt(el('comp-sid').value.trim());
        if (compSid && state.services[compSid]) {
          const cs = state.services[compSid];
          el('comp-svc-info').textContent = `${cs.name.slice(0, 20)} (rate ${cs.rate})`;
        }
      }
    } catch (err) {
      el('setup-status').textContent = 'Connection failed';
      el('setup-status').style.color = 'var(--danger)';
      el('conn-dot').style.color = 'var(--danger)';
      el('topbar-title').textContent = 'Connection failed';
      el('topbar-sub').textContent = err.message;
      log('Panel connection failed: ' + err.message);
    }
  }

  function renderServicesTable() {
    const tbody = el('order-tree-body');
    const filter = el('order-search').value.toLowerCase().trim();
    const svcs = Object.values(state.services);

    const filtered = filter ? svcs.filter(s =>
      String(s.service).includes(filter) ||
      (s.name && s.name.toLowerCase().includes(filter)) ||
      (s.category && s.category.toLowerCase().includes(filter))
    ) : svcs;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--muted);">No matching services found.</td></tr>';
      return;
    }

    let html = '';
    const slice = filtered.slice(0, 300);
    slice.forEach(s => {
      html += `
        <tr data-sid="${s.service}" class="service-row" style="cursor: pointer;">
          <td style="font-weight: 700;">${s.service}</td>
          <td style="color: var(--muted); max-width: 130px; overflow: hidden; text-overflow: ellipsis;">${s.category}</td>
          <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis;">${s.name}</td>
          <td>${s.rate}</td>
          <td>${s.min}</td>
          <td>${s.max}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('.service-row').forEach(row => {
      row.addEventListener('click', () => {
        tbody.querySelectorAll('.service-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        const sid = parseInt(row.dataset.sid);
        const s = state.services[sid];
        const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';

        // Two-way sync to both New Order and Auto Plan tabs (exact desktop parity)
        el('order-sid').value = sid;
        el('order-svc-info').textContent = info;
        el('auto-sid').value = sid;
        el('auto-svc-info').textContent = info;
        updateAutoStats();
      });
    });
  }

  // --- TAB 2: NEW ORDER ---
  function initOrder() {
    el('order-search').addEventListener('input', renderServicesTable);

    // Two-way sync between New Order and Auto Plan inputs
    el('order-sid').addEventListener('input', () => {
      const val = el('order-sid').value.trim();
      el('auto-sid').value = val;
      const s = state.services[parseInt(val)];
      const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';
      el('order-svc-info').textContent = info;
      el('auto-svc-info').textContent = info;
    });

    el('order-link').addEventListener('input', () => {
      el('auto-link').value = el('order-link').value;
    });

    el('btn-order-preview').addEventListener('click', () => {
      const plan = buildManualPlan();
      if (!plan) return;
      const lines = plan.map(([d, q]) => `+${fmtGap(d)}: ${q}`);
      el('order-prev-box').value = `${plan.length} steps scheduled:\n` + lines.join('\n');
    });

    el('btn-order-start').addEventListener('click', () => {
      const r = validateManualOrder();
      if (!r) return;
      const { sid, link, plan } = r;

      const totalQty = plan.reduce((a, [, q]) => a + q, 0);
      const s = state.services[sid];
      const cost = s ? (totalQty * s.rate / 1000) : null;
      if (cost !== null && state.balance !== null && cost > state.balance) {
        if (!confirm(`Estimated cost ${cost.toFixed(4)} is higher than your balance ${state.balance}.\nLater runs may fail. Continue anyway?`)) return;
      }

      if (!confirm(`Start this plan? ${plan.length} runs, total ${totalQty} items.`)) return;

      const now = Date.now();
      const steps = plan.map(([d, q], idx) => ({
        step_no: idx + 1,
        run_at: now + d * 60000,
        service_id: sid,
        link: link,
        quantity: q
      }));

      savePlanToCloud(`Manual Order (${plan.length} drops)`, sid, link, steps);
    });
  }

  function validateManualOrder() {
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
    const plan = buildManualPlan();
    if (!plan) return null;

    for (const [, qty] of plan) {
      const err = checkQty(sid, qty);
      if (err) {
        alert(err);
        return null;
      }
    }
    return { sid, link, plan };
  }

  function buildManualPlan() {
    const planTxt = el('order-plan').value.trim();
    const defGapTxt = el('order-gap').value.trim() || '1h';
    let defGapMins = 60;
    try { defGapMins = parseDuration(defGapTxt); }
    catch (e) { alert("Invalid default gap: " + e.message); return null; }

    try {
      return parsePlanSyntax(planTxt, defGapMins);
    } catch (e) {
      alert("Plan syntax error: " + e.message);
      return null;
    }
  }

  // ================================================================
  //  TAB 3: AUTO PLAN
  // ================================================================
  function initAutoPlan() {
    // Two-way sync to New Order tab
    el('auto-sid').addEventListener('input', () => {
      const val = el('auto-sid').value.trim();
      el('order-sid').value = val;
      const sid = parseInt(val);
      const s = state.services[sid];
      const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';
      el('auto-svc-info').textContent = info;
      el('order-svc-info').textContent = info;
      updateAutoStats();
    });

    el('auto-link').addEventListener('input', () => {
      el('order-link').value = el('auto-link').value;
    });

    // Companion SID change (exact desktop on_comp_sid_change parity)
    el('comp-sid').addEventListener('input', () => {
      const sidTxt = el('comp-sid').value.trim();
      if (/^\d+$/.test(sidTxt)) {
        const sid = parseInt(sidTxt);
        const s = state.services[sid];
        if (s) {
          el('comp-svc-info').textContent = `${s.name.slice(0, 20)} (rate ${s.rate})`;
          // Elevate drop qty to service minimum if currently lower
          const curDropQ = parseInt(el('comp-drop-qty').value.trim()) || 0;
          if (curDropQ < s.min) {
            el('comp-drop-qty').value = s.min;
          }
          if (el('comp-enabled').checked && state.scheduleRuns.length) {
            rePairCompanion();
          }
          updateAutoStats();
          return;
        }
      }
      el('comp-svc-info').textContent = '';
      updateAutoStats();
    });

    // Preset pills (1k, 5k, 10k, 20k, 50k, Custom)
    document.querySelectorAll('#tab-auto .pill-group:not(#auto-dur-pills):not(#auto-runs-pills):not(#comp-dur-pills):not(#comp-runs-pills):not(#comp-int-pills) .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.parentElement.querySelectorAll('.pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (pill.dataset.preset) applyAutoPreset(pill.dataset.preset);
      });
    });

    // Delivery time pills (Views)
    document.querySelectorAll('#auto-dur-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#auto-dur-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.dur === 'custom');
        el('auto-custom-dur').disabled = !isCustom;
        if (isCustom) el('auto-custom-dur').focus();
      });
    });

    el('auto-custom-dur').addEventListener('input', () => {
      setSelectedPill('auto-dur-pills', 'custom');
      el('auto-custom-dur').disabled = false;
    });

    // Number of runs pills (Views)
    document.querySelectorAll('#auto-runs-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#auto-runs-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.runs === 'custom');
        el('auto-custom-runs').disabled = !isCustom;
        if (isCustom) el('auto-custom-runs').focus();
        // Spread checkbox is ONLY enabled when runs choice is 'auto' (desktop parity line 1344)
        el('auto-spread-chk').disabled = (pill.dataset.runs !== 'auto');
      });
    });

    el('auto-custom-runs').addEventListener('input', () => {
      setSelectedPill('auto-runs-pills', 'custom');
      el('auto-custom-runs').disabled = false;
      el('auto-spread-chk').disabled = true;
    });

    // Auto-scale button
    el('btn-auto-scale').addEventListener('click', () => {
      autoScaleFromTotal();
    });

    // Variance slider (Views)
    el('auto-var-slider').addEventListener('input', e => {
      el('auto-var-lbl').textContent = `±${e.target.value}%`;
    });

    // Companion Toggle Checkbox
    el('comp-enabled').addEventListener('change', e => {
      el('comp-box').style.display = e.target.checked ? 'flex' : 'none';
      if (e.target.checked && state.scheduleRuns.length) {
        rePairCompanion();
      } else {
        state.companionLikes = {};
        renderAutoTable();
        updateAutoStats();
      }
    });

    // Companion Delivery time pills
    document.querySelectorAll('#comp-dur-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-dur-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cdur === 'custom');
        el('comp-custom-dur').disabled = !isCustom;
        if (isCustom) el('comp-custom-dur').focus();
        if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
      });
    });

    el('comp-custom-dur').addEventListener('input', () => {
      setSelectedPill('comp-dur-pills', 'custom');
      el('comp-custom-dur').disabled = false;
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });

    // Companion Number of runs pills
    document.querySelectorAll('#comp-runs-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-runs-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cruns === 'custom');
        el('comp-custom-runs').disabled = !isCustom;
        if (isCustom) el('comp-custom-runs').focus();

        const intSec = el('comp-interval-section');
        const isAuto = (pill.dataset.cruns === 'auto');
        if (intSec) {
          intSec.style.opacity = isAuto ? '1' : '0.4';
          intSec.querySelectorAll('input, .pill-item').forEach(x => {
            if (x.tagName === 'INPUT') x.disabled = !isAuto;
          });
        }
        if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
      });
    });

    el('comp-custom-runs').addEventListener('input', () => {
      setSelectedPill('comp-runs-pills', 'custom');
      el('comp-custom-runs').disabled = false;
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });

    // Companion Interval pills
    document.querySelectorAll('#comp-int-pills .pill-item').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#comp-int-pills .pill-item').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cint === 'custom');
        el('comp-custom-int').disabled = !isCustom;
        if (isCustom) el('comp-custom-int').focus();
        if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
      });
    });

    el('comp-custom-int').addEventListener('input', () => {
      setSelectedPill('comp-int-pills', 'custom');
      el('comp-custom-int').disabled = false;
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });

    // Companion Total Qty & Qty/drop inputs
    el('comp-total-qty').addEventListener('input', () => {
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });
    el('comp-drop-qty').addEventListener('input', () => {
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });

    // Companion Variance slider
    el('comp-var-slider').addEventListener('input', e => {
      el('comp-var-lbl').textContent = `±${e.target.value}%`;
      if (el('comp-enabled').checked && state.scheduleRuns.length) rePairCompanion();
    });

    // Re-pair button
    el('btn-comp-repair').addEventListener('click', () => {
      rePairCompanion(true);
    });

    // Advanced collapsible
    el('btn-toggle-adv').addEventListener('click', () => {
      const box = el('adv-pattern-box');
      const btn = el('btn-toggle-adv');
      const hidden = box.style.display === 'none';
      box.style.display = hidden ? 'block' : 'none';
      btn.textContent = hidden ? '▾ Advanced: Custom Pattern' : '▸ Advanced: Custom Pattern';
    });

    // Action buttons
    el('btn-auto-generate').addEventListener('click', generateAutoSchedule);
    el('btn-auto-regenerate').addEventListener('click', generateAutoSchedule);
    el('btn-auto-start').addEventListener('click', startAutoPlan);
    el('btn-auto-add').addEventListener('click', () => {
      el('modal-add').classList.remove('hidden');
    });

    // Import / Export
    el('btn-auto-export').addEventListener('click', exportSchedule);
    el('btn-auto-import').addEventListener('click', () => el('file-import-input').click());
    el('file-import-input').addEventListener('change', importSchedule);

    // Initial preset setup (configures form without generating schedule)
    applyAutoPreset('10k');
  }

  // --- PRESET HANDLING (Exact desktop on_view_preset_pick parity) ---
  function applyAutoPreset(key) {
    state.activePreset = key;
    if (key === 'custom') {
      autoScaleFromTotal();
      return;
    }

    const presets = {
      '1k':  { tot: 1000,  dur: '6h',  runs: 10 },
      '5k':  { tot: 5000,  dur: '12h', runs: 32 },
      '10k': { tot: 10000, dur: '24h', runs: 65 },
      '20k': { tot: 20000, dur: '48h', runs: 130 },
      '50k': { tot: 50000, dur: '72h', runs: 320 }
    };

    const p = presets[key];
    if (!p) return;

    el('auto-total-views').value = p.tot;

    if (['6h', '12h', '24h', '48h'].includes(p.dur)) {
      setSelectedPill('auto-dur-pills', p.dur);
      el('auto-custom-dur').disabled = true;
    } else {
      setSelectedPill('auto-dur-pills', 'custom');
      el('auto-custom-dur').value = p.dur;
      el('auto-custom-dur').disabled = false;
    }

    setSelectedPill('auto-runs-pills', 'custom');
    el('auto-custom-runs').value = p.runs;
    el('auto-custom-runs').disabled = false;
    el('auto-spread-chk').checked = true;
    el('auto-spread-chk').disabled = true; // custom runs => spread disabled

    const durMins = parseDuration(p.dur);
    const avgQ = Math.round(p.tot / p.runs);
    const avgGap = Math.round(durMins / p.runs);
    el('auto-cycle-lbl').textContent = `★ ${p.tot.toLocaleString()} Views over ${p.dur} across ${p.runs} runs (~${avgQ} views every ~${avgGap}m)`;
    el('auto-cycle-lbl').style.background = "#eefaf3";
    el('auto-cycle-lbl').style.color = "var(--success)";

    // NOTE: Does NOT auto-generate schedule. Schedule is generated ONLY when user clicks Generate schedule.
  }

  function autoScaleFromTotal() {
    const totTxt = el('auto-total-views').value.trim();
    if (!/^\d+$/.test(totTxt) || parseInt(totTxt) < 1) {
      el('auto-cycle-lbl').textContent = "Enter a total quantity to auto-scale schedule.";
      el('auto-cycle-lbl').style.background = "#f5f7fc";
      el('auto-cycle-lbl').style.color = "var(--muted)";
      return;
    }
    const tot = parseInt(totTxt);
    // Desktop auto-scale formula (lines 1290-1292)
    const runs = Math.max(4, Math.round(tot / 155));
    const hours = Math.max(1, Math.round(runs * 22.1 / 60));
    const dur = `${hours}h`;

    if (['6h', '12h', '24h', '48h'].includes(dur)) {
      setSelectedPill('auto-dur-pills', dur);
      el('auto-custom-dur').disabled = true;
    } else {
      setSelectedPill('auto-dur-pills', 'custom');
      el('auto-custom-dur').value = dur;
      el('auto-custom-dur').disabled = false;
    }

    setSelectedPill('auto-runs-pills', 'custom');
    el('auto-custom-runs').value = runs;
    el('auto-custom-runs').disabled = false;
    el('auto-spread-chk').checked = true;
    el('auto-spread-chk').disabled = true;

    // Update preset pill to Custom
    document.querySelectorAll('#tab-auto .pill-group:not(#auto-dur-pills):not(#auto-runs-pills):not(#comp-dur-pills):not(#comp-runs-pills):not(#comp-int-pills) .pill-item').forEach(p => {
      p.classList.toggle('active', p.dataset.preset === 'custom');
    });
    state.activePreset = 'custom';

    const avgQ = Math.round(tot / runs);
    const avgGap = Math.round((hours * 60) / runs);
    el('auto-cycle-lbl').textContent = `★ Auto-scaled: ${tot.toLocaleString()} Views over ${dur} across ${runs} runs (~${avgQ} views every ~${avgGap}m)`;
    el('auto-cycle-lbl').style.background = "#eefaf3";
    el('auto-cycle-lbl').style.color = "var(--success)";
  }

  // ================================================================
  //  generateAutoSchedule — Exact desktop generate_auto parity
  // ================================================================
  function generateAutoSchedule() {
    // 1. Service validation
    const sidTxt = el('auto-sid').value.trim();
    if (!sidTxt || !/^\d+$/.test(sidTxt)) {
      alert("Pick a service, or type its numeric ID, on the New order tab.");
      return;
    }
    const sid = parseInt(sidTxt);

    // 2. Link validation — strictly enforce https:// (desktop parity lines 1514-1516)
    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert("Enter the full post/profile link (starting with https://).");
      return;
    }

    // 3. Pattern parsing
    let cycle;
    const advBox = el('adv-pattern-box');
    const advVisible = advBox && advBox.style.display !== 'none';
    const rawPattern = el('auto-raw-pattern') ? el('auto-raw-pattern').value.trim() : '';
    if (advVisible && rawPattern) {
      try {
        cycle = parseCycle(rawPattern);
      } catch (e) {
        alert(e.message);
        return;
      }
    } else {
      cycle = [[3, [50, 50]], [5, [60, 60]], [7, [65, 65]]];
    }

    // 4. Duration parsing
    let durationMin;
    const durChoice = getSelectedPillVal('auto-dur-pills');
    try {
      const durStr = durChoice === 'custom' ? el('auto-custom-dur').value.trim() : durChoice;
      durationMin = parseDuration(durStr);
      if (durationMin <= 0) throw new Error();
    } catch {
      alert("Custom duration should look like 24h, 2d, 36h.");
      return;
    }

    // 5. Total quantity validation
    const totalTxt = el('auto-total-views').value.trim();
    let total = null;
    if (totalTxt) {
      if (!/^\d+$/.test(totalTxt) || parseInt(totalTxt) < 1) {
        alert("Total quantity must be a whole number, 1 or more (or leave it empty for no limit).");
        return;
      }
      total = parseInt(totalTxt);
    }

    // 6. Number of runs validation
    let nRuns = null;
    const choice = getSelectedPillVal('auto-runs-pills');
    if (choice !== 'auto') {
      const nTxt = choice === 'custom' ? el('auto-custom-runs').value.trim() : choice;
      if (!/^\d+$/.test(nTxt) || parseInt(nTxt) < 1 || parseInt(nTxt) > 800) {
        alert("Number of runs must be a whole number from 1 to 800.");
        return;
      }
      nRuns = parseInt(nTxt);
    }

    // 7. Check total against service limits
    const s = state.services[sid];
    if (total !== null && s && !(s.min <= total && total <= s.max)) {
      alert(`Total ${total} is outside this service's limits (${s.min} to ${s.max}).`);
      return;
    }

    // 8. Scale pattern if pattern is below service min
    if (s && s.min > 0 && total === null) {
      const smallest = Math.min(...cycle.map(([q]) => q));
      if (smallest < s.min) {
        const factor = Math.ceil(s.min / smallest);
        cycle.forEach(item => { item[0] *= factor; });
        log(`Pattern quantities were below this service's minimum (${s.min}), so they were scaled up x${factor}, keeping the same shape.`);
      }
    }

    // 9. Compute default gap from pattern
    const mids = cycle.filter(([, g]) => g !== null).map(([, g]) => (g[0] + g[1]) / 2);
    const defaultGap = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 60;

    // 10. Generate runs
    const variancePct = parseInt(el('auto-var-slider').value) || 20;
    const spread = el('auto-spread-chk').checked;
    const minQ = s ? s.min : 1;
    const maxQ = s ? s.max : 1e9;

    let runs;
    try {
      if (nRuns !== null) {
        runs = generateForRuns(cycle, durationMin, variancePct, nRuns, total, minQ, maxQ);
      } else if (total !== null) {
        runs = generateForTotal(cycle, durationMin, variancePct, defaultGap, total, minQ, maxQ, spread);
      } else {
        runs = generateSchedule(cycle, durationMin, variancePct, defaultGap);
        if (s) runs.forEach(r => { r[1] = Math.min(Math.max(r[1], minQ), maxQ); });
      }
    } catch (e) {
      alert(e.message);
      return;
    }

    state.scheduleRuns = runs;
    state.companionLikes = {};

    log(`Schedule built: ${runs.length} run(s), ${runs.reduce((a, [, q]) => a + q, 0)} total, last one ${fmtGap(runs.length ? runs[runs.length - 1][0] : 0)} from the start.`);

    // 11. Auto re-pair companion if enabled
    if (el('comp-enabled').checked) {
      rePairCompanion(false);
    } else {
      renderAutoTable();
      updateAutoStats();
    }
  }

  // ================================================================
  //  rePairCompanion — Exact desktop re_pair_companion parity
  //  (Enforces companion service minimum, interval & duration)
  // ================================================================
  function rePairCompanion(showAlerts = false) {
    if (!state.scheduleRuns.length) {
      if (showAlerts) alert("Generate or add view runs first.");
      return;
    }

    const compSidTxt = el('comp-sid').value.trim();
    if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
      if (showAlerts) alert("Enter a numeric Service ID for the 2nd service (e.g. Likes).");
      return;
    }
    const csid = parseInt(compSidTxt);
    const compS = state.services[csid];
    const sMin = compS ? compS.min : 1;
    const sMax = compS ? compS.max : 1e9;

    // 1. Total Quantity or Qty per drop
    const totalTxt = el('comp-total-qty').value.trim();
    let compTotal = null;
    if (totalTxt) {
      if (!/^\d+$/.test(totalTxt) || parseInt(totalTxt) < 1) {
        if (showAlerts) alert("2nd service Total quantity must be a whole number, 1 or more (or leave empty).");
        return;
      }
      compTotal = parseInt(totalTxt);
      if (compS && !(compS.min <= compTotal && compTotal <= compS.max)) {
        if (showAlerts) alert(`Total quantity ${compTotal} is outside 2nd service limits (${compS.min} to ${compS.max}).`);
        return;
      }
    }

    const qtyTxt = el('comp-drop-qty').value.trim();
    let baseQty = 25;
    if (qtyTxt) {
      if (!/^\d+$/.test(qtyTxt) || parseInt(qtyTxt) < 1) {
        if (showAlerts) alert("Quantity per drop must be 1 or more.");
        return;
      }
      baseQty = parseInt(qtyTxt);
    }
    // Enforce service minimum on baseQty
    if (baseQty < sMin) {
      baseQty = sMin;
      el('comp-drop-qty').value = sMin;
    }

    // 2. Delivery Time / Duration for companion
    const durChoice = getSelectedPillVal('comp-dur-pills');
    let maxCompDelay;
    if (durChoice === 'match') {
      maxCompDelay = state.scheduleRuns[state.scheduleRuns.length - 1][0];
    } else {
      const durStr = durChoice === 'custom' ? el('comp-custom-dur').value.trim() : durChoice;
      try {
        maxCompDelay = parseDuration(durStr);
        if (maxCompDelay <= 0) throw new Error();
      } catch {
        if (showAlerts) alert("2nd service duration should look like 6h, 12h, 24h, 36h.");
        return;
      }
    }

    // Eligible view runs within companion delivery time
    let eligible = [];
    state.scheduleRuns.forEach(([d], idx) => {
      if (d <= maxCompDelay + 0.001) eligible.push(idx);
    });
    if (!eligible.length) eligible = [0];

    // 3. Number of Runs or Auto (Interval) — exact desktop logic
    const nrunsChoice = getSelectedPillVal('comp-runs-pills');
    let chosenIndices = [];

    if (nrunsChoice !== 'auto') {
      const nTxt = nrunsChoice === 'custom' ? el('comp-custom-runs').value.trim() : nrunsChoice;
      if (!/^\d+$/.test(nTxt) || parseInt(nTxt) < 1) {
        if (showAlerts) alert("Number of runs for 2nd service must be 1 or more.");
        return;
      }
      const targetN = Math.max(1, Math.min(parseInt(nTxt), eligible.length));
      if (targetN === 1) {
        chosenIndices = [eligible[0]];
      } else {
        for (let step = 0; step < targetN; step++) {
          const idxInEl = Math.round(step * (eligible.length - 1) / (targetN - 1));
          if (!chosenIndices.includes(eligible[idxInEl])) {
            chosenIndices.push(eligible[idxInEl]);
          }
        }
      }
    } else {
      // Auto: drop by interval (e.g. 1h default, 30m, 2h)
      const intChoice = getSelectedPillVal('comp-int-pills');
      let intervalMins;
      try {
        const intervalStr = intChoice === 'custom' ? el('comp-custom-int').value.trim() : intChoice;
        intervalMins = parseDuration(intervalStr);
        if (intervalMins <= 0) throw new Error();
      } catch {
        if (showAlerts) alert("Ride-along interval must look like 1h, 30m, 2h, 45m.");
        return;
      }

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

    // 4. Calculate Quantities with Random Variance
    const variancePct = parseInt(el('comp-var-slider').value) || 20;
    const k = chosenIndices.length;
    let quantities = [];

    if (compTotal !== null) {
      if (k === 1) {
        quantities = [compTotal];
      } else if (variancePct > 0) {
        const vFrac = variancePct / 100.0;
        const rawWeights = chosenIndices.map(() => 1.0 - vFrac + Math.random() * (2 * vFrac));
        const weightSum = rawWeights.reduce((a, b) => a + b, 0);
        let rawQtys = rawWeights.map(w => Math.max(sMin, Math.round(compTotal * w / Math.max(1e-9, weightSum))));
        let diff = compTotal - rawQtys.reduce((a, b) => a + b, 0);
        const step = diff > 0 ? 1 : -1;
        let ptr = 0;
        while (diff !== 0 && ptr < k * 10) {
          const tgt = ptr % k;
          if (step > 0 && rawQtys[tgt] < sMax) {
            rawQtys[tgt] += 1;
            diff -= 1;
          } else if (step < 0 && rawQtys[tgt] > sMin) {
            rawQtys[tgt] -= 1;
            diff += 1;
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
        let q = baseQty;
        if (variancePct > 0) {
          const factor = 1.0 - (variancePct / 100) + Math.random() * (2 * variancePct / 100);
          q = Math.round(baseQty * factor);
        }
        // Enforce companion service limits (likes should only be >= service minimum)
        return Math.max(sMin, Math.min(q, sMax));
      });
    }

    state.companionLikes = {};
    chosenIndices.forEach((runIdx, i) => {
      state.companionLikes[runIdx] = quantities[i];
    });

    const totAssigned = Object.values(state.companionLikes).reduce((a, b) => a + b, 0);
    log(`Paired 2nd service #${compSidTxt}: ${chosenIndices.length} drops, total ${totAssigned} likes (±${variancePct}% variance across ${chosenIndices.length} runs).`);

    renderAutoTable();
    updateAutoStats();
  }

  // ================================================================
  //  SCHEDULE TABLE RENDERING
  // ================================================================
  function renderAutoTable() {
    const tbody = el('auto-tree-body');
    if (!state.scheduleRuns.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 60px; color: var(--muted);">No schedule yet.<br>Pick a pattern and press “Generate schedule”.</td></tr>';
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
      const compOn = el('comp-enabled').checked;
      let likesBadge = '';
      if (compOn) {
        if (likes !== undefined && likes !== null) {
          likesBadge = `<span class="h-badge" title="Click to edit like drop" onclick="window.anoxyEditLikes(${i})">♥+${likes}</span>`;
        } else {
          likesBadge = `<span class="h-add" title="Click to add like drop here" onclick="window.anoxyAddLikes(${i})">+♥</span>`;
        }
      }

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

    const totalLikes = el('comp-enabled').checked ? Object.values(state.companionLikes).reduce((a, b) => a + b, 0) : 0;
    el('stat-total').textContent = totalLikes > 0 ? `${totalViews} (+${totalLikes}♥)` : String(totalViews);

    const sid = parseInt(el('auto-sid').value.trim());
    const s = state.services[sid];
    if (s) {
      let cost = totalViews * s.rate / 1000;
      if (el('comp-enabled').checked && totalLikes > 0) {
        const compSid = parseInt(el('comp-sid').value.trim());
        const compS = state.services[compSid];
        if (compS) cost += totalLikes * compS.rate / 1000;
      }
      el('stat-cost').textContent = `${cost.toFixed(4)} ${state.currency}`;
    } else {
      el('stat-cost').textContent = '–';
    }
  }

  // ================================================================
  //  startAutoPlan — Exact desktop auto_start_plan parity
  // ================================================================
  async function startAutoPlan() {
    if (!state.scheduleRuns.length) {
      alert('Click "Generate schedule" first.');
      return;
    }

    const sidTxt = el('auto-sid').value.trim();
    if (!sidTxt || !/^\d+$/.test(sidTxt)) {
      alert('Pick a service, or type its numeric ID, on the New order tab.');
      return;
    }
    const sid = parseInt(sidTxt);

    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return;
    }

    // Validate every view quantity against service limits
    for (const [, qty] of state.scheduleRuns) {
      const err = checkQty(sid, qty);
      if (err) { alert(err); return; }
    }

    // Validate companion quantities against service limits
    let compSid = null;
    const compOn = el('comp-enabled').checked && Object.keys(state.companionLikes).length > 0;
    if (compOn) {
      const compSidTxt = el('comp-sid').value.trim();
      if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
        alert('Please enter a valid numeric 2nd Service ID.');
        return;
      }
      compSid = parseInt(compSidTxt);
      for (const cq of Object.values(state.companionLikes)) {
        const err = checkQty(compSid, cq);
        if (err) {
          alert("Companion Quantity Error: " + err);
          return;
        }
      }
    }

    // Cost calculation & balance check
    const totalViews = state.scheduleRuns.reduce((a, [, q]) => a + q, 0);
    const s = state.services[sid];
    let cost = s ? (totalViews * s.rate / 1000) : null;
    const totalLikes = compOn ? Object.values(state.companionLikes).reduce((a, b) => a + b, 0) : 0;
    if (cost !== null && compOn && totalLikes > 0) {
      const compS = state.services[compSid];
      if (compS) cost += totalLikes * compS.rate / 1000;
    }

    if (cost !== null && state.balance !== null && cost > state.balance) {
      if (!confirm(`Estimated cost ${cost.toFixed(4)} is higher than your balance ${state.balance}.\nLater runs may fail. Continue anyway?`)) return;
    }

    const compRunsCount = compOn ? Object.keys(state.companionLikes).length : 0;
    const confirmMsg = `${state.scheduleRuns.length} primary runs` +
      (compOn ? ` + ${compRunsCount} paired companion runs` : '') +
      ` over this schedule.\n\nTotal views: ${totalViews}` +
      (compOn ? ` + ${totalLikes} likes` : '') +
      (cost !== null ? `\nEstimated cost: ${cost.toFixed(4)} ${state.currency}` : '') +
      (state.balance !== null ? `\nBalance: ${state.balance} ${state.currency}` : '');

    if (!confirm(confirmMsg)) return;

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

      if (compOn && state.companionLikes[i] && compSid) {
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
    state.scheduleRuns = [];
    state.companionLikes = {};
    renderAutoTable();
    updateAutoStats();
  }

  // --- SAVE PLAN TO 24/7 CLOUD ---
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

  // ================================================================
  //  MODAL DIALOGS: EDIT STEP, ADD RUN, EDIT MY PLANS STEP
  // ================================================================
  let editStepIdx = -1;

  function initModals() {
    // --- EDIT RUN MODAL ---
    el('btn-edit-cancel').addEventListener('click', () => el('modal-edit').classList.add('hidden'));

    el('btn-edit-save').addEventListener('click', () => {
      if (editStepIdx < 0 || editStepIdx >= state.scheduleRuns.length) return;
      const vQty = parseInt(el('edit-views-qty').value.trim()) || 0;
      const gapTxt = el('edit-gap').value.trim();
      const lQty = parseInt(el('edit-likes-qty').value.trim()) || 0;
      const shift = el('edit-shift-chk').checked;

      if (vQty <= 0) {
        alert("Views quantity must be 1 or more.");
        return;
      }
      const sid = parseInt(el('auto-sid').value.trim());
      const err = checkQty(sid, vQty);
      if (err) { alert(err); return; }

      let newGap;
      try {
        newGap = parseDuration(gapTxt);
      } catch {
        alert("Gap should look like 30m, 1h, 45m.");
        return;
      }

      if (lQty > 0) {
        const compSid = parseInt(el('comp-sid').value.trim());
        const cerr = checkQty(compSid, lQty);
        if (cerr) { alert(cerr); return; }
      }

      const oldDelay = state.scheduleRuns[editStepIdx][0];
      const prevDelay = editStepIdx ? state.scheduleRuns[editStepIdx - 1][0] : 0.0;
      const newDelay = editStepIdx ? (prevDelay + newGap) : newGap;
      const diff = newDelay - oldDelay;

      state.scheduleRuns[editStepIdx][1] = vQty;

      if (el('comp-enabled').checked) {
        if (lQty > 0) state.companionLikes[editStepIdx] = lQty;
        else delete state.companionLikes[editStepIdx];
      }

      if (shift) {
        for (let j = editStepIdx; j < state.scheduleRuns.length; j++) {
          state.scheduleRuns[j][0] += diff;
        }
      } else {
        state.scheduleRuns[editStepIdx][0] = newDelay;
        // Sort preserving companion map attached to each run (exact desktop parity lines 1864-1868)
        const decorated = state.scheduleRuns.map((r, idx) => [r[0], r[1], state.companionLikes[idx] || null]);
        decorated.sort((a, b) => a[0] - b[0]);
        state.scheduleRuns = decorated.map(x => [x[0], x[1]]);
        state.companionLikes = {};
        decorated.forEach((x, idx) => {
          if (x[2] !== null) state.companionLikes[idx] = x[2];
        });
      }

      el('modal-edit').classList.add('hidden');
      renderAutoTable();
      updateAutoStats();
    });

    // --- ADD RUN MODAL ---
    el('btn-add-cancel').addEventListener('click', () => el('modal-add').classList.add('hidden'));

    el('btn-add-save').addEventListener('click', () => {
      const vQty = parseInt(el('add-views-qty').value.trim()) || 0;
      const gapTxt = el('add-gap').value.trim() || '30m';
      const lQtyTxt = el('add-likes-qty').value.trim();
      const lQty = lQtyTxt ? parseInt(lQtyTxt) : null;

      if (vQty <= 0) {
        alert("Views quantity must be 1 or more.");
        return;
      }
      const sid = parseInt(el('auto-sid').value.trim());
      const err = checkQty(sid, vQty);
      if (err) { alert(err); return; }

      let gapMins;
      try {
        gapMins = parseDuration(gapTxt);
      } catch {
        alert("Gap should look like 30m, 1h, 45m.");
        return;
      }

      if (lQty !== null && lQty > 0) {
        const compSid = parseInt(el('comp-sid').value.trim());
        const cerr = checkQty(compSid, lQty);
        if (cerr) { alert(cerr); return; }
      }

      const lastDelay = state.scheduleRuns.length ? state.scheduleRuns[state.scheduleRuns.length - 1][0] : 0.0;
      const newDelay = lastDelay + gapMins;

      // Add run and preserve companion map
      const decorated = state.scheduleRuns.map((r, idx) => [r[0], r[1], state.companionLikes[idx] || null]);
      decorated.push([newDelay, vQty, lQty]);
      decorated.sort((a, b) => a[0] - b[0]);

      state.scheduleRuns = decorated.map(x => [x[0], x[1]]);
      state.companionLikes = {};
      decorated.forEach((x, idx) => {
        if (x[2] !== null && x[2] > 0) state.companionLikes[idx] = x[2];
      });

      el('modal-add').classList.add('hidden');
      renderAutoTable();
      updateAutoStats();
    });

    // --- STEP ACTIONS MODAL (MY PLANS) ---
    el('btn-step-cancel').addEventListener('click', () => el('modal-step').classList.add('hidden'));
  }

  // Table row actions
  window.anoxyEditStep = function (i) {
    editStepIdx = i;
    const run = state.scheduleRuns[i];
    const prev = i ? state.scheduleRuns[i - 1][0] : 0.0;
    const gapMins = i ? (run[0] - prev) : run[0];

    el('modal-edit-title').textContent = `Edit run ${i + 1}`;
    el('edit-views-qty').value = run[1];
    el('edit-gap').value = gapToken(gapMins);
    el('modal-edit-gap-lbl').textContent = i ? "Gap after previous run (e.g. 30m, 1h)" : "Start in (minutes from start)";

    const compOn = el('comp-enabled').checked;
    el('edit-likes-group').style.display = compOn ? 'block' : 'none';
    el('edit-likes-qty').value = state.companionLikes[i] || 0;

    // Shift checkbox visible if not last run
    el('edit-shift-group').style.display = (i < state.scheduleRuns.length - 1) ? 'flex' : 'none';
    el('edit-shift-chk').checked = true;

    el('modal-edit').classList.remove('hidden');
  };

  window.anoxyEditLikes = function (i) {
    const curQ = state.companionLikes[i] || 25;
    const ans = prompt(`Set like quantity for run ${i + 1} (0 to remove):`, curQ);
    if (ans === null) return;
    const q = parseInt(ans.trim());
    if (isNaN(q) || q < 0) {
      alert("Quantity must be 0 or a positive whole number.");
      return;
    }
    if (q === 0) {
      delete state.companionLikes[i];
    } else {
      const compSid = parseInt(el('comp-sid').value.trim());
      const err = checkQty(compSid, q);
      if (err) { alert(err); return; }
      state.companionLikes[i] = q;
    }
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyAddLikes = function (i) {
    const compSid = parseInt(el('comp-sid').value.trim());
    const compS = state.services[compSid];
    const sMin = compS ? compS.min : 1;
    const sMax = compS ? compS.max : 1e9;
    let defQ = parseInt(el('comp-drop-qty').value.trim()) || 25;
    if (defQ < sMin) defQ = sMin;
    if (defQ > sMax) defQ = sMax;

    state.companionLikes[i] = defQ;
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyDeleteStep = function (i) {
    state.scheduleRuns.splice(i, 1);
    // Re-index companion map (shift keys down, exact desktop auto_delete parity lines 1910-1925)
    const newMap = {};
    for (const [k, v] of Object.entries(state.companionLikes)) {
      const ki = parseInt(k);
      if (ki < i) newMap[ki] = v;
      else if (ki > i) newMap[ki - 1] = v;
    }
    state.companionLikes = newMap;
    renderAutoTable();
    updateAutoStats();
  };

  // --- IMPORT / EXPORT (Exact desktop parity lines 1927-2005) ---
  function exportSchedule() {
    if (!state.scheduleRuns.length) {
      alert("No schedule to export.");
      return;
    }
    const data = {
      app: "anoxy_schedular",
      version: 2,
      runs: state.scheduleRuns,
      preset: state.activePreset,
      total_views: el('auto-total-views').value.trim(),
      duration: getSelectedPillVal('auto-dur-pills'),
      custom_dur: el('auto-custom-dur').value.trim(),
      nruns: getSelectedPillVal('auto-runs-pills'),
      custom_nruns: el('auto-custom-runs').value.trim(),
      spread: el('auto-spread-chk').checked,
      variance: parseInt(el('auto-var-slider').value) || 20,
      comp_enabled: el('comp-enabled').checked,
      comp_sid: el('comp-sid').value.trim(),
      comp_total: el('comp-total-qty').value.trim(),
      comp_qty: el('comp-drop-qty').value.trim(),
      comp_duration: getSelectedPillVal('comp-dur-pills'),
      comp_custom_dur: el('comp-custom-dur').value.trim(),
      comp_nruns: getSelectedPillVal('comp-runs-pills'),
      comp_custom_runs: el('comp-custom-runs').value.trim(),
      comp_interval: getSelectedPillVal('comp-int-pills'),
      comp_custom_int: el('comp-custom-int').value.trim(),
      comp_variance: parseInt(el('comp-var-slider').value) || 20,
      comp_map: state.companionLikes
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anoxy_schedule_${state.activePreset}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log(`Exported schedule (${state.scheduleRuns.length} runs).`);
  }

  function importSchedule(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = JSON.parse(evt.target.result);
        if (!Array.isArray(data.runs)) throw new Error("Invalid schedule file format.");

        state.scheduleRuns = data.runs;
        if (data.total_views) el('auto-total-views').value = data.total_views;
        if (data.duration) setSelectedPill('auto-dur-pills', data.duration);
        if (data.custom_dur) el('auto-custom-dur').value = data.custom_dur;
        if (data.nruns) setSelectedPill('auto-runs-pills', data.nruns);
        if (data.custom_nruns) el('auto-custom-runs').value = data.custom_nruns;
        if (data.variance !== undefined) {
          el('auto-var-slider').value = data.variance;
          el('auto-var-lbl').textContent = `±${data.variance}%`;
        }

        if (data.comp_enabled) {
          el('comp-enabled').checked = true;
          el('comp-box').style.display = 'flex';
          if (data.comp_sid) el('comp-sid').value = data.comp_sid;
          if (data.comp_total) el('comp-total-qty').value = data.comp_total;
          if (data.comp_qty) el('comp-drop-qty').value = data.comp_qty;
          if (data.comp_duration) setSelectedPill('comp-dur-pills', data.comp_duration);
          if (data.comp_custom_dur) el('comp-custom-dur').value = data.comp_custom_dur;
          if (data.comp_nruns) setSelectedPill('comp-runs-pills', data.comp_nruns);
          if (data.comp_custom_runs) el('comp-custom-runs').value = data.comp_custom_runs;
          if (data.comp_interval) setSelectedPill('comp-int-pills', data.comp_interval);
          if (data.comp_custom_int) el('comp-custom-int').value = data.comp_custom_int;
          if (data.comp_variance !== undefined) {
            el('comp-var-slider').value = data.comp_variance;
            el('comp-var-lbl').textContent = `±${data.comp_variance}%`;
          }
          state.companionLikes = data.comp_map || {};
        }

        renderAutoTable();
        updateAutoStats();
        log(`Imported schedule (${state.scheduleRuns.length} runs).`);
      } catch (err) {
        alert("Failed to import schedule: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ================================================================
  //  TAB 4: MY PLANS & STEP ACTIONS
  // ================================================================
  function initPlans() {
    el('btn-plan-refresh').addEventListener('click', refreshPlans);
    el('btn-plan-cancel').addEventListener('click', cancelSelectedPlan);

    // Step actions (exact desktop parity lines 2269-2276)
    el('btn-step-qty').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only a 'pending' step can be edited."); return; }
      const ans = prompt("New quantity for this step:", step.quantity);
      if (ans === null) return;
      const q = parseInt(ans.trim());
      if (isNaN(q) || q <= 0) { alert("Quantity must be a whole number, 1 or more."); return; }
      const err = checkQty(step.service_id, q);
      if (err) { alert(err); return; }
      updateCloudStep(step.id, { quantity: q });
    });

    el('btn-step-move').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only a 'pending' step can be moved."); return; }
      const ans = prompt("Run this step in how many minutes from now (e.g. 5m, 1h, 30m):", "10m");
      if (ans === null) return;
      try {
        const mins = parseDuration(ans.trim());
        const newRunAt = Date.now() + mins * 60000;
        updateCloudStep(step.id, { run_at: newRunAt });
      } catch (e) {
        alert(e.message);
      }
    });

    el('btn-step-shift').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only pending steps can be shifted."); return; }
      const ans = prompt("Shift this step and all later pending steps by how much (e.g. 15m, 1h, -10m):", "15m");
      if (ans === null) return;
      try {
        let mins;
        const trimmed = ans.trim();
        if (trimmed.startsWith('-')) mins = -parseDuration(trimmed.slice(1));
        else mins = parseDuration(trimmed);

        const delta = mins * 60000;
        shiftLaterSteps(step, delta);
      } catch (e) {
        alert(e.message);
      }
    });

    el('btn-step-del').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a step first."); return; }
      if (step.status !== 'pending') { alert("Only a 'pending' step can be deleted."); return; }
      if (!confirm(`Delete step #${step.step_no} (${step.quantity} items)?`)) return;
      updateCloudStep(step.id, { status: 'cancelled' });
    });
  }

  function getSelectedStep() {
    if (!state.selectedStepId) return null;
    return state.steps.find(s => s.id === state.selectedStepId || String(s.step_no) === String(state.selectedStepId));
  }

  async function updateCloudStep(stepId, fields) {
    try {
      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: stepId, ...fields })
      });
      log(`Step updated in 24/7 Cloud.`);
      refreshPlans();
    } catch (err) {
      alert("Error updating step: " + err.message);
    }
  }

  async function shiftLaterSteps(baseStep, deltaMs) {
    const planSteps = state.steps.filter(s => s.plan_id === baseStep.plan_id && s.status === 'pending');
    const toShift = planSteps.filter(s => s.step_no >= baseStep.step_no);
    for (const s of toShift) {
      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: s.id, run_at: s.run_at + deltaMs })
      });
    }
    log(`Shifted ${toShift.length} step(s) in cloud.`);
    refreshPlans();
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
        <tr data-pid="${p.id}" class="plan-row ${state.selectedPlanId === p.id ? 'selected' : ''}" style="cursor: pointer;">
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
      const sid = s.id || s.step_no;

      html += `
        <tr data-stepid="${sid}" class="step-row ${state.selectedStepId === sid ? 'selected' : ''}" style="cursor: pointer;">
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

    tbody.querySelectorAll('.step-row').forEach(row => {
      row.addEventListener('click', () => {
        tbody.querySelectorAll('.step-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        state.selectedStepId = row.dataset.stepid;
      });
    });
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

})();
