/**
 * app.js — ADHD Prescribing NI
 *
 * Vanilla JS single-page application. No frameworks, no build step.
 * Depends on Chart.js loaded from CDN (global `Chart`).
 *
 * Routing:  hash-based  (#practice/1001  →  practice detail)
 * Data:     fetched on demand from /site/data/
 */

(() => {
  'use strict';

  /* =========================================================================
     Constants
     ========================================================================= */

  /**
   * Canonical data period. Charts always show the full period so that months
   * with zero prescribing are explicit rather than absent.
   */
  const DATA_START = '2015-01';
  const DATA_END   = '2025-12';

  const DRUG_NAMES = [
    'Methylphenidate',
    'Lisdexamfetamine',
    'Atomoxetine',
    'Dexamfetamine',
    'Guanfacine',
  ];

  const DRUG_COLORS = {
    'Methylphenidate':  '#3b82f6',  // blue
    'Lisdexamfetamine': '#10b981',  // emerald
    'Atomoxetine':      '#f59e0b',  // amber
    'Dexamfetamine':    '#8b5cf6',  // violet
    'Guanfacine':       '#ef4444',  // red
    '_other':           '#94a3b8',  // slate (fallback)
  };

  /* =========================================================================
     State
     ========================================================================= */

  const state = {
    index:    null,   // practices-index.json array
    practice: null,   // current loaded practice JSON
    charts: {
      total: null,
      drugs: null,
    },
  };

  /* =========================================================================
     DOM helpers
     ========================================================================= */

  const $ = id => document.getElementById(id);

  function show(el)  { el.classList.remove('hidden'); }
  function hide(el)  { el.classList.add('hidden'); }

  /**
   * Reveal an element with a fade-up animation.
   * Uses double-rAF so the browser registers display:block before animating.
   */
  function reveal(el, animClass = 'is-entering') {
    el.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add(animClass);
        el.addEventListener(
          'animationend',
          () => el.classList.remove(animClass),
          { once: true }
        );
      });
    });
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  /* =========================================================================
     Number formatting
     ========================================================================= */

  /** Comma-separated integer: 1234 → "1,234" */
  function fmt(n) {
    return Number(n).toLocaleString('en-GB');
  }

  /** Currency with 2 dp: 1234.5 → "£1,234.50" */
  function fmtGbp(n) {
    return '£' + Number(n).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /* =========================================================================
     Month utilities
     ========================================================================= */

  /**
   * Generate sorted list of YYYY-MM strings from start to end, inclusive.
   * Used to build the chart X-axis with explicit zeros for missing months.
   */
  function buildMonthRange(start, end) {
    const months = [];
    let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      if (++m > 12) { m = 1; y++; }
    }
    return months;
  }

  /** "2023-06" → "Jun '23" */
  function monthLabel(m) {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1).toLocaleDateString('en-GB', {
      month: 'short',
      year:  '2-digit',
    });
  }

  /* =========================================================================
     Router
     ========================================================================= */

  const router = {
    init() {
      window.addEventListener('hashchange', () => this.dispatch());
      this.dispatch();
    },

    dispatch() {
      const hash  = window.location.hash.replace(/^#\/?/, '');
      const parts = hash.split('/');

      if (parts[0] === 'practice' && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (!isNaN(id)) {
          loadPractice(id);
          return;
        }
      }

      showLanding();
    },

    go(path) {
      window.location.hash = path;
    },
  };

  /* =========================================================================
     View: Landing
     ========================================================================= */

  function showLanding() {
    hide($('view-practice'));
    reveal($('view-landing'));
    hide($('error-banner'));
    document.title = 'ADHD Prescribing in Northern Ireland';

    const input = $('search-input');
    if (input) {
      input.value = '';
      input.setAttribute('aria-expanded', 'false');
    }
    hide($('search-results'));
    hide($('search-clear'));

    window.scrollTo({ top: 0, behavior: 'instant' });

    // Focus the search box once the fade is complete
    setTimeout(() => input && input.focus(), 80);
  }

  /* =========================================================================
     View: Practice detail
     ========================================================================= */

  async function loadPractice(id) {
    // Immediately show the practice shell with skeleton
    hide($('view-landing'));
    hide($('practice-content'));
    hide($('error-banner'));
    show($('view-practice'));
    reveal($('practice-skeleton'));

    window.scrollTo({ top: 0, behavior: 'instant' });

    try {
      const res = await fetch(`data/practices/${id}.json`);
      if (!res.ok) throw new Error(`Practice ${id} not found (HTTP ${res.status})`);
      const data = await res.json();
      state.practice = data;
      renderPractice(data);

      // Swap skeleton → content
      hide($('practice-skeleton'));
      reveal($('practice-content'), 'is-revealing');

      document.title = `${titleCase(data.surgeryName || data.doctorName || '')} — ADHD Prescribing NI`;
    } catch (err) {
      console.error(err);
      hide($('practice-skeleton'));
      showError(err.message);
    }
  }

  /* =========================================================================
     Practice rendering
     ========================================================================= */

  function renderPractice(data) {
    // ---- Header ----
    $('practice-lcg-tag').textContent    = data.lcg                            || '';
    $('practice-name').textContent       = titleCase(data.surgeryName          || '');
    $('practice-doctor').textContent     = titleCase(data.doctorName           || '');
    $('practice-address').textContent    = data.address                        || '';
    $('practice-postcode').textContent   = data.postcode                       || '';
    $('practice-id').textContent         = data.id;

    // ---- Determine month range ----
    // Always plot the full canonical period so every month is represented
    // on the X-axis. Months absent from prescribing{} are treated as zero.
    const allMonths         = buildMonthRange(DATA_START, DATA_END);
    const prescribedMonths  = Object.keys(data.prescribing || {});
    const hasData           = prescribedMonths.length > 0;

    if (!hasData) {
      setText('stat-total',    '0');
      setText('stat-avg',      '0');
      setText('stat-top-drug', 'No data');
      setText('stat-trend',    '—');
      show($('no-data-notice'));
      hide($('charts-grid'));
      hide($('drug-table-card'));
      return;
    }

    hide($('no-data-notice'));
    show($('charts-grid'));
    show($('drug-table-card'));

    // ---- Aggregate drug totals ----
    const drugTotals = {};   // drug → total items across the period
    const drugCosts  = {};   // drug → total actual_cost
    let   grandTotal = 0;
    let   grandCost  = 0;

    allMonths.forEach(m => {
      const md = data.prescribing[m];
      if (!md) return;
      grandTotal += md.total_items || 0;
      grandCost  += md.actual_cost || 0;
      Object.entries(md.drugs || {}).forEach(([drug, d]) => {
        drugTotals[drug] = (drugTotals[drug] || 0) + (d.total_items || 0);
        drugCosts[drug]  = (drugCosts[drug]  || 0) + (d.actual_cost  || 0);
      });
    });

    // ---- Summary stats ----
    const monthsWithData = allMonths.filter(m => data.prescribing[m]);
    const avgItems = monthsWithData.length > 0
      ? Math.round(grandTotal / monthsWithData.length)
      : 0;

    const topDrug = Object.entries(drugTotals)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Trend: compare the average of the earliest third vs latest third
    // of months that actually have data.
    let trendText  = '—';
    let trendClass = 'stat-value stat-value--flat';

    if (monthsWithData.length >= 6) {
      const third     = Math.floor(monthsWithData.length / 3);
      const early     = monthsWithData.slice(0, third);
      const late      = monthsWithData.slice(-third);
      const earlyAvg  = early.reduce((s, m) => s + (data.prescribing[m]?.total_items || 0), 0) / early.length;
      const lateAvg   = late.reduce( (s, m) => s + (data.prescribing[m]?.total_items || 0), 0) / late.length;

      if (earlyAvg > 0) {
        const pct = ((lateAvg - earlyAvg) / earlyAvg) * 100;
        if (Math.abs(pct) < 5) {
          trendText  = '→ Stable';
          trendClass = 'stat-value stat-value--flat';
        } else if (pct > 0) {
          trendText  = `↑ +${pct.toFixed(0)}%`;
          trendClass = 'stat-value stat-value--up';
        } else {
          trendText  = `↓ ${pct.toFixed(0)}%`;
          trendClass = 'stat-value stat-value--down';
        }
      }
    }

    setText('stat-total',    fmt(grandTotal));
    setText('stat-avg',      fmt(avgItems));
    setText('stat-top-drug', topDrug);
    const trendEl = $('stat-trend');
    trendEl.textContent = trendText;
    trendEl.className   = trendClass;

    // ---- Charts ----
    renderTotalChart(data, allMonths);
    renderDrugChart(data, allMonths);

    // ---- Table ----
    renderDrugTable(drugTotals, drugCosts, grandTotal, grandCost, monthsWithData.length);
  }

  /* =========================================================================
     Chart rendering
     ========================================================================= */

  // Apply Inter font and muted colour to all Chart.js instances.
  // (Chart.js is loaded before this script in the HTML, so `Chart` is defined.)
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color       = '#7b8fa8';

  const TOOLTIP_BASE = {
    backgroundColor: '#0c1a2e',
    titleColor:  'rgba(255,255,255,0.9)',
    bodyColor:   'rgba(255,255,255,0.75)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    padding:     12,
    cornerRadius: 8,
    titleFont:  { size: 12, weight: '600' },
    bodyFont:   { size: 12 },
    displayColors: false,
  };

  const AXIS_GRID  = { color: 'rgba(0,0,0,0.045)' };
  const AXIS_TICKS = { font: { size: 11 }, color: '#7b8fa8', maxTicksLimit: 12 };

  function renderTotalChart(data, months) {
    if (state.charts.total) {
      state.charts.total.destroy();
      state.charts.total = null;
    }

    const canvas  = $('chart-total');
    const ctx     = canvas.getContext('2d');
    const labels  = months.map(monthLabel);

    // Zero-fill: months absent from prescribing get 0
    const values  = months.map(m => data.prescribing[m]?.total_items || 0);

    // Gradient derived from the canvas's actual rendered height
    const chartH  = canvas.parentElement.clientHeight || 270;
    const grad    = ctx.createLinearGradient(0, 0, 0, chartH);
    grad.addColorStop(0,   'rgba(37, 99, 235, 0.2)');
    grad.addColorStop(1,   'rgba(37, 99, 235, 0)');

    state.charts.total = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Total items',
          data:  values,
          borderColor:      '#2563eb',
          backgroundColor:  grad,
          borderWidth:      2.5,
          pointRadius:      months.length > 24 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#2563eb',
          pointBorderColor:     '#fff',
          pointBorderWidth:     1.5,
          fill:    true,
          tension: 0.35,
          // Treat 0-value points as real data (not gaps)
          spanGaps: false,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              title: items => items[0].label,
              label: ctx  => ` ${fmt(ctx.parsed.y)} items`,
            },
          },
        },
        scales: {
          x: {
            grid:   AXIS_GRID,
            ticks:  AXIS_TICKS,
            border: { color: 'transparent' },
          },
          y: {
            beginAtZero: true,
            grid:   AXIS_GRID,
            ticks:  { ...AXIS_TICKS, callback: v => fmt(v) },
            border: { color: 'transparent' },
          },
        },
      },
    });
  }

  function renderDrugChart(data, months) {
    if (state.charts.drugs) {
      state.charts.drugs.destroy();
      state.charts.drugs = null;
    }

    const ctx    = $('chart-drugs').getContext('2d');
    const labels = months.map(monthLabel);

    // Collect drugs present in ANY month (across the full period)
    const presentDrugs = new Set();
    months.forEach(m => {
      Object.keys(data.prescribing[m]?.drugs || {}).forEach(d => presentDrugs.add(d));
    });

    // Order canonically, then any unknown drugs
    const orderedDrugs = [
      ...DRUG_NAMES.filter(d => presentDrugs.has(d)),
      ...[...presentDrugs].filter(d => !DRUG_NAMES.includes(d)),
    ];

    const datasets = orderedDrugs.map(drug => {
      const base = DRUG_COLORS[drug] || DRUG_COLORS['_other'];
      return {
        label:           drug,
        // Zero-fill: months absent from prescribing or drug absent from that month → 0
        data:            months.map(m => data.prescribing[m]?.drugs?.[drug]?.total_items || 0),
        backgroundColor: base + 'cc',
        borderColor:     base,
        borderWidth:     1,
        borderRadius:    0,
        stack:           'drugs',
      };
    });

    state.charts.drugs = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font:         { size: 11 },
              color:        '#3d4f68',
              boxWidth:     10,
              boxHeight:    10,
              padding:      14,
              usePointStyle: true,
              pointStyle:   'circle',
            },
          },
          tooltip: {
            ...TOOLTIP_BASE,
            displayColors: true,
            boxWidth:  10,
            boxHeight: 10,
            callbacks: {
              title: items => items[0].label,
              label: ctx  => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
              // Filter out zero-value datasets so tooltip isn't cluttered
              afterLabel: ctx => null,
            },
            filter: item => item.parsed.y > 0,
          },
        },
        scales: {
          x: {
            stacked: true,
            grid:    { display: false },
            ticks:   AXIS_TICKS,
            border:  { color: 'transparent' },
          },
          y: {
            stacked:     true,
            beginAtZero: true,
            grid:        AXIS_GRID,
            ticks:       { ...AXIS_TICKS, callback: v => fmt(v) },
            border:      { color: 'transparent' },
          },
        },
      },
    });
  }

  /* =========================================================================
     Drug table
     ========================================================================= */

  function renderDrugTable(drugTotals, drugCosts, grandTotal, grandCost, numMonths) {
    const tbody = $('drug-table-body');
    tbody.innerHTML = '';

    const sorted = Object.entries(drugTotals).sort((a, b) => b[1] - a[1]);

    sorted.forEach(([drug, total]) => {
      const color      = DRUG_COLORS[drug] || DRUG_COLORS['_other'];
      const avgMonthly = numMonths > 0 ? Math.round(total / numMonths) : 0;
      const share      = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0';
      const cost       = drugCosts[drug] || 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <span class="drug-swatch" style="background:${color}" aria-hidden="true"></span>
          ${escHtml(drug)}
        </td>
        <td class="col-num">${fmt(total)}</td>
        <td class="col-num">${fmt(avgMonthly)}</td>
        <td class="col-num">${share}%</td>
        <td class="col-num">${fmtGbp(cost)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Totals row
    const totalsRow = document.createElement('tr');
    totalsRow.className = 'table-totals-row';
    totalsRow.innerHTML = `
      <td>All ADHD medications</td>
      <td class="col-num">${fmt(grandTotal)}</td>
      <td class="col-num">${fmt(numMonths > 0 ? Math.round(grandTotal / numMonths) : 0)}</td>
      <td class="col-num">100%</td>
      <td class="col-num">${fmtGbp(grandCost)}</td>
    `;
    tbody.appendChild(totalsRow);
  }

  /* =========================================================================
     Search / Autocomplete
     ========================================================================= */

  const search = {
    input:      null,
    results:    null,
    clearBtn:   null,
    focusIndex: -1,
    debounce:   null,

    init() {
      this.input    = $('search-input');
      this.results  = $('search-results');
      this.clearBtn = $('search-clear');

      if (!this.input) return;

      this.input.addEventListener('input', () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.run(), 130);
        this.input.value.trim()
          ? show(this.clearBtn)
          : hide(this.clearBtn);
      });

      this.input.addEventListener('keydown', e => this.onKey(e));

      // Re-open dropdown when field is focused with existing text
      this.input.addEventListener('focus', () => {
        if (this.input.value.trim()) this.run();
      });

      this.clearBtn.addEventListener('click', () => {
        this.input.value = '';
        hide(this.clearBtn);
        this.close();
        this.input.focus();
      });

      // Close dropdown on outside click
      document.addEventListener('click', e => {
        if (!e.target.closest('.search-container')) this.close();
      });
    },

    run() {
      const q = this.input.value.trim().toLowerCase();

      if (!q) { this.close(); return; }
      if (!state.index) return;

      const qs = q.replace(/\s/g, '');
      const hits = state.index
        .filter(p =>
          (p.surgeryName || '').toLowerCase().includes(q) ||
          (p.doctorName  || '').toLowerCase().includes(q) ||
          // Postcode: strip spaces so "BT37" matches "BT37 9RH"
          p.postcode.toLowerCase().replace(/\s/g, '').includes(qs) ||
          p.lcg.toLowerCase().includes(q) ||
          (p.address && p.address.toLowerCase().includes(q))
        )
        .slice(0, 10);

      this.render(hits, q);
    },

    render(hits, q) {
      this.results.innerHTML = '';
      this.focusIndex = -1;

      if (hits.length === 0) {
        const li = document.createElement('li');
        li.className   = 'sr-empty';
        li.textContent = `No practices found matching "${q}"`;
        this.results.appendChild(li);
        this.open();
        return;
      }

      hits.forEach(p => {
        const li = document.createElement('li');
        li.className = 'sr-item';
        li.setAttribute('role', 'option');
        li.dataset.id = p.id;

        const surgery = titleCase(p.surgeryName || '');
        const doctor  = titleCase(p.doctorName  || '');

        // Show surgery name prominently; doctor name in brackets underneath
        li.innerHTML = `
          <svg class="sr-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <div>
            <div class="sr-name">${hl(surgery, q)} <span class="sr-doctor">(${hl(doctor, q)})</span></div>
            <div class="sr-sub">${hl(p.postcode, q)} &middot; ${hl(p.lcg, q)}</div>
          </div>
        `;

        li.addEventListener('click', () => this.select(p.id));
        this.results.appendChild(li);
      });

      this.open();
    },

    select(id) {
      this.close();
      router.go(`practice/${id}`);
    },

    onKey(e) {
      const items = [...this.results.querySelectorAll('.sr-item')];
      if (!items.length && e.key !== 'Escape') return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.focusIndex = Math.min(this.focusIndex + 1, items.length - 1);
          this.updateFocus(items);
          break;

        case 'ArrowUp':
          e.preventDefault();
          this.focusIndex = Math.max(this.focusIndex - 1, -1);
          this.updateFocus(items);
          break;

        case 'Enter':
          e.preventDefault();
          if (this.focusIndex >= 0 && items[this.focusIndex]) {
            this.select(items[this.focusIndex].dataset.id);
          }
          break;

        case 'Escape':
          this.close();
          break;
      }
    },

    updateFocus(items) {
      items.forEach((el, i) => el.classList.toggle('focused', i === this.focusIndex));
      items[this.focusIndex]?.scrollIntoView({ block: 'nearest' });
    },

    open() {
      show(this.results);
      this.input.setAttribute('aria-expanded', 'true');
    },

    close() {
      hide(this.results);
      this.input.setAttribute('aria-expanded', 'false');
      this.focusIndex = -1;
    },
  };

  /* =========================================================================
     Text utilities
     ========================================================================= */

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Wrap matching substrings with <mark> for search highlighting. */
  function hl(text, query) {
    const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escHtml(text).replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>');
  }

  /**
   * Convert ALL-CAPS practice names to Title Case.
   * Handles possessives: "BRENDAN'S" → "Brendan's".
   * Works even when the input has a mixed-case prefix like "Dr. HOEY & PARTNERS".
   */
  function titleCase(str) {
    if (!str) return str;
    return str
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())   // capitalise each word start
      .replace(/'S\b/g, "'s");                  // fix possessive 'S → 's
  }

  /* =========================================================================
     Error display
     ========================================================================= */

  function showError(message) {
    $('error-text').textContent = message;
    show($('error-banner'));
  }

  /* =========================================================================
     Initialisation
     ========================================================================= */

  async function init() {
    // Load the practices index for search autocomplete
    try {
      const res = await fetch('data/practices-index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.index = await res.json();

      const countStr = fmt(state.index.length);
      setText('kpi-practices',   countStr);
      setText('practice-count',  countStr);
    } catch (err) {
      console.error('Failed to load practices index:', err);
      showError('Could not load practice data. Try refreshing the page.');
    }

    search.init();

    // Back button uses pushState to clear the hash cleanly, then manually
    // triggers the landing view. This avoids the hashchange → hashchange loop
    // that would occur if we just set window.location.hash = ''.
    $('back-btn').addEventListener('click', () => {
      history.pushState(null, '', window.location.pathname + window.location.search);
      showLanding();
    });

    // Router reads the current URL hash and dispatches the initial view
    router.init();
  }

  // Boot once the DOM is ready (script is at bottom of body, so usually immediate)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
