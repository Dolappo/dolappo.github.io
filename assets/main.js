(() => {
  const root = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  document.getElementById('yr').textContent = new Date().getFullYear();

  /* ---------- mode switch: Industry / Academic ---------- */
  const setMode = (mode) => {
    body.dataset.mode = mode;
    document.querySelectorAll('[data-set-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.setMode === mode)));
    try { localStorage.setItem('df-mode', mode); } catch (e) {}
  };
  document.querySelectorAll('[data-set-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.setMode)));
  const params = new URLSearchParams(location.search);
  let saved = null;
  try { saved = localStorage.getItem('df-mode'); } catch (e) {}
  const initial = params.get('mode') || saved;
  if (initial === 'academic' || initial === 'industry') setMode(initial);

  /* ---------- cursor, spotlight, parallax ---------- */
  if (finePointer && !reduceMotion) {
    body.classList.add('has-cursor');
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    let mx = innerWidth / 2, my = innerHeight / 3, rx = mx, ry = my;

    addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
      root.style.setProperty('--mx', mx + 'px');
      root.style.setProperty('--my', my + 'px');
    }, { passive: true });

    const loop = () => {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      requestAnimationFrame(loop);
    };
    loop();

    addEventListener('pointerdown', () => body.classList.add('cursor-down'));
    addEventListener('pointerup', () => body.classList.remove('cursor-down'));
    document.addEventListener('mouseleave', () => body.classList.remove('has-cursor'));
    document.addEventListener('mouseenter', () => body.classList.add('has-cursor'));

    document.querySelectorAll('a, button, .xp-row').forEach((el) => {
      el.addEventListener('pointerenter', () => body.classList.add('cursor-hover'));
      el.addEventListener('pointerleave', () => body.classList.remove('cursor-hover'));
    });

    /* magnetic buttons */
    document.querySelectorAll('.magnetic').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* glow cards: border + fill follow the pointer */
  document.querySelectorAll('.glow').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', (e.clientX - r.left) + 'px');
      el.style.setProperty('--y', (e.clientY - r.top) + 'px');
    });
  });

  /* ---------- experience: tap / keyboard to open (touch devices) ---------- */
  const xp = document.querySelector('.xp');
  const rows = [...document.querySelectorAll('.xp-row')];
  const toggle = (row) => {
    const open = !row.classList.contains('open');
    rows.forEach((r) => { r.classList.remove('open'); r.setAttribute('aria-expanded', 'false'); });
    if (open) { row.classList.add('open'); row.setAttribute('aria-expanded', 'true'); }
    xp.classList.toggle('has-open', open);
  };
  rows.forEach((row) => {
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => { if (!finePointer) toggle(row); });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row); }
    });
  });

  /* ---------- reveal on scroll + active nav ---------- */
  const revealEls = document.querySelectorAll('.section-head, .card, .xp-row, .r-item, .about, .contact > *');
  if ('IntersectionObserver' in window && !reduceMotion) {
    revealEls.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 60 + 'ms'; io.observe(el); });
  }

  const links = [...document.querySelectorAll('.nav nav a')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s));
  }
})();
