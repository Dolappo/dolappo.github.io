(() => {
  const root = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const fx = finePointer && !reduceMotion;
  const lerp = (a, b, t) => a + (b - a) * t;

  document.getElementById('yr').textContent = new Date().getFullYear();

  /* ---------- live clock (West Africa Time) ---------- */
  const clocks = document.querySelectorAll('[data-clock]');
  const tick = () => {
    let t;
    try { t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }); }
    catch (e) { t = ''; }
    clocks.forEach((c) => { c.textContent = t; });
  };
  tick(); setInterval(tick, 15000);

  /* ---------- Industry / Academic mode ---------- */
  const setMode = (mode) => {
    body.dataset.mode = mode;
    document.querySelectorAll('[data-set-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.setMode === mode)));
    try { localStorage.setItem('df-mode', mode); } catch (e) {}
  };
  document.querySelectorAll('[data-set-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.setMode)));
  let saved = null;
  try { saved = localStorage.getItem('df-mode'); } catch (e) {}
  const initial = new URLSearchParams(location.search).get('mode') || saved;
  if (initial === 'academic' || initial === 'industry') setMode(initial);

  /* ---------- hero intro ---------- */
  const start = () => {
    requestAnimationFrame(() => body.classList.add('loaded'));
    setTimeout(() => body.classList.add('settled'), 1500);
  };
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]).then(start);
  } else start();

  /* ---------- split headings into words ---------- */
  document.querySelectorAll('.split').forEach((el) => {
    let i = 0;
    const wrap = (node) => {
      const w = document.createElement('span'); w.className = 'w';
      const inner = document.createElement('span'); inner.style.setProperty('--i', i++);
      inner.appendChild(node); w.appendChild(inner);
      return w;
    };
    [...el.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          frag.appendChild(/^\s+$/.test(part) ? document.createTextNode(' ') : wrap(document.createTextNode(part)));
        });
        el.replaceChild(frag, n);
      } else if (n.nodeType === 1) {
        if (n.tagName === 'BR') return;
        el.replaceChild(wrap(n.cloneNode(true)), n);
      }
    });
  });

  /* ---------- smooth scroll (Lenis) ---------- */
  let lenis = null;
  if (fx && window.Lenis) { // touch keeps native scrolling
    lenis = new window.Lenis({ duration: 1.15, easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)) });
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }

  /* ---------- nav: scrolled state, anchors, mobile drawer ---------- */
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', (window.scrollY || root.scrollTop) > 30);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const drawer = document.getElementById('drawer');
  const menuBtn = document.querySelector('.menu-btn');
  const setDrawer = (open) => {
    menuBtn.setAttribute('aria-expanded', String(open));
    drawer.hidden = !open;
    if (lenis) open ? lenis.stop() : lenis.start();
    else body.style.overflow = open ? 'hidden' : '';
  };
  menuBtn.addEventListener('click', () => setDrawer(drawer.hidden));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) { setDrawer(false); menuBtn.focus(); } });

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id === '#top' ? document.body : document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (!drawer.hidden) setDrawer(false);
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : target, { offset: -70 });
      else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      if (id !== '#top') history.replaceState(null, '', id);
    });
  });

  /* ---------- fluid smoke background ---------- */
  if (fx && window.startFluid) {
    try { if (window.startFluid(document.querySelector('.fluid'))) body.classList.add('has-fluid'); }
    catch (e) { /* static glow fallback stays */ }
  }

  /* ---------- cursor, preview, magnetic ---------- */
  const xp = document.querySelector('.xp');
  const rows = [...document.querySelectorAll('.xp-row')];
  const preview = document.querySelector('.preview');
  const strip = document.querySelector('.preview-strip');
  const chip = document.querySelector('.view-chip');
  const chipLabel = chip.querySelector('span');

  // one cover per role, stacked in a strip that slides to the hovered row
  rows.forEach((row) => {
    const d = row.dataset;
    const cover = document.createElement('div');
    cover.className = 'cover';
    cover.style.setProperty('--h', d.hue || 40);
    const k = document.createElement('span'); k.className = 'k'; k.textContent = d.kicker || '';
    const c = document.createElement('span'); c.className = 'c'; c.textContent = row.querySelector('.xp-co').textContent;
    const m = document.createElement('span'); m.className = 'm'; m.textContent = d.metric || '';
    cover.append(k, c, m);
    strip.appendChild(cover);
  });

  if (fx) {
    body.classList.add('has-cursor');
    const ring = document.querySelector('.cursor');
    const dot = document.querySelector('.cursor-dot');
    let mx = innerWidth / 2, my = innerHeight / 2;
    let rx = mx, ry = my, px = mx, py = my, cx = mx, cy = my;
    let previewOn = false;

    addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    }, { passive: true });

    const loop = () => {
      rx = lerp(rx, mx, 0.2); ry = lerp(ry, my, 0.2);
      px = lerp(px, mx, 0.16); py = lerp(py, my, 0.16);
      cx = lerp(cx, mx, 0.3); cy = lerp(cy, my, 0.3);
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      preview.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      chip.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    addEventListener('pointerdown', () => body.classList.add('cursor-down'));
    addEventListener('pointerup', () => body.classList.remove('cursor-down'));
    document.addEventListener('pointerleave', () => body.classList.remove('has-cursor'));
    document.addEventListener('pointerenter', () => body.classList.add('has-cursor'));

    const interactive = 'a, button, .panel, .hw';
    document.addEventListener('pointerover', (e) => {
      body.classList.toggle('cursor-hover', !!e.target.closest(interactive));
    });

    // experience hover preview
    const showPreview = (row) => {
      const i = rows.indexOf(row);
      const open = row.classList.contains('open');
      if (!previewOn) { px = mx; py = my; cx = mx; cy = my; }
      strip.style.transform = `translateY(${-i * 220}px)`;
      preview.classList.toggle('on', !open);
      chip.classList.add('on');
      chipLabel.textContent = open ? 'Close' : 'Open';
      body.classList.add('cursor-hidden');
      previewOn = true;
    };
    const hidePreview = () => {
      preview.classList.remove('on'); chip.classList.remove('on');
      body.classList.remove('cursor-hidden');
      previewOn = false;
    };
    rows.forEach((row) => {
      row.querySelector('.xp-head').addEventListener('pointerenter', () => showPreview(row));
      row.addEventListener('pointerleave', hidePreview);
      row.querySelector('.xp-head').addEventListener('pointerleave', (e) => {
        // moving into the open details: drop the preview but keep the normal cursor
        if (row.contains(e.relatedTarget)) hidePreview();
      });
    });
    xp.addEventListener('xp-toggle', (e) => { if (previewOn) showPreview(e.detail); });

    // magnetic buttons
    document.querySelectorAll('.magnetic').forEach((el) => {
      const label = el.querySelector('span');
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.transition = 'transform .2s linear';
        el.style.transform = `translate(${x * 14}px, ${y * 12}px) scale(1.04)`;
        if (label) { label.style.transition = el.style.transition; label.style.transform = `translate(${x * 6}px, ${y * 5}px)`; }
      });
      el.addEventListener('pointerleave', () => {
        el.style.transition = 'transform .8s cubic-bezier(.34,1.56,.64,1)';
        el.style.transform = '';
        if (label) { label.style.transition = el.style.transition; label.style.transform = ''; }
      });
    });
  }

  /* ---------- experience accordion (click, tap, keyboard) ---------- */
  rows.forEach((row, i) => {
    const head = row.querySelector('.xp-head');
    const bodyEl = row.querySelector('.xp-body');
    bodyEl.id = 'xp-' + i;
    head.setAttribute('aria-controls', bodyEl.id);
    head.addEventListener('click', () => {
      const open = !row.classList.contains('open');
      rows.forEach((r) => { r.classList.remove('open'); r.querySelector('.xp-head').setAttribute('aria-expanded', 'false'); });
      if (open) { row.classList.add('open'); head.setAttribute('aria-expanded', 'true'); }
      xp.dispatchEvent(new CustomEvent('xp-toggle', { detail: row }));
      if (lenis) setTimeout(() => lenis.resize(), 750);
    });
  });

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealEls = document.querySelectorAll('.case, .xp-row, .panel, .avatar, .about-text, .stats > div, .contact-row, .note, .section-head .sub');
    revealEls.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 70 + 'ms'; io.observe(el); });
    document.querySelectorAll('.split').forEach((el) => io.observe(el));
    // reveal transition-delay must not slow later hover transitions
    revealEls.forEach((el) => el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true }));
  } else {
    document.querySelectorAll('.split').forEach((el) => el.classList.add('in'));
  }

  /* ---------- stats count-up ---------- */
  if (!reduceMotion) {
    document.querySelectorAll('[data-count]').forEach((el) => {
      const end = +el.dataset.count;
      const t0 = performance.now() + 500, dur = 1400;
      const step = (now) => {
        const p = Math.min(Math.max((now - t0) / dur, 0), 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  /* ---------- active nav link ---------- */
  const links = [...document.querySelectorAll('.nav-links a')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s));
  }
})();
