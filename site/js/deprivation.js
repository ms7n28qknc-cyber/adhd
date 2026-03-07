/**
 * deprivation.js — ADHD Prescribing NI
 * Loads data/deprivation-analysis.json and renders:
 *   • Key finding statement
 *   • Line chart: rate per quintile over time (2015–2025)
 *   • Bar chart: rate by quintile for the most recent year
 *   • Table: rates by quintile and year
 *   • Practice count and caveat
 *
 * Falls back gracefully if the JSON doesn't exist yet (runs silently until
 * assign_deprivation.py has been executed).
 */
(function () {
  'use strict';

  const YEARS = ['2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'];

  const Q_COLORS = {
    '1': '#dc2626',   // red   — most deprived
    '2': '#f97316',   // orange
    '3': '#d97706',   // amber
    '4': '#16a34a',   // green
    '5': '#2563eb',   // blue  — least deprived
  };
  const NI_COLOR = '#9ca3af';

  const Q_LABELS = {
    '1': 'Q1 — Most Deprived',
    '2': 'Q2',
    '3': 'Q3',
    '4': 'Q4',
    '5': 'Q5 — Least Deprived',
  };

  const TOOLTIP_BASE = {
    backgroundColor: '#0c1a2e',
    titleColor:      'rgba(255,255,255,0.9)',
    bodyColor:       'rgba(255,255,255,0.75)',
    borderColor:     'rgba(255,255,255,0.08)',
    borderWidth:     1,
    padding:         12,
    cornerRadius:    8,
  };

  const AXIS_GRID  = { color: 'rgba(0,0,0,0.045)' };
  const AXIS_TICKS = { font: { size: 11 }, color: '#7b8fa8' };

  function fmtRate(r) {
    if (r === null || r === undefined) return '—';
    return Number(r).toLocaleString('en-GB', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  /* ── Find the latest year that has data for all 5 quintiles ─────────────── */
  function latestFullYear(byQ) {
    for (let i = YEARS.length - 1; i >= 0; i--) {
      const yr = YEARS[i];
      if (['1','2','3','4','5'].every(q => byQ[q] && byQ[q][yr] != null)) {
        return yr;
      }
    }
    return null;
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  function renderDeprivation(data) {
    const byQ    = data.byQuintile              || {};
    const niAvg  = data.niAverage               || {};
    const counts = data.practiceCountByQuintile || {};

    const kfYear = latestFullYear(byQ);
    const kfQ1   = kfYear && byQ['1'] ? byQ['1'][kfYear] : null;
    const kfQ5   = kfYear && byQ['5'] ? byQ['5'][kfYear] : null;

    // ── Key finding ──────────────────────────────────────────────────────────
    const kfEl = document.getElementById('depr-key-finding');
    if (kfEl && kfYear && kfQ1 != null && kfQ5 != null && kfQ5 > 0) {
      const ratio  = (kfQ1 / kfQ5).toFixed(1);
      const higher = kfQ1 >= kfQ5 ? 'higher' : 'lower';
      kfEl.innerHTML =
        `In <strong>${kfYear}</strong>, practices in the most deprived areas (Q1) prescribed ` +
        `<strong>${fmtRate(kfQ1)}</strong> ADHD items per 1,000 patients per month — ` +
        `<strong>${ratio}× ${higher}</strong> than the least deprived areas ` +
        `(Q5: ${fmtRate(kfQ5)}).`;
    }

    // ── Line chart (trend per quintile over time) ─────────────────────────────
    const lineCanvas = document.getElementById('depr-line-chart');
    if (lineCanvas) {
      const datasets = ['1','2','3','4','5'].map(q => ({
        label:                Q_LABELS[q],
        data:                 YEARS.map(yr => (byQ[q] && byQ[q][yr] != null) ? byQ[q][yr] : null),
        borderColor:          Q_COLORS[q],
        backgroundColor:      'transparent',
        borderWidth:          2,
        pointRadius:          3,
        pointHoverRadius:     5,
        pointBackgroundColor: Q_COLORS[q],
        pointBorderColor:     '#fff',
        pointBorderWidth:     1.5,
        tension:              0.3,
        spanGaps:             false,
      }));

      datasets.push({
        label:                'NI Average',
        data:                 YEARS.map(yr => niAvg[yr] != null ? niAvg[yr] : null),
        borderColor:          NI_COLOR,
        backgroundColor:      'transparent',
        borderWidth:          1.5,
        borderDash:           [4, 3],
        pointRadius:          2,
        pointHoverRadius:     4,
        pointBackgroundColor: NI_COLOR,
        pointBorderColor:     '#fff',
        pointBorderWidth:     1,
        tension:              0.3,
        spanGaps:             false,
      });

      new Chart(lineCanvas.getContext('2d'), {
        type: 'line',
        data: { labels: YEARS, datasets },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font:          { size: 11 },
                color:         '#3d4f68',
                boxWidth:      24,
                boxHeight:     2,
                padding:       14,
                usePointStyle: true,
                pointStyle:    'line',
              },
            },
            tooltip: {
              ...TOOLTIP_BASE,
              displayColors: true,
              boxWidth:  24,
              boxHeight: 2,
              callbacks: {
                title: items => items[0].label,
                label: ctx  => {
                  const v = ctx.parsed.y;
                  return v == null ? null : ` ${ctx.dataset.label}: ${fmtRate(v)}`;
                },
              },
              filter: item => item.parsed.y != null,
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
              ticks:  { ...AXIS_TICKS, callback: v => fmtRate(v) },
              border: { color: 'transparent' },
              title: {
                display: true,
                text:    'Monthly items per 1,000 patients',
                color:   '#7b8fa8',
                font:    { size: 11 },
              },
            },
          },
        },
      });
    }

    // ── Bar chart (latest year, one bar per quintile) ─────────────────────────
    const barCanvas = document.getElementById('depr-bar-chart');
    if (barCanvas && kfYear) {
      const barLabels = ['1','2','3','4','5'].map(q =>
        q === '1' ? 'Q1 Most\nDeprived' : q === '5' ? 'Q5 Least\nDeprived' : `Q${q}`
      );
      const barData   = ['1','2','3','4','5'].map(q =>
        (byQ[q] && byQ[q][kfYear] != null) ? byQ[q][kfYear] : 0
      );
      const barColors = ['1','2','3','4','5'].map(q => Q_COLORS[q]);

      const barYrEl = document.getElementById('depr-bar-year');
      if (barYrEl) barYrEl.textContent = kfYear;

      new Chart(barCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: barLabels,
          datasets: [{
            label:           `ADHD rate in ${kfYear}`,
            data:            barData,
            backgroundColor: barColors.map(c => c + 'cc'),
            borderColor:     barColors,
            borderWidth:     1.5,
            borderRadius:    4,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...TOOLTIP_BASE,
              callbacks: {
                title: items => items[0].label.replace('\n', ' '),
                label: ctx  => ` ${fmtRate(ctx.parsed.y)} items / 1k patients / month`,
              },
            },
          },
          scales: {
            x: {
              grid:   { display: false },
              ticks:  { font: { size: 11 }, color: '#3d4f68' },
              border: { color: 'transparent' },
            },
            y: {
              beginAtZero: true,
              grid:   AXIS_GRID,
              ticks:  { ...AXIS_TICKS, callback: v => fmtRate(v) },
              border: { color: 'transparent' },
              title: {
                display: true,
                text:    `Monthly items / 1,000 patients (${kfYear})`,
                color:   '#7b8fa8',
                font:    { size: 11 },
              },
            },
          },
        },
      });
    }

    // ── Table (years × quintiles) ─────────────────────────────────────────────
    const tbody = document.getElementById('depr-table-body');
    if (tbody) {
      tbody.innerHTML = '';
      YEARS.forEach(yr => {
        const cells = ['1','2','3','4','5'].map(q => {
          const v = (byQ[q] && byQ[q][yr] != null) ? byQ[q][yr] : null;
          return `<td class="col-num">${fmtRate(v)}</td>`;
        });
        const niV = niAvg[yr] != null ? fmtRate(niAvg[yr]) : '—';
        const tr  = document.createElement('tr');
        tr.innerHTML = `<td>${yr}</td>${cells.join('')}<td class="col-num depr-ni-cell">${niV}</td>`;
        tbody.appendChild(tr);
      });
    }

    // ── Practice count footnote ───────────────────────────────────────────────
    const countEl = document.getElementById('depr-practice-counts');
    if (countEl) {
      const total = ['1','2','3','4','5'].reduce((s, q) => s + (counts[q] || 0), 0);
      const unmapped = (data.unmappedCount || 0);
      const parts = ['1','2','3','4','5'].map(q => `Q${q}: ${counts[q] || 0}`).join(', ');
      countEl.textContent = `${total} practices mapped (${parts}).` +
        (unmapped > 0 ? ` ${unmapped} practice${unmapped > 1 ? 's' : ''} could not be mapped.` : '');
    }

    // ── Reveal section ────────────────────────────────────────────────────────
    const section = document.getElementById('deprivation-section');
    if (section) section.classList.remove('depr-loading');
  }

  /* ── Boot ────────────────────────────────────────────────────────────────── */
  fetch('data/deprivation-analysis.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(renderDeprivation)
    .catch(() => {
      // Data not yet generated — hide section silently until assign_deprivation.py runs
      const section = document.getElementById('deprivation-section');
      if (section) section.style.display = 'none';
    });
}());
