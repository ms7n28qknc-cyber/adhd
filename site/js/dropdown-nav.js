/**
 * dropdown-nav.js
 * Keyboard-accessible dropdown navigation for ADHD Prescribing site.
 * Works alongside the existing nav.js mobile hamburger logic.
 */
(function () {
  'use strict';

  function initDropdowns() {
    var dropdowns = document.querySelectorAll('[data-dropdown]');
    if (!dropdowns.length) return;

    dropdowns.forEach(function (dropdown) {
      var btn  = dropdown.querySelector('.nav-dropdown-btn');
      var menu = dropdown.querySelector('.nav-dropdown-menu');
      if (!btn || !menu) return;

      // Toggle on button click
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = btn.getAttribute('aria-expanded') === 'true';

        // Close all other open dropdowns first
        closeAll(dropdowns);

        if (!isOpen) {
          open(btn, menu);
        }
      });

      // Keyboard navigation within menu
      menu.addEventListener('keydown', function (e) {
        var items = Array.from(menu.querySelectorAll('.nav-dropdown-item'));
        var focused = document.activeElement;
        var idx = items.indexOf(focused);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          var next = items[idx + 1] || items[0];
          next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          var prev = items[idx - 1] || items[items.length - 1];
          prev.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          closeAll(dropdowns);
          btn.focus();
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', function () {
      closeAll(dropdowns);
    });

    // Close on Escape anywhere
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(dropdowns);
    });
  }

  function open(btn, menu) {
    btn.setAttribute('aria-expanded', 'true');
    menu.classList.add('is-open');
  }

  function close(btn, menu) {
    btn.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
  }

  function closeAll(dropdowns) {
    dropdowns.forEach(function (dropdown) {
      var btn  = dropdown.querySelector('.nav-dropdown-btn');
      var menu = dropdown.querySelector('.nav-dropdown-menu');
      if (btn && menu) close(btn, menu);
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDropdowns);
  } else {
    initDropdowns();
  }
})();
