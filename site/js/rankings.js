/* =============================================================================
   rankings.js — NI ADHD Prescribing Rankings page
   Loads rankings.json + averages.json and renders year-selector, bar chart,
   and rankings table (top 10 | NI-avg divider | bottom 10).
   ============================================================================= */

'use strict';

/* ── Chart.js global defaults ────────────────────────────────────────────── */
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.color       = '#7b8fa8';

/* ── Formatting helpers ──────────────────────────────────────────────────── */
function fmtRate(r) {
  if (r === null || r === undefined) return '—';
  return r.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/* ── State ───────────────────────────────────────────────────────────────── */
let rankings = [];   // raw data from rankings.json
let niRates  = {};   // averages.json → ni rates
let activeYear = 'Overall';
let barChart   = null;

/* ── Compute effective rate for a practice in a given year/Overall ────────── */
function practiceRate(p, year) {
  if (year === 'Overall') {
    const vals = Object.values(p.rates).filter(v => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  const v = p.rates[year];
  return (v === null || v === undefined) ? null : v;
}

/* ── NI average for the selected year ────────────────────────────────────── */
function niRate(year) {
  if (year === 'Overall') {
    const vals = Object.values(niRates).filter(v => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  const v = niRates[year];
  return (v === null || v === undefined) ? null : v;
}

/* ── Build sorted list of active (non-closed, non-null-rate) practices ─────── */
function buildSorted(year) {
  const rows = [];
  for (const p of rankings) {
    if (p.closed) continue;
    const rate = practiceRate(p, year);
    if (rate === null) continue;
    rows.push({ ...p, _rate: rate });
  }
  rows.sort((a, b) => b._rate - a._rate);
  return rows;
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function render(year) {
  const sorted = buildSorted(year);

  if (sorted.length === 0) {
    document.getElementById('rankings-no-data').classList.remove('hidden');
    document.getElementById('rankings-table-wrap').classList.add('hidden');
    document.getElementById('bar-chart-card').classList.add('hidden');
    return;
  }

  document.getElementById('rankings-no-data').classList.add('hidden');
  document.getElementById('rankings-table-wrap').classList.remove('hidden');
  document.getElementById('bar-chart-card').classList.remove('hidden');

  const avgNI  = niRate(year);
  const top10  = sorted.slice(0, 10);
  const bot10  = sorted.slice(-10);        // last 10 (lowest rates)

  // Bottom 10 displayed in descending order: 10th-lowest at top, absolute lowest at bottom
  // They are already in descending order (sorted desc), so just reverse from end:
  // sorted is desc → bot10 [0] = 10th-lowest, bot10[9] = absolute lowest ✓

  /* ── Bar chart (top 10, horizontal) ────────────────────────────────────── */
  const barLabels = top10.map(p => p.surgeryName);
  const barData   = top10.map(p => p._rate);
  const barBg     = top10.map(() => 'rgba(37,99,235,0.75)');

  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  const avgNIValue = avgNI ?? 0;
  const niLinePlugin = {
    id: 'niLine',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const x = xScale.getPixelForValue(avgNIValue);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1.5;
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.fillStyle = '#d97706';
      ctx.font = "11px 'Inter', sans-serif";
      ctx.textAlign = 'left';
      const label = `NI avg: ${fmtRate(avgNI)}`;
      const labelX = x + 4;
      const labelY = chartArea.top + 14;
      ctx.fillText(label, labelX, labelY);
      ctx.restore();
    },
  };

  const ctx = document.getElementById('rankings-bar-chart').getContext('2d');
  barChart = new Chart(ctx, {
    type: 'bar',
    plugins: [niLinePlugin],
    data: {
      labels: barLabels,
      datasets: [{
        label: 'Rate (items / 1k patients / month)',
        data: barData,
        backgroundColor: barBg,
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmtRate(ctx.raw)} items / 1k patients / month`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Avg monthly items per 1,000 registered patients' },
          ticks: { callback: v => fmtRate(v) },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        y: {
          ticks: {
            font: { size: 11 },
            callback: (_, i) => {
              const name = barLabels[i] || '';
              return name.length > 28 ? name.slice(0, 26) + '…' : name;
            },
          },
          grid: { display: false },
        },
      },
    },
  });

  // Update bar chart description
  const descYr = year === 'Overall' ? '2015–2025' : year;
  document.getElementById('bar-chart-desc').textContent =
    `Average monthly ADHD items per 1,000 registered patients — ${descYr}`;
  document.getElementById('rankings-table-desc').textContent =
    `Top 10 highest and bottom 10 lowest prescribing practices — ${descYr}`;

  /* ── Rankings table ─────────────────────────────────────────────────────── */
  const dividerNiText = avgNI !== null
    ? `— NI average: ${fmtRate(avgNI)} items / 1,000 patients / month —`
    : '— NI average —';

  const tbodyRows = [];

  // Top 10 (rank 1 = highest)
  top10.forEach((p, i) => {
    tbodyRows.push(tableRow(i + 1, p, true));
  });

  // Divider row
  tbodyRows.push(`
    <tr class="rankings-divider-row">
      <td colspan="4">${dividerNiText}</td>
    </tr>`);

  // Bottom 10 (shown descending: 10th-lowest → absolute lowest at bottom)
  // bot10 is already sorted descending from the main sort, so just show as-is.
  const totalPractices = sorted.length;
  bot10.forEach((p, i) => {
    const rank = totalPractices - (bot10.length - 1 - i);
    tbodyRows.push(tableRow(rank, p, false));
  });

  document.getElementById('rankings-tbody').innerHTML = tbodyRows.join('');
}

function tableRow(rank, p, isTop) {
  const href = `index.html#practice/${p.id}`;
  const rankSpan = `<span class="rank-num${isTop ? ' rank-num--top' : ''}">${rank}</span>`;
  const lcgSpan  = p.lcg ? `<span class="rank-lcg">${p.lcg}</span>` : '—';
  const nameLink = `<a href="${href}" class="rankings-practice-link">${escHtml(p.surgeryName)}</a>
    ${p.doctorName ? `<br><small style="color:var(--text-3);font-weight:400;font-size:0.75rem">${escHtml(p.doctorName)}</small>` : ''}`;
  return `
    <tr>
      <td>${rankSpan}</td>
      <td>${nameLink}</td>
      <td>${lcgSpan}</td>
      <td class="col-rate">${fmtRate(p._rate)}</td>
    </tr>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Year selector ───────────────────────────────────────────────────────── */
function buildYearSelector(years) {
  const container = document.getElementById('year-selector');
  const allYears = ['Overall', ...years];

  container.innerHTML = allYears.map(y => `
    <button class="year-btn${y === activeYear ? ' year-btn--active' : ''}"
            data-year="${y}"
            aria-pressed="${y === activeYear}"
            type="button">
      ${y}
    </button>
  `).join('');

  container.addEventListener('click', e => {
    const btn = e.target.closest('.year-btn');
    if (!btn) return;
    const year = btn.dataset.year;
    if (year === activeYear) return;
    activeYear = year;

    container.querySelectorAll('.year-btn').forEach(b => {
      const active = b.dataset.year === year;
      b.classList.toggle('year-btn--active', active);
      b.setAttribute('aria-pressed', active);
    });

    render(year);
  });
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  const [rankRes, avgRes] = await Promise.all([
    fetch('data/rankings.json'),
    fetch('data/averages.json'),
  ]);

  if (!rankRes.ok) throw new Error('Failed to load rankings.json');
  rankings = await rankRes.json();

  if (avgRes.ok) {
    const avg = await avgRes.json();
    niRates = avg.ni || {};
  }

  // Collect years present in data (from any non-closed practice)
  const yearSet = new Set();
  for (const p of rankings) {
    if (!p.closed) {
      for (const [yr, val] of Object.entries(p.rates)) {
        if (val !== null) yearSet.add(yr);
      }
    }
  }
  const years = [...yearSet].sort();

  buildYearSelector(years);
  render(activeYear);
}

main().catch(err => {
  console.error('Rankings page error:', err);
  document.getElementById('rankings-page').insertAdjacentHTML('afterbegin', `
    <div class="error-banner" style="margin-bottom:1.5rem;border-radius:var(--r)">
      <div class="container" style="padding:0.75rem 1rem">
        <p>Failed to load rankings data. Please refresh the page.</p>
      </div>
    </div>
  `);
});
