(() => {
  function initCanonicalNavbar() {
    const nav = document.getElementById('mainnav');
    const burger = document.getElementById('nav-burger');
    if (!nav || !burger || burger.dataset.canonicalNavBound === '1') return;

    burger.dataset.canonicalNavBound = '1';

    const syncExpanded = () => {
      burger.setAttribute('aria-expanded', nav.classList.contains('mobile-open') ? 'true' : 'false');
    };

    const closeMenu = () => {
      nav.classList.remove('mobile-open');
      syncExpanded();
    };

    // Main/static pages already have an inline onclick handler. Journal pages do not.
    // Bind toggling only where it is missing to prevent a double toggle.
    if (!burger.getAttribute('onclick')) {
      burger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        nav.classList.toggle('mobile-open');
        syncExpanded();
      });
    } else {
      burger.addEventListener('click', () => {
        requestAnimationFrame(syncExpanded);
      });
    }

    nav.querySelectorAll('.nav-links a, .nav-links button').forEach((item) => {
      item.addEventListener('click', () => {
        // Close only the responsive dropdown; desktop state is unaffected.
        if (window.matchMedia('(max-width: 900px)').matches) closeMenu();
      });
    });

    document.addEventListener('click', (event) => {
      if (!nav.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (!window.matchMedia('(max-width: 900px)').matches) closeMenu();
    });

    syncExpanded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCanonicalNavbar, { once: true });
  } else {
    initCanonicalNavbar();
  }
})();
