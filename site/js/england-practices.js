/* england-practices.js — England ADHD Prescribing — All Practices page */

(function () {
  'use strict';

  const INDEX_URL    = '../data/england/practices-index.json';
  const PRACTICE_URL = code => `../data/england/practices/${code}.json`;
  const PAGE_SIZE    = 50;

  const DRUG_COLOURS = {
    Methylphenidate:  '#2563eb',
    Lisdexamfetamine: '#16a34a',
    Atomoxetine:      '#d97706',
    Dexamfetamine:    '#9333ea',
    Guanfacine:       '#0891b2',
    Modafinil:        '#dc2626',
  };
  const DRUG_ORDER = ['Methylphenidate','Lisdexamfetamine','Atomoxetine','Dexamfetamine','Guanfacine','Modafinil'];

  let allPractices = [];
  let filtered     = [];
  let currentPage  = 0;
  let detailChart  = null;

  // ── helpers ────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtK(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'m';
    if (n >= 1_000)     return (n/1_000).toFixed(0)+'k';
    return String(n);
  }
  function fmtCost(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return '£'+(n/1_000_000).toFixed(1)+'m';
    if (n >= 1_000)     return '£'+(n/1_000).toFixed(0)+'k';
    return '£'+n.toFixed(0);
  }
  function fmtRate(n) {
    if (n == null) return '—';
    return n.toFixed(2);
  }

  // Normalise text for search
  function norm(s) { return String(s||'').toLowerCase(); }

  // ── build search UI ────────────────────────────────────────────────────────

  function buildSearchUI(container) {
    container.innerHTML = `
      <div class="browse-search-row">
        <input type="search" id="practice-search" class="browse-search"
               placeholder="Search by name, postcode…" aria-label="Search practices" autocomplete="off">
        <select id="region-filter" class="filter-select" aria-label="Filter by region">
          <option value="">All regions</option>
        </select>
        <select id="icb-filter" class="filter-select" aria-label="Filter by ICB">
          <option value="">All ICBs</option>
        </select>
      </div>
      <p id="browse-count" class="browse-count" aria-live="polite"></p>
      <div id="practice-list"></div>
      <div id="browse-pagination" class="browse-pagination"></div>
      <div id="practice-detail" class="practice-detail hidden"></div>
    `;

    // Populate region filter
    const regions = [...new Set(allPractices.map(p => p.region).filter(Boolean))].sort();
    const regionSel = document.getElementById('region-filter');
    for (const r of regions) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r.charAt(0) + r.slice(1).toLowerCase();
      regionSel.appendChild(opt);
    }

    // Populate ICB filter (all initially)
    populateICBFilter('');

    document.getElementById('practice-search').addEventListener('input', debounce(onFilter, 200));
    regionSel.addEventListener('change', () => {
      populateICBFilter(regionSel.value);
      onFilter();
    });
    document.getElementById('icb-filter').addEventListener('change', onFilter);
  }

  function populateICBFilter(region) {
    const icbSel = document.getElementById('icb-filter');
    const current = icbSel.value;
    icbSel.innerHTML = '<option value="">All ICBs</option>';
    const source = region ? allPractices.filter(p => p.region === region) : allPractices;
    const icbs = [...new Set(source.map(p => p.icb_name).filter(Boolean))].sort();
    for (const icb of icbs) {
      const opt = document.createElement('option');
      opt.value = icb;
      opt.textContent = icb.replace(/^NHS /, '').replace(/ ICB - \w+$/, '');
      if (icb === current) opt.selected = true;
      icbSel.appendChild(opt);
    }
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── filter + render list ───────────────────────────────────────────────────

  function onFilter() {
    const q      = norm(document.getElementById('practice-search').value.trim());
    const region = document.getElementById('region-filter').value;
    const icb    = document.getElementById('icb-filter').value;

    filtered = allPractices.filter(p => {
      if (region && p.region !== region) return false;
      if (icb    && p.icb_name !== icb)  return false;
      if (q) {
        return norm(p.name).includes(q) ||
               norm(p.postcode).includes(q) ||
               norm(p.code).includes(q);
      }
      return true;
    });

    currentPage = 0;
    renderList();
    closeDetail();
  }

  function renderList() {
    const listEl   = document.getElementById('practice-list');
    const countEl  = document.getElementById('browse-count');
    const pagEl    = document.getElementById('browse-pagination');
    if (!listEl) return;

    const total   = filtered.length;
    const pages   = Math.ceil(total / PAGE_SIZE);
    const start   = currentPage * PAGE_SIZE;
    const slice   = filtered.slice(start, start + PAGE_SIZE);

    if (countEl) {
      countEl.textContent = total === allPractices.length
        ? `${total.toLocaleString('en-GB')} practices`
        : `${total.toLocaleString('en-GB')} of ${allPractices.length.toLocaleString('en-GB')} practices`;
    }

    if (total === 0) {
      listEl.innerHTML = '<p style="padding:2rem;color:var(--text-3)">No practices match your search.</p>';
      pagEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = slice.map(p => `
      <div class="browse-item" data-code="${esc(p.code)}" role="button" tabindex="0"
           aria-label="View details for ${esc(p.name)}">
        <div class="browse-item-name">${esc(p.name)}</div>
        <div class="browse-item-meta">
          <span>${esc(p.code)}</span>
          ${p.postcode ? `<span>${esc(p.postcode)}</span>` : ''}
          ${p.icb_name ? `<span>${esc(p.icb_name.replace(/^NHS /, '').replace(/ ICB - \w+$/, ''))}</span>` : ''}
          ${p.region   ? `<span>${esc(p.region.charAt(0) + p.region.slice(1).toLowerCase())}</span>` : ''}
        </div>
      </div>`).join('');

    // Click/keyboard handlers
    listEl.querySelectorAll('.browse-item').forEach(el => {
      el.addEventListener('click',   () => openDetail(el.dataset.code));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(el.dataset.code); });
    });

    // Pagination
    if (pages <= 1) { pagEl.innerHTML = ''; return; }
    const btns = [];
    if (currentPage > 0) btns.push(`<button class="pag-btn" data-page="${currentPage-1}">← Prev</button>`);
    btns.push(`<span class="pag-info">Page ${currentPage+1} of ${pages}</span>`);
    if (currentPage < pages - 1) btns.push(`<button class="pag-btn" data-page="${currentPage+1}">Next →</button>`);
    pagEl.innerHTML = btns.join('');
    pagEl.querySelectorAll('.pag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = parseInt(btn.dataset.page);
        renderList();
        document.getElementById('practice-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ── practice detail panel ──────────────────────────────────────────────────

  function closeDetail() {
    const el = document.getElementById('practice-detail');
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
    if (detailChart) { detailChart.destroy(); detailChart = null; }
  }

  function openDetail(code) {
    const detailEl = document.getElementById('practice-detail');
    if (!detailEl) return;

    // Scroll to detail
    detailEl.classList.remove('hidden');
    detailEl.innerHTML = '<p style="padding:1.5rem;color:var(--text-3)">Loading practice data…</p>';
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (detailChart) { detailChart.destroy(); detailChart = null; }

    fetch(PRACTICE_URL(code))
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then(p => renderDetail(p, detailEl))
      .catch(() => {
        detailEl.innerHTML = '<p style="padding:1.5rem;color:var(--text-3)">Could not load practice data.</p>';
      });
  }

  function renderDetail(p, el) {
    const months = p.months || [];

    // Totals
    const totalItems = months.reduce((s, m) => s + (m.total_items || 0), 0);
    const totalCost  = months.reduce((s, m) => s + (m.total_cost  || 0), 0);
    const lastMonth  = [...months].reverse().find(m => m.total_items > 0);
    const lastRate   = lastMonth?.rate != null ? fmtRate(lastMonth.rate) + ' per 1k' : '—';

    // Drug totals
    const drugTotals = {};
    for (const m of months) {
      if (!m.drugs) continue;
      for (const [d, n] of Object.entries(m.drugs)) {
        drugTotals[d] = (drugTotals[d] || 0) + n;
      }
    }
    const grandItems = Object.values(drugTotals).reduce((s, v) => s + v, 0);
    const drugs = DRUG_ORDER.filter(d => drugTotals[d] > 0);

    el.innerHTML = `
      <div class="practice-detail-inner">
        <button class="practice-detail-close" id="detail-close" aria-label="Close practice detail">✕ Close</button>
        <h2 class="practice-detail-title">${esc(p.name)}</h2>
        <div class="practice-detail-meta">
          <span>Code: <strong>${esc(p.code)}</strong></span>
          ${p.address  ? `<span>${esc(p.address)}</span>` : ''}
          ${p.postcode ? `<span>${esc(p.postcode)}</span>` : ''}
          ${p.icb_name ? `<span>ICB: ${esc(p.icb_name)}</span>` : ''}
          ${p.region   ? `<span>Region: ${esc(p.region)}</span>` : ''}
        </div>

        <div class="stats-grid" style="margin:1rem 0">
          <div class="stat-card"><div class="stat-label">Total items (all years)</div><div class="stat-value">${fmtK(totalItems)}</div></div>
          <div class="stat-card"><div class="stat-label">Gross cost (all years)</div><div class="stat-value">${fmtCost(totalCost)}</div></div>
          <div class="stat-card"><div class="stat-label">Latest monthly rate</div><div class="stat-value">${lastRate}</div></div>
          <div class="stat-card"><div class="stat-label">Months of data</div><div class="stat-value">${months.length}</div></div>
        </div>

        ${drugs.length > 0 ? `
        <div class="table-card" style="margin-bottom:1rem">
          <div class="table-card-hd"><div class="section-title">Drug breakdown</div></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Drug</th><th class="col-num">Items</th><th class="col-num">Share</th></tr></thead>
              <tbody>${drugs.map(d => `
                <tr>
                  <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${DRUG_COLOURS[d]||'#888'};margin-right:6px"></span>${esc(d)}</td>
                  <td class="col-num">${fmtK(drugTotals[d])}</td>
                  <td class="col-num">${((drugTotals[d]/grandItems)*100).toFixed(1)}%</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

        ${months.length > 0 ? `
        <div class="chart-card" style="margin-bottom:1rem">
          <div class="chart-card-hd">
            <div class="chart-title">Prescribing trend</div>
            <div class="chart-desc">Monthly items over time${months.some(m => m.rate != null) ? ' and rate per 1,000 patients' : ''}</div>
          </div>
          <div class="chart-wrap" style="height:220px">
            <canvas id="detail-chart"></canvas>
          </div>
        </div>` : ''}
      </div>`;

    document.getElementById('detail-close').addEventListener('click', closeDetail);

    // Draw trend chart
    if (months.length > 0) {
      const canvas = document.getElementById('detail-chart');
      if (canvas) {
        const hasRate = months.some(m => m.rate != null);
        const datasets = [{
          label: 'Items',
          data: months.map(m => m.total_items || 0),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.10)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
          yAxisID: 'yItems',
        }];

        if (hasRate) {
          datasets.push({
            label: 'Rate (per 1k)',
            data: months.map(m => m.rate ?? null),
            borderColor: '#16a34a',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            yAxisID: 'yRate',
            spanGaps: true,
          });
        }

        detailChart = new Chart(canvas, {
          type: 'line',
          data: { labels: months.map(m => m.month), datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
            scales: {
              x: { ticks: { maxTicksLimit: 8, callback(v) {
                const l = this.getLabelForValue(v);
                return l.endsWith('-01') ? l.slice(0,4) : '';
              }}},
              yItems: { position: 'left',  title: { display: true, text: 'Items' } },
              ...(hasRate ? { yRate: { position: 'right', title: { display: true, text: 'Rate' }, grid: { drawOnChartArea: false } } } : {}),
            },
          },
        });
      }
    }
  }

  // ── init ───────────────────────────────────────────────────────────────────

  const container = document.getElementById('browse-list');
  if (!container) return;

  container.innerHTML = '<p style="padding:2rem;color:var(--text-3)">Loading practices…</p>';

  fetch(INDEX_URL)
    .then(r => r.json())
    .then(data => {
      allPractices = data;
      filtered     = data;
      buildSearchUI(container);
      renderList();
    })
    .catch(err => {
      console.error('england-practices: failed to load index', err);
      container.innerHTML = '<p style="padding:2rem;color:var(--text-3)">Failed to load practice list.</p>';
    });

})();
