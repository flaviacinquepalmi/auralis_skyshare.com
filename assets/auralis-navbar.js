(() => {
  function initCanonicalNavbar() {
    const nav = document.getElementById('mainnav');
    const burger = document.getElementById('nav-burger');
    if (!nav || !burger || burger.dataset.canonicalNavBound === '1') return;

    burger.dataset.canonicalNavBound = '1';

    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
    const syncExpanded = () => burger.setAttribute('aria-expanded', nav.classList.contains('mobile-open') ? 'true' : 'false');
    const closeMenu = () => {
      nav.classList.remove('mobile-open');
      syncExpanded();
    };

    /* SPA pages already own the toggle through onclick="toggleMobileMenu()".
       Static Journal pages do not, so bind exactly one toggle here. */
    if (!burger.hasAttribute('onclick')) {
      burger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        nav.classList.toggle('mobile-open');
        syncExpanded();
      });
    } else {
      burger.addEventListener('click', () => requestAnimationFrame(syncExpanded));
    }

    nav.querySelectorAll('.nav-links a, .nav-links button').forEach((item) => {
      item.addEventListener('click', () => {
        if (isMobile()) closeMenu();
      });
    });

    document.addEventListener('click', (event) => {
      if (isMobile() && !nav.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (!isMobile()) closeMenu();
    });

    syncExpanded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCanonicalNavbar, { once: true });
  } else {
    initCanonicalNavbar();
  }
})();
