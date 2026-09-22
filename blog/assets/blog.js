(() => {
  const menu = document.querySelector('.blog-menu');
  const panel = document.querySelector('.mobile-panel');

  if (menu && panel) {
    const closeMenu = () => {
      menu.classList.remove('open');
      panel.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
    };

    menu.addEventListener('click', () => {
      const isOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', isOpen);
      menu.classList.toggle('open', isOpen);
      menu.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    panel.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
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

  const form = document.getElementById('home-newsletter-form');
  if (form) {
    const API_BASE_URL = 'https://auralis-skyshare-com.onrender.com';
    const emailInput = document.getElementById('home-newsletter-email');
    const consentInput = document.getElementById('home-newsletter-consent');
    const submitBtn = document.getElementById('home-newsletter-submit');
    const status = document.getElementById('home-newsletter-status');
    const hp = document.getElementById('home-newsletter-hp');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.className = 'home-newsletter-status';
      status.textContent = '';

      const email = (emailInput.value || '').trim();
      if (!email || !emailInput.checkValidity()) {
        status.className = 'home-newsletter-status err';
        status.textContent = 'Inserisci un indirizzo email valido.';
        emailInput.focus();
        return;
      }
      if (!consentInput.checked) {
        status.className = 'home-newsletter-status err';
        status.textContent = 'Per iscriverti è necessario prestare il consenso alle comunicazioni.';
        return;
      }
      if (hp && hp.value) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Invio…';

      try {
        const response = await fetch(`${API_BASE_URL}/api/newsletter/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            email,
            consent: true,
            source: 'blog_inline',
            consentAt: new Date().toISOString()
          })
        });
        const data = await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(data.error || 'Iscrizione non riuscita');

        status.className = 'home-newsletter-status ok';
        status.textContent = 'Perfetto. Controlla la tua inbox per completare l’iscrizione.';
        form.reset();
      } catch (err) {
        console.error('Blog newsletter subscribe error:', err);
        status.className = 'home-newsletter-status err';
        status.textContent = 'Newsletter in configurazione. Riprova tra poco.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Iscriviti';
      }
    });
  }
})();
