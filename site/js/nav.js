/**
 * nav.js — Hamburger menu behaviour
 * Pure vanilla JS, no dependencies.
 * Shared across all pages.
 */
(function () {
  'use strict';

  var toggle = document.getElementById('nav-toggle');
  var nav    = document.getElementById('site-nav');

  if (!toggle || !nav) return;

  function openMenu() {
    nav.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
  }

  function closeMenu() {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
  }

  // Toggle on hamburger click
  toggle.addEventListener('click', function () {
    if (nav.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close when any nav link is tapped
  var links = nav.querySelectorAll('.nav-link');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', closeMenu);
  }

  // Close when tapping outside the header
  document.addEventListener('click', function (e) {
    var header = document.querySelector('.site-header');
    if (header && !header.contains(e.target)) {
      closeMenu();
    }
  });

  // Close if window is resized back to desktop width
  window.addEventListener('resize', function () {
    if (window.innerWidth > 768) {
      closeMenu();
    }
  });
}());
