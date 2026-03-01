/* practices.js — alphabetical browse page for ADHD Prescribing NI */
(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function titleCase(str) {
    if (!str) return str;
    return str
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/'S\b/g, "'s");
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Sort key: strip leading "The " so "The Mall Surgery" sorts under M
  function sortKey(name) {
    return name.replace(/^the\s+/i, '').trim();
  }

  function firstLetter(name) {
    const ch = sortKey(name).charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render(practices) {
    const count = practices.length;
    document.getElementById('browse-count').textContent =
      `${count.toLocaleString()} GP practice${count !== 1 ? 's' : ''} across Northern Ireland`;
    document.title = `All ${count} GP Practices — ADHD Prescribing NI`;

    // Sort alphabetically by surgeryName (using sort key)
    const sorted = [...practices].sort((a, b) => {
      const ka = sortKey((a.surgeryName || a.name || '')).toLowerCase();
      const kb = sortKey((b.surgeryName || b.name || '')).toLowerCase();
      return ka.localeCompare(kb);
    });

    // Group by first letter
    const groups = {};
    for (const p of sorted) {
      const letter = firstLetter(p.surgeryName || p.name || '');
      (groups[letter] = groups[letter] || []).push(p);
    }

    const presentLetters = new Set(Object.keys(groups));
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    // ── Alphabet nav ──────────────────────────────────────────────────────

    const navEl = document.getElementById('alpha-nav');
    navEl.innerHTML = ALPHABET
      .map(l => {
        if (presentLetters.has(l)) {
          return `<a class="alpha-btn" href="#letter-${l}" aria-label="Jump to ${l}">${l}</a>`;
        }
        return `<span class="alpha-btn alpha-btn--empty" aria-hidden="true">${l}</span>`;
      })
      .join('');

    // ── Practice list ─────────────────────────────────────────────────────

    const letters = [...presentLetters].sort();

    const html = letters.map(letter => {
      const cards = groups[letter].map(p => {
        const surgery  = escHtml(titleCase(p.surgeryName || ''));
        const doctor   = escHtml(titleCase(p.doctorName  || ''));
        const address  = escHtml(p.address  || '');
        const postcode = escHtml(p.postcode || '');
        const lcg      = escHtml(p.lcg      || '');

        // Build the address/postcode/LCG line, skipping blanks
        const meta = [address, postcode, lcg].filter(Boolean).join(' · ');

        return `<a href="index.html#practice/${p.id}" class="practice-entry">
          <div class="pe-surgery">${surgery}</div>
          ${doctor ? `<div class="pe-doctor">${doctor}</div>` : ''}
          ${meta   ? `<div class="pe-meta">${meta}</div>`     : ''}
        </a>`;
      }).join('');

      return `<section id="letter-${letter}" class="alpha-section">
        <h2 class="alpha-heading">${letter}</h2>
        <div class="practice-list">${cards}</div>
      </section>`;
    }).join('');

    document.getElementById('browse-list').innerHTML = html;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  fetch('data/practices-index.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(render)
    .catch(err => {
      document.getElementById('browse-count').textContent = 'Failed to load data';
      document.getElementById('browse-list').innerHTML =
        `<p class="browse-error">Could not load the practice list: ${escHtml(err.message)}</p>`;
    });
})();
