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

  const DRUG_NAMES = [
    'Methylphenidate',
    'Lisdexamfetamine',
    'Atomoxetine',
    'Dexamfetamine',
    'Guanfacine',
  ];

  // Must match order of DRUG_NAMES
  const DRUG_COLORS = {
    'Methylphenidate':  '#3b82f6',
    'Lisdexamfetamine': '#10b981',
    'Atomoxetine':      '#f59e0b',
    'Dexamfetamine':    '#8b5cf6',
    'Guanfacine':       '#ef4444',
    '_other':           '#94a3b8',
  };

  // Alpha values for bar chart backgrounds
  const BAR_ALPHA = 'cc';

  /* =========================================================================
     State
     ========================================================================= */

  const state = {
    index: null,          // practices-index.json array
    practice: null,       // current practice JSON
    charts: {
      total: null,
      drugs: null,
    },
  };

  /* =========================================================================
     DOM helpers
     ========================================================================= */

  const $ = id => document.getElementById(id);

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-GB');
  }

  function fmtGbp(n) {
    return '£' + Number(n).toLocaleString('en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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
      const hash = window.location.hash.replace(/^#\/?/, '');
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
    show($('view-landing'));
    hide($('error-banner'));
    document.title = 'ADHD Prescribing in Northern Ireland';

    // Reset search field
    const input = $('search-input');
    if (input) {
      input.value = '';
      input.setAttribute('aria-expanded', 'false');
    }
    hide($('search-results'));
    hide($('search-clear'));

    window.scrollTo({ top: 0, behavior: 'instant' });

    // Focus search box after brief delay (allows layout to settle)
    setTimeout(() => input && input.focus(), 60);
  }

  /* =========================================================================
     View: Practice detail
     ========================================================================= */

  async function loadPractice(id) {
    show($('loading'));
    hide($('error-banner'));
    hide($('view-landing'));
    hide($('view-practice'));

    try {
      const res = await fetch(`data/practices/${id}.json`);
      if (!res.ok) throw new Error(`Practice ${id} not found (HTTP ${res.status})`);
      const data = await res.json();
      state.practice = data;
      renderPractice(data);
      show($('view-practice'));
      document.title = `${titleCase(data.name)} — ADHD Prescribing NI`;
    } catch (err) {
      console.error(err);
      showError(err.message);
      // Still show the practice view so back-button is accessible
      show($('view-practice'));
    } finally {
      hide($('loading'));
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  function renderPractice(data) {
    // ---- Header info ----
    $('practice-lcg-tag').textContent = data.lcg || '';
    $('practice-name').textContent    = titleCase(data.name);
    $('practice-address').textContent = data.address || '';
    $('practice-postcode').textContent = data.postcode || '';
    $('practice-id').textContent      = data.id;

    const months = Object.keys(data.prescribing || {}).sort();

    if (months.length === 0) {
      // No prescribing data
      setText('stat-total', '0');
      setText('stat-avg', '0');
      setText('stat-top-drug', 'No data');
      setText('stat-trend', '—');
      show($('no-data-notice'));
      hide($('charts-grid'));
      hide($('drug-table-card'));
      return;
    }

    hide($('no-data-notice'));
    show($('charts-grid'));
    show($('drug-table-card'));

    // ---- Aggregate drug totals ----
    const drugTotals   = {};  // drug → total items
    const drugCosts    = {};  // drug → total actual_cost
    let   grandTotal   = 0;
    let   grandCost    = 0;

    months.forEach(m => {
      const monthData = data.prescribing[m];
      grandTotal += monthData.total_items || 0;
      grandCost  += monthData.actual_cost || 0;

      Object.entries(monthData.drugs || {}).forEach(([drug, d]) => {
        drugTotals[drug] = (drugTotals[drug] || 0) + d.total_items;
        drugCosts[drug]  = (drugCosts[drug]  || 0) + d.actual_cost;
      });
    });

    // ---- Summary stats ----
    const avgItems = Math.round(grandTotal / months.length);

    const topDrug = Object.entries(drugTotals)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Trend: compare last third vs first third of period
    let trendText  = '—';
    let trendClass = 'stat-value stat-value--flat';

    if (months.length >= 6) {
      const third = Math.floor(months.length / 3);
      const earlyMonths = months.slice(0, third);
      const lateMonths  = months.slice(-third);

      const earlyAvg = earlyMonths.reduce((s, m) => s + data.prescribing[m].total_items, 0) / earlyMonths.length;
      const lateAvg  = lateMonths.reduce((s, m)  => s + data.prescribing[m].total_items, 0) / lateMonths.length;

      if (earlyAvg === 0) {
        trendText  = '—';
        trendClass = 'stat-value stat-value--flat';
      } else {
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
    renderTotalChart(data, months);
    renderDrugChart(data, months);

    // ---- Table ----
    renderDrugTable(drugTotals, drugCosts, grandTotal, grandCost, months.length);
  }

  /* =========================================================================
     Chart rendering
     ========================================================================= */

  // Shared Chart.js default overrides
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color       = '#7b8fa8';

  const TOOLTIP_BASE = {
    backgroundColor: '#0c1a2e',
    titleColor: 'rgba(255,255,255,0.9)',
    bodyColor:  'rgba(255,255,255,0.75)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    padding: 12,
    cornerRadius: 8,
    titleFont:  { size: 12, weight: '600' },
    bodyFont:   { size: 12 },
    displayColors: false,
  };

  const AXIS_GRID = { color: 'rgba(0,0,0,0.045)' };
  const AXIS_TICKS = { font: { size: 11 }, color: '#7b8fa8', maxTicksLimit: 12 };

  function monthLabel(m) {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1).toLocaleDateString('en-GB', {
      month: 'short',
      year: '2-digit',
    });
  }

  function renderTotalChart(data, months) {
    if (state.charts.total) {
      state.charts.total.destroy();
      state.charts.total = null;
    }

    const ctx    = $('chart-total').getContext('2d');
    const labels = months.map(monthLabel);
    const values = months.map(m => data.prescribing[m].total_items || 0);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, 270);
    grad.addColorStop(0,   'rgba(37, 99, 235, 0.18)');
    grad.addColorStop(1,   'rgba(37, 99, 235, 0)');

    state.charts.total = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Total items',
          data: values,
          borderColor: '#2563eb',
          backgroundColor: grad,
          borderWidth: 2.5,
          pointRadius: months.length > 24 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#2563eb',
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          fill: true,
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              title: items => items[0].label,
              label: ctx => ` ${fmt(ctx.parsed.y)} items`,
            },
          },
        },
        scales: {
          x: {
            grid: AXIS_GRID,
            ticks: AXIS_TICKS,
            border: { color: 'transparent' },
          },
          y: {
            beginAtZero: true,
            grid: AXIS_GRID,
            ticks: {
              ...AXIS_TICKS,
              callback: v => fmt(v),
            },
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

    // Collect all drugs present; order by DRUG_NAMES, then extras
    const presentDrugs = new Set();
    months.forEach(m => {
      Object.keys(data.prescribing[m].drugs || {}).forEach(d => presentDrugs.add(d));
    });

    const orderedDrugs = [
      ...DRUG_NAMES.filter(d => presentDrugs.has(d)),
      ...[...presentDrugs].filter(d => !DRUG_NAMES.includes(d)),
    ];

    const datasets = orderedDrugs.map(drug => {
      const baseColor = DRUG_COLORS[drug] || DRUG_COLORS['_other'];
      return {
        label: drug,
        data: months.map(m => data.prescribing[m].drugs?.[drug]?.total_items || 0),
        backgroundColor: baseColor + BAR_ALPHA,
        borderColor: baseColor,
        borderWidth: 1,
        borderRadius: 0,
        stack: 'drugs',
      };
    });

    state.charts.drugs = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 11 },
              color: '#3d4f68',
              boxWidth: 10,
              boxHeight: 10,
              padding: 14,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            ...TOOLTIP_BASE,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            callbacks: {
              title: items => items[0].label,
              label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: AXIS_TICKS,
            border: { color: 'transparent' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: AXIS_GRID,
            ticks: {
              ...AXIS_TICKS,
              callback: v => fmt(v),
            },
            border: { color: 'transparent' },
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
    input:       null,
    results:     null,
    clearBtn:    null,
    focusIndex:  -1,
    debounce:    null,

    init() {
      this.input    = $('search-input');
      this.results  = $('search-results');
      this.clearBtn = $('search-clear');

      if (!this.input) return;

      this.input.addEventListener('input', () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.run(), 130);
        const hasValue = this.input.value.trim().length > 0;
        hasValue ? show(this.clearBtn) : hide(this.clearBtn);
      });

      this.input.addEventListener('keydown', e => this.onKey(e));

      this.input.addEventListener('focus', () => {
        if (this.input.value.trim()) this.run();
      });

      this.clearBtn.addEventListener('click', () => {
        this.input.value = '';
        hide(this.clearBtn);
        this.close();
        this.input.focus();
      });

      document.addEventListener('click', e => {
        if (!e.target.closest('.search-container')) this.close();
      });
    },

    run() {
      const q = this.input.value.trim().toLowerCase();

      if (!q) {
        this.close();
        return;
      }

      if (!state.index) return;

      const hits = state.index
        .filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.postcode.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
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
        li.className = 'sr-empty';
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

        li.innerHTML = `
          <svg class="sr-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <div>
            <div class="sr-name">${hl(p.name, q)}</div>
            <div class="sr-sub">${hl(p.postcode, q)} &middot; ${escHtml(p.lcg)}</div>
          </div>
        `;

        li.addEventListener('click', () => {
          this.select(p.id);
        });

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
            const id = items[this.focusIndex].dataset.id;
            this.select(id);
          }
          break;

        case 'Escape':
          this.close();
          break;
      }
    },

    updateFocus(items) {
      items.forEach((item, i) => {
        item.classList.toggle('focused', i === this.focusIndex);
      });
      if (this.focusIndex >= 0) {
        items[this.focusIndex]?.scrollIntoView({ block: 'nearest' });
      }
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
     Utility: text helpers
     ========================================================================= */

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hl(text, query) {
    // Highlight matching substrings
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${safeQuery})`, 'gi');
    return escHtml(text).replace(re, '<mark>$1</mark>');
  }

  function titleCase(str) {
    // Convert ALL-CAPS practice names to Title Case
    if (!str) return str;
    if (str === str.toUpperCase()) {
      return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }
    return str;
  }

  /* =========================================================================
     Error display
     ========================================================================= */

  function showError(message) {
    const banner = $('error-banner');
    $('error-text').textContent = message;
    show(banner);
  }

  /* =========================================================================
     Initialisation
     ========================================================================= */

  async function init() {
    // Load practices index for search
    try {
      const res = await fetch('data/practices-index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.index = await res.json();

      // Update KPI counts
      const count = state.index.length;
      const countStr = fmt(count);
      setText('kpi-practices', countStr);
      setText('practice-count', countStr);
    } catch (err) {
      console.error('Failed to load practices index:', err);
      showError('Could not load practice index. Try refreshing the page.');
    }

    // Wire up search
    search.init();

    // Back button
    $('back-btn').addEventListener('click', () => {
      // Use pushState to clear the hash without reloading
      history.pushState(null, '', window.location.pathname + window.location.search);
      showLanding();
    });

    // Start router (reads current hash and renders correct view)
    router.init();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
