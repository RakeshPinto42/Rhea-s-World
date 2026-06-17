/* Shared handbook behavior: theme, mobile nav, scroll progress, TOC scrollspy, back-to-top. */
(function () {
  // theme (site-wide key)
  const tBtn = document.getElementById('themeBtn');
  function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('rhea_theme',t);if(tBtn)tBtn.innerHTML=t==='dark'?'&#9728; Light':'&#9789; Dark';}
  if(tBtn) tBtn.onclick=()=>setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
  setTheme(localStorage.getItem('rhea_theme')||'light');

  // mobile nav
  const navToggle=document.getElementById('navToggle'),navLinks=document.getElementById('navLinks');
  if(navToggle){navToggle.addEventListener('click',()=>{const o=navLinks.classList.toggle('open');navToggle.setAttribute('aria-expanded',o);});
    navLinks.addEventListener('click',e=>{if(e.target.tagName==='A'){navLinks.classList.remove('open');navToggle.setAttribute('aria-expanded','false');}});}

  // scroll progress bar
  const prog=document.getElementById('prog');
  const backtop=document.getElementById('backtop');
  function onScroll(){
    const h=document.documentElement;
    const sc=h.scrollTop||document.body.scrollTop;
    const max=h.scrollHeight-h.clientHeight;
    if(prog) prog.style.width=(max>0?(sc/max*100):0)+'%';
    if(backtop) backtop.classList.toggle('show',sc>500);
  }
  addEventListener('scroll',onScroll,{passive:true}); onScroll();
  if(backtop) backtop.onclick=()=>scrollTo({top:0,behavior:'smooth'});

  // TOC scrollspy
  const links=[...document.querySelectorAll('.toc a[href^="#"]')];
  const map=new Map(links.map(a=>[a.getAttribute('href').slice(1),a]));
  const secs=[...document.querySelectorAll('.content section[id]')];
  if(secs.length){
    const io=new IntersectionObserver(es=>{
      es.forEach(e=>{ if(e.isIntersecting){
        links.forEach(a=>a.classList.remove('active'));
        const a=map.get(e.target.id); if(a){a.classList.add('active');
          a.scrollIntoView({block:'nearest'});}
      }});
    },{rootMargin:'-60px 0px -70% 0px'});
    secs.forEach(s=>io.observe(s));
  }
})();