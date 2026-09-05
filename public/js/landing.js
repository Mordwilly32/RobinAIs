// public/js/landing.js
// Vida de la portada: entradas deslizadas al hacer scroll, barra que se
// encoge, contadores, pestañas con píldora deslizante, parallax suave y
// cinta infinita de materias.

(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Entradas al hacer scroll -------------------------------------------
  // Cada elemento con data-anim entra deslizándose desde su lado. El retraso
  // (data-delay, en ms) es lo que crea el efecto de cascada.
  function initReveals() {
    const items = document.querySelectorAll('[data-anim], .rb-step');
    if (!items.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = Number(el.dataset.delay || 0);
        setTimeout(() => el.classList.add('in'), delay);
        observer.unobserve(el);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    items.forEach(el => observer.observe(el));
  }

  // ---- Barra que reacciona al scroll --------------------------------------
  function initNav() {
    const nav = document.getElementById('rbNav');
    const burger = document.getElementById('rbBurger');
    const links = document.getElementById('rbNavLinks');
    if (!nav) return;

    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (burger && links) {
      burger.addEventListener('click', () => {
        burger.classList.toggle('open');
        links.classList.toggle('open');
      });
      links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        burger.classList.remove('open');
        links.classList.remove('open');
      }));
    }
  }

  // ---- Contadores ----------------------------------------------------------
  function initCounters() {
    const nums = document.querySelectorAll('[data-count]');
    if (!nums.length) return;

    const run = (el) => {
      const raw = el.dataset.count;
      const suffix = el.dataset.suffix || '';

      // Algunas cifras de esta exposición no son números («Muchos», «Muchas»):
      // esas se escriben tal cual, porque contar hasta un texto da NaN.
      const target = Number(raw);
      if (!raw || Number.isNaN(target)) {
        el.textContent = raw + suffix;
        return;
      }
      if (reduced) { el.textContent = target + suffix; return; }

      const duration = 1400;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1);
        // Desacelera al final para que se sienta natural
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    // Sin animaciones (o sin IntersectionObserver) las cifras se escriben de una
    // vez: esperar a que la sección entre en pantalla las dejaría en cero para
    // quien tiene el movimiento desactivado en su sistema.
    if (reduced || !('IntersectionObserver' in window)) { nums.forEach(run); return; }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    nums.forEach(el => observer.observe(el));
  }

  // ---- Pestañas ------------------------------------------------------------
  function initTabs() {
    const tabs = document.getElementById('rbTabs');
    const pill = document.getElementById('rbTabsPill');
    if (!tabs || !pill) return;

    const buttons = [...tabs.querySelectorAll('button')];

    // La píldora roja se coloca justo encima del botón activo y se desliza.
    function movePill(btn) {
      pill.style.width = btn.offsetWidth + 'px';
      pill.style.transform = `translateX(${btn.offsetLeft - 5}px)`;
    }

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.toggle('on', b === btn));
        movePill(btn);

        document.querySelectorAll('.rb-panel').forEach(panel => {
          panel.classList.toggle('on', panel.dataset.panel === btn.dataset.tab);
        });
      });
    });

    const active = buttons.find(b => b.classList.contains('on')) || buttons[0];
    movePill(active);
    window.addEventListener('resize', () => {
      const current = buttons.find(b => b.classList.contains('on')) || buttons[0];
      movePill(current);
    });
  }

  // ---- Parallax de las tarjetas del héroe ----------------------------------
  // Se mueven un poco con el scroll y siguen levemente al mouse: es lo que da
  // sensación de profundidad sin distraer.
  function initParallax() {
    const items = document.querySelectorAll('[data-parallax]');
    if (!items.length || reduced) return;

    let scrollY = 0;
    let mouseX = 0;
    let mouseY = 0;
    let ticking = false;

    // No se escribe transform directamente: la animación de flotar ya lo usa
    // y le ganaría al estilo en línea. Se escriben las variables que leen los
    // fotogramas de rb-floaty.
    function apply() {
      items.forEach(el => {
        const depth = Number(el.dataset.parallax) / 100;
        el.style.setProperty('--py', `${scrollY * depth * 0.35}px`);
        el.style.setProperty('--px', `${mouseX * depth * 14}px`);
        el.style.setProperty('--pr', `${mouseY * depth * 4}deg`);
      });
      ticking = false;
    }

    function request() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', () => {
      scrollY = Math.min(window.scrollY, 700);
      request();
    }, { passive: true });

    const scene = document.querySelector('.rb-scene');
    if (scene) {
      scene.addEventListener('mousemove', (e) => {
        const rect = scene.getBoundingClientRect();
        mouseX = (e.clientX - rect.left) / rect.width - 0.5;
        mouseY = (e.clientY - rect.top) / rect.height - 0.5;
        request();
      });
      scene.addEventListener('mouseleave', () => { mouseX = 0; mouseY = 0; request(); });
    }
  }

  // ---- Cinta infinita ------------------------------------------------------
  // Se duplica el contenido para que el bucle no tenga costura visible.
  function initMarquee() {
    const track = document.getElementById('rbMarquee');
    if (!track || track.dataset.cloned === 'true') return;
    track.dataset.cloned = 'true';
    track.innerHTML += track.innerHTML;
  }

  // ---- Scroll suave a las secciones ---------------------------------------
  function initAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const target = document.querySelector(link.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initReveals();
    initCounters();
    initTabs();
    initParallax();
    initMarquee();
    initAnchors();
  });
})();
