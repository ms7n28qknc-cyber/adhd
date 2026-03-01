/* =============================================================================
   overview.js — NI ADHD Prescribing Overview page
   Loads overall-stats.json and renders headline stats, charts, and tables.
   ============================================================================= */

'use strict';

const DRUG_COLORS = {
  Methylphenidate:  '#3b82f6',   /* blue    */
  Lisdexamfetamine: '#10b981',   /* emerald */
  Atomoxetine:      '#f59e0b',   /* amber   */
  Dexamfetamine:    '#8b5cf6',   /* violet  */
  Guanfacine:       '#ef4444',   /* red     */
};

const FIVE_DRUGS = ['Methylphenidate', 'Lisdexamfetamine', 'Atomoxetine', 'Dexamfetamine', 'Guanfacine'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ── Formatting helpers ──────────────────────────────────────────────────── */

function fmtNum(n, dp = 0) {
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtGBP(n) {
  return '£' + fmtNum(Math.round(n));
}

function fmtPct(v, dp = 1) {
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(dp) + '%';
}

function monthLabel(key) {
  const [, m] = key.split('-');
  return MONTH_NAMES[+m - 1];
}

/* ── Chart.js global defaults ────────────────────────────────────────────── */

Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.color       = '#7b8fa8';

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  const resp = await fetch('data/overall-stats.json');
  if (!resp.ok) throw new Error('Failed to load overall-stats.json');
  const data = await resp.json();

  const months    = data.months;                      // { '2015-01': {...}, ... }
  const monthKeys = Object.keys(months).sort();       // sorted ascending

  /* ── 1. Headline stats ─────────────────────────────────────────────────── */

  let totalGross  = 0;
  let totalItems  = 0;
  let maxPractices = 0;

  for (const key of monthKeys) {
    const m = months[key];
    totalGross   += m.gross_cost;
    totalItems   += m.total_items;
    if (m.practices_prescribing > maxPractices) {
      maxPractices = m.practices_prescribing;
    }
  }

  // % change: average monthly cost in first year vs last year
  const firstYearKeys = monthKeys.filter(k => k.startsWith('2015'));
  const lastYearKeys  = monthKeys.filter(k => k.startsWith('2025'));
  const avgFirst = firstYearKeys.reduce((s, k) => s + months[k].gross_cost, 0) / firstYearKeys.length;
  const avgLast  = lastYearKeys.reduce((s, k) =>  s + months[k].gross_cost, 0) / lastYearKeys.length;
  const pctChange = ((avgLast - avgFirst) / avgFirst) * 100;

  const headlineData = [
    {
      label: 'Total Gross Cost (2015–2025)',
      value: '£' + fmtNum(totalGross / 1e6, 1) + 'm',
    },
    {
      label: 'Total Items Prescribed (2015–2025)',
      value: fmtNum(totalItems),
    },
    {
      label: 'Monthly Cost Change (2015 → 2025)',
      value: fmtPct(pctChange),
      cls:   pctChange > 0 ? 'stat-value--down' : 'stat-value--up',
    },
    {
      label: 'Active Prescribing Practices (peak)',
      value: fmtNum(maxPractices),
    },
  ];

  document.getElementById('headline-stats').innerHTML = headlineData.map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.cls || ''}">${c.value}</div>
    </div>
  `).join('');

  const closedCount = data.closed_practices_count || 0;
  if (closedCount > 0) {
    const noteEl = document.getElementById('closed-note');
    noteEl.textContent =
      `Note: ${closedCount} practices in this dataset appear to have closed at some point ` +
      `during the 2015–2025 period. Their historical prescribing data is still viewable ` +
      `on individual practice pages.`;
    noteEl.classList.remove('hidden');
  }

  /* ── 2. Monthly cost + items chart ────────────────────────────────────── */

  const chartLabels = monthKeys.map(k => {
    const [y, m] = k.split('-');
    return `${MONTH_NAMES[+m - 1]} ${y}`;
  });

  const costSeries  = monthKeys.map(k => months[k].gross_cost);
  const itemsSeries = monthKeys.map(k => months[k].total_items);

  const ctx1 = document.getElementById('monthly-chart').getContext('2d');
  new Chart(ctx1, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        {
          label:           'Gross Cost (£)',
          data:            costSeries,
          borderColor:     '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.08)',
          fill:            true,
          borderWidth:     2,
          pointRadius:     0,
          tension:         0.3,
          yAxisID:         'yCost',
        },
        {
          label:           'Items',
          data:            itemsSeries,
          borderColor:     '#10b981',
          backgroundColor: 'transparent',
          fill:            false,
          borderWidth:     2,
          pointRadius:     0,
          tension:         0.3,
          yAxisID:         'yItems',
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
            label: ctx => ctx.datasetIndex === 0
              ? ` Gross Cost: £${fmtNum(Math.round(ctx.raw))}`
              : ` Items: ${fmtNum(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 15,
            maxRotation:   0,
            callback: (_, i) => {
              const lbl = chartLabels[i];
              return lbl && lbl.startsWith('Jan') ? lbl.split(' ')[1] : '';
            },
          },
          grid: { display: false },
        },
        yCost: {
          position: 'left',
          title:    { display: true, text: '£ Gross Cost' },
          ticks: {
            callback: v => v >= 1e6
              ? '£' + (v / 1e6).toFixed(1) + 'm'
              : '£' + (v / 1e3).toFixed(0) + 'k',
          },
        },
        yItems: {
          position: 'right',
          title:    { display: true, text: '# Items' },
          grid:     { drawOnChartArea: false },
          ticks:    { callback: v => fmtNum(v) },
        },
      },
    },
  });

  /* ── 3. Yearly summary table ───────────────────────────────────────────── */

  const years = [...new Set(monthKeys.map(k => k.slice(0, 4)))].sort();

  const yearStats = {};
  for (const y of years) {
    const ym = monthKeys.filter(k => k.startsWith(y));
    yearStats[y] = {
      items:  ym.reduce((s, k) => s + months[k].total_items, 0),
      gross:  ym.reduce((s, k) => s + months[k].gross_cost,  0),
      actual: ym.reduce((s, k) => s + months[k].actual_cost, 0),
      n:      ym.length,
    };
  }

  document.getElementById('yearly-tbody').innerHTML = years.map((y, i) => {
    const s       = yearStats[y];
    const avgItems = s.items / s.n;
    const avgCost  = s.gross / s.n;

    let yoyItems = '—', yoyCost = '—';
    let yoyItemsCls = '', yoyCostCls = '';

    if (i > 0) {
      const prev = yearStats[years[i - 1]];
      const dCost  = ((s.gross  - prev.gross)  / prev.gross)  * 100;
      const dItems = ((s.items  - prev.items)  / prev.items)  * 100;
      yoyCost      = fmtPct(dCost);
      yoyItems     = fmtPct(dItems);
      yoyCostCls   = dCost  > 0 ? 'yoy-up' : dCost  < 0 ? 'yoy-down' : '';
      yoyItemsCls  = dItems > 0 ? 'yoy-up' : dItems < 0 ? 'yoy-down' : '';
    }

    return `
      <tr>
        <td><strong>${y}</strong></td>
        <td class="col-num">${fmtNum(s.items)}</td>
        <td class="col-num">${fmtGBP(s.gross)}</td>
        <td class="col-num">${fmtGBP(s.actual)}</td>
        <td class="col-num">${fmtNum(Math.round(avgItems))}</td>
        <td class="col-num">${fmtGBP(avgCost)}</td>
        <td class="col-num ${yoyItemsCls}">${yoyItems}</td>
        <td class="col-num ${yoyCostCls}">${yoyCost}</td>
      </tr>`;
  }).join('');

  /* ── 4. Drug stacked area chart ────────────────────────────────────────── */

  const ctx2 = document.getElementById('drug-chart').getContext('2d');
  new Chart(ctx2, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: FIVE_DRUGS.map(drug => ({
        label:           drug,
        data:            monthKeys.map(k => months[k].drugs?.[drug]?.total_items ?? 0),
        borderColor:     DRUG_COLORS[drug],
        backgroundColor: DRUG_COLORS[drug] + '66',
        fill:            true,
        borderWidth:     1.5,
        pointRadius:     0,
        tension:         0.3,
      })),
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtNum(ctx.raw)} items`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            maxTicksLimit: 15,
            maxRotation:   0,
            callback: (_, i) => {
              const lbl = chartLabels[i];
              return lbl && lbl.startsWith('Jan') ? lbl.split(' ')[1] : '';
            },
          },
          grid: { display: false },
        },
        y: {
          stacked: true,
          title:   { display: true, text: '# Items' },
          ticks:   { callback: v => fmtNum(v) },
        },
      },
    },
  });

  /* ── 5. Drug breakdown table ───────────────────────────────────────────── */

  const drugTotals = {};
  for (const drug of FIVE_DRUGS) {
    drugTotals[drug] = { items: 0, gross: 0 };
  }

  for (const key of monthKeys) {
    const m = months[key];
    for (const drug of FIVE_DRUGS) {
      if (m.drugs?.[drug]) {
        drugTotals[drug].items += m.drugs[drug].total_items;
        drugTotals[drug].gross += m.drugs[drug].gross_cost;
      }
    }
  }

  const totalDrugItems = FIVE_DRUGS.reduce((s, d) => s + drugTotals[d].items, 0);
  const totalDrugGross = FIVE_DRUGS.reduce((s, d) => s + drugTotals[d].gross, 0);

  function drugTrend(drug) {
    const first12avg = monthKeys.slice(0, 12)
      .reduce((s, k) => s + (months[k].drugs?.[drug]?.total_items ?? 0), 0) / 12;
    const last12avg  = monthKeys.slice(-12)
      .reduce((s, k) => s + (months[k].drugs?.[drug]?.total_items ?? 0), 0) / 12;
    const ratio = first12avg > 0 ? last12avg / first12avg : 0;
    if (ratio > 1.2)  return '<span class="trend-up">&#8593; Increasing</span>';
    if (ratio < 0.83) return '<span class="trend-down">&#8595; Decreasing</span>';
    return '<span class="trend-flat">&#8594; Stable</span>';
  }

  // Sort by total items descending
  const sortedDrugs = [...FIVE_DRUGS].sort((a, b) => drugTotals[b].items - drugTotals[a].items);

  document.getElementById('drug-tbody').innerHTML = sortedDrugs.map(drug => {
    const s         = drugTotals[drug];
    const itemShare = (s.items / totalDrugItems * 100).toFixed(1);
    const costShare = (s.gross / totalDrugGross * 100).toFixed(1);
    return `
      <tr>
        <td>
          <span class="drug-swatch" style="background:${DRUG_COLORS[drug]}"></span>${drug}
        </td>
        <td class="col-num">${fmtNum(s.items)}</td>
        <td class="col-num">${itemShare}%</td>
        <td class="col-num">${fmtGBP(s.gross)}</td>
        <td class="col-num">${costShare}%</td>
        <td>${drugTrend(drug)}</td>
      </tr>`;
  }).join('');
}

main().catch(err => {
  console.error('Overview page error:', err);
  document.querySelector('.overview-page').insertAdjacentHTML('afterbegin', `
    <div class="error-banner" style="margin-bottom:1.5rem;border-radius:var(--r)">
      <div class="container" style="padding:0.75rem 1rem">
        <p>Failed to load data. Please refresh the page.</p>
      </div>
    </div>
  `);
});
