(function(){
  const menu = document.querySelector('.blog-menu');
  const panel = document.querySelector('.mobile-panel');
  if(menu && panel){
    menu.addEventListener('click',()=>{
      menu.classList.toggle('open');
      panel.style.display = menu.classList.contains('open') ? 'flex' : 'none';
      menu.setAttribute('aria-expanded', menu.classList.contains('open') ? 'true':'false');
    });
  }

  const progress = document.querySelector('.article-progress');
  if(progress){
    const update = ()=>{
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
      progress.style.width = Math.min(100,Math.max(0,pct)) + '%';
    };
    addEventListener('scroll', update, {passive:true});
    update();
  }
})();
