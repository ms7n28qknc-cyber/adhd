/* england-overview.js — England ADHD Prescribing Overview page */

(function () {
  'use strict';

  const DATA_URL  = '../data/england/overview.json';

  // Colour palette for 6 drugs (consistent across charts)
  const DRUG_COLOURS = {
    Methylphenidate:  { border: '#2563eb', bg: 'rgba(37,99,235,0.75)'  },
    Lisdexamfetamine: { border: '#16a34a', bg: 'rgba(22,163,74,0.75)'  },
    Atomoxetine:      { border: '#d97706', bg: 'rgba(217,119,6,0.75)'  },
    Dexamfetamine:    { border: '#9333ea', bg: 'rgba(147,51,234,0.75)' },
    Guanfacine:       { border: '#0891b2', bg: 'rgba(8,145,178,0.75)'  },
    Modafinil:        { border: '#dc2626', bg: 'rgba(220,38,38,0.60)'  },
  };

  const DRUG_ORDER = ['Methylphenidate','Lisdexamfetamine','Atomoxetine','Dexamfetamine','Guanfacine','Modafinil'];

  // ── helpers ────────────────────────────────────────────────────────────────

  function fmt(n)  { return n == null ? '—' : n.toLocaleString('en-GB'); }
  function fmtK(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'm';
    if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
    return String(n);
  }
  function fmtCost(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'm';
    if (n >= 1_000)     return '£' + (n / 1_000).toFixed(0) + 'k';
    return '£' + n.toFixed(0);
  }
  function fmtCostFull(n) {
    return n == null ? '—' : '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function pct(n) {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }
  function yoyClass(n) {
    if (n == null) return '';
    return n > 0 ? 'yoy-up' : 'yoy-down';
  }

  // ── stat cards ─────────────────────────────────────────────────────────────

  function buildStats(months) {
    const all   = months;
    const last  = months[months.length - 1];
    const y2015 = months.filter(m => m.month.startsWith('2015'));
    const avg2015Items = y2015.reduce((s, m) => s + m.total_items, 0) / y2015.length;

    const total12mItems = months.slice(-12).reduce((s, m) => s + m.total_items, 0);
    const total12mCost  = months.slice(-12).reduce((s, m) => s + (m.total_cost || 0), 0);

    const growthFactor = ((last.total_items / avg2015Items) - 1) * 100;

    const stats = [
      { label: `Latest month — ${last.month}`, value: fmt(last.total_items) + ' items' },
      { label: 'Prescribing growth since 2015', value: '+' + growthFactor.toFixed(0) + '%' },
      { label: 'Items in last 12 months', value: fmtK(total12mItems) },
      { label: 'Gross cost — last 12 months', value: fmtCost(total12mCost) },
    ];

    const grid = document.getElementById('headline-stats');
    if (!grid) return;
    grid.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value">${s.value}</div>
      </div>`).join('');
  }

  // ── monthly chart ──────────────────────────────────────────────────────────

  function buildMonthlyChart(months) {
    const canvas = document.getElementById('monthly-chart');
    if (!canvas) return;

    const labels = months.map(m => m.month);
    const items  = months.map(m => m.total_items);
    const costs  = months.map(m => m.total_cost || 0);

    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Items',
            data: items,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,0.10)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            yAxisID: 'yItems',
            tension: 0.3,
          },
          {
            label: 'Gross Cost (£)',
            data: costs,
            borderColor: '#16a34a',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            yAxisID: 'yCost',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (ctx.dataset.yAxisID === 'yCost') {
                  return ' ' + ctx.dataset.label + ': £' + ctx.parsed.y.toLocaleString('en-GB', { maximumFractionDigits: 0 });
                }
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString('en-GB');
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 10,
              callback(val, i) {
                const lbl = this.getLabelForValue(val);
                return lbl.endsWith('-01') ? lbl.slice(0, 4) : '';
              },
            },
          },
          yItems: {
            position: 'left',
            title: { display: true, text: 'Items' },
            ticks: { callback: v => fmtK(v) },
          },
          yCost: {
            position: 'right',
            title: { display: true, text: 'Gross Cost (£)' },
            grid: { drawOnChartArea: false },
            ticks: { callback: v => fmtCost(v) },
          },
        },
      },
    });
  }

  // ── yearly summary table ───────────────────────────────────────────────────

  function buildYearlyTable(months) {
    const tbody = document.getElementById('yearly-tbody');
    if (!tbody) return;

    // Group months by year
    const byYear = {};
    for (const m of months) {
      const y = m.month.slice(0, 4);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(m);
    }

    const years = Object.keys(byYear).sort();
    const rows  = years.map(y => {
      const ms   = byYear[y];
      const items = ms.reduce((s, m) => s + m.total_items, 0);
      const cost  = ms.reduce((s, m) => s + (m.total_cost || 0), 0);
      return { year: y, items, cost, count: ms.length };
    });

    tbody.innerHTML = rows.map((r, i) => {
      const prev = rows[i - 1];
      const yoyItems = prev ? ((r.items / prev.items - 1) * 100) : null;
      const yoyCost  = prev ? ((r.cost  / prev.cost  - 1) * 100) : null;
      return `<tr>
        <td>${r.year}${r.count < 12 ? ' <small style="color:var(--text-3)">(partial)</small>' : ''}</td>
        <td class="col-num">${fmt(r.items)}</td>
        <td class="col-num">${fmtCostFull(r.cost)}</td>
        <td class="col-num">${fmt(Math.round(r.items / r.count))}</td>
        <td class="col-num">${fmtCostFull(r.cost / r.count)}</td>
        <td class="col-num ${yoyClass(yoyItems)}">${pct(yoyItems)}</td>
        <td class="col-num ${yoyClass(yoyCost)}">${pct(yoyCost)}</td>
      </tr>`;
    }).join('');
  }

  // ── drug stacked area chart ────────────────────────────────────────────────

  function buildDrugChart(months) {
    const canvas = document.getElementById('drug-chart');
    if (!canvas) return;

    const labels = months.map(m => m.month);

    // Only include drugs that appear in the data
    const allDrugs = new Set();
    for (const m of months) {
      if (m.drugs) Object.keys(m.drugs).forEach(d => allDrugs.add(d));
    }
    const drugs = DRUG_ORDER.filter(d => allDrugs.has(d));

    const datasets = drugs.map(drug => ({
      label: drug,
      data: months.map(m => (m.drugs && m.drugs[drug]) ? m.drugs[drug] : 0),
      borderColor: DRUG_COLOURS[drug]?.border || '#888',
      backgroundColor: DRUG_COLOURS[drug]?.bg || 'rgba(136,136,136,0.6)',
      borderWidth: 1,
      pointRadius: 0,
      fill: true,
      tension: 0.2,
    }));

    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label(ctx) {
                return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString('en-GB');
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              maxTicksLimit: 10,
              callback(val) {
                const lbl = this.getLabelForValue(val);
                return lbl.endsWith('-01') ? lbl.slice(0, 4) : '';
              },
            },
          },
          y: {
            stacked: true,
            ticks: { callback: v => fmtK(v) },
          },
        },
      },
    });
  }

  // ── drug breakdown table ───────────────────────────────────────────────────

  function buildDrugTable(months) {
    const tbody = document.getElementById('drug-tbody');
    if (!tbody) return;

    const allDrugs = new Set();
    for (const m of months) {
      if (m.drugs) Object.keys(m.drugs).forEach(d => allDrugs.add(d));
    }
    const drugs = DRUG_ORDER.filter(d => allDrugs.has(d));

    // Totals
    const totals = {};
    for (const d of drugs) totals[d] = { items: 0, cost: 0 };

    // We can compute cost per drug proportionally from total_cost + drug item shares
    for (const m of months) {
      if (!m.drugs) continue;
      const monthItems = Object.values(m.drugs).reduce((s, v) => s + v, 0);
      const monthCost  = m.total_cost || 0;
      for (const d of drugs) {
        const n = m.drugs[d] || 0;
        totals[d].items += n;
        totals[d].cost  += monthItems > 0 ? (n / monthItems) * monthCost : 0;
      }
    }

    const grandItems = drugs.reduce((s, d) => s + totals[d].items, 0);
    const grandCost  = drugs.reduce((s, d) => s + totals[d].cost, 0);

    // Trend: compare first-year avg to last-year avg
    const firstYear = months.slice(0, 12);
    const lastYear  = months.slice(-12);

    tbody.innerHTML = drugs.map(d => {
      const first = firstYear.reduce((s, m) => s + ((m.drugs && m.drugs[d]) || 0), 0) / firstYear.length;
      const last  = lastYear.reduce((s, m)  => s + ((m.drugs && m.drugs[d]) || 0), 0) / lastYear.length;
      const trend = first > 0 ? ((last / first - 1) * 100).toFixed(0) + '%' : 'n/a';
      const trendDir = last > first ? '▲' : '▼';
      const trendCls = last > first ? 'yoy-up' : 'yoy-down';

      const dotCol = DRUG_COLOURS[d]?.border || '#888';
      return `<tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dotCol};margin-right:6px"></span>${d}</td>
        <td class="col-num">${fmt(totals[d].items)}</td>
        <td class="col-num">${((totals[d].items / grandItems) * 100).toFixed(1)}%</td>
        <td class="col-num">${fmtCostFull(totals[d].cost)}</td>
        <td class="col-num">${((totals[d].cost / grandCost) * 100).toFixed(1)}%</td>
        <td class="col-num ${trendCls}">${trendDir} ${trend} since 2015</td>
      </tr>`;
    }).join('');
  }

  // ── init ───────────────────────────────────────────────────────────────────

  fetch(DATA_URL)
    .then(r => r.json())
    .then(data => {
      const months = data.months || data;
      buildStats(months);
      buildMonthlyChart(months);
      buildYearlyTable(months);
      buildDrugChart(months);
      buildDrugTable(months);
    })
    .catch(err => {
      console.error('england-overview: failed to load data', err);
      document.getElementById('headline-stats').innerHTML =
        '<p style="color:var(--text-3);padding:1rem">Failed to load data. Please try refreshing.</p>';
    });

})();
