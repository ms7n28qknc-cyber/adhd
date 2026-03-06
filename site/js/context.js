/* =============================================================================
   context.js — ADHD in Context page
   Loads health-context.json (HSCIMS indicators) and averages.json (ADHD rates)
   then renders all charts and tables.
   ============================================================================= */

'use strict';

/* ── Constants ──────────────────────────────────────────────────────────────── */

const TRUSTS = ['Belfast', 'Northern', 'South Eastern', 'Southern', 'Western'];

// Colours — kept consistent across charts
const TRUST_COLORS = {
  'Belfast':       '#2563eb',
  'Northern':      '#10b981',
  'South Eastern': '#8b5cf6',
  'Southern':      '#f59e0b',
  'Western':       '#ef4444',
};
const NI_COLOR   = '#374151';
const ADHD_COLOR = '#06b6d4';   // cyan — distinct from all trust colours

// Chart.js global defaults (match rest of site)
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.color       = '#7b8fa8';

/* ── Formatting helpers ─────────────────────────────────────────────────────── */

function fmt2(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt1(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmt3(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// For self-harm / suicide use 3dp; for M&A and ADHD use 1dp
function fmtRate(n, dp = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/* ── Trust selector widget ──────────────────────────────────────────────────── */

function buildTrustSelector(containerId, trusts, activeIndex, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = trusts.map((t, i) => `
    <button class="year-btn ${i === activeIndex ? 'year-btn--active' : ''}"
            data-idx="${i}" type="button">${t}</button>
  `).join('');
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    el.querySelectorAll('.year-btn').forEach(b => b.classList.remove('year-btn--active'));
    btn.classList.add('year-btn--active');
    onChange(+btn.dataset.idx);
  });
}

/* ── Section 1: Mood & Anxiety ──────────────────────────────────────────────── */

function buildMaChart(ctx, hscims, adhdRates) {
  const maData    = hscims.moodAnxiety;
  const lastYear  = '2023';

  const avgVals  = TRUSTS.map(t => maData.trusts[t]?.average?.[lastYear]     ?? null);
  const deprVals = TRUSTS.map(t => maData.trusts[t]?.mostDeprived?.[lastYear] ?? null);
  const adhdVals = TRUSTS.map(t => adhdRates.lcg?.[t]?.[lastYear]             ?? null);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: TRUSTS,
      datasets: [
        {
          label:           'M&A Trust average',
          data:            avgVals,
          backgroundColor: 'rgba(37,99,235,0.75)',
          borderColor:     'rgba(37,99,235,1)',
          borderWidth:     1,
          order:           2,
          yAxisID:         'yMA',
        },
        {
          label:           'M&A most deprived quintile',
          data:            deprVals,
          backgroundColor: 'rgba(37,99,235,0.25)',
          borderColor:     'rgba(37,99,235,0.6)',
          borderWidth:     1,
          borderDash:      [4, 3],
          order:           2,
          yAxisID:         'yMA',
        },
        {
          type:            'line',
          label:           'ADHD items per 1,000 patients',
          data:            adhdVals,
          borderColor:     ADHD_COLOR,
          backgroundColor: 'transparent',
          borderWidth:     2.5,
          pointRadius:     5,
          pointBackgroundColor: ADHD_COLOR,
          tension:         0.3,
          order:           1,
          yAxisID:         'yADHD',
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw;
              if (v == null) return ` ${ctx.dataset.label}: —`;
              if (ctx.datasetIndex === 2)
                return ` ADHD: ${fmt1(v)} per 1,000 patients`;
              return ` ${ctx.dataset.label}: ${fmt1(v)} per 1,000 pop.`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        yMA: {
          position: 'left',
          title:    { display: true, text: 'M&A prescriptions per 1,000 pop.' },
          ticks:    { callback: v => fmt1(v) },
          grid:     { color: 'rgba(0,0,0,0.045)' },
        },
        yADHD: {
          position: 'right',
          title:    { display: true, text: 'ADHD items per 1,000 patients' },
          ticks:    { callback: v => fmt1(v) },
          grid:     { drawOnChartArea: false },
        },
      },
    },
  });
}

function renderMaTable(trustIdx, hscims, adhdRates) {
  const trust    = TRUSTS[trustIdx];
  const maData   = hscims.moodAnxiety;
  const years    = maData.years;
  const trustAvg = maData.trusts[trust]?.average     ?? {};
  const trustDep = maData.trusts[trust]?.mostDeprived ?? {};
  const adhdLcg  = adhdRates.lcg?.[trust]             ?? {};

  const title = document.getElementById('ma-table-title');
  const yr0 = years[0], yr1 = years[years.length - 1];
  if (title) title.textContent = `${trust} HSC Trust — Mood & Anxiety and ADHD, ${yr0}–${yr1}`;

  const tbody = document.getElementById('ma-tbody');
  if (!tbody) return;

  tbody.innerHTML = years.map(yr => {
    const avg  = trustAvg[yr]  ?? null;
    const dep  = trustDep[yr]  ?? null;
    const adhd = adhdLcg[yr]   ?? null;
    const gap  = (avg != null && dep != null) ? dep - avg : null;
    const gapCls = gap != null && gap > 0 ? 'ctx-gap-positive' : '';
    return `
      <tr>
        <td><strong>${maData.periodLabels[yr] || yr}</strong></td>
        <td class="col-num">${fmt1(avg)}</td>
        <td class="col-num">${fmt1(dep)}</td>
        <td class="col-num ${gapCls}">${gap != null ? '+' + fmt1(gap) : '—'}</td>
        <td class="col-num ctx-adhd-col">${fmt1(adhd)}</td>
      </tr>`;
  }).join('');

  // Add NI row
  const niAvg = maData.ni;
  const niAdhd = adhdRates.ni ?? {};
  tbody.innerHTML += `
    <tr class="ctx-ni-row">
      <td colspan="5" class="ctx-ni-divider">NI average</td>
    </tr>` +
    years.map(yr => `
      <tr class="ctx-ni-row">
        <td><strong>${maData.periodLabels[yr] || yr}</strong><span class="ctx-ni-tag"> NI</span></td>
        <td class="col-num">${fmt1(niAvg?.[yr] ?? null)}</td>
        <td class="col-num">${fmt1(hscims.moodAnxiety.deprivationQuintiles?.mostDeprived?.[yr] ?? null)}</td>
        <td class="col-num ctx-gap-positive">
          ${(niAvg?.[yr] != null && hscims.moodAnxiety.deprivationQuintiles?.mostDeprived?.[yr] != null)
            ? '+' + fmt1(hscims.moodAnxiety.deprivationQuintiles.mostDeprived[yr] - niAvg[yr])
            : '—'}
        </td>
        <td class="col-num ctx-adhd-col">${fmt1(niAdhd[yr] ?? null)}</td>
      </tr>`).join('');
}

/* ── Section 2 & 3: Multi-line chart helper ─────────────────────────────────── */

function buildLineChart(canvasId, hscims, indicatorKey, adhdRates) {
  const ctx      = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return null;
  const ind      = hscims[indicatorKey];
  const years    = ind.years;
  const labels   = years.map(yr => ind.periodLabels[yr] || yr);

  const datasets = [
    // NI average
    {
      label:           'NI average',
      data:            years.map(yr => ind.ni?.[yr] ?? null),
      borderColor:     NI_COLOR,
      backgroundColor: 'transparent',
      borderWidth:     2.5,
      borderDash:      [6, 3],
      pointRadius:     4,
      pointBackgroundColor: NI_COLOR,
      tension:         0.3,
      yAxisID:         'yInd',
    },
    // One line per Trust
    ...TRUSTS.map(trust => ({
      label:           trust,
      data:            years.map(yr => ind.trusts?.[trust]?.average?.[yr] ?? null),
      borderColor:     TRUST_COLORS[trust],
      backgroundColor: 'transparent',
      borderWidth:     2,
      pointRadius:     3,
      pointBackgroundColor: TRUST_COLORS[trust],
      tension:         0.3,
      yAxisID:         'yInd',
    })),
    // ADHD NI rate on secondary axis
    {
      label:           'ADHD NI rate (per 1,000 patients)',
      data:            years.map(yr => adhdRates.ni?.[yr] ?? null),
      borderColor:     ADHD_COLOR,
      backgroundColor: 'transparent',
      borderWidth:     2,
      borderDash:      [3, 3],
      pointRadius:     3,
      pointBackgroundColor: ADHD_COLOR,
      tension:         0.3,
      yAxisID:         'yADHD',
    },
  ];

  // Y-axis label
  const yLabel = indicatorKey === 'moodAnxiety'
    ? 'per 1,000 pop.'
    : indicatorKey === 'selfHarm'
    ? 'Admissions per 1,000 pop.'
    : 'Deaths per 1,000 pop.';

  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: c => {
              if (c.raw == null) return null;
              if (c.datasetIndex === datasets.length - 1)
                return ` ${c.dataset.label}: ${fmt1(c.raw)}`;
              const dp = indicatorKey === 'moodAnxiety' ? 1 : 3;
              return ` ${c.dataset.label}: ${fmtRate(c.raw, dp)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        yInd: {
          position: 'left',
          title:    { display: true, text: yLabel },
          ticks: {
            callback: v => {
              if (indicatorKey === 'moodAnxiety') return fmt1(v);
              return fmtRate(v, 3);
            },
          },
          grid: { color: 'rgba(0,0,0,0.045)' },
        },
        yADHD: {
          position: 'right',
          title:    { display: true, text: 'ADHD items per 1,000 patients' },
          ticks:    { callback: v => fmt1(v) },
          grid:     { drawOnChartArea: false },
        },
      },
    },
  });
}

/* ── Section 2 & 3: Trust × Year table ─────────────────────────────────────── */

function buildIndicatorTable(tableId, hscims, indicatorKey, adhdRates) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const ind    = hscims[indicatorKey];
  const years  = ind.years;
  const dp     = indicatorKey === 'moodAnxiety' ? 1 : 3;

  // Header row
  const yearLabels = years.map(yr => ind.periodLabels[yr] || yr);
  table.querySelector('thead').innerHTML = `
    <tr>
      <th>Trust / Area</th>
      ${yearLabels.map(l => `<th class="col-num">${l}</th>`).join('')}
    </tr>`;

  // Body: NI + each Trust + deprivation row + ADHD divider + NI ADHD + Trust ADHD
  const rows = [
    { label: 'NI average', vals: years.map(yr => ind.ni?.[yr] ?? null), cls: 'ctx-ni-avg-row' },
    ...TRUSTS.map(t => ({
      label: t,
      vals:  years.map(yr => ind.trusts?.[t]?.average?.[yr] ?? null),
      color: TRUST_COLORS[t],
      cls:   '',
    })),
    {
      label: 'NI most deprived quintile',
      vals:  years.map(yr => ind.deprivationQuintiles?.mostDeprived?.[yr] ?? null),
      cls:   'ctx-depr-row',
    },
  ];

  let tbody = rows.map(row => {
    const dot = row.color
      ? `<span class="drug-swatch" style="background:${row.color}"></span>`
      : '';
    return `<tr class="${row.cls}">
      <td>${dot}${row.label}</td>
      ${row.vals.map(v => `<td class="col-num">${fmtRate(v, dp)}</td>`).join('')}
    </tr>`;
  }).join('');

  // ADHD section — divider + NI + each Trust
  tbody += `
    <tr class="ctx-adhd-divider-row">
      <td colspan="${years.length + 1}">
        ADHD medication rate (items per 1,000 registered patients)
        — different denominator, see footnote
      </td>
    </tr>
    <tr class="ctx-adhd-data-row">
      <td>NI average</td>
      ${years.map(yr => `<td class="col-num ctx-adhd-col">${fmt1(adhdRates.ni?.[yr] ?? null)}</td>`).join('')}
    </tr>` +
    TRUSTS.map(t => `
      <tr class="ctx-adhd-data-row">
        <td>
          <span class="drug-swatch" style="background:${TRUST_COLORS[t]}"></span>${t}
        </td>
        ${years.map(yr => `<td class="col-num ctx-adhd-col">${fmt1(adhdRates.lcg?.[t]?.[yr] ?? null)}</td>`).join('')}
      </tr>`).join('');

  table.querySelector('tbody').innerHTML = tbody;
}

/* ── Main ────────────────────────────────────────────────────────────────────── */

async function main() {
  // Load both data sources in parallel
  const [hscResp, avgResp] = await Promise.all([
    fetch('data/health-context.json'),
    fetch('data/averages.json'),
  ]);

  if (!hscResp.ok) throw new Error('Failed to load health-context.json');
  if (!avgResp.ok) throw new Error('Failed to load averages.json');

  const hscims    = await hscResp.json();
  const adhdRates = await avgResp.json();

  // Show placeholder notice if data is still illustrative
  if (hscims._placeholder) {
    const notice = document.getElementById('placeholder-notice');
    if (notice) notice.classList.remove('hidden');
  }

  /* ── Section 1 ── */
  const maCtx = document.getElementById('ma-bar-chart')?.getContext('2d');
  if (maCtx) buildMaChart(maCtx, hscims, adhdRates);

  // Trust selector
  let activeTrustIdx = 0;
  buildTrustSelector('ma-trust-selector', TRUSTS, activeTrustIdx, idx => {
    activeTrustIdx = idx;
    renderMaTable(idx, hscims, adhdRates);
  });
  renderMaTable(activeTrustIdx, hscims, adhdRates);

  // Denominator footnote
  const noteEl = document.getElementById('ma-denom-note');
  if (noteEl) {
    noteEl.textContent =
      'Note: ADHD rates are calculated from items prescribed per 1,000 registered GP patients. ' +
      'Mood & anxiety rates use persons prescribed per 1,000 general population. ' +
      'These denominators differ and direct numerical comparison should be made with caution.';
  }

  /* ── Section 2 ── */
  buildLineChart('sh-line-chart', hscims, 'selfHarm', adhdRates);
  buildIndicatorTable('sh-table', hscims, 'selfHarm', adhdRates);

  /* ── Section 3 ── */
  buildLineChart('sui-line-chart', hscims, 'suicide', adhdRates);
  buildIndicatorTable('sui-table', hscims, 'suicide', adhdRates);
}

main().catch(err => {
  console.error('Context page error:', err);
  document.querySelector('.context-page')?.insertAdjacentHTML('afterbegin', `
    <div class="error-banner" style="margin-bottom:1.5rem;border-radius:var(--r)">
      <div class="container" style="padding:0.75rem 1rem">
        <p>Failed to load data. Please refresh the page.</p>
      </div>
    </div>
  `);
});
