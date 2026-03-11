/* england-rankings.js — England ADHD Prescribing Rankings page */

(function () {
  'use strict';

  const DATA_URL = '../data/england/rankings.json';

  let allRankings = [];
  let barChart    = null;

  // ── helpers ────────────────────────────────────────────────────────────────

  function fmt(n)  { return n == null ? '—' : n.toLocaleString('en-GB'); }
  function fmtRate(n) {
    if (n == null) return '—';
    return n >= 100 ? n.toFixed(1) : n.toFixed(2);
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── region filter ──────────────────────────────────────────────────────────

  function populateRegionFilter(rankings) {
    const sel = document.getElementById('region-select');
    if (!sel) return;
    const regions = [...new Set(rankings.map(r => r.region).filter(Boolean))].sort();
    for (const r of regions) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r.charAt(0) + r.slice(1).toLowerCase().replace(/ and /g, ' and ');
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => renderAll(sel.value));
  }

  // ── bar chart ──────────────────────────────────────────────────────────────

  function buildBarChart(top10) {
    const canvas = document.getElementById('rankings-bar-chart');
    if (!canvas) return;

    const labels = top10.map(r => {
      const name = r.name.length > 30 ? r.name.slice(0, 28) + '…' : r.name;
      return name;
    });
    const data   = top10.map(r => r.rate);
    const bgs    = top10.map((_, i) => i === 0 ? 'rgba(220,38,38,0.8)' : 'rgba(37,99,235,0.7)');

    if (barChart) { barChart.destroy(); barChart = null; }

    barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Rate (items / 1k patients / month)',
          data,
          backgroundColor: bgs,
          borderColor: bgs.map(c => c.replace('0.7','1').replace('0.8','1')),
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const r = top10[ctx.dataIndex];
                return [
                  ` Rate: ${fmtRate(r.rate)} items/1k/month`,
                  ` Items (12m): ${fmt(r.items_12m)}`,
                  ` ICB: ${r.icb || '—'}`,
                ];
              },
            },
          },
        },
        scales: {
          x: { title: { display: true, text: 'Items per 1,000 patients per month' } },
          y: { ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  // ── table ──────────────────────────────────────────────────────────────────

  function buildTable(filtered) {
    const tbody      = document.getElementById('rankings-tbody');
    const noData     = document.getElementById('rankings-no-data');
    const tableWrap  = document.getElementById('rankings-table-wrap');
    const tableDesc  = document.getElementById('rankings-table-desc');
    if (!tbody) return;

    if (filtered.length === 0) {
      noData && noData.classList.remove('hidden');
      tableWrap && tableWrap.classList.add('hidden');
      return;
    }
    noData && noData.classList.add('hidden');
    tableWrap && tableWrap.classList.remove('hidden');

    // Show top 25 + bottom 25 (avoiding duplicates when fewer than 50 total)
    const top    = filtered.slice(0, 25);
    const bottom = filtered.slice(-25).filter(r => !top.includes(r));
    const rows   = [...top];
    let addedSep = false;
    if (bottom.length) {
      rows.push(null); // separator
      addedSep = true;
      rows.push(...bottom);
    }

    const totalShown = top.length + bottom.length;
    if (tableDesc) {
      tableDesc.textContent = filtered.length <= 50
        ? `Showing all ${filtered.length} practices`
        : `Showing top ${top.length} and bottom ${bottom.length} of ${fmt(filtered.length)} practices`;
    }

    tbody.innerHTML = rows.map(r => {
      if (r === null) {
        return `<tr class="table-separator"><td colspan="6" style="text-align:center;padding:0.35rem;color:var(--text-3);font-size:0.78rem;background:var(--bg-2)">
          ⋮ ${fmt(filtered.length - 50)} more practices not shown ⋮
        </td></tr>`;
      }
      return `<tr>
        <td class="col-num">${r.rank}</td>
        <td>${esc(r.name)}<br><small style="color:var(--text-3)">${esc(r.code)}</small></td>
        <td style="font-size:0.82rem">${esc(r.icb || '—')}</td>
        <td style="font-size:0.82rem">${esc(r.region || '—')}</td>
        <td class="col-rate">${fmtRate(r.rate)}</td>
        <td class="col-num">${fmt(r.items_12m)}</td>
      </tr>`;
    }).join('');
  }

  // ── combined render ────────────────────────────────────────────────────────

  function renderAll(regionFilter) {
    const filtered = regionFilter
      ? allRankings.filter(r => r.region === regionFilter)
      : allRankings;

    const top10 = filtered.slice(0, 10);
    buildBarChart(top10);
    buildTable(filtered);

    const descEl = document.getElementById('bar-chart-desc');
    if (descEl) {
      descEl.textContent = regionFilter
        ? `Top 10 practices in ${regionFilter.charAt(0) + regionFilter.slice(1).toLowerCase()} — items / 1k patients / month`
        : 'Top 10 practices in England — items / 1k patients / month';
    }
  }

  // ── init ───────────────────────────────────────────────────────────────────

  fetch(DATA_URL)
    .then(r => r.json())
    .then(data => {
      // rankings.json is stored as [[key,val],...] array-of-pairs or plain object
      let obj = data;
      if (Array.isArray(data)) {
        obj = Object.fromEntries(data);
      }

      const period   = obj.period   || '';
      const rankings = obj.rankings || [];

      allRankings = rankings;

      // Period note
      const note = document.getElementById('rankings-period-note');
      if (note && period) note.textContent = `Period: ${period}`;

      populateRegionFilter(rankings);
      renderAll('');
    })
    .catch(err => {
      console.error('england-rankings: failed to load data', err);
      const tbody = document.getElementById('rankings-tbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:2rem">Failed to load rankings data.</td></tr>';
    });

})();
