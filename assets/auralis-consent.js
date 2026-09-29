(function(){
  'use strict';

  const MEASUREMENT_ID = 'G-Z1EXTLD4JV';
  const STORAGE_KEY = 'auralis_consent_v1';
  const STYLE_ID = 'auralis-consent-style';
  const BANNER_ID = 'auralis-consent-banner';
  const PANEL_ID = 'auralis-consent-panel';

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };

  function safeParse(value){
    try { return JSON.parse(value); } catch (_e) { return null; }
  }

  function readConsent(){
    try { return safeParse(localStorage.getItem(STORAGE_KEY)); } catch (_e) { return null; }
  }

  function consentState(prefs){
    const analytics = !!prefs?.analytics;
    return {
      analytics_storage: analytics ? 'granted' : 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted'
    };
  }

  const saved = readConsent();
  let googleTagLoaded = false;

  // Consent Mode v2, basic implementation: no Google request is made
  // until Analytics consent has been explicitly granted.
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted'
  });

  function loadGoogleTag(){
    if(googleTagLoaded || document.querySelector('script[data-auralis-ga4]')){
      googleTagLoaded = true;
      return;
    }
    googleTagLoaded = true;
    gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted'
    });
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, {
      send_page_view: true,
      allow_google_signals: false
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    script.dataset.auralisGa4 = '1';
    document.head.appendChild(script);
  }

  function analyticsAllowed(){
    return !!readConsent()?.analytics;
  }

  function clearAnalyticsCookies(){
    document.cookie.split(';').forEach(function(cookie){
      const name = cookie.split('=')[0].trim();
      if(!/^_ga(?:_|$)/.test(name)) return;
      const host = window.location.hostname;
      const domains = ['', host, '.' + host, '.auralisair.it'];
      domains.forEach(function(domain){
        const domainPart = domain ? '; domain=' + domain : '';
        document.cookie = name + '=; Max-Age=0; path=/' + domainPart + '; SameSite=Lax';
      });
    });
  }

  if(saved?.analytics){
    loadGoogleTag();
  }

  window.auralisTrack = function(eventName, params){
    if(!eventName || typeof window.gtag !== 'function' || !analyticsAllowed()) return;
    const safe = Object.assign({
      page_path: window.location.pathname,
      page_location: window.location.href
    }, params || {});
    // Never pass email/name/phone or other user-entered PII here.
    gtag('event', eventName, safe);
  };

  function injectStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{--ac-navy:#07182d;--ac-navy2:#0d2a4c;--ac-gold:#e8c96a;--ac-text:#0a1628;--ac-muted:#667487;--ac-border:rgba(10,22,40,.10)}
      .ac-banner{position:fixed;left:18px;right:18px;bottom:18px;z-index:2147483000;display:none;max-width:1180px;margin:0 auto;padding:18px 18px 16px;border:1px solid rgba(255,255,255,.58);border-radius:28px;background:rgba(255,255,255,.93);box-shadow:0 24px 80px rgba(4,12,24,.22);backdrop-filter:blur(24px) saturate(145%);-webkit-backdrop-filter:blur(24px) saturate(145%);font-family:Inter,Arial,sans-serif;color:var(--ac-text)}
      .ac-banner.open{display:block;animation:acUp .24s ease both}@keyframes acUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      .ac-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:center}.ac-title{margin:0 0 6px;font-size:18px;line-height:1.1;font-weight:850;letter-spacing:-.35px}.ac-copy{margin:0;max-width:760px;color:var(--ac-muted);font-size:12px;line-height:1.6}.ac-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.ac-btn{min-height:44px;padding:0 17px;border-radius:999px;border:1px solid var(--ac-border);background:#fff;color:var(--ac-text);font:inherit;font-size:10px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:.2s ease}.ac-btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(10,22,40,.09)}.ac-btn.primary{background:var(--ac-navy);color:#fff;border-color:var(--ac-navy)}.ac-btn.reject{background:#fff}.ac-btn.gold{background:var(--ac-gold);border-color:var(--ac-gold);color:var(--ac-navy)}
      .ac-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(4,12,24,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.ac-overlay.open{display:flex}.ac-panel{width:min(620px,100%);max-height:min(760px,88vh);overflow:auto;border-radius:30px;background:#fff;border:1px solid rgba(255,255,255,.6);box-shadow:0 34px 100px rgba(0,0,0,.28);padding:28px;color:var(--ac-text);font-family:Inter,Arial,sans-serif}.ac-panel-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}.ac-panel h2{font-size:28px;line-height:1.05;letter-spacing:-1px;margin:0 0 8px}.ac-panel p{font-size:12px;line-height:1.65;color:var(--ac-muted);margin:0}.ac-close{border:0;background:#f3f5f8;width:38px;height:38px;border-radius:999px;font-size:22px;color:var(--ac-text);cursor:pointer}.ac-option{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 0;border-top:1px solid var(--ac-border)}.ac-option:first-of-type{margin-top:8px}.ac-option strong{display:block;font-size:14px;margin-bottom:4px}.ac-option span{display:block;color:var(--ac-muted);font-size:11px;line-height:1.5}.ac-switch{position:relative;width:48px;height:28px;display:inline-block}.ac-switch input{opacity:0;width:0;height:0}.ac-slider{position:absolute;inset:0;border-radius:999px;background:#d7dde5;transition:.2s}.ac-slider:before{content:"";position:absolute;width:22px;height:22px;left:3px;top:3px;background:#fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.16);transition:.2s}.ac-switch input:checked + .ac-slider{background:var(--ac-navy)}.ac-switch input:checked + .ac-slider:before{transform:translateX(20px)}.ac-switch.locked{opacity:.58;pointer-events:none}.ac-panel-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:20px;border-top:1px solid var(--ac-border)}
      .ac-footer-link{border:0;background:none;padding:0;color:rgba(255,255,255,.28);font:inherit;font-size:11px;cursor:pointer;text-decoration:none}.ac-footer-link:hover{color:rgba(255,255,255,.72)}
      @media(max-width:760px){.ac-banner{left:10px;right:10px;bottom:10px;padding:18px;border-radius:24px}.ac-grid{grid-template-columns:1fr;gap:16px}.ac-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.ac-actions .primary{grid-column:1/-1}.ac-btn{width:100%;padding:0 10px}.ac-panel{padding:22px;border-radius:26px}.ac-panel h2{font-size:25px}.ac-panel-actions{display:grid;grid-template-columns:1fr 1fr}.ac-panel-actions .primary{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function saveConsent(prefs, source){
    const record = {
      analytics: !!prefs.analytics,
      marketing: false,
      updatedAt: new Date().toISOString(),
      source: source || 'banner'
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (_e) {}

    if(record.analytics){
      if(!googleTagLoaded) loadGoogleTag();
      else gtag('consent', 'update', consentState(record));
      gtag('set', 'allow_google_signals', false);
      window.auralisTrack?.('consent_update', {
        analytics_consent: 'granted',
        marketing_consent: 'denied',
        consent_source: record.source
      });
    } else {
      if(googleTagLoaded) gtag('consent', 'update', consentState(record));
      clearAnalyticsCookies();
    }

    closeBanner();
    closePanel();
  }

  function bannerMarkup(){
    return `<section class="ac-banner" id="${BANNER_ID}" role="dialog" aria-live="polite" aria-label="Preferenze cookie">
      <div class="ac-grid">
        <div><h2 class="ac-title">La tua privacy, con la stessa cura.</h2><p class="ac-copy">Usiamo cookie necessari per il funzionamento del sito. Con il tuo consenso possiamo usare anche Analytics per capire come viene utilizzato Auralis e migliorare l’esperienza. Puoi cambiare scelta in qualsiasi momento. <a href="/cookie-policy/" style="color:inherit;text-decoration:underline">Cookie Policy</a> · <a href="/privacy/" style="color:inherit;text-decoration:underline">Privacy Policy</a>.</p></div>
        <div class="ac-actions">
          <button class="ac-btn reject" type="button" data-ac-action="reject">Rifiuta</button>
          <button class="ac-btn" type="button" data-ac-action="customize">Personalizza</button>
          <button class="ac-btn primary" type="button" data-ac-action="accept">Accetta tutti</button>
        </div>
      </div>
    </section>`;
  }

  function panelMarkup(){
    const prefs = readConsent() || {analytics:false,marketing:false};
    return `<div class="ac-overlay" id="${PANEL_ID}" aria-hidden="true">
      <section class="ac-panel" role="dialog" aria-modal="true" aria-labelledby="ac-panel-title">
        <div class="ac-panel-head"><div><h2 id="ac-panel-title">Preferenze cookie</h2><p>Scegli quali categorie autorizzare. I cookie necessari restano sempre attivi perché servono al funzionamento e alla sicurezza del sito. Per maggiori dettagli consulta la <a href="/cookie-policy/" style="color:inherit;text-decoration:underline">Cookie Policy</a>.</p></div><button class="ac-close" type="button" data-ac-action="close" aria-label="Chiudi">×</button></div>
        <div class="ac-option"><div><strong>Necessari</strong><span>Autenticazione, sicurezza e funzioni essenziali del sito.</span></div><label class="ac-switch locked"><input type="checkbox" checked disabled><span class="ac-slider"></span></label></div>
        <div class="ac-option"><div><strong>Analytics</strong><span>Google Analytics 4 per comprendere utilizzo, prestazioni e conversioni senza inviare dati personali nei nostri eventi.</span></div><label class="ac-switch"><input id="ac-analytics" type="checkbox" ${prefs.analytics?'checked':''}><span class="ac-slider"></span></label></div>
        <div class="ac-panel-actions"><button class="ac-btn reject" type="button" data-ac-action="reject">Rifiuta</button><button class="ac-btn primary" type="button" data-ac-action="save">Salva preferenze</button></div>
      </section>
    </div>`;
  }

  function openBanner(){ document.getElementById(BANNER_ID)?.classList.add('open'); }
  function closeBanner(){ document.getElementById(BANNER_ID)?.classList.remove('open'); }
  function openPanel(){ const p=document.getElementById(PANEL_ID); if(!p)return; const prefs=readConsent()||{analytics:false}; const a=p.querySelector('#ac-analytics'); if(a)a.checked=!!prefs.analytics; p.classList.add('open'); p.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
  function closePanel(){ const p=document.getElementById(PANEL_ID); if(!p)return; p.classList.remove('open'); p.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }

  function addFooterPreferenceLink(){
    if(document.querySelector('.ac-footer-link')) return;
    const footer = document.getElementById('main-footer') || document.querySelector('footer');
    if(!footer) return;
    const target = footer.querySelector('.foot-bottom > div:last-child') || footer.querySelector('.foot-bottom') || footer;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ac-footer-link';
    btn.textContent = 'Preferenze cookie';
    btn.addEventListener('click', openPanel);
    target.appendChild(btn);
  }

  function eventMetaFromCard(card){
    if(!card) return {};
    const route = card.querySelector('.el-rt')?.innerText?.replace(/\s+/g,' ').trim() || '';
    const legId = card.dataset?.legId || '';
    return {empty_leg_id: legId, route: route.slice(0,100)};
  }

  function setupTracking(){
    let filterTimer = 0;
    document.addEventListener('click', function(event){
      const inspire = event.target.closest('#el-mode-inspire,.el-inspire-go');
      if(inspire) window.auralisTrack?.('inspire_click');

      const viewCards = event.target.closest('#el-view-cards');
      const viewList = event.target.closest('#el-view-list');
      if(viewCards || viewList) window.auralisTrack?.('change_results_view',{results_view:viewList?'list':'cards'});

      const booking = event.target.closest('.el-btn,[data-action="book"],button');
      if(booking && /prenota ora/i.test((booking.textContent||'').trim())){
        const card = booking.closest('.el-card');
        window.auralisTrack?.('begin_booking', eventMetaFromCard(card));
      }

      const card = event.target.closest('.el-card');
      if(card && !event.target.closest('button,a')) window.auralisTrack?.('view_empty_leg', eventMetaFromCard(card));

      const auth = event.target.closest('#btn-auth,#btn-auth-mobile,[data-auth-login]');
      if(auth && /login|accedi/i.test((auth.textContent||'').trim())) window.auralisTrack?.('login_start',{method:'auth0'});
    }, {passive:true});

    document.addEventListener('change', function(event){
      if(!event.target.matches('#el-filter-from,#el-filter-to,#el-filter-date,#el-filter-pax,#el-filter-jet,#el-inspire-from')) return;
      clearTimeout(filterTimer);
      filterTimer = window.setTimeout(function(){
        window.auralisTrack?.('filter_empty_leg',{
          filter_name: event.target.id,
          filter_value: String(event.target.value||'').slice(0,80)
        });
      },250);
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    injectStyles();
    if(!document.getElementById(BANNER_ID)) document.body.insertAdjacentHTML('beforeend', bannerMarkup());
    if(!document.getElementById(PANEL_ID)) document.body.insertAdjacentHTML('beforeend', panelMarkup());
    addFooterPreferenceLink();
    setupTracking();

    document.body.addEventListener('click', function(event){
      const action = event.target.closest('[data-ac-action]')?.dataset?.acAction;
      if(!action) return;
      if(action==='accept') saveConsent({analytics:true},'accept_all');
      if(action==='reject') saveConsent({analytics:false},'reject_all');
      if(action==='customize') openPanel();
      if(action==='close') closePanel();
      if(action==='save') saveConsent({analytics:!!document.getElementById('ac-analytics')?.checked},'custom');
    });
    document.getElementById(PANEL_ID)?.addEventListener('click', function(event){ if(event.target===this) closePanel(); });
    document.addEventListener('keydown', function(event){ if(event.key==='Escape') closePanel(); });

    if(!saved) openBanner();
  });
})();
