(() => {
  const menu = document.querySelector('.blog-menu');
  const panel = document.querySelector('.mobile-panel');

  if (menu && panel) {
    const closeMenu = () => {
      menu.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
    };

    menu.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      menu.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    panel.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });
  }

  const progress = document.querySelector('.article-progress');
  if (progress) {
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const value = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      progress.style.width = value + '%';
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
  }
})();
