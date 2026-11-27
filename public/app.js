/**
 * Anoxy Schedular - Cloud Web App Client
 * Exact 1:1 Logic and Behavioral Parity with desktop anoxy_schedular.py
 */

(function () {
  'use strict';

  // --- CONSTANTS (Matching desktop anoxy_schedular.py lines 266-270) ---
  const UNITS = { s: 1 / 60, m: 1, h: 60, d: 1440 };
  const FINAL_STATUSES = new Set(['completed', 'canceled', 'cancelled', 'partial', 'refunded', 'fail', 'failed']);

  const COMPANION_TYPES = [
    {
      key: 'likes',
      slotTitle: 'Pair 2nd service (ride-along Likes)',
      desc: 'Drops likes at the exact same timestamp as views, once every 1h (customisable).',
      label: 'Likes',
      singular: 'like',
      icon: '♥',
      prefix: 'comp',
      accent: 'var(--accent)',
      badgeBg: '#eef2fe',
      badgeClass: 'h-badge',
      keywords: ['like'],
      exclude: ['dislike']
    },
    {
      key: 'shares',
      slotTitle: 'Pair 3rd service (ride-along Shares)',
      desc: 'Drops shares at the exact same timestamp as views, once every 1h (customisable).',
      label: 'Shares',
      singular: 'share',
      icon: '↗',
      prefix: 'share',
      accent: '#0284c7',
      badgeBg: '#e0f2fe',
      badgeClass: 's-badge',
      keywords: ['share', 'repost'],
      exclude: []
    },
    {
      key: 'saves',
      slotTitle: 'Pair 4th service (ride-along Saves)',
      desc: 'Drops saves at the exact same timestamp as views, once every 1h (customisable).',
      label: 'Saves',
      singular: 'save',
      icon: '🔖',
      prefix: 'save',
      accent: '#7c3aed',
      badgeBg: '#f3e8ff',
      badgeClass: 'v-badge',
      keywords: ['save', 'bookmark'],
      exclude: []
    },
    {
      key: 'comments',
      slotTitle: 'Pair 5th service (ride-along Comments / Custom Comments)',
      desc: 'Drops comments (or exact custom comment lines) at the same timestamp as views.',
      label: 'Comments',
      singular: 'comment',
      icon: '💬',
      prefix: 'comment',
      accent: '#0d9488',
      badgeBg: '#ccfbf1',
      badgeClass: 'c-badge',
      keywords: ['comment'],
      exclude: [],
      supportsCustomComments: true
    }
  ];

  function getCompCfg(key) {
    return COMPANION_TYPES.find(c => c.key === key) || COMPANION_TYPES[0];
  }

  function getCompLimits(cfgOrKey, compSidTxt) {
    const cfg = typeof cfgOrKey === 'string' ? getCompCfg(cfgOrKey) : cfgOrKey;
    const raw = compSidTxt !== undefined && compSidTxt !== null ? String(compSidTxt).trim() : '';
    const csid = /^\d+$/.test(raw) ? parseInt(raw) : null;
    const compS = csid ? (state.services[csid] || state.services[String(csid)]) : null;
    const sMin = (compS && compS.min) ? Math.max(1, parseInt(compS.min) || 1) : 10;
    const sMax = (compS && compS.max) ? Math.max(sMin, parseInt(compS.max) || 1e9) : 1e9;
    return { csid, compS, sMin, sMax };
  }

  function getCompIds(cfgOrKey) {
    const c = typeof cfgOrKey === 'string' ? getCompCfg(cfgOrKey) : cfgOrKey;
    const p = c.prefix;
    return {
      enabled: `${p}-enabled`,
      box: `${p}-box`,
      sid: `${p}-sid`,
      rate: `${p}-rate`,
      svcInfo: `${p}-svc-info`,
      totalQty: `${p}-total-qty`,
      dropQty: `${p}-drop-qty`,
      minQty: c.key === 'likes' ? 'comp-min-likes' : `${p}-min`,
      maxQty: c.key === 'likes' ? 'comp-max-likes' : `${p}-max`,
      limitBadge: `${p}-limit-badge`,
      durPills: `${p}-dur-pills`,
      customDur: `${p}-custom-dur`,
      runsPills: `${p}-runs-pills`,
      customRuns: `${p}-custom-runs`,
      intSec: `${p}-interval-section`,
      intPills: `${p}-int-pills`,
      customInt: `${p}-custom-int`,
      varSlider: `${p}-var-slider`,
      varLbl: `${p}-var-lbl`,
      repairBtn: `btn-${p}-repair`,
      editGroup: `edit-${c.key}-group`,
      editQty: `edit-${c.key}-qty`,
      addGroup: `add-${c.key}-group`,
      addQty: `add-${c.key}-qty`
    };
  }

  // --- STATE ---
  const state = {
    user: null,
    services: {},       // { [service_id]: { service, name, rate, min, max, category } }
    balance: null,
    currency: 'USD',
    scheduleRuns: [],   // [ [delayMinutes, quantity], ... ]
    companions: { likes: {}, shares: {}, saves: {}, comments: {} }, // { [typeKey]: { [runIndex]: quantity } }
    customCommentsMap: {}, // { [runIndex]: string[] } for Custom Comments lines
    activePreset: '10k',
    plans: [],
    steps: [],
    providerStatuses: {}, // { [order_id]: 'In progress' | 'Completed' | ... }
    isDispatching: false,
    isPollingStatus: false,
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
  //  PARSERS & FORMATTERS (Exact Python desktop parity lines 272-343)
  // ================================================================

  /**
   * parseDuration: Parses duration tokens like '1h', '30m', '1h30m', '90s', '1d2h'.
   * Matches desktop parse_duration (line 272).
   */
  function parseDuration(text) {
    if (!text) throw new Error("Duration cannot be empty");
    const s = String(text).trim().toLowerCase();
    const tokenRe = /(\d+(?:\.\d+)?)\s*([smhd])/g;
    let total = 0.0, matchedAny = false, lastIndex = 0, m;

    while ((m = tokenRe.exec(s)) !== null) {
      if (m.index !== lastIndex) {
        const skipped = s.slice(lastIndex, m.index).trim();
        if (skipped) throw new Error(`Unexpected text in duration: '${skipped}'`);
      }
      matchedAny = true;
      lastIndex = tokenRe.lastIndex;
      const val = parseFloat(m[1]);
      const unit = m[2];
      total += val * UNITS[unit];
    }

    if (!matchedAny || lastIndex < s.length) {
      // Fallback for pure numbers (default unit: minutes)
      if (/^\d+(?:\.\d+)?$/.test(s)) {
        return parseFloat(s);
      }
      throw new Error(`Invalid duration: '${text}'. Use formats like 30m, 1h, 1h30m, 2d.`);
    }
    return Math.max(0, Math.round(total * 100) / 100);
  }

  /**
   * parseGap: '30m' -> 30.0 ; '1h30m' -> 90.0 ; '20m-45m' -> random between them.
   * Matches desktop parse_gap (line 276).
   */
  function parseGap(tok) {
    const t = String(tok).trim().toLowerCase();
    if (t.includes('-')) {
      const parts = t.split('-');
      if (parts.length !== 2) throw new Error(`Invalid gap range '${tok}'`);
      const lo = parseDuration(parts[0]);
      const hi = parseDuration(parts[1]);
      if (lo > hi) throw new Error(`Gap range low > high in '${tok}'`);
      return lo + Math.random() * (hi - lo);
    }
    return parseDuration(t);
  }

  /**
   * parseCycle: A repeating pattern for Auto plan. Each item is [quantity, gap_after]
   * where gap_after is [lo, hi] range in minutes, or null (default gap filled in later).
   * Matches desktop parse_cycle (lines 315-343).
   */
  function parseCycle(text) {
    const tokens = String(text).toLowerCase().replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    const items = [];
    let i = 0;
    const n = tokens.length;

    while (i < n) {
      const qtok = tokens[i];
      const q = parseInt(qtok, 10);
      if (isNaN(q) || q < 1 || String(q) !== qtok) {
        throw new Error(`Expected a quantity (1 or more) at token ${i + 1}, got '${qtok}'.`);
      }
      i++;
      let gap = null;
      if (i < n && !/^\d+$/.test(tokens[i])) {
        const tok = tokens[i];
        if (tok.includes('-')) {
          const parts = tok.split('-', 2);
          const lo = parseDuration(parts[0]);
          const hi = parseDuration(parts[1]);
          gap = lo <= hi ? [lo, hi] : [hi, lo];
        } else {
          const d = parseDuration(tok);
          gap = [d, d];
        }
        i++;
      }
      items.push([q, gap]);
    }
    if (!items.length) {
      throw new Error("No quantities found. Example: 3 50m 5 60m 7 65m");
    }
    return items;
  }

  /**
   * parsePlanSyntax: '2 1h 5 30m 10' -> [[0, 2], [60, 5], [90, 10]].
   * Matches desktop parse_plan (lines 288-312).
   */
  function parsePlanSyntax(text, defaultGapStr = "1h") {
    let defaultGap = 60;
    try { defaultGap = parseGap(defaultGapStr); } catch (e) { /* fallback 60 */ }

    const tokens = String(text).toLowerCase().replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    const plan = [];
    let elapsed = 0.0;
    let gap = null;

    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        if (plan.length) {
          elapsed += (gap !== null ? gap : defaultGap);
        } else {
          elapsed += (gap || 0);
        }
        plan.push([Math.round(elapsed * 100) / 100, parseInt(tok, 10)]);
        gap = null;
      } else {
        try {
          const gVal = parseGap(tok);
          gap = (gap || 0) + gVal;
        } catch (e) {
          throw new Error(`Can't understand '${tok}'. Use quantities and time tokens (e.g. 2 1h 5 20m-45m 10).`);
        }
      }
    }
    if (!plan.length) {
      throw new Error("No quantities found. Example: 2 1h 5 30m 10");
    }
    return plan;
  }

  /**
   * fmtGap: 52.4 -> '52m' ; 65 -> '1h 05m' ; 120 -> '2h' ; 0.5 -> '30s'.
   * Matches desktop fmt_gap (lines 472-480).
   */
  function fmtGap(minutes) {
    if (minutes < 1) {
      return `${Math.round(minutes * 60)}s`;
    }
    const mins = Math.round(minutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) {
      return `${h}h ${String(m).padStart(2, '0')}m`;
    }
    return h ? `${h}h` : `${m}m`;
  }

  /**
   * gapToken: Minutes -> text the parser accepts: 52.4 -> '52m', 125 -> '2h5m', 0 -> '0m'.
   * Matches desktop gap_token (lines 483-497).
   */
  function gapToken(minutes) {
    const secs = minutes >= 1 ? Math.round(minutes) * 60 : Math.round(minutes * 60);
    if (secs <= 0) return "0m";
    const d = Math.floor(secs / 86400);
    let rem = secs % 86400;
    const h = Math.floor(rem / 3600);
    rem = rem % 3600;
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (s) parts.push(`${s}s`);
    return parts.join('') || "0m";
  }

  // ================================================================
  //  SCHEDULE GENERATION ALGORITHMS (Exact desktop parity lines 345-470)
  // ================================================================

  /**
   * generateSchedule: Repeats cycle until durationMinutes have elapsed.
   * Matches desktop generate_schedule (lines 345-368).
   */
  function generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns = 800) {
    const defaultGap = [defaultGapMinutes, defaultGapMinutes];
    const filled = cycle.map(([q, g]) => [q, g !== null ? g : defaultGap]);
    const v = Math.max(0.0, variancePct) / 100.0;
    const runs = [];
    let elapsed = 0.0, idx = 0;

    while (elapsed < durationMinutes && runs.length < maxRuns) {
      const [q, [lo, hi]] = filled[idx % filled.length];
      const factor = v > 0 ? (1 - v + Math.random() * 2 * v) : 1;
      const qty = Math.max(1, Math.round(q * factor));
      runs.push([Math.round(elapsed * 100) / 100, qty]);

      let gap;
      if (hi > lo) {
        gap = lo + Math.random() * (hi - lo);
      } else if (v > 0) {
        gap = lo * (1 - v + Math.random() * 2 * v);
      } else {
        gap = lo;
      }
      elapsed += Math.max(1.0, gap);
      idx++;
    }
    return runs;
  }

  /**
   * fitTotal: Cuts the schedule off the moment total is reached; tops up if it fell short;
   * folds a leftover below service minimum into the run before it.
   * Matches desktop fit_total (lines 371-385).
   */
  function fitTotal(runs, total, minQ = 1, maxQ = 1e9) {
    const out = [];
    let acc = 0;
    for (const [d, qRaw] of runs) {
      if (acc >= total) break;
      const q = Math.min(qRaw, total - acc);
      out.push([d, q]);
      acc += q;
    }
    if (out.length && acc < total) {
      out[out.length - 1][1] += total - acc;
    }
    // A tiny leftover below the service minimum is folded into the run before it (line 383)
    if (out.length > 1 && out[out.length - 1][1] < minQ && (out[out.length - 2][1] + out[out.length - 1][1] <= maxQ)) {
      out[out.length - 2][1] += out.pop()[1];
    }
    return out;
  }

  /**
   * generateForTotal: Delivers exactly total inside durationMinutes.
   * spread=false: follows pattern and gaps, stops as soon as total is reached.
   * spread=true : keeps pattern quantities but spaces runs evenly across the window.
   * Matches desktop generate_for_total (lines 388-428).
   */
  function generateForTotal(cycle, durationMinutes, variancePct, defaultGapMinutes, total, minQ = 1, maxQ = 1e9, spread = false, maxRuns = 800) {
    const v = Math.max(0.0, variancePct) / 100.0;
    if (spread) {
      const qtys = [];
      let idx = 0, acc = 0;
      while (acc < total) {
        let q = cycle[idx % cycle.length][0];
        if (v > 0) {
          q = Math.max(1, Math.round(q * (1 - v + Math.random() * 2 * v)));
        }
        q = Math.max(minQ, Math.min(q, maxQ));
        q = qtys.length >= maxRuns - 1 ? (total - acc) : Math.min(q, total - acc);
        qtys.push(q);
        acc += q;
        idx++;
      }
      if (qtys.length > 1 && qtys[qtys.length - 1] < minQ && (qtys[qtys.length - 2] + qtys[qtys.length - 1] <= maxQ)) {
        qtys[qtys.length - 2] += qtys.pop();
      }
      const step = durationMinutes / qtys.length;
      const runs = [];
      let last = -1.0;
      for (let i = 0; i < qtys.length; i++) {
        const jitter = (Math.random() * 2 * v - v) * step;
        const d = (i === 0) ? 0.0 : Math.max(last + 1.0, i * step + jitter);
        runs.push([Math.round(d * 100) / 100, qtys[i]]);
        last = d;
      }
      return runs;
    }

    function clamp(rs) {
      rs.forEach(r => { r[1] = Math.max(minQ, Math.min(r[1], maxQ)); });
      return rs;
    }

    let runs = clamp(generateSchedule(cycle, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
    const natural = runs.reduce((a, [, q]) => a + q, 0);
    if (natural < total) {
      const factor = total / Math.max(1, natural);
      const scaled = cycle.map(([q, g]) => [q * factor, g]);
      runs = clamp(generateSchedule(scaled, durationMinutes, variancePct, defaultGapMinutes, maxRuns));
    }
    return fitTotal(runs, total, minQ, maxQ);
  }

  /**
   * generateForRuns: Exactly nRuns runs, spaced evenly across the delivery time (with random jitter).
   * Matches desktop generate_for_runs (lines 431-470).
   */
  function generateForRuns(cycle, durationMinutes, variancePct, nRuns, total = null, minQ = 1, maxQ = 1e9) {
    const v = Math.max(0.0, variancePct) / 100.0;
    const n = nRuns;
    minQ = Math.max(1, minQ);
    if (durationMinutes / n < 1) {
      throw new Error(`${n} runs is too many for this delivery time (gaps would be under a minute).`);
    }

    const weights = [];
    for (let i = 0; i < n; i++) {
      const base = cycle[i % cycle.length][0];
      const jitter = v > 0 ? (1 - v + Math.random() * 2 * v) : 1;
      weights.push(base * jitter);
    }

    let qtys;
    if (total === null) {
      qtys = weights.map(w => Math.max(minQ, Math.min(maxQ, Math.max(1, Math.round(w)))));
    } else {
      if (total < n * minQ) {
        throw new Error(`A total of ${total} is too small for ${n} runs (each run needs at least ${minQ}).`);
      }
      const rem = total - n * minQ;
      const sw = weights.reduce((a, b) => a + b, 0);
      const raw = weights.map(w => rem * w / (sw || 1));
      qtys = raw.map(x => minQ + Math.floor(x));

      const indices = Array.from({ length: n }, (_, i) => i);
      indices.sort((a, b) => (raw[b] - Math.floor(raw[b])) - (raw[a] - Math.floor(raw[a])));
      const diff = total - qtys.reduce((a, b) => a + b, 0);
      for (let k = 0; k < diff; k++) {
        qtys[indices[k]] += 1;
      }

      // Respect service maximum by moving excess to runs with room (lines 455-462)
      for (let i = 0; i < n; i++) {
        while (qtys[i] > maxQ) {
          let minIdx = 0;
          for (let k = 1; k < n; k++) {
            if (qtys[k] < qtys[minIdx]) minIdx = k;
          }
          if (qtys[minIdx] >= maxQ) {
            throw new Error(`A total of ${total} does not fit into ${n} runs of at most ${maxQ}.`);
          }
          const move = Math.min(qtys[i] - maxQ, maxQ - qtys[minIdx]);
          qtys[i] -= move;
          qtys[minIdx] += move;
        }
      }
    }

    const step = durationMinutes / n;
    const runs = [];
    let last = -1.0;
    for (let i = 0; i < n; i++) {
      const jitter = (Math.random() * 2 * v - v) * step;
      const d = (i === 0) ? 0.0 : Math.max(last + 1.0, i * step + jitter);
      runs.push([Math.round(d * 100) / 100, qtys[i]]);
      last = d;
    }
    return runs;
  }

  // --- SERVICE LIMITS VALIDATION (Exact desktop check_qty lines 2363-2367) ---
  function checkQty(sid, qty) {
    if (!sid || isNaN(sid)) return null;
    const s = state.services[parseInt(sid)] || state.services[String(sid)];
    if (s) {
      if (qty < s.min || qty > s.max) {
        return `Quantity ${qty} is outside this service's limits (${s.min} to ${s.max}).`;
      }
    } else {
      if (qty < 1) return `Quantity must be 1 or more.`;
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

  function parseCustomCommentLines(rawText) {
    return String(rawText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  function isCustomCommentsService(svc) {
    if (!svc) return false;
    const t = (svc.type || '').toLowerCase();
    const n = (svc.name || '').toLowerCase();
    return t.includes('custom') || n.includes('custom comment');
  }

  function updateCommentLinesBadge() {
    const lbl = el('comment-lines-lbl');
    const ta = el('comment-custom-list');
    if (!lbl || !ta) return;
    const n = parseCustomCommentLines(ta.value).length;
    lbl.textContent = `${n} line${n === 1 ? '' : 's'}`;
  }

  function updateCommentTypeHint(svc) {
    const hint = el('comment-type-hint');
    if (!hint) return;
    if (svc && isCustomCommentsService(svc)) {
      hint.style.color = '#0d9488';
      hint.textContent = `✓ Panel type "${svc.type || 'Custom Comments'}" detected — paste comments above (1 line = 1 comment).`;
    } else if (svc) {
      hint.style.color = 'var(--muted)';
      hint.textContent = `Service type: ${svc.type || 'Default'} — sends numeric quantity (or exact comment lines if filled above).`;
    } else {
      hint.style.color = 'var(--muted)';
      hint.textContent = 'When lines are filled above, each drop sends those exact comment lines (`comments` param) matching its drop qty.';
    }
  }

  function applyCompanionServiceToUI(typeKey, sid, { enableBox = false, repairIfSchedule = false, overwriteRate = false } = {}) {
    const cfg = getCompCfg(typeKey);
    const ids = getCompIds(cfg);
    const s = state.services[parseInt(sid)] || state.services[String(sid)];
    if (el(ids.sid) && String(el(ids.sid).value).trim() !== String(sid)) {
      el(ids.sid).value = sid;
    }
    if (s) {
      if (el(ids.svcInfo)) {
        el(ids.svcInfo).style.color = 'var(--muted)';
        el(ids.svcInfo).textContent = `${s.name.slice(0, 24)} (min ${s.min}, max ${s.max}, rate ${s.rate})`;
      }
      if (el(ids.limitBadge)) el(ids.limitBadge).textContent = `Min ${s.min} – Max ${s.max}`;
      if (el(ids.minQty)) {
        el(ids.minQty).placeholder = s.min;
        const curUmin = parseInt((el(ids.minQty).value || '').trim());
        if (!isNaN(curUmin) && curUmin < s.min) el(ids.minQty).value = s.min;
      }
      if (el(ids.rate) && (overwriteRate || !el(ids.rate).value)) el(ids.rate).value = s.rate;
      if (el(ids.dropQty)) {
        el(ids.dropQty).placeholder = `Min ${s.min}`;
        const curDropQ = parseInt((el(ids.dropQty).value || '').trim()) || 0;
        if (overwriteRate || !el(ids.dropQty).value.trim() || curDropQ < s.min) {
          el(ids.dropQty).value = s.min;
        }
      }
    } else {
      if (el(ids.svcInfo)) {
        el(ids.svcInfo).style.color = 'var(--muted)';
        el(ids.svcInfo).textContent = '';
      }
      if (el(ids.limitBadge)) el(ids.limitBadge).textContent = '';
    }
    if (cfg.supportsCustomComments) {
      updateCommentTypeHint(s || null);
    }
    if (enableBox) {
      if (el(ids.enabled)) el(ids.enabled).checked = true;
      if (el(ids.box)) el(ids.box).style.display = 'flex';
    }
    if (repairIfSchedule && el(ids.enabled)?.checked && state.scheduleRuns.length) {
      rePairCompanion(typeKey, false);
    } else if (enableBox || repairIfSchedule) {
      updateAutoStats();
    }
  }

  function resetCompanionMaps() {
    COMPANION_TYPES.forEach(c => { state.companions[c.key] = {}; });
    state.customCommentsMap = {};
  }

  function rePairAllEnabledCompanions() {
    let anyEnabled = false;
    COMPANION_TYPES.forEach(c => {
      const ids = getCompIds(c);
      if (el(ids.enabled)?.checked) {
        anyEnabled = true;
        rePairCompanion(c.key, false);
      }
    });
    if (!anyEnabled) {
      renderAutoTable();
      updateAutoStats();
    }
  }

  // ================================================================
  //  APP INITIALIZATION & EVENT LISTENERS
  // ================================================================

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const cached = localStorage.getItem('anoxy_cached_services');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          state.services = {};
          parsed.forEach(item => {
            if (Array.isArray(item) && item.length >= 5) {
              const sid = parseInt(item[0]);
              state.services[sid] = {
                service: sid,
                name: item[1] || '',
                rate: parseFloat(item[2]) || 0,
                min: Math.max(1, parseInt(item[3]) || 1),
                max: Math.max(1, parseInt(item[4]) || 1e9),
                category: item[5] || '',
                type: item[6] || 'Default'
              };
            }
          });
        } else if (parsed && typeof parsed === 'object') {
          state.services = parsed;
        }
        state.currency = localStorage.getItem('anoxy_cached_currency') || 'USD';
        renderServicesTable();
      }
      const cachedStatuses = localStorage.getItem('anoxy_provider_statuses');
      if (cachedStatuses) {
        state.providerStatuses = JSON.parse(cachedStatuses);
      }
    } catch (e) {}
    initAuth();
    initTabs();
    initSetup();
    initOrder();
    initAutoPlan();
    initPlans();
    initModals();

    // 1-second local due check (exact desktop worker() parity) — dispatches the INSTANT run_at <= now
    setInterval(async () => {
      const url = localStorage.getItem('anoxy_panel_url');
      const key = localStorage.getItem('anoxy_panel_key');
      if (!url || !key || !state.steps.length || state.isDispatching) return;

      const now = Date.now();
      const dueNow = state.steps.filter(s => s.status === 'pending' && Number(s.run_at) <= now);
      if (dueNow.length > 0) {
        state.isDispatching = true;
        try {
          dueNow.forEach(s => { s.status = 'sending'; });
          if (el('tab-plans') && el('tab-plans').classList.contains('active') && state.selectedPlanId) {
            renderStepsTable(state.selectedPlanId);
          }
          await triggerCloudCronDispatch();
        } finally {
          state.isDispatching = false;
        }
      }
    }, 1000);

    // 15-second background sync + live provider status poller ('In progress' -> 'Completed')
    setInterval(async () => {
      const url = localStorage.getItem('anoxy_panel_url');
      const key = localStorage.getItem('anoxy_panel_key');
      if (!url || !key) return;

      const plansTab = el('tab-plans');
      const plansActive = plansTab && plansTab.classList.contains('active');
      const hasActiveWork = state.steps.some(s =>
        s.status === 'pending' || s.status === 'sending' ||
        (s.status === 'sent' && !FINAL_STATUSES.has((getStepProviderStatus(s) || '').toLowerCase()))
      );

      if (plansActive) {
        await refreshPlans(true);
      } else if (hasActiveWork) {
        await refreshPlans(false);
      }
    }, 15000);
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

  function switchTab(name, shouldRefresh = true) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'plans' && shouldRefresh) refreshPlans(true);
  }

  // --- TAB 1: SETUP ---
  function initSetup() {
    localStorage.removeItem('anoxy_script_url');
    const savedUrl = localStorage.getItem('anoxy_panel_url');
    const savedKey = localStorage.getItem('anoxy_panel_key');
    if (savedUrl) el('setup-url').value = savedUrl;
    if (savedKey) el('setup-key').value = savedKey;

    el('setup-show-key').addEventListener('change', e => {
      el('setup-key').type = e.target.checked ? 'text' : 'password';
    });

    el('btn-save-connect').addEventListener('click', () => {
      let url = el('setup-url').value.trim();
      const key = el('setup-key').value.trim();
      if (!url || !key) {
        alert('Enter the API URL and API key.');
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
        el('setup-url').value = url;
      }
      localStorage.setItem('anoxy_panel_url', url);
      localStorage.setItem('anoxy_panel_key', key);
      connectPanel(url, key);
    });
  }

  let activeConnectPromise = null;

  function autoConnectPanel() {
    let url = (localStorage.getItem('anoxy_panel_url') || '').trim();
    const key = (localStorage.getItem('anoxy_panel_key') || '').trim();
    if (url && key) {
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }
      return connectPanel(url, key);
    }
    return Promise.resolve();
  }

  async function ensurePanelServicesLoaded() {
    if (activeConnectPromise) {
      await activeConnectPromise;
      return;
    }
    if (Object.keys(state.services || {}).length === 0) {
      await autoConnectPanel();
    }
  }

  function connectPanel(url, key) {
    activeConnectPromise = (async () => {
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
            body: JSON.stringify({ action: 'balance', api_url: url, apiUrl: url, api_key: key, apiKey: key })
          }),
          fetch('/api/panel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'services', api_url: url, apiUrl: url, api_key: key, apiKey: key })
          })
        ]);

        const balData = await balRes.json();
        const svcData = await svcRes.json();

        if (balData && balData.error) {
          throw new Error(balData.error);
        }
        if (svcData && svcData.error) {
          throw new Error(svcData.error);
        }

        state.balance = isNaN(parseFloat(balData.balance)) ? 0 : parseFloat(balData.balance);
        state.currency = balData.currency || 'USD';

        if (!Array.isArray(svcData)) {
          throw new Error('Panel returned invalid services format (expected array)');
        }

        state.services = {};
        const compactCache = [];
        svcData.forEach(s => {
          const sid = parseInt(s.service);
          if (isNaN(sid)) return;
          const minParsed = Math.max(1, parseInt(String(s.min ?? '1').replace(/[^\d]/g, '')) || 1);
          const maxParsed = Math.max(minParsed, parseInt(String(s.max ?? '1000000000').replace(/[^\d]/g, '')) || 1e9);
          const rateParsed = parseFloat(s.rate) || 0;
          const svcObj = {
            service: sid,
            name: s.name || '',
            rate: rateParsed,
            min: minParsed,
            max: maxParsed,
            category: s.category || '',
            type: s.type || 'Default'
          };
          state.services[sid] = svcObj;
          compactCache.push([sid, svcObj.name, rateParsed, minParsed, maxParsed, svcObj.category, svcObj.type]);
        });
        const count = Object.keys(state.services).length;
        el('setup-status').textContent = `Connected (${count} services, balance: ${state.balance} ${state.currency})`;
        el('setup-status').style.color = 'var(--success)';
        el('conn-dot').style.color = 'var(--success)';
        el('topbar-title').textContent = 'Connected';
        el('topbar-sub').textContent = `${count} services · balance ${state.balance} ${state.currency}`;
        log(`Connected to panel. Loaded ${count} services. Balance: ${state.balance} ${state.currency}.`);
        renderServicesTable();

        // Cache services compactly for instant startup retrieval
        try {
          localStorage.setItem('anoxy_cached_services', JSON.stringify(compactCache));
          localStorage.setItem('anoxy_cached_currency', state.currency || 'USD');
        } catch (e) {}

        // Update info labels and rates if SIDs are already entered
        const sid = parseInt(el('auto-sid').value.trim());
        if (sid && state.services[sid]) {
          const s = state.services[sid];
          const info = `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000`;
          el('auto-svc-info').textContent = info;
          el('order-svc-info').textContent = info;
          if (el('auto-rate') && !el('auto-rate').value) el('auto-rate').value = s.rate;
        }
        COMPANION_TYPES.forEach(c => {
          const ids = getCompIds(c);
          const csid = parseInt((el(ids.sid)?.value || '').trim());
          if (csid && state.services[csid]) {
            applyCompanionServiceToUI(c.key, csid, { overwriteRate: false });
          }
        });
        if (state.scheduleRuns.length) rePairAllEnabledCompanions();
        else updateAutoStats();
        refreshPlans(true);
      } catch (err) {
        el('setup-status').textContent = 'Connection failed: ' + err.message;
        el('setup-status').style.color = 'var(--danger)';
        el('conn-dot').style.color = 'var(--danger)';
        el('topbar-title').textContent = 'Connection failed';
        el('topbar-sub').textContent = err.message;
        log('Panel connection failed: ' + err.message);
      } finally {
        activeConnectPromise = null;
      }
    })();
    return activeConnectPromise;
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
    filtered.slice(0, 300).forEach(s => {
      const compBtns = COMPANION_TYPES.map(c =>
        `<button class="btn-small btn-pick-comp" data-sid="${s.service}" data-ctype="${c.key}" style="padding: 2px 5px; font-size: 10px; font-weight: 600; margin-left: 3px; background: ${c.badgeBg}; color: ${c.accent};">Use ${c.label}</button>`
      ).join('');
      html += `
        <tr data-sid="${s.service}" class="service-row" style="cursor: pointer;">
          <td style="font-weight: 700;">${s.service}</td>
          <td style="color: var(--muted); max-width: 120px; overflow: hidden; text-overflow: ellipsis;">${s.category}</td>
          <td style="max-width: 240px; overflow: hidden; text-overflow: ellipsis;">${s.name}</td>
          <td style="font-weight: 600;">${s.rate}</td>
          <td>${s.min}</td>
          <td>${s.max}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn-small btn-pick-views" data-sid="${s.service}" style="padding: 2px 7px; font-size: 10px; font-weight: 600;">Use Views</button>${compBtns}
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('.service-row').forEach(row => {
      const sid = parseInt(row.dataset.sid);
      const s = state.services[sid];
      const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';

      const pickViews = () => {
        tbody.querySelectorAll('.service-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        el('order-sid').value = sid;
        el('order-svc-info').textContent = info;
        el('auto-sid').value = sid;
        el('auto-svc-info').textContent = info;
        if (el('auto-rate')) el('auto-rate').value = s.rate;
        updateAutoStats();
      };

      const btnV = row.querySelector('.btn-pick-views');
      if (btnV) {
        btnV.addEventListener('click', e => {
          e.stopPropagation();
          pickViews();
        });
      }

      row.querySelectorAll('.btn-pick-comp').forEach(btnC => {
        btnC.addEventListener('click', e => {
          e.stopPropagation();
          const ctype = btnC.dataset.ctype;
          const cfg = getCompCfg(ctype);
          applyCompanionServiceToUI(ctype, sid, { enableBox: true, repairIfSchedule: true, overwriteRate: true });
          log(`Selected Service #${sid} (${s.name}) for ${cfg.label}.`);
        });
      });

      row.addEventListener('click', () => {
        pickViews();
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
      const sid = parseInt(val);
      const s = state.services[sid];
      const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';
      el('order-svc-info').textContent = info;
      el('auto-svc-info').textContent = info;
    });

    el('order-link').addEventListener('input', () => {
      el('auto-link').value = el('order-link').value;
    });

    // Preview button with full service limits validation and summary (exact desktop lines 2407-2415)
    el('btn-order-preview').addEventListener('click', () => {
      const r = validateManualOrder();
      if (!r) return;
      const { sid, plan } = r;
      const s = state.services[sid];
      const total = plan.reduce((a, [, q]) => a + q, 0);
      const now = Date.now();
      const lines = plan.map(([d, q], i) => `Step ${i + 1}: ${q} at ${new Date(now + d * 60000).toLocaleTimeString()} (+${Math.round(d)} min)`);
      if (s) {
        const cost = total * s.rate / 1000;
        lines.push(`Total ${total} | estimated cost ${cost.toFixed(4)} ${state.currency}`);
        if (state.balance !== null) lines.push(`Balance ${state.balance} ${state.currency}`);
      } else {
        lines.push(`Total ${total}`);
      }
      lines.push('(random ranges are picked again when you start)');
      el('order-prev-box').value = lines.join('\n');
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
    const sidTxt = el('order-sid').value.trim();
    if (!sidTxt || !/^\d+$/.test(sidTxt)) {
      alert('Pick a service or type its numeric ID.');
      return null;
    }
    const sid = parseInt(sidTxt);
    const link = el('order-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return null;
    }
    const plan = buildManualPlan();
    if (!plan) return null;

    // Strict validation of each step quantity against service min/max (desktop line 2385)
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
    try {
      return parsePlanSyntax(planTxt, defGapTxt);
    } catch (e) {
      alert(e.message);
      return null;
    }
  }

  function renderCompanionControls() {
    const container = el('companions-container');
    if (!container) return;

    container.innerHTML = COMPANION_TYPES.map(c => {
      const ids = getCompIds(c);
      const labelUp = c.label.toUpperCase();
      const lower = c.label.toLowerCase();
      return `
        <div style="background: #fafbfe; border: 1px solid var(--border); border-radius: 4px; padding: 8px;">
          <label style="font-size: 11.5px; font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer; color: ${c.accent};">
            <input id="${ids.enabled}" type="checkbox"> ${c.icon} ${c.slotTitle}
          </label>
          <div style="font-size: 10.5px; color: var(--muted); margin-top: 2px;">
            ${c.desc}
          </div>

          <div id="${ids.box}" style="display: none; margin-top: 8px; flex-direction: column; gap: 6px;">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 11px; width: 92px;">${c.label} Service ID:</span>
              <input id="${ids.sid}" type="text" class="input-entry" style="width: 70px;">
              <span style="font-size: 11px; color: var(--muted);">Rate/1k:</span>
              <input id="${ids.rate}" type="text" class="input-entry" placeholder="Auto" style="width: 55px; padding: 3px 5px; font-size: 11px;">
              <span id="${ids.svcInfo}" style="font-size: 10.5px; color: var(--muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
            </div>

            <div>
              <div style="font-size: 10px; font-weight: 700; color: var(--muted); margin-bottom: 2px;">TOTAL QUANTITY (${labelUp})</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <input id="${ids.totalQty}" type="text" class="input-entry" placeholder="Total (e.g. 1000)" style="width: 95px; padding: 3px 6px; font-size: 11.5px;">
                <span style="font-size: 11px; color: var(--muted);">or Qty/drop:</span>
                <input id="${ids.dropQty}" type="text" class="input-entry" value="" placeholder="Auto (min)" style="width: 72px; padding: 3px 6px; font-size: 11.5px;">
              </div>
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">
                Leave Total empty to use Qty/drop, or enter Total (e.g. 1000).
              </div>
            </div>

            <div>
              <div style="font-size: 10px; font-weight: 700; color: var(--muted); margin-bottom: 2px;">MIN & MAX ${labelUp} (PER DROP)</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11px; color: var(--muted);">Min:</span>
                <input id="${ids.minQty}" type="text" class="input-entry" placeholder="Min" style="width: 50px; padding: 3px 6px; font-size: 11.5px;">
                <span style="font-size: 11px; color: var(--muted);">Max:</span>
                <input id="${ids.maxQty}" type="text" class="input-entry" placeholder="Max" style="width: 50px; padding: 3px 6px; font-size: 11.5px;">
                <span id="${ids.limitBadge}" style="font-size: 10px; color: ${c.accent}; background: ${c.badgeBg}; padding: 2px 6px; border-radius: 3px;"></span>
              </div>
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">
                Randomizes each ${c.singular} drop between Min & Max (e.g. 10 to 50).
              </div>
            </div>

            <div>
              <div style="font-size: 10px; font-weight: 700; color: var(--muted); margin-bottom: 3px;">DELIVERY TIME (${labelUp})</div>
              <div style="display: flex; align-items: center; gap: 5px;">
                <div class="pill-group" id="${ids.durPills}">
                  <div class="pill-item active" data-cdur="match">Match</div>
                  <div class="pill-item" data-cdur="6h">6h</div>
                  <div class="pill-item" data-cdur="12h">12h</div>
                  <div class="pill-item" data-cdur="24h">24h</div>
                  <div class="pill-item" data-cdur="custom">Custom</div>
                </div>
                <input id="${ids.customDur}" type="text" class="input-entry" value="18h" style="width: 48px; padding: 3px 5px; font-size: 11px; text-align: center;" disabled>
              </div>
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">
                'Match' spreads ${lower} across full views span, or stop earlier.
              </div>
            </div>

            <div>
              <div style="font-size: 10px; font-weight: 700; color: var(--muted); margin-bottom: 3px;">NUMBER OF RUNS (${labelUp})</div>
              <div style="display: flex; align-items: center; gap: 5px;">
                <div class="pill-group" id="${ids.runsPills}">
                  <div class="pill-item active" data-cruns="auto">Auto</div>
                  <div class="pill-item" data-cruns="5">5</div>
                  <div class="pill-item" data-cruns="10">10</div>
                  <div class="pill-item" data-cruns="20">20</div>
                  <div class="pill-item" data-cruns="custom">Custom</div>
                </div>
                <input id="${ids.customRuns}" type="text" class="input-entry" value="8" style="width: 48px; padding: 3px 5px; font-size: 11px; text-align: center;" disabled>
              </div>
            </div>

            <div id="${ids.intSec}">
              <div style="display: flex; align-items: center; gap: 5px;">
                <span style="font-size: 11px; color: var(--muted); width: 48px;">Interval:</span>
                <div class="pill-group" id="${ids.intPills}">
                  <div class="pill-item" data-cint="30m">30m</div>
                  <div class="pill-item active" data-cint="1h">1h</div>
                  <div class="pill-item" data-cint="2h">2h</div>
                  <div class="pill-item" data-cint="custom">Custom</div>
                </div>
                <input id="${ids.customInt}" type="text" class="input-entry" value="45m" style="width: 48px; padding: 3px 5px; font-size: 11px; text-align: center;" disabled>
              </div>
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">
                Auto = drop by interval. Number = pick that many view runs.
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: 10.5px;">
                <span style="color: var(--muted); font-size: 10px; font-weight: 700;">RANDOM VARIANCE (${labelUp})</span>
                <span id="${ids.varLbl}" style="font-weight: 700; color: var(--success); background: #e7f6ee; padding: 1px 6px; border-radius: 3px;">±20%</span>
              </div>
              <input id="${ids.varSlider}" type="range" min="0" max="50" value="20" style="width: 100%;">
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">
                Nudges each ${c.singular} drop up or down for natural variation.
              </div>
            </div>

            ${c.supportsCustomComments ? `
              <div style="border-top: 1px dashed var(--border); padding-top: 6px; margin-top: 2px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                  <span style="font-size: 10px; font-weight: 700; color: var(--muted);">CUSTOM COMMENTS POOL (OPTIONAL — 1 LINE = 1 COMMENT)</span>
                  <span id="comment-lines-lbl" style="font-size: 10px; font-weight: 700; color: #0d9488; background: #ccfbf1; padding: 1px 6px; border-radius: 3px;">0 lines</span>
                </div>
                <textarea id="comment-custom-list" class="input-entry" rows="4" placeholder="Paste custom comments here, one per line...&#10;Nice post!&#10;Great content!&#10;(Leave empty to send numeric quantity only)" style="width: 100%; font-size: 11px; resize: vertical;"></textarea>
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                  <select id="comment-mode" class="input-entry" style="width: auto; font-size: 11px; padding: 3px 6px;">
                    <option value="sequential">Order: Top to Bottom</option>
                    <option value="random">Order: Random Shuffle</option>
                  </select>
                  <button id="btn-comment-use-count" type="button" class="btn-small" style="font-size: 10.5px; padding: 3px 8px;">Use line count as Total</button>
                </div>
                <div id="comment-type-hint" style="font-size: 10px; color: var(--muted); margin-top: 3px;">
                  When lines are filled above, each drop sends those exact comment lines (\`comments\` param) matching its drop qty.
                </div>
              </div>
            ` : ''}

            <button id="${ids.repairBtn}" class="btn-small" style="width: 100%; margin-top: 4px; padding: 5px; font-weight: 600;">
              ↻ Re-pair / Reset ${c.label} across schedule
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function bindCompanionEvents(cfg) {
    const ids = getCompIds(cfg);
    const key = cfg.key;
    const repairIfActive = () => {
      if (el(ids.enabled).checked && state.scheduleRuns.length) rePairCompanion(key, false);
    };

    el(ids.rate).addEventListener('input', () => updateAutoStats());

    el(ids.sid).addEventListener('input', () => {
      const sidTxt = el(ids.sid).value.trim();
      if (/^\d+$/.test(sidTxt)) {
        const sid = parseInt(sidTxt);
        if (state.services[sid] || state.services[sidTxt]) {
          applyCompanionServiceToUI(key, sid, { repairIfSchedule: true, overwriteRate: true });
          return;
        }
      }
      el(ids.svcInfo).textContent = '';
      el(ids.limitBadge).textContent = '';
      if (cfg.supportsCustomComments) updateCommentTypeHint(null);
      repairIfActive();
      updateAutoStats();
    });

    el(ids.enabled).addEventListener('change', e => {
      const isChecked = e.target.checked;
      el(ids.box).style.display = isChecked ? 'flex' : 'none';
      if (isChecked) {
        if (state.scheduleRuns.length) rePairCompanion(key, false);
        else updateAutoStats();
      } else {
        state.companions[key] = {};
        if (cfg.supportsCustomComments) state.customCommentsMap = {};
        renderAutoTable();
        updateAutoStats();
      }
    });

    // Duration pills + custom input
    document.querySelectorAll(`#${ids.durPills} .pill-item`).forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll(`#${ids.durPills} .pill-item`).forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cdur === 'custom');
        el(ids.customDur).disabled = !isCustom;
        if (isCustom) el(ids.customDur).focus();
        repairIfActive();
      });
    });
    el(ids.customDur).addEventListener('input', () => {
      setSelectedPill(ids.durPills, 'custom');
      el(ids.customDur).disabled = false;
      repairIfActive();
    });

    // Runs pills + custom input
    document.querySelectorAll(`#${ids.runsPills} .pill-item`).forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll(`#${ids.runsPills} .pill-item`).forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cruns === 'custom');
        el(ids.customRuns).disabled = !isCustom;
        if (isCustom) el(ids.customRuns).focus();

        const intSec = el(ids.intSec);
        const isAuto = (pill.dataset.cruns === 'auto');
        if (intSec) {
          intSec.style.opacity = isAuto ? '1' : '0.4';
          intSec.querySelectorAll('input').forEach(x => { x.disabled = !isAuto; });
        }
        repairIfActive();
      });
    });
    el(ids.customRuns).addEventListener('input', () => {
      setSelectedPill(ids.runsPills, 'custom');
      el(ids.customRuns).disabled = false;
      repairIfActive();
    });

    // Interval pills + custom input
    document.querySelectorAll(`#${ids.intPills} .pill-item`).forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll(`#${ids.intPills} .pill-item`).forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const isCustom = (pill.dataset.cint === 'custom');
        el(ids.customInt).disabled = !isCustom;
        if (isCustom) el(ids.customInt).focus();
        repairIfActive();
      });
    });
    el(ids.customInt).addEventListener('input', () => {
      setSelectedPill(ids.intPills, 'custom');
      el(ids.customInt).disabled = false;
      repairIfActive();
    });

    // Total, drop, min & max qty inputs
    [ids.totalQty, ids.dropQty, ids.minQty, ids.maxQty].forEach(inputId => {
      el(inputId).addEventListener('input', repairIfActive);
    });

    // Variance slider
    el(ids.varSlider).addEventListener('input', e => {
      el(ids.varLbl).textContent = `±${e.target.value}%`;
      repairIfActive();
    });

    // Custom Comments Pool controls (only for comments companion)
    if (cfg.supportsCustomComments) {
      const customTa = el('comment-custom-list');
      const modeSel = el('comment-mode');
      const useCountBtn = el('btn-comment-use-count');
      if (customTa) {
        customTa.addEventListener('input', () => {
          updateCommentLinesBadge();
          repairIfActive();
        });
      }
      if (modeSel) {
        modeSel.addEventListener('change', repairIfActive);
      }
      if (useCountBtn && customTa) {
        useCountBtn.addEventListener('click', () => {
          const lines = parseCustomCommentLines(customTa.value);
          el(ids.totalQty).value = lines.length ? String(lines.length) : '';
          if (el(ids.enabled).checked && state.scheduleRuns.length) rePairCompanion(key, true);
          else updateAutoStats();
        });
      }
    }

    // Re-pair button
    el(ids.repairBtn).addEventListener('click', () => {
      rePairCompanion(key, true);
    });
  }

  // ================================================================
  //  TAB 3: AUTO PLAN
  // ================================================================
  function initAutoPlan() {
    renderCompanionControls();

    // Two-way sync to New Order tab
    el('auto-sid').addEventListener('input', () => {
      const val = el('auto-sid').value.trim();
      el('order-sid').value = val;
      const sid = parseInt(val);
      const s = state.services[sid] || state.services[val];
      const info = s ? `min ${s.min}  max ${s.max}  rate ${s.rate} per 1000` : '';
      el('auto-svc-info').textContent = info;
      el('order-svc-info').textContent = info;
      if (s && el('auto-rate')) el('auto-rate').value = s.rate;
      updateAutoStats();
    });

    if (el('auto-rate')) {
      el('auto-rate').addEventListener('input', () => updateAutoStats());
    }

    el('auto-link').addEventListener('input', () => {
      el('order-link').value = el('auto-link').value;
    });

    // Bind Likes, Shares, Saves companion controls cleanly
    COMPANION_TYPES.forEach(bindCompanionEvents);

    // Preset pills (1k, 5k, 10k, 20k, 50k, Custom)
    document.querySelectorAll('#tab-auto .pill-item[data-preset]').forEach(pill => {
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
    const inrEl = el('btn-start-inr');
    if (inrEl) {
      inrEl.addEventListener('click', () => {
        const curRate = parseFloat(localStorage.getItem('anoxy_usd_inr_rate')) || 88.0;
        const newRate = prompt('Enter USD to INR conversion rate (e.g. 88, 89):', curRate);
        if (newRate && !isNaN(parseFloat(newRate)) && parseFloat(newRate) > 0) {
          localStorage.setItem('anoxy_usd_inr_rate', parseFloat(newRate));
          updateAutoStats();
        }
      });
    }
    const toggleCostBtn = el('btn-toggle-cost-details');
    if (toggleCostBtn) {
      const isShown = localStorage.getItem('anoxy_show_cost_breakdown') !== '0';
      toggleCostBtn.textContent = isShown ? 'Per-service price ▾' : 'Per-service price ▸';
      toggleCostBtn.addEventListener('click', () => {
        const cur = localStorage.getItem('anoxy_show_cost_breakdown') !== '0';
        const next = !cur;
        localStorage.setItem('anoxy_show_cost_breakdown', next ? '1' : '0');
        toggleCostBtn.textContent = next ? 'Per-service price ▾' : 'Per-service price ▸';
        updateAutoStats();
      });
    }
    el('btn-auto-add').addEventListener('click', () => {
      COMPANION_TYPES.forEach(c => {
        const ids = getCompIds(c);
        const on = Boolean(el(ids.enabled)?.checked);
        const grp = el(ids.addGroup);
        const inp = el(ids.addQty);
        if (grp) grp.style.display = on ? 'block' : 'none';
        if (on && inp) {
          const { sMin } = getCompLimits(c, el(ids.sid)?.value);
          inp.placeholder = `Min ${sMin} (or leave empty)`;
          inp.value = '';
        }
        if (c.supportsCustomComments && el('add-comments-text')) {
          el('add-comments-text').value = '';
        }
      });
      el('modal-add').classList.remove('hidden');
    });

    // Import / Export
    el('btn-auto-export').addEventListener('click', exportSchedule);
    el('btn-auto-import').addEventListener('click', () => el('file-import-input').click());
    el('file-import-input').addEventListener('change', importSchedule);

    // Initial preset setup (configures form without generating schedule)
    applyAutoPreset('10k');
  }

  // --- PRESET HANDLING (Exact desktop on_view_preset_pick parity lines 1249-1282) ---
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
    const sid = parseInt((el('auto-sid')?.value || '').trim());
    const s = sid ? (state.services[sid] || state.services[String(sid)]) : null;
    const minQ = (s && s.min) ? Math.max(1, parseInt(s.min) || 1) : 1;
    const maxRunsByMin = Math.max(1, Math.floor(tot / minQ));
    const runs = Math.min(maxRunsByMin, Math.max(1, Math.round(tot / Math.max(155, minQ))));
    const hours = runs === 1 ? 1 : Math.max(1, Math.round(runs * 22.1 / 60));
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
  //  generateAutoSchedule — Exact desktop generate_auto parity (lines 1508-1594)
  // ================================================================
  async function generateAutoSchedule() {
    // 1. Service validation (lines 1509-1512)
    const sidTxt = el('auto-sid').value.trim();
    if (!sidTxt || !/^\d+$/.test(sidTxt)) {
      alert("Pick a service, or type its numeric ID, on the New order tab.");
      return;
    }
    const sid = parseInt(sidTxt);
    if (!state.services[sid] && !state.services[String(sid)]) {
      await ensurePanelServicesLoaded();
    }

    // 2. Link validation — strictly enforce https:// (desktop parity lines 1514-1516)
    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert("Enter the full post/profile link (starting with https://).");
      return;
    }

    // 3. Pattern parsing (lines 1517-1521)
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

    // 4. Duration parsing (lines 1522-1530)
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

    // 5. Total quantity validation from input (lines 1532-1539) - NOT hardcoded preset
    const totalTxt = el('auto-total-views').value.trim();
    let total = null;
    if (totalTxt) {
      if (!/^\d+$/.test(totalTxt) || parseInt(totalTxt) < 1) {
        alert("Total quantity must be a whole number, 1 or more (or leave it empty for no limit).");
        return;
      }
      total = parseInt(totalTxt);
    }

    // 6. Number of runs validation (lines 1541-1548)
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

    // 7. Check total against service limits (lines 1550-1554)
    const s = state.services[sid] || state.services[String(sid)];
    if (!s) {
      const hasSvcs = Object.keys(state.services || {}).length > 0;
      alert(hasSvcs
        ? `Service #${sid} was not found in your connected panel. Pick a valid Service ID on the New order tab.`
        : `Panel services are not loaded yet. Connect on Setup first so service min/max limits are used.`);
      return;
    }
    if (total !== null && !(s.min <= total && total <= s.max)) {
      alert(`Total ${total} is outside this service's limits (${s.min} to ${s.max}).`);
      return;
    }

    // 8. Scale pattern if pattern quantities are below service min (lines 1555-1563)
    if (s && s.min > 0 && total === null) {
      const smallest = Math.min(...cycle.map(([q]) => q));
      if (smallest < s.min) {
        const factor = Math.ceil(s.min / smallest);
        cycle.forEach(item => { item[0] *= factor; });
        log(`Pattern quantities were below this service's minimum (${s.min}), so they were scaled up x${factor}, keeping the same shape.`);
      }
    }

    // 9. Compute default gap from pattern (lines 1564-1565)
    const mids = cycle.filter(([, g]) => g !== null).map(([, g]) => (g[0] + g[1]) / 2);
    const defaultGap = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 60;

    // 10. Generate runs (lines 1566-1585)
    const variancePct = parseInt(el('auto-var-slider').value) || 20;
    const spread = el('auto-spread-chk').checked;
    const minQ = Math.max(1, s.min || 1);
    const maxQ = Math.max(minQ, s.max || 1e9);

    let runs;
    try {
      if (nRuns !== null) {
        runs = generateForRuns(cycle, durationMin, variancePct, nRuns, total, minQ, maxQ);
      } else if (total !== null) {
        runs = generateForTotal(cycle, durationMin, variancePct, defaultGap, total, minQ, maxQ, spread);
      } else {
        runs = generateSchedule(cycle, durationMin, variancePct, defaultGap);
        runs.forEach(r => { r[1] = Math.min(Math.max(r[1], minQ), maxQ); });
      }
    } catch (e) {
      alert(e.message);
      return;
    }

    // Strict guard: never leave any run below service minimum
    const invalidRun = runs.find(([, q]) => q < minQ || q > maxQ);
    if (invalidRun) {
      alert(`Could not fit total ${total || ''} with service limits (min ${minQ}, max ${maxQ}). Adjust Total or Number of runs.`);
      return;
    }

    state.scheduleRuns = runs;
    resetCompanionMaps();

    log(`Schedule built: ${runs.length} run(s), ${runs.reduce((a, [, q]) => a + q, 0)} total, last one ${fmtGap(runs.length ? runs[runs.length - 1][0] : 0)} from the start.`);

    // 11. Auto re-pair all enabled companions (Likes / Shares / Saves)
    rePairAllEnabledCompanions();
  }

  // ================================================================
  //  rePairCompanion — Parameterized pairing for Likes, Shares & Saves
  //  Strictly enforces service minimum per drop (no drop below service min allowed)
  // ================================================================
  function clearCompanionDrops(cfg, warnMsg = '') {
    const ids = getCompIds(cfg);
    state.companions[cfg.key] = {};
    if (cfg.supportsCustomComments) state.customCommentsMap = {};
    if (warnMsg && el(ids.svcInfo)) {
      el(ids.svcInfo).style.color = 'var(--danger)';
      el(ids.svcInfo).textContent = warnMsg;
    }
    renderAutoTable();
    updateAutoStats();
  }

  function rePairCompanion(typeKey = 'likes', showAlerts = false) {
    if (!state.scheduleRuns.length) {
      if (showAlerts) alert("Generate or add view runs first.");
      return;
    }

    const cfg = getCompCfg(typeKey);
    const ids = getCompIds(cfg);
    const lowerLabel = cfg.label.toLowerCase();

    const compSidTxt = el(ids.sid).value.trim();

    if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
      clearCompanionDrops(cfg);
      if (showAlerts) alert(`Enter a numeric Service ID for ${cfg.label}.`);
      return;
    }

    const { compS, sMin, sMax } = getCompLimits(cfg, compSidTxt);
    if (!compS && Object.keys(state.services || {}).length > 0) {
      clearCompanionDrops(cfg, `⚠ Service #${compSidTxt} not found in panel`);
      if (showAlerts) alert(`${cfg.label} Service #${compSidTxt} was not found in your connected panel.`);
      return;
    }

    if (compS && el(ids.svcInfo)) {
      el(ids.svcInfo).style.color = 'var(--muted)';
      el(ids.svcInfo).textContent = `${compS.name.slice(0, 24)} (min ${compS.min}, max ${compS.max}, rate ${compS.rate})`;
    }

    // 1. Total Quantity or Qty per drop
    const totalTxt = el(ids.totalQty).value.trim();
    let compTotal = null;
    if (totalTxt) {
      if (!/^\d+$/.test(totalTxt) || parseInt(totalTxt) < 1) {
        clearCompanionDrops(cfg, `⚠ Enter a whole number Total >= ${sMin}`);
        if (showAlerts) alert(`${cfg.label} Total quantity must be a whole number, 1 or more (or leave empty).`);
        return;
      }
      compTotal = parseInt(totalTxt);
      if (compTotal < sMin) {
        clearCompanionDrops(cfg, `⚠ Total ${compTotal} is below service min ${sMin}`);
        if (showAlerts) alert(`Total ${lowerLabel} quantity ${compTotal} is below the service minimum (${sMin}).`);
        return;
      }
      if (compTotal > sMax) {
        clearCompanionDrops(cfg, `⚠ Total ${compTotal} is above service max ${sMax}`);
        if (showAlerts) alert(`Total ${lowerLabel} quantity ${compTotal} is outside service limits (${sMin} to ${sMax}).`);
        return;
      }
    }

    const qtyTxt = el(ids.dropQty).value.trim();
    let baseQty = sMin;
    if (qtyTxt && !qtyTxt.includes('-')) {
      if (!/^\d+$/.test(qtyTxt) || parseInt(qtyTxt) < 1) {
        clearCompanionDrops(cfg, `⚠ Invalid Qty/drop (min ${sMin})`);
        if (showAlerts) alert(`${cfg.label} quantity per drop must be 1 or more.`);
        return;
      }
      baseQty = parseInt(qtyTxt);
    }
    if (baseQty < sMin) {
      baseQty = sMin;
      if (qtyTxt) el(ids.dropQty).value = sMin;
    }

    // 2. Delivery Time / Duration
    const durChoice = getSelectedPillVal(ids.durPills);
    let maxCompDelay;
    if (durChoice === 'match') {
      maxCompDelay = state.scheduleRuns[state.scheduleRuns.length - 1][0];
    } else {
      const durStr = durChoice === 'custom' ? el(ids.customDur).value.trim() : durChoice;
      try {
        maxCompDelay = parseDuration(durStr);
        if (maxCompDelay <= 0) throw new Error();
      } catch {
        if (showAlerts) alert(`${cfg.label} duration should look like 6h, 12h, 24h, 36h.`);
        return;
      }
    }

    let eligible = [];
    state.scheduleRuns.forEach(([d], idx) => {
      if (d <= maxCompDelay + 0.001) eligible.push(idx);
    });
    if (!eligible.length) eligible = [0];

    // 3. Number of Runs or Auto (Interval)
    const nrunsChoice = getSelectedPillVal(ids.runsPills);
    let chosenIndices = [];

    if (nrunsChoice !== 'auto') {
      const nTxt = nrunsChoice === 'custom' ? el(ids.customRuns).value.trim() : nrunsChoice;
      if (!/^\d+$/.test(nTxt) || parseInt(nTxt) < 1) {
        if (showAlerts) alert(`Number of runs for ${cfg.label} must be 1 or more.`);
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
      const intChoice = getSelectedPillVal(ids.intPills);
      let intervalMins;
      try {
        const intervalStr = intChoice === 'custom' ? el(ids.customInt).value.trim() : intChoice;
        intervalMins = parseDuration(intervalStr);
        if (intervalMins <= 0) throw new Error();
      } catch {
        if (showAlerts) alert(`${cfg.label} interval must look like 1h, 30m, 2h, 45m.`);
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

    // 4. Min & Max per drop inputs
    const minTxt = el(ids.minQty).value.trim();
    const maxTxt = el(ids.maxQty).value.trim();
    let userMin = minTxt && /^\d+$/.test(minTxt) ? parseInt(minTxt) : null;
    let userMax = maxTxt && /^\d+$/.test(maxTxt) ? parseInt(maxTxt) : null;

    if (userMin === null && userMax === null && qtyTxt.includes('-')) {
      const parts = qtyTxt.split('-').map(p => parseInt(p.trim())).filter(n => !isNaN(n));
      if (parts.length === 2) {
        userMin = Math.min(parts[0], parts[1]);
        userMax = Math.max(parts[0], parts[1]);
      }
    }

    const effMin = userMin !== null ? Math.max(sMin, userMin) : sMin;
    const effMax = userMax !== null ? Math.min(sMax, Math.max(effMin, userMax)) : sMax;

    if (userMin !== null && userMin < sMin) {
      if (showAlerts) alert(`Minimum ${lowerLabel} per drop (${userMin}) is below service minimum (${sMin}). Clamped to ${sMin}.`);
      el(ids.minQty).value = sMin;
    }

    if (compTotal !== null) {
      const maxPossibleDrops = Math.max(1, Math.floor(compTotal / effMin));
      if (chosenIndices.length > maxPossibleDrops) {
        chosenIndices = chosenIndices.slice(0, maxPossibleDrops);
      }
    }

    // 5. Calculate Quantities with Random Variance or Min/Max Range
    const variancePct = parseInt(el(ids.varSlider).value) || 20;
    const k = chosenIndices.length;
    let quantities = [];
    const hasMinMax = (userMin !== null || userMax !== null);

    if (compTotal !== null) {
      if (k === 1) {
        quantities = [compTotal];
      } else if (hasMinMax || variancePct > 0) {
        const floorB = hasMinMax ? effMin : sMin;
        const ceilB = hasMinMax ? effMax : sMax;
        const vFrac = variancePct / 100.0;
        const rawWeights = chosenIndices.map(() => 1.0 - vFrac + Math.random() * (2 * vFrac));
        const weightSum = rawWeights.reduce((a, b) => a + b, 0);
        let rawQtys = rawWeights.map(w => Math.max(floorB, Math.min(ceilB, Math.round(compTotal * w / Math.max(1e-9, weightSum)))));
        let diff = compTotal - rawQtys.reduce((a, b) => a + b, 0);
        const step = diff > 0 ? 1 : -1;
        let madeProgress = true;
        while (diff !== 0 && madeProgress) {
          madeProgress = false;
          for (let tgt = 0; tgt < k && diff !== 0; tgt++) {
            if (step > 0 && rawQtys[tgt] < ceilB) { rawQtys[tgt] += 1; diff -= 1; madeProgress = true; }
            else if (step < 0 && rawQtys[tgt] > floorB) { rawQtys[tgt] -= 1; diff += 1; madeProgress = true; }
          }
        }
        quantities = rawQtys;
      } else {
        const baseQ = Math.max(effMin, Math.floor(compTotal / k));
        const rem = compTotal - baseQ * k;
        quantities = chosenIndices.map((_, i) => baseQ + (i < rem ? 1 : 0));
      }
    } else if (hasMinMax) {
      quantities = chosenIndices.map(() => {
        if (effMax <= effMin) return effMin;
        return Math.floor(effMin + Math.random() * (effMax - effMin + 1));
      });
    } else {
      quantities = chosenIndices.map(() => {
        let q = baseQty;
        if (variancePct > 0) {
          const factor = 1.0 - (variancePct / 100) + Math.random() * (2 * variancePct / 100);
          q = Math.round(baseQty * factor);
        }
        return Math.max(sMin, Math.min(q, sMax));
      });
    }

    const newMap = {};
    chosenIndices.forEach((runIdx, i) => {
      newMap[runIdx] = quantities[i];
    });
    state.companions[cfg.key] = newMap;

    const totAssigned = Object.values(newMap).reduce((a, b) => a + b, 0);

    if (cfg.supportsCustomComments) {
      const pool = parseCustomCommentLines(el('comment-custom-list')?.value);
      if (pool.length > 0) {
        const mode = el('comment-mode')?.value || 'sequential';
        const workingPool = [...pool];
        const shufflePool = arr => {
          for (let m = arr.length - 1; m > 0; m--) {
            const r = Math.floor(Math.random() * (m + 1));
            [arr[m], arr[r]] = [arr[r], arr[m]];
          }
        };
        if (mode === 'random') shufflePool(workingPool);

        const cMap = {};
        let cursor = 0;
        chosenIndices.forEach((runIdx, idx) => {
          const take = quantities[idx];
          const picked = [];
          for (let j = 0; j < take; j++) {
            if (cursor >= workingPool.length) {
              if (mode === 'random') shufflePool(workingPool);
              cursor = 0;
            }
            picked.push(workingPool[cursor++]);
          }
          cMap[runIdx] = picked;
        });
        state.customCommentsMap = cMap;
        const poolNote = totAssigned > pool.length ? 'pool wrapped' : (totAssigned < pool.length ? `${pool.length - totAssigned} pool lines unused` : '1:1 pool match');
        log(`Paired Comments #${compSidTxt || '?'}: ${chosenIndices.length} drops, ${totAssigned} custom comments (${pool.length} lines, ${poolNote}).`);
      } else {
        state.customCommentsMap = {};
        log(`Paired ${cfg.label} #${compSidTxt || '?'}: ${chosenIndices.length} drops, total ${totAssigned} ${lowerLabel} (±${variancePct}% variance).`);
      }
    } else {
      log(`Paired ${cfg.label} #${compSidTxt || '?'}: ${chosenIndices.length} drops, total ${totAssigned} ${lowerLabel} (±${variancePct}% variance).`);
    }

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

      const badges = COMPANION_TYPES.map(c => {
        const ids = getCompIds(c);
        if (!el(ids.enabled)?.checked) return '';
        const qty = state.companions[c.key]?.[i];
        if (qty !== undefined && qty !== null) {
          const customLines = c.supportsCustomComments ? state.customCommentsMap?.[i] : null;
          const hasCustom = customLines && customLines.length > 0;
          const badgeTitle = hasCustom
            ? `Click to edit custom comments (${customLines.length}): ${customLines.slice(0, 2).join(' | ')}`
            : `Click to edit ${c.singular} drop`;
          const safeTitle = badgeTitle.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          const extraMark = hasCustom ? '✎' : '';
          return `<span class="${c.badgeClass}" title="${safeTitle}" onclick="window.anoxyEditCompanion('${c.key}', ${i})">${c.icon}${extraMark}+${qty}</span>`;
        }
        return `<span class="h-add" title="Click to add ${c.singular} drop here" onclick="window.anoxyAddCompanion('${c.key}', ${i})">+${c.icon}</span>`;
      }).filter(Boolean).join(' ');

      html += `
        <tr>
          <td>${i + 1}</td>
          <td>${whenStr}</td>
          <td style="color: var(--muted);">${gapStr}</td>
          <td style="font-weight: 700;"><span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px;">+${q} ${badges}</span></td>
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

  function resolveServiceRate(sidInputId, rateInputId, autoFillRate = false) {
    const sidTxt = (el(sidInputId)?.value || '').trim();
    const sid = sidTxt && /^\d+$/.test(sidTxt) ? parseInt(sidTxt) : null;
    const svc = sid ? (state.services[sid] || state.services[sidTxt]) : null;
    let rate = 0;
    const manual = parseFloat(el(rateInputId)?.value);
    if (!isNaN(manual) && manual > 0) {
      rate = manual;
    } else if (svc && svc.rate !== undefined && svc.rate !== null) {
      const parsed = parseFloat(svc.rate);
      if (!isNaN(parsed) && parsed > 0) {
        rate = parsed;
        if (autoFillRate && el(rateInputId) && !el(rateInputId).value) el(rateInputId).value = parsed;
      }
    }
    return { sid, svc, rate };
  }

  function computePlanCostSummary(autoFillRates = false) {
    const totalViews = state.scheduleRuns.reduce((s, [, q]) => s + q, 0);
    const { sid, svc, rate: viewsRate } = resolveServiceRate('auto-sid', 'auto-rate', autoFillRates);
    const viewsCost = (totalViews > 0 && viewsRate > 0) ? (totalViews * viewsRate / 1000) : 0;

    const compBreakdown = COMPANION_TYPES.map(c => {
      const ids = getCompIds(c);
      const map = state.companions[c.key] || {};
      const total = Object.values(map).reduce((a, b) => a + b, 0);
      const runCount = Object.keys(map).length;
      const { sid: csid, svc: compS, rate } = resolveServiceRate(ids.sid, ids.rate, autoFillRates);
      const cost = (total > 0 && rate > 0) ? (total * rate / 1000) : 0;
      const enabled = Boolean(el(ids.enabled)?.checked) && runCount > 0;
      return { cfg: c, ids, sid: csid, svc: compS, rate, total, runCount, cost, enabled, map };
    });

    const totalCompCost = compBreakdown.reduce((a, x) => a + x.cost, 0);
    const totalPlanCost = viewsCost + totalCompCost;
    const hasAnyCost = viewsCost > 0 || totalCompCost > 0;
    const curr = (state.currency || 'USD').toUpperCase();
    const usdToInrRate = parseFloat(localStorage.getItem('anoxy_usd_inr_rate')) || 88.0;
    const inrCost = (curr === 'INR' || curr === '₹') ? totalPlanCost : (totalPlanCost * usdToInrRate);

    return { totalViews, sid, svc, viewsRate, viewsCost, compBreakdown, totalPlanCost, hasAnyCost, curr, usdToInrRate, inrCost };
  }

  function renderServiceCostBadge({ label, icon, bg, color, sid, qty, rate, cost, curr, usdToInrRate }) {
    const isInr = curr === 'INR' || curr === '₹';
    let priceHtml;
    if (rate > 0) {
      const itemInr = isInr ? cost : (cost * usdToInrRate);
      priceHtml = isInr
        ? `₹${cost.toFixed(2)}`
        : `${cost.toFixed(4)} ${curr} <span style="opacity: 0.8;">(₹${itemInr.toFixed(2)})</span>`;
    } else {
      priceHtml = '<span style="color: var(--muted);">no rate</span>';
    }
    const sidTag = sid ? `#${sid}` : '';
    const tip = `${label} ${sidTag} · ${qty.toLocaleString()} qty @ ${rate || 0}/1k`;
    return `<span title="${tip}" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 4px; background: ${bg}; color: ${color}; border: 1px solid rgba(15, 23, 42, 0.08); font-size: 11px; font-weight: 700; white-space: nowrap;">${icon} ${label}${sidTag ? ' ' + sidTag : ''} (${qty.toLocaleString()}): ${priceHtml}</span>`;
  }

  function updateAutoStats() {
    const runs = state.scheduleRuns;
    const n = runs.length;
    el('stat-runs').textContent = n ? n : '–';
    const breakdownBox = el('cost-breakdown-box');

    if (!n) {
      el('stat-gap').textContent = '–';
      el('stat-finish').textContent = '–';
      el('stat-total').textContent = '–';
      el('stat-cost').textContent = '–';
      if (el('btn-start-cost')) el('btn-start-cost').textContent = '–';
      if (el('btn-start-inr')) el('btn-start-inr').textContent = '';
      if (breakdownBox) {
        breakdownBox.innerHTML = '';
        breakdownBox.style.display = 'none';
      }
      return;
    }

    const summary = computePlanCostSummary(true);
    const { totalViews, sid, viewsRate, viewsCost, compBreakdown, totalPlanCost, hasAnyCost, curr, usdToInrRate, inrCost } = summary;

    const lastD = runs[n - 1][0];
    const gaps = [];
    for (let k = 0; k < n - 1; k++) gaps.push(runs[k + 1][0] - runs[k][0]);
    el('stat-gap').textContent = gaps.length ? fmtGap(gaps.reduce((a, b) => a + b, 0) / gaps.length) : '–';

    const fin = new Date(Date.now() + lastD * 60000);
    el('stat-finish').textContent = fin.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                                    fin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const activeTags = compBreakdown.filter(x => x.total > 0).map(x => `+${x.total.toLocaleString()}${x.cfg.icon}`);
    el('stat-total').textContent = activeTags.length
      ? `${totalViews.toLocaleString()} (${activeTags.join(' ')})`
      : totalViews.toLocaleString();

    if (breakdownBox) {
      const showBreakdown = localStorage.getItem('anoxy_show_cost_breakdown') !== '0';
      if (showBreakdown) {
        const itemsHtml = [
          renderServiceCostBadge({
            label: 'Views',
            icon: '👁',
            bg: '#eef2ff',
            color: '#3b5bdb',
            sid,
            qty: totalViews,
            rate: viewsRate,
            cost: viewsCost,
            curr,
            usdToInrRate
          })
        ];
        compBreakdown.filter(x => x.total > 0).forEach(x => {
          itemsHtml.push(renderServiceCostBadge({
            label: x.cfg.label,
            icon: x.cfg.icon,
            bg: x.cfg.badgeBg,
            color: x.cfg.accent,
            sid: x.sid,
            qty: x.total,
            rate: x.rate,
            cost: x.cost,
            curr,
            usdToInrRate
          }));
        });
        breakdownBox.innerHTML = itemsHtml.join('');
        breakdownBox.style.display = 'flex';
      } else {
        breakdownBox.innerHTML = '';
        breakdownBox.style.display = 'none';
      }
    }

    if (hasAnyCost) {
      let costText = '';
      let inrText = '';

      if (curr === 'INR' || curr === '₹') {
        costText = `₹ ${totalPlanCost.toFixed(2)}`;
        inrText = `Total: ₹ ${totalPlanCost.toFixed(2)} INR`;
        el('stat-cost').textContent = `₹ ${totalPlanCost.toFixed(2)}`;
      } else {
        costText = `${totalPlanCost.toFixed(4)} ${curr}`;
        inrText = `≈ ₹ ${inrCost.toFixed(2)} INR`;
        el('stat-cost').textContent = `${totalPlanCost.toFixed(4)} ${curr} (₹${inrCost.toFixed(2)})`;
      }

      const parts = [`Views: ${viewsCost.toFixed(4)} ${curr} (${totalViews.toLocaleString()})`];
      compBreakdown.filter(x => x.total > 0).forEach(x => {
        parts.push(`${x.cfg.label}: ${x.cost.toFixed(4)} ${curr} (${x.total.toLocaleString()})`);
      });
      const breakdown = parts.join(' + ');
      el('stat-cost').title = breakdown;

      if (el('btn-start-cost')) {
        el('btn-start-cost').textContent = costText;
        el('btn-start-cost').title = breakdown;
      }
      if (el('btn-start-inr')) {
        el('btn-start-inr').textContent = inrText;
        el('btn-start-inr').title = `Calculated at 1 USD = ${usdToInrRate} INR. Click to change USD/INR rate.`;
      }
    } else {
      el('stat-cost').textContent = '–';
      el('stat-cost').title = '';
      if (el('btn-start-cost')) el('btn-start-cost').textContent = '–';
      if (el('btn-start-inr')) el('btn-start-inr').textContent = '';
    }
  }

  // ================================================================
  //  startAutoPlan — Exact desktop auto_start_plan parity + multi-companion
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
    const s = state.services[sid];
    const vMin = (s && s.min) ? s.min : 1;
    const vMax = (s && s.max) ? s.max : 1e9;

    const link = el('auto-link').value.trim();
    if (!link.startsWith('http')) {
      alert('Enter the full link (starting with https://).');
      return;
    }

    for (let i = 0; i < state.scheduleRuns.length; i++) {
      const [, qty] = state.scheduleRuns[i];
      if (qty < vMin || qty > vMax) {
        alert(`Run #${i + 1} views quantity ${qty} is outside this service's limits (${vMin} to ${vMax}).`);
        return;
      }
    }

    // Validate every enabled companion (Likes / Shares / Saves) against its service limits
    const activeCompanions = [];
    for (const c of COMPANION_TYPES) {
      const ids = getCompIds(c);
      const map = state.companions[c.key] || {};
      const on = el(ids.enabled)?.checked && Object.keys(map).length > 0;
      if (!on) continue;

      const compSidTxt = el(ids.sid).value.trim();
      if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
        alert(`Please enter a valid numeric ${c.label} Service ID.`);
        return;
      }
      const { csid: compSid, sMin, sMax } = getCompLimits(c, compSidTxt);

      for (const [runIdxStr, cq] of Object.entries(map)) {
        const runNum = parseInt(runIdxStr) + 1;
        if (cq < sMin || cq > sMax) {
          alert(`Run #${runNum} ${c.label.toLowerCase()} drop quantity ${cq} is outside service limits (${sMin} to ${sMax}). Minimum allowed is ${sMin}.`);
          return;
        }
      }
      activeCompanions.push({ cfg: c, compSid, map });
    }

    // Cost calculation & balance check across Views + all active companions
    const summary = computePlanCostSummary(false);
    const { totalViews, viewsCost, compBreakdown, totalPlanCost, curr, inrCost } = summary;

    if (totalPlanCost > 0 && state.balance !== null && totalPlanCost > state.balance) {
      if (!confirm(`Estimated cost ${totalPlanCost.toFixed(4)} ${curr} is higher than your balance ${state.balance} ${curr}.\nLater runs may fail. Continue anyway?`)) return;
    }

    const activeDetails = compBreakdown.filter(x => x.enabled && x.total > 0);
    const compRunsSummary = activeDetails.map(x => ` + ${x.runCount} ${x.cfg.label.toLowerCase()} drops`).join('');
    const totalQtySummary = activeDetails.map(x => ` + ${x.total.toLocaleString()} ${x.cfg.label.toLowerCase()}`).join('');
    const costParts = [`Views: ${viewsCost.toFixed(4)}`].concat(activeDetails.map(x => `${x.cfg.label}: ${x.cost.toFixed(4)}`));
    const inrDisplay = (curr === 'INR' || curr === '₹') ? `₹ ${totalPlanCost.toFixed(2)} INR` : `${totalPlanCost.toFixed(4)} ${curr} (≈ ₹ ${inrCost.toFixed(2)} INR)`;

    const confirmMsg = `${state.scheduleRuns.length} primary runs${compRunsSummary} over this schedule.` +
      `\n\nTotal views: ${totalViews.toLocaleString()}${totalQtySummary}` +
      `\n\nTotal Estimated Cost: ${inrDisplay}` +
      (activeDetails.length ? `\n(${costParts.join(' + ')})` : '') +
      (state.balance !== null ? `\nYour Balance: ${state.balance} ${curr}` : '');

    if (!confirm(confirmMsg)) return;

    const now = Date.now();
    const steps = [];

    state.scheduleRuns.forEach(([d, q], i) => {
      const runAt = now + d * 60000;
      steps.push({
        step_no: steps.length + 1,
        run_at: runAt,
        service_id: sid,
        link: link,
        quantity: q
      });

      activeCompanions.forEach(({ cfg, compSid, map }) => {
        if (map[i]) {
          const stepObj = {
            step_no: steps.length + 1,
            run_at: runAt,
            service_id: compSid,
            link: link,
            quantity: map[i]
          };
          const customLines = cfg.supportsCustomComments ? state.customCommentsMap?.[i] : null;
          if (customLines && customLines.length) {
            stepObj.comments = customLines.join('\n');
          }
          steps.push(stepObj);
        }
      });
    });

    const started = await savePlanToCloud(`Auto ${state.activePreset.toUpperCase()} Plan (${steps.length} drops)`, sid, link, steps);
    if (started) {
      state.scheduleRuns = [];
      resetCompanionMaps();
      renderAutoTable();
      updateAutoStats();
    }
  }

  // --- SAVE PLAN TO 24/7 CLOUD (Immediately dispatches due-now steps just like EXE) ---
  async function savePlanToCloud(name, sid, link, steps) {
    const url = localStorage.getItem('anoxy_panel_url');
    const key = localStorage.getItem('anoxy_panel_key');

    if (!url || !key) {
      alert('Please configure Panel API credentials in Setup first.');
      switchTab('setup');
      return false;
    }

    const startBtn = el('btn-auto-start');
    const origBtnTxt = startBtn ? startBtn.textContent : '';
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = '⏳ Starting & sending...';
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
        if (data.plan) {
          state.plans = [data.plan, ...state.plans.filter(p => String(p.id) !== String(data.plan.id))];
        }
        if (Array.isArray(data.steps) && data.steps.length) {
          data.steps.forEach(s => {
            if (s.order_id && s.provider_status) {
              cacheProviderStatus(s.order_id, s.provider_status);
            }
          });
          state.steps = [...state.steps.filter(s => String(s.plan_id) !== String(data.plan_id)), ...data.steps];
          state.steps.sort((a, b) => (Number(a.run_at) - Number(b.run_at)) || (Number(a.step_no) - Number(b.step_no)));
        }
        state.selectedPlanId = data.plan_id;

        const sentNow = (data.steps || []).filter(s => s.status === 'sent');
        if (sentNow.length) {
          sentNow.forEach(s => log(`Plan ${data.plan_id} step ${s.step_no}: sent ${s.quantity} (order ${s.order_id})`));
        }
        log(`Plan started with ${steps.length} scheduled step(s) in 24/7 Cloud.`);

        renderPlansTable();
        switchTab('plans', false);
        setTimeout(() => pollProviderStatuses(), 1200);
        setTimeout(() => pollProviderStatuses(), 5000);
        return true;
      } else if (data.message && data.message.includes('Missing username or password')) {
        alert("Google Sheet Apps Script Update Required:\n\nYour Google Sheet currently has the old login-only script.\n\nTo enable 24/7 Cloud Plans:\n1. Open your Google Sheet → Extensions → Apps Script\n2. Replace all code by pasting 'google_apps_script.js'\n3. Click Deploy → Manage deployments → Edit (pencil icon)\n4. Select Version: 'New version' and click Deploy.");
        return false;
      } else {
        alert('Plan response: ' + (data.message || JSON.stringify(data)));
        return false;
      }
    } catch (err) {
      alert('Error dispatching plan to cloud: ' + err.message);
      return false;
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = origBtnTxt;
      }
    }
  }

  // ================================================================
  //  MODAL DIALOGS: EDIT STEP, ADD RUN, EDIT MY PLANS STEP
  // ================================================================
  let editStepIdx = -1;
  let commentDropIdx = -1;

  function updateCommentDropLinesBadge() {
    const lbl = el('comment-drop-lines-lbl');
    const ta = el('comment-drop-text');
    if (!lbl || !ta) return;
    const n = parseCustomCommentLines(ta.value).length;
    lbl.textContent = `${n} line${n === 1 ? '' : 's'}`;
    if (n > 0 && el('comment-drop-qty')) {
      el('comment-drop-qty').value = n;
    }
  }

  function openCommentDropModal(i, suggestQty) {
    const cfg = getCompCfg('comments');
    const ids = getCompIds(cfg);
    const { csid: compSid, sMin, sMax } = getCompLimits(cfg, el(ids.sid)?.value);

    commentDropIdx = i;
    const curLines = state.customCommentsMap?.[i] || [];
    const curQ = curLines.length > 0 ? curLines.length : (state.companions.comments?.[i] ?? suggestQty ?? sMin);
    el('modal-comment-drop-title').textContent = `Run #${i + 1} — Comments`;
    el('modal-comment-drop-sub').textContent = `Service #${compSid || '?'} limits: min ${sMin}, max ${sMax}`;
    el('comment-drop-qty').min = 0;
    el('comment-drop-qty').max = sMax;
    el('comment-drop-qty').value = curQ;
    el('comment-drop-text').value = curLines.join('\n');
    updateCommentDropLinesBadge();
    el('modal-comment-drop').classList.remove('hidden');
  }

  function initModals() {
    // --- EDIT RUN MODAL (Exact desktop run_dialog parity lines 1736-1805) ---
    el('btn-edit-cancel').addEventListener('click', () => el('modal-edit').classList.add('hidden'));

    if (el('edit-comments-text')) {
      el('edit-comments-text').addEventListener('input', () => {
        const lines = parseCustomCommentLines(el('edit-comments-text').value);
        if (lines.length > 0 && el('edit-comments-qty')) el('edit-comments-qty').value = lines.length;
      });
    }
    if (el('add-comments-text')) {
      el('add-comments-text').addEventListener('input', () => {
        const lines = parseCustomCommentLines(el('add-comments-text').value);
        if (lines.length > 0 && el('add-comments-qty')) el('add-comments-qty').value = lines.length;
      });
    }

    el('btn-edit-save').addEventListener('click', () => {
      if (editStepIdx < 0 || editStepIdx >= state.scheduleRuns.length) return;
      const vQty = parseInt(el('edit-views-qty').value.trim()) || 0;
      const gapTxt = el('edit-gap').value.trim();
      const shift = el('edit-shift-chk').checked;

      const sidTxt = el('auto-sid').value.trim();
      const sid = parseInt(sidTxt);
      const s = state.services[sid];
      const vMin = (s && s.min) ? s.min : 1;
      const vMax = (s && s.max) ? s.max : 1e9;

      if (vQty < vMin || vQty > vMax) {
        alert(`Views quantity ${vQty} is outside this service's limits (${vMin} to ${vMax}). Minimum allowed is ${vMin}.`);
        return;
      }

      let newGap;
      try {
        newGap = parseDuration(gapTxt);
      } catch {
        alert("Gap should look like 30m, 1h, 45m.");
        return;
      }

      // Strict validation for all enabled companion quantities (Likes, Shares, Saves, Comments)
      const compUpdates = {};
      let updatedCustomLines = null;
      for (const c of COMPANION_TYPES) {
        const ids = getCompIds(c);
        if (!el(ids.enabled)?.checked) continue;
        let cQty = parseInt((el(ids.editQty)?.value || '').trim()) || 0;
        if (c.supportsCustomComments && el('edit-comments-text')) {
          const lines = parseCustomCommentLines(el('edit-comments-text').value);
          if (lines.length > 0) {
            cQty = lines.length;
            updatedCustomLines = lines;
          } else {
            updatedCustomLines = [];
          }
        }
        if (cQty > 0) {
          const compSidTxt = el(ids.sid).value.trim();
          if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
            alert(`Please enter a numeric ${c.label} Service ID first.`);
            return;
          }
          const { sMin, sMax } = getCompLimits(c, compSidTxt);
          if (cQty < sMin) {
            alert(`${c.label} quantity ${cQty} is below this service's minimum of ${sMin}. Enter 0 to remove.`);
            return;
          }
          if (cQty > sMax) {
            alert(`${c.label} quantity ${cQty} is above this service's maximum of ${sMax}.`);
            return;
          }
        }
        compUpdates[c.key] = cQty;
      }

      const oldDelay = state.scheduleRuns[editStepIdx][0];
      const prevDelay = editStepIdx ? state.scheduleRuns[editStepIdx - 1][0] : 0.0;
      const newDelay = editStepIdx ? (prevDelay + newGap) : newGap;
      const diff = newDelay - oldDelay;

      state.scheduleRuns[editStepIdx][1] = vQty;
      Object.entries(compUpdates).forEach(([k, cQty]) => {
        if (cQty > 0) state.companions[k][editStepIdx] = cQty;
        else delete state.companions[k][editStepIdx];
      });
      if (updatedCustomLines !== null) {
        if (updatedCustomLines.length > 0 && compUpdates.comments > 0) {
          state.customCommentsMap[editStepIdx] = updatedCustomLines;
        } else {
          delete state.customCommentsMap[editStepIdx];
        }
      }

      if (shift) {
        for (let j = editStepIdx; j < state.scheduleRuns.length; j++) {
          state.scheduleRuns[j][0] += diff;
        }
      } else {
        state.scheduleRuns[editStepIdx][0] = newDelay;
        const decorated = state.scheduleRuns.map((r, idx) => {
          const attached = {};
          COMPANION_TYPES.forEach(c => { attached[c.key] = state.companions[c.key]?.[idx] || null; });
          return { delay: r[0], qty: r[1], attached, customComments: state.customCommentsMap[idx] || null };
        });
        decorated.sort((a, b) => a.delay - b.delay);
        state.scheduleRuns = decorated.map(x => [x.delay, x.qty]);
        resetCompanionMaps();
        decorated.forEach((x, idx) => {
          COMPANION_TYPES.forEach(c => {
            if (x.attached[c.key] !== null) state.companions[c.key][idx] = x.attached[c.key];
          });
          if (x.customComments && x.customComments.length) {
            state.customCommentsMap[idx] = x.customComments;
          }
        });
      }

      el('modal-edit').classList.add('hidden');
      renderAutoTable();
      updateAutoStats();
    });

    // --- ADD RUN MODAL (Exact desktop auto_add parity + multi-companion) ---
    el('btn-add-cancel').addEventListener('click', () => el('modal-add').classList.add('hidden'));

    el('btn-add-save').addEventListener('click', () => {
      const vQty = parseInt(el('add-views-qty').value.trim()) || 0;
      const gapTxt = el('add-gap').value.trim() || '30m';

      const sidTxt = el('auto-sid').value.trim();
      const sid = parseInt(sidTxt);
      const s = state.services[sid];
      const vMin = (s && s.min) ? s.min : 1;
      const vMax = (s && s.max) ? s.max : 1e9;

      if (vQty < vMin || vQty > vMax) {
        alert(`Views quantity ${vQty} is outside service limits (${vMin} to ${vMax}). Minimum allowed is ${vMin}.`);
        return;
      }

      let gapMins;
      try {
        gapMins = parseDuration(gapTxt);
      } catch {
        alert("Gap should look like 30m, 1h, 45m.");
        return;
      }

      const compAdds = {};
      let addedCustomLines = null;
      for (const c of COMPANION_TYPES) {
        const ids = getCompIds(c);
        if (!el(ids.enabled)?.checked) continue;
        const txt = (el(ids.addQty)?.value || '').trim();
        let cQty = txt ? parseInt(txt) : 0;
        if (c.supportsCustomComments && el('add-comments-text')) {
          const lines = parseCustomCommentLines(el('add-comments-text').value);
          if (lines.length > 0) {
            cQty = lines.length;
            addedCustomLines = lines;
          }
        }
        if (cQty > 0) {
          const compSidTxt = el(ids.sid).value.trim();
          if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
            alert(`Please enter a numeric ${c.label} Service ID first.`);
            return;
          }
          const { sMin, sMax } = getCompLimits(c, compSidTxt);
          if (cQty < sMin) {
            alert(`${c.label} quantity ${cQty} is below service minimum (${sMin}). Minimum allowed is ${sMin}.`);
            return;
          }
          if (cQty > sMax) {
            alert(`${c.label} quantity ${cQty} is above service maximum (${sMax}).`);
            return;
          }
          compAdds[c.key] = cQty;
        }
      }

      const lastDelay = state.scheduleRuns.length ? state.scheduleRuns[state.scheduleRuns.length - 1][0] : 0.0;
      const newDelay = lastDelay + gapMins;

      const decorated = state.scheduleRuns.map((r, idx) => {
        const attached = {};
        COMPANION_TYPES.forEach(c => { attached[c.key] = state.companions[c.key]?.[idx] || null; });
        return { delay: r[0], qty: r[1], attached, customComments: state.customCommentsMap[idx] || null };
      });
      decorated.push({ delay: newDelay, qty: vQty, attached: compAdds, customComments: addedCustomLines });
      decorated.sort((a, b) => a.delay - b.delay);

      state.scheduleRuns = decorated.map(x => [x.delay, x.qty]);
      resetCompanionMaps();
      decorated.forEach((x, idx) => {
        COMPANION_TYPES.forEach(c => {
          if (x.attached[c.key] && x.attached[c.key] > 0) state.companions[c.key][idx] = x.attached[c.key];
        });
        if (x.customComments && x.customComments.length) {
          state.customCommentsMap[idx] = x.customComments;
        }
      });

      el('modal-add').classList.add('hidden');
      renderAutoTable();
      updateAutoStats();
    });

    // --- STEP ACTIONS MODAL (MY PLANS) ---
    el('btn-step-cancel').addEventListener('click', () => el('modal-step').classList.add('hidden'));

    // --- COMMENTS DROP MODAL (Per-run Custom Comments + Qty) ---
    if (el('comment-drop-text')) {
      el('comment-drop-text').addEventListener('input', updateCommentDropLinesBadge);
    }
    if (el('btn-comment-drop-cancel')) {
      el('btn-comment-drop-cancel').addEventListener('click', () => el('modal-comment-drop').classList.add('hidden'));
    }
    if (el('btn-comment-drop-remove')) {
      el('btn-comment-drop-remove').addEventListener('click', () => {
        if (commentDropIdx >= 0) {
          delete state.companions.comments[commentDropIdx];
          delete state.customCommentsMap[commentDropIdx];
          log(`Removed comments drop from Run #${commentDropIdx + 1}.`);
          renderAutoTable();
          updateAutoStats();
        }
        el('modal-comment-drop').classList.add('hidden');
      });
    }
    if (el('btn-comment-drop-save')) {
      el('btn-comment-drop-save').addEventListener('click', () => {
        if (commentDropIdx < 0) return;
        const cfg = getCompCfg('comments');
        const ids = getCompIds(cfg);
        const { sMin, sMax } = getCompLimits(cfg, el(ids.sid)?.value);

        const lines = parseCustomCommentLines(el('comment-drop-text').value);
        const q = lines.length > 0 ? lines.length : parseInt(el('comment-drop-qty').value.trim());

        if (isNaN(q) || q < 0) {
          alert('Quantity must be 0 or a positive whole number.');
          return;
        }
        if (q === 0) {
          delete state.companions.comments[commentDropIdx];
          delete state.customCommentsMap[commentDropIdx];
          log(`Removed comments drop from Run #${commentDropIdx + 1}.`);
        } else if (q < sMin) {
          alert(`Comments quantity ${q} is below this service's minimum of ${sMin}.`);
          return;
        } else if (q > sMax) {
          alert(`Comments quantity ${q} is above this service's maximum of ${sMax}.`);
          return;
        } else {
          state.companions.comments[commentDropIdx] = q;
          if (lines.length > 0) {
            state.customCommentsMap[commentDropIdx] = lines;
            log(`Set Run #${commentDropIdx + 1} comments drop to ${q} custom line(s).`);
          } else {
            delete state.customCommentsMap[commentDropIdx];
            log(`Set Run #${commentDropIdx + 1} comments drop to ${q}.`);
          }
          el(ids.enabled).checked = true;
          el(ids.box).style.display = 'flex';
        }

        el('modal-comment-drop').classList.add('hidden');
        renderAutoTable();
        updateAutoStats();
      });
    }
  }

  // --- ROW ACTIONS: EDIT STEP MODAL POPUP ---
  window.anoxyEditStep = function (i) {
    editStepIdx = i;
    const run = state.scheduleRuns[i];
    const prev = i ? state.scheduleRuns[i - 1][0] : 0.0;
    const gapMins = i ? (run[0] - prev) : run[0];

    const sid = parseInt(el('auto-sid').value.trim());
    const s = state.services[sid];
    const vMin = (s && s.min) ? s.min : 1;
    const vMax = (s && s.max) ? s.max : 1e9;

    el('modal-edit-title').textContent = `Edit run ${i + 1}`;
    el('edit-views-qty').value = run[1];
    el('edit-views-qty').min = vMin;
    el('edit-views-qty').max = vMax;
    el('modal-edit-qty-lbl').textContent = `Views Quantity (min ${vMin}, max ${vMax})`;

    el('edit-gap').value = gapToken(gapMins);
    el('modal-edit-gap-lbl').textContent = i ? "Gap after previous run (e.g. 30m, 1h, 45m)" : "Start in (minutes from start)";

    COMPANION_TYPES.forEach(c => {
      const ids = getCompIds(c);
      const compOn = Boolean(el(ids.enabled)?.checked);
      const grp = el(ids.editGroup);
      const inp = el(ids.editQty);
      if (grp) grp.style.display = compOn ? 'block' : 'none';
      if (compOn && inp) {
        const { sMin, sMax } = getCompLimits(c, el(ids.sid)?.value);
        inp.min = sMin;
        inp.max = sMax;
        inp.placeholder = `min ${sMin}, max ${sMax}`;
        const curQty = state.companions[c.key]?.[i];
        inp.value = curQty !== undefined ? curQty : 0;
        if (c.supportsCustomComments && el('edit-comments-text')) {
          el('edit-comments-text').value = (state.customCommentsMap?.[i] || []).join('\n');
        }
      }
    });

    el('edit-shift-group').style.display = (i < state.scheduleRuns.length - 1) ? 'flex' : 'none';
    el('edit-shift-chk').checked = true;

    el('modal-edit').classList.remove('hidden');
  };

  // --- ROW ACTIONS: EDIT & ADD COMPANION BADGES (Likes / Shares / Saves / Comments) ---
  window.anoxyEditCompanion = function (typeKey, i) {
    const cfg = getCompCfg(typeKey);
    const ids = getCompIds(cfg);
    const compSidTxt = el(ids.sid).value.trim();
    if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
      alert(`Please enter a numeric ${cfg.label} Service ID first.`);
      return;
    }
    if (cfg.supportsCustomComments) {
      openCommentDropModal(i);
      return;
    }
    const { sMin, sMax } = getCompLimits(cfg, compSidTxt);

    const curQ = state.companions[cfg.key][i] || sMin;
    const ans = prompt(`Run #${i + 1} ${cfg.label} drop:\n\nEnter quantity (min ${sMin}, max ${sMax}, or 0 to remove):`, curQ);
    if (ans === null) return;
    const q = parseInt(ans.trim());
    if (isNaN(q) || q < 0) {
      alert("Quantity must be 0 or a positive whole number.");
      return;
    }
    if (q === 0) {
      delete state.companions[cfg.key][i];
      log(`Removed ${cfg.label.toLowerCase()} drop from Run #${i + 1}.`);
    } else if (q < sMin) {
      alert(`${cfg.label} quantity ${q} is below this service's minimum of ${sMin}.`);
      return;
    } else if (q > sMax) {
      alert(`${cfg.label} quantity ${q} is above this service's maximum of ${sMax}.`);
      return;
    } else {
      state.companions[cfg.key][i] = q;
      log(`Set Run #${i + 1} ${cfg.label.toLowerCase()} drop to ${q}.`);
    }
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyAddCompanion = function (typeKey, i) {
    const cfg = getCompCfg(typeKey);
    const ids = getCompIds(cfg);
    let compSidTxt = el(ids.sid).value.trim();
    if (!compSidTxt || !/^\d+$/.test(compSidTxt)) {
      const promptSid = prompt(`Enter ${cfg.label} Service ID:`);
      if (!promptSid || !/^\d+$/.test(promptSid.trim())) return;
      compSidTxt = promptSid.trim();
      applyCompanionServiceToUI(cfg.key, compSidTxt, { enableBox: true, overwriteRate: false });
    }
    const { sMin, sMax } = getCompLimits(cfg, compSidTxt);

    let defQ = parseInt(el(ids.dropQty).value.trim()) || sMin;
    if (defQ < sMin) defQ = sMin;
    if (defQ > sMax) defQ = sMax;

    if (cfg.supportsCustomComments) {
      openCommentDropModal(i, defQ);
      return;
    }

    state.companions[cfg.key][i] = defQ;
    el(ids.enabled).checked = true;
    el(ids.box).style.display = 'flex';
    log(`Added ${defQ} ${cfg.label.toLowerCase()} to Run #${i + 1}.`);
    renderAutoTable();
    updateAutoStats();
  };

  window.anoxyEditLikes = i => window.anoxyEditCompanion('likes', i);
  window.anoxyAddLikes = i => window.anoxyAddCompanion('likes', i);

  // --- ROW ACTIONS: DELETE STEP (Exact desktop lines 1910-1925) ---
  window.anoxyDeleteStep = function (i) {
    state.scheduleRuns.splice(i, 1);
    COMPANION_TYPES.forEach(c => {
      const newMap = {};
      for (const [k, v] of Object.entries(state.companions[c.key] || {})) {
        const ki = parseInt(k);
        if (ki < i) newMap[ki] = v;
        else if (ki > i) newMap[ki - 1] = v;
      }
      state.companions[c.key] = newMap;
    });
    const newCustomMap = {};
    for (const [k, v] of Object.entries(state.customCommentsMap || {})) {
      const ki = parseInt(k);
      if (ki < i) newCustomMap[ki] = v;
      else if (ki > i) newCustomMap[ki - 1] = v;
    }
    state.customCommentsMap = newCustomMap;
    renderAutoTable();
    updateAutoStats();
  };

  // --- IMPORT / EXPORT (Exact desktop lines 1927-2005 + Likes/Shares/Saves/Comments) ---
  function readCompConfigFromUI(cfg) {
    const ids = getCompIds(cfg);
    const out = {
      enabled: el(ids.enabled).checked,
      sid: el(ids.sid).value.trim(),
      rate: el(ids.rate).value.trim(),
      total: el(ids.totalQty).value.trim(),
      qty: el(ids.dropQty).value.trim(),
      min: el(ids.minQty).value.trim(),
      max: el(ids.maxQty).value.trim(),
      duration: getSelectedPillVal(ids.durPills),
      custom_dur: el(ids.customDur).value.trim(),
      nruns: getSelectedPillVal(ids.runsPills),
      custom_runs: el(ids.customRuns).value.trim(),
      interval: getSelectedPillVal(ids.intPills),
      custom_int: el(ids.customInt).value.trim(),
      variance: parseInt(el(ids.varSlider).value) || 20,
      map: state.companions[cfg.key] || {}
    };
    if (cfg.supportsCustomComments) {
      out.custom_list = el('comment-custom-list')?.value || '';
      out.custom_mode = el('comment-mode')?.value || 'sequential';
      out.custom_comments_map = state.customCommentsMap || {};
    }
    return out;
  }

  function applyCompConfigToUI(cfg, saved) {
    if (!saved) return;
    const ids = getCompIds(cfg);
    el(ids.enabled).checked = Boolean(saved.enabled);
    el(ids.box).style.display = saved.enabled ? 'flex' : 'none';
    if (saved.sid) el(ids.sid).value = saved.sid;
    if (saved.rate) el(ids.rate).value = saved.rate;
    if (saved.total !== undefined) el(ids.totalQty).value = saved.total;
    if (saved.qty) el(ids.dropQty).value = saved.qty;
    if (saved.min !== undefined) el(ids.minQty).value = saved.min;
    if (saved.max !== undefined) el(ids.maxQty).value = saved.max;
    if (saved.duration) setSelectedPill(ids.durPills, saved.duration);
    if (saved.custom_dur) el(ids.customDur).value = saved.custom_dur;
    if (saved.nruns) setSelectedPill(ids.runsPills, saved.nruns);
    if (saved.custom_runs) el(ids.customRuns).value = saved.custom_runs;
    if (saved.interval) setSelectedPill(ids.intPills, saved.interval);
    if (saved.custom_int) el(ids.customInt).value = saved.custom_int;
    if (saved.variance !== undefined) {
      el(ids.varSlider).value = saved.variance;
      el(ids.varLbl).textContent = `±${saved.variance}%`;
    }
    state.companions[cfg.key] = saved.map || {};
    if (cfg.supportsCustomComments) {
      if (el('comment-custom-list') && saved.custom_list !== undefined) el('comment-custom-list').value = saved.custom_list;
      if (el('comment-mode') && saved.custom_mode) el('comment-mode').value = saved.custom_mode;
      updateCommentLinesBadge();
      state.customCommentsMap = saved.custom_comments_map || {};
    }
    if (saved.sid) applyCompanionServiceToUI(cfg.key, saved.sid, { overwriteRate: false });
  }

  function exportSchedule() {
    if (!state.scheduleRuns.length) {
      alert("No schedule to export.");
      return;
    }
    const companionsData = {};
    COMPANION_TYPES.forEach(c => { companionsData[c.key] = readCompConfigFromUI(c); });
    const likesData = companionsData.likes;

    const data = {
      app: "anoxy_schedular",
      version: 3,
      runs: state.scheduleRuns,
      preset: state.activePreset,
      total_views: el('auto-total-views').value.trim(),
      duration: getSelectedPillVal('auto-dur-pills'),
      custom_dur: el('auto-custom-dur').value.trim(),
      nruns: getSelectedPillVal('auto-runs-pills'),
      custom_nruns: el('auto-custom-runs').value.trim(),
      spread: el('auto-spread-chk').checked,
      variance: parseInt(el('auto-var-slider').value) || 20,
      comp_enabled: likesData.enabled,
      comp_sid: likesData.sid,
      comp_total: likesData.total,
      comp_qty: likesData.qty,
      comp_duration: likesData.duration,
      comp_custom_dur: likesData.custom_dur,
      comp_nruns: likesData.nruns,
      comp_custom_runs: likesData.custom_runs,
      comp_interval: likesData.interval,
      comp_custom_int: likesData.custom_int,
      comp_variance: likesData.variance,
      comp_map: likesData.map,
      companions: companionsData
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
        resetCompanionMaps();
        if (data.total_views) el('auto-total-views').value = data.total_views;
        if (data.duration) setSelectedPill('auto-dur-pills', data.duration);
        if (data.custom_dur) el('auto-custom-dur').value = data.custom_dur;
        if (data.nruns) setSelectedPill('auto-runs-pills', data.nruns);
        if (data.custom_nruns) el('auto-custom-runs').value = data.custom_nruns;
        if (data.variance !== undefined) {
          el('auto-var-slider').value = data.variance;
          el('auto-var-lbl').textContent = `±${data.variance}%`;
        }

        if (data.companions && typeof data.companions === 'object') {
          COMPANION_TYPES.forEach(c => applyCompConfigToUI(c, data.companions[c.key]));
        } else if (data.comp_enabled) {
          applyCompConfigToUI(getCompCfg('likes'), {
            enabled: true,
            sid: data.comp_sid,
            total: data.comp_total,
            qty: data.comp_qty,
            duration: data.comp_duration,
            custom_dur: data.comp_custom_dur,
            nruns: data.comp_nruns,
            custom_runs: data.comp_custom_runs,
            interval: data.comp_interval,
            custom_int: data.comp_custom_int,
            variance: data.comp_variance,
            map: data.comp_map
          });
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
  //  TAB 4: MY PLANS & STEP ACTIONS (Exact desktop lines 2240-2589 + live status poll)
  // ================================================================
  function cacheProviderStatus(orderId, statusStr) {
    if (!orderId || !statusStr) return;
    const key = String(orderId).trim();
    state.providerStatuses[key] = String(statusStr);
    try {
      localStorage.setItem('anoxy_provider_statuses', JSON.stringify(state.providerStatuses));
    } catch (e) {}
  }

  function getStepProviderStatus(step) {
    if (!step) return '';
    if (step.provider_status) return String(step.provider_status);
    const oid = step.order_id !== undefined && step.order_id !== null ? String(step.order_id).trim() : '';
    if (oid && state.providerStatuses[oid]) return state.providerStatuses[oid];
    return '';
  }

  function initPlans() {
    el('btn-plan-refresh').addEventListener('click', async () => {
      await triggerCloudCronDispatch();
      await refreshPlans(true);
    });
    el('btn-plan-cancel').addEventListener('click', cancelSelectedPlan);
    if (el('btn-plan-remove')) {
      el('btn-plan-remove').addEventListener('click', removeSelectedPlan);
    }

    // Step actions: Change quantity (line 2269)
    el('btn-step-qty').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only a 'pending' step can be edited."); return; }
      const sid = step.service_id;
      const s = state.services[sid];
      const minVal = (s && s.min) ? s.min : 1;
      const maxVal = (s && s.max) ? s.max : 1e9;
      const ans = prompt(`New quantity for Step #${step.step_no} (min ${minVal}, max ${maxVal}):`, step.quantity);
      if (ans === null) return;
      const q = parseInt(ans.trim());
      if (isNaN(q) || q < minVal || q > maxVal) {
        alert(`Quantity must be a whole number between ${minVal} and ${maxVal}.`);
        return;
      }
      updateCloudStep(step.id, { quantity: q });
    });

    // Step actions: Move step from now (line 2270)
    el('btn-step-move').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only a 'pending' step can be moved."); return; }
      const ans = prompt("Run this step in how many minutes from now (e.g. 0m, 5m, 1h, 30m):", "30m");
      if (ans === null) return;
      try {
        const mins = parseDuration(ans.trim());
        const newRunAt = Date.now() + mins * 60000;
        updateCloudStep(step.id, { run_at: newRunAt });
      } catch (e) {
        alert(e.message);
      }
    });

    // Step actions: Shift this + later steps (line 2271)
    el('btn-step-shift').addEventListener('click', () => {
      const step = getSelectedStep();
      if (!step) { alert("Select a pending step first."); return; }
      if (step.status !== 'pending') { alert("Only pending steps can be shifted."); return; }
      const ans = prompt("Shift this step and all later pending steps by how much (e.g. 15m, 1h, -10m):", "30m");
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

    // Step actions: Add step (line 2272)
    if (el('btn-step-add')) {
      el('btn-step-add').addEventListener('click', async () => {
        if (!state.selectedPlanId) { alert("Select a plan above first."); return; }
        const plan = state.plans.find(p => String(p.id) === String(state.selectedPlanId));
        if (!plan) return;
        const sid = parseInt(plan.service_id);
        const s = state.services[sid];
        const minVal = (s && s.min) ? s.min : 1;
        const maxVal = (s && s.max) ? s.max : 1e9;

        const qTxt = prompt(`Quantity for the new step (min ${minVal}, max ${maxVal}):`, minVal);
        if (qTxt === null) return;
        const q = parseInt(qTxt.trim());
        if (isNaN(q) || q < minVal || q > maxVal) {
          alert(`Quantity must be between ${minVal} and ${maxVal}.`);
          return;
        }
        const tTxt = prompt("Run it how long from now? (e.g. 2h, 30m, 0m):", "1h");
        if (tTxt === null) return;
        let mins;
        try {
          mins = parseDuration(tTxt.trim());
        } catch (e) {
          alert(e.message);
          return;
        }

        try {
          await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add_step',
              plan_id: plan.id,
              service_id: sid,
              link: plan.link,
              quantity: q,
              run_at: Date.now() + mins * 60000
            })
          });
          log(`Added step (${q}) to plan ${plan.id}.`);
          await refreshPlans(false);
        } catch (err) {
          alert("Error adding step: " + err.message);
        }
      });
    }

    // Step actions: Delete step (line 2274)
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
    return state.steps.find(s => String(s.id) === String(state.selectedStepId) || String(s.step_no) === String(state.selectedStepId));
  }

  async function updateCloudStep(stepId, fields) {
    try {
      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: stepId, ...fields })
      });
      log(`Step updated in 24/7 Cloud.`);
      await refreshPlans(false);
    } catch (err) {
      alert("Error updating step: " + err.message);
    }
  }

  async function shiftLaterSteps(baseStep, deltaMs) {
    const planSteps = state.steps.filter(s => String(s.plan_id) === String(baseStep.plan_id) && s.status === 'pending');
    const toShift = planSteps.filter(s => Number(s.step_no) >= Number(baseStep.step_no));
    for (const s of toShift) {
      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: s.id, run_at: Number(s.run_at) + deltaMs })
      });
    }
    log(`Shifted ${toShift.length} step(s) in cloud.`);
    await refreshPlans(false);
  }

  async function triggerCloudCronDispatch() {
    try {
      const res = await fetch('/api/cron');
      const d = await res.json();
      if (d && Array.isArray(d.results) && d.results.length > 0) {
        d.results.forEach(r => {
          const target = state.steps.find(s => String(s.id) === String(r.step_id));
          if (target) {
            if (r.status) target.status = r.status;
            if (r.order) {
              target.order_id = r.order;
              if (r.provider_status) {
                target.provider_status = r.provider_status;
                cacheProviderStatus(r.order, r.provider_status);
              }
            }
            if (r.run_at) target.run_at = r.run_at;
            if (r.error !== undefined) target.error = r.error;
          }
          if (r.success) {
            log(`Dispatched step ${r.step_id}: sent (order #${r.order}${r.provider_status ? ', ' + r.provider_status : ''}).`);
          } else if (r.error) {
            log(`Step ${r.step_id}: ${r.error}`);
          }
        });
        renderPlansTable();
        setTimeout(() => pollProviderStatuses(), 1200);
      } else {
        await refreshPlans(false);
      }
    } catch (err) {
      log('Dispatch check error: ' + err.message);
    }
  }

  async function pollProviderStatuses() {
    if (state.isPollingStatus) return;
    const url = localStorage.getItem('anoxy_panel_url');
    const key = localStorage.getItem('anoxy_panel_key');
    if (!url || !key) return;

    const sentSteps = state.steps.filter(s => {
      if (s.status !== 'sent') return false;
      const oid = s.order_id !== undefined && s.order_id !== null ? String(s.order_id).trim() : '';
      if (!/^\d+$/.test(oid)) return false;
      const cur = (getStepProviderStatus(s) || '').toLowerCase().trim();
      return !FINAL_STATUSES.has(cur);
    });

    if (!sentSteps.length) return;

    // Unique order IDs (up to 30, matching desktop poll_status)
    const uniqueOrders = [...new Set(sentSteps.map(s => String(s.order_id).trim()))].slice(0, 30);
    state.isPollingStatus = true;

    try {
      const sheetUpdates = [];
      let uiChanged = false;

      // Poll in small chunks of 5 parallel requests
      for (let i = 0; i < uniqueOrders.length; i += 5) {
        const chunk = uniqueOrders.slice(i, i + 5);
        await Promise.all(chunk.map(async oid => {
          try {
            const res = await fetch('/api/panel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'status', order: oid, api_url: url, api_key: key })
            });
            const data = await res.json();
            if (data && data.status) {
              const newStatus = String(data.status);
              const prev = state.providerStatuses[oid] || '';
              if (newStatus !== prev) {
                cacheProviderStatus(oid, newStatus);
                uiChanged = true;
              }
              state.steps.forEach(s => {
                if (String(s.order_id).trim() === oid && s.provider_status !== newStatus) {
                  s.provider_status = newStatus;
                  sheetUpdates.push({ step_id: s.id, provider_status: newStatus });
                  uiChanged = true;
                }
              });
            }
          } catch (e) {}
        }));
      }

      if (uiChanged && el('tab-plans') && el('tab-plans').classList.contains('active')) {
        renderStepsTable(state.selectedPlanId);
      }

      if (sheetUpdates.length > 0) {
        fetch('/api/plans', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_statuses', updates: sheetUpdates })
        }).catch(() => {});
      }
    } finally {
      state.isPollingStatus = false;
    }
  }

  async function refreshPlans(alsoPollStatus = true) {
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      state.plans = data.plans || [];
      state.steps = (data.steps || []).map(s => {
        const oid = s.order_id !== undefined && s.order_id !== null ? String(s.order_id).trim() : '';
        if (!s.provider_status && oid && state.providerStatuses[oid]) {
          s.provider_status = state.providerStatuses[oid];
        } else if (s.provider_status && oid) {
          cacheProviderStatus(oid, s.provider_status);
        }
        return s;
      });
      renderPlansTable();
      if (alsoPollStatus) {
        pollProviderStatuses();
      }
    } catch (err) {
      log('Error syncing plans: ' + err.message);
    }
  }

  function formatExeDateTime(tsMs) {
    const dt = new Date(Number(tsMs));
    if (isNaN(dt.getTime())) return '–';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = n => String(n).padStart(2, '0');
    return `${p(dt.getDate())} ${months[dt.getMonth()]} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
  }

  function renderPlansTable() {
    const tbody = el('plans-tree-body');
    if (!state.plans.length) {
      state.selectedPlanId = null;
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--muted);">No plans scheduled yet.</td></tr>';
      el('steps-tree-body').innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--muted);">Select a plan above.</td></tr>';
      return;
    }

    const exists = state.selectedPlanId && state.plans.some(p => String(p.id) === String(state.selectedPlanId));
    if (!exists) {
      state.selectedPlanId = state.plans[0].id;
    }

    let html = '';
    state.plans.forEach(p => {
      const pSteps = state.steps.filter(s => String(s.plan_id) === String(p.id));
      const pending = pSteps.filter(s => s.status === 'pending').length;
      const sent = pSteps.filter(s => s.status === 'sent').length;
      const totalQty = pSteps.reduce((acc, s) => acc + (parseInt(s.quantity) || 0), 0);
      const nextStep = pSteps.find(s => s.status === 'pending');
      const nextStr = nextStep ? formatExeDateTime(nextStep.run_at) : '-';
      const isSel = String(state.selectedPlanId) === String(p.id);

      html += `
        <tr data-pid="${p.id}" class="plan-row ${isSel ? 'selected' : ''}" style="cursor: pointer;">
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

    // Always keep bottom steps table synchronized with selected plan (exact desktop tick parity!)
    renderStepsTable(state.selectedPlanId);
  }

  function renderStepsTable(planId) {
    const tbody = el('steps-tree-body');
    const pSteps = state.steps.filter(s => String(s.plan_id) === String(planId));

    if (!pSteps.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--muted);">No steps in this plan.</td></tr>';
      return;
    }

    let html = '';
    pSteps.forEach(s => {
      const whenStr = formatExeDateTime(s.run_at);
      let statusColor = 'var(--muted)';
      if (s.status === 'sent') statusColor = 'var(--success)';
      else if (s.status === 'pending') statusColor = 'var(--warning)';
      else if (s.status === 'sending') statusColor = 'var(--accent)';
      else if (s.status === 'failed') statusColor = 'var(--danger)';
      else if (s.status === 'unknown') statusColor = '#9b59b6';

      const svc = state.services[s.service_id];
      const svcTxt = svc ? `#${s.service_id} (${svc.name.substring(0, 14)}...)` : `#${s.service_id}`;
      const sid = s.id || s.step_no;

      const rawOrder = s.order_id !== undefined && s.order_id !== null ? String(s.order_id).trim() : '';
      const isValidOrder = /^\d+$/.test(rawOrder);
      const orderCell = isValidOrder ? rawOrder : (s.status === 'sent' && rawOrder ? rawOrder : '');
      const provStatus = s.status === 'sent' ? (getStepProviderStatus(s) || 'Checking...') : '';
      const customLinesList = s.comments ? String(s.comments).trim().split(/\r?\n/).filter(Boolean) : [];
      const customTag = customLinesList.length ? `Custom (${customLinesList.length}): ${customLinesList[0].slice(0, 22)}${customLinesList.length > 1 ? '...' : ''}` : '';
      const noteCell = s.error || (!isValidOrder && rawOrder && s.status !== 'sent' ? rawOrder : customTag);
      const noteTitle = customLinesList.length ? customLinesList.join(' | ').replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '';

      html += `
        <tr data-stepid="${sid}" class="step-row ${String(state.selectedStepId) === String(sid) ? 'selected' : ''}" style="cursor: pointer; color: ${statusColor};">
          <td>${s.step_no}</td>
          <td>${svcTxt}</td>
          <td style="font-weight: 600;">${s.quantity}</td>
          <td>${whenStr}</td>
          <td style="font-weight: 700;">${s.status}</td>
          <td>${provStatus}</td>
          <td>${orderCell}</td>
          <td title="${noteTitle}">${noteCell}</td>
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
        body: JSON.stringify({ action: 'cancel_plan', plan_id: state.selectedPlanId })
      });
      log(`Plan ${state.selectedPlanId} cancelled.`);
      await refreshPlans(false);
    } catch (err) {
      alert('Failed to cancel plan: ' + err.message);
    }
  }

  async function removeSelectedPlan() {
    if (!state.selectedPlanId) {
      alert('Select a plan first.');
      return;
    }
    const busy = state.steps.some(s => String(s.plan_id) === String(state.selectedPlanId) && (s.status === 'pending' || s.status === 'sending'));
    if (busy) {
      alert('Still active: Cancel the plan first, or wait until it finishes.');
      return;
    }
    try {
      await fetch('/api/plans', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_plan', plan_id: state.selectedPlanId })
      });
      state.selectedPlanId = null;
      await refreshPlans(false);
    } catch (err) {
      alert('Failed to remove plan: ' + err.message);
    }
  }

})();
