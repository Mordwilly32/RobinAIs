// public/js/landing.js
// Vida de la portada: entradas al hacer scroll, barra que se encoge, la zona
// de funciones que se ancla y se abre, pestañas con píldora deslizante,
// parallax suave, la cinta de materias y el chat que se cuenta solo.

(function () {
  // El sistema puede pedir menos movimiento (en Windows, «Efectos de animación»
  // apagado). Eso ya no apaga la portada: el CSS la deja más lenta y con menos
  // recorrido, y aquí solo se quita el parallax, que es lo único que persigue al
  // mouse. Ver la nota larga en landing.css.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  // Enciende un elemento con su retraso.
  //
  // El temporizador es a propósito y no requestAnimationFrame: en una pestaña
  // de fondo los fotogramas se congelan, y con rAF la portada se quedaba en
  // blanco hasta que volvías a mirarla. Antes de encender nada se fuerza una
  // lectura del layout (ver initReveals) para que el navegador deje asentado el
  // estado inicial; si la clase entra en el mismo tirón en que se pinta ese
  // estado, no hay desde dónde animar y el elemento aparece de golpe.
  function encender(el, delay) {
    setTimeout(() => el.classList.add('in'), Math.max(delay, 20));
  }

  // ---- Entradas al hacer scroll -------------------------------------------
  // Cada elemento con data-anim entra deslizándose desde su lado. El retraso
  // (data-delay, en ms) es lo que crea el efecto de cascada.
  function initReveals() {
    const items = [...document.querySelectorAll('[data-anim]')];
    const steps = [...document.querySelectorAll('.rb-step')].filter(el => !el.hasAttribute('data-anim'));
    const todos = items.concat(steps);
    if (!todos.length) return;

    if (!hasIO) {
      todos.forEach(el => el.classList.add('in'));
      return;
    }

    // Una sola lectura del layout para todos: deja asentado el estado inicial
    // (opacidad 0 y el desplazamiento de data-anim) antes de encender nada.
    void document.body.offsetHeight;

    const vh = window.innerHeight;

    // Lo que ya está en pantalla al cargar no se puede «esperar a que entre»:
    // entra solo, en cascada, para que la portada se arme delante de los ojos
    // en vez de aparecer entera de un golpe.
    const visibles = todos.filter(el => el.getBoundingClientRect().top < vh * 0.9);
    visibles.forEach((el, i) => {
      el.dataset.rbSeen = '1';
      encender(el, Number(el.dataset.delay || 0) + Math.min(i, 8) * 70);
    });

    const resto = todos.filter(el => el.dataset.rbSeen !== '1');
    if (!resto.length) return;

    // El margen de abajo obliga a que el elemento entre de verdad en pantalla
    // antes de encenderse. Sin él, en una pantalla alta media página se revela
    // antes de que llegues a mirarla.
    const margen = Math.round(Math.min(vh * 0.18, 170));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        encender(el, Number(el.dataset.delay || 0));
        observer.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: `0px 0px -${margen}px 0px` });

    resto.forEach(el => observer.observe(el));
  }

  // ---- La zona de funciones que se ancla ----------------------------------
  // Mientras el carril alto pasa por la pantalla, el escenario se queda pegado
  // arriba. Con ese recorrido (0 → 1) primero se abre la zona y después salen
  // las tarjetas, una por una.
  function initShowcase() {
    const track = document.getElementById('rbShowcase');
    if (!track) return;
    const stage = track.querySelector('.rb-showcase-stage');
    const zone = track.querySelector('.rb-showcase-zone');
    const cards = [...track.querySelectorAll('.rb-feature')];
    if (!stage || !zone || !cards.length) return;

    let observer = null;   // el modo sin anclaje usa su propio observador
    let anclado = null;    // null = todavía no se decidió

    const puedeAnclar = () => getComputedStyle(stage).position === 'sticky';

    // Modo sin anclaje: las tarjetas entran al asomarse, como el resto.
    function modoNormal() {
      zone.style.setProperty('--open', '1');
      if (!hasIO) { cards.forEach(c => c.classList.add('show')); return; }
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const i = cards.indexOf(entry.target);
          setTimeout(() => entry.target.classList.add('show'), (i % 3) * 90);
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' });
      cards.forEach(c => observer.observe(c));
    }

    function pintar() {
      const rect = track.getBoundingClientRect();
      const recorrido = rect.height - window.innerHeight;
      const p = recorrido > 0 ? Math.min(Math.max(-rect.top / recorrido, 0), 1) : 1;

      // Primer cuarto: la zona se abre. El resto: las tarjetas, una por una.
      zone.style.setProperty('--open', Math.min(p / 0.24, 1).toFixed(3));

      const desde = 0.3;
      const hasta = 0.94;
      cards.forEach((card, i) => {
        const turno = desde + (hasta - desde) * (i / cards.length);
        card.classList.toggle('show', p >= turno);
      });
    }

    let esperando = false;
    function alHacerScroll() {
      if (esperando || anclado !== true) return;
      esperando = true;
      requestAnimationFrame(() => { esperando = false; pintar(); });
    }

    // El modo se decide con el CSS: si el escenario quedó sticky, hay anclaje.
    function sincronizar() {
      const quiere = puedeAnclar();
      if (quiere === anclado) { if (anclado) pintar(); return; }
      anclado = quiere;

      if (observer) { observer.disconnect(); observer = null; }
      if (anclado) {
        cards.forEach(c => c.classList.remove('show'));
        pintar();
      } else {
        modoNormal();
      }
    }

    sincronizar();
    window.addEventListener('scroll', alHacerScroll, { passive: true });
    window.addEventListener('resize', sincronizar);
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

  // ---- Cinta de materias ---------------------------------------------------
  // El bucle es un translateX(-50%): para que empalme sin costura, el carril
  // tiene que ser exactamente el doble de su mitad, y esa mitad tiene que tapar
  // todo el ancho visible — si no, al llegar al final del recorrido se abre un
  // hueco a la derecha. Por eso se repite el contenido hasta cubrir la fila y
  // recién entonces se duplica.
  function initMarquee() {
    const velocidad = reduced ? 30 : 45;   // píxeles por segundo

    document.querySelectorAll('.rb-marquee-track').forEach((track, i) => {
      if (track.dataset.cloned === 'true') return;
      const fila = track.parentElement;
      const original = track.innerHTML;

      let copias = 1;
      while (track.scrollWidth < fila.clientWidth && copias < 12) {
        track.innerHTML += original;
        copias++;
      }
      track.innerHTML += track.innerHTML;
      track.dataset.cloned = 'true';

      // La duración sale del ancho, no al revés: así las dos filas van al mismo
      // paso aunque una lleve más materias que la otra.
      const mitad = track.scrollWidth / 2;
      const lenta = i % 2 === 1 ? 1.25 : 1;   // la fila de vuelta, un poco más suave
      track.style.animationDuration = Math.round((mitad / velocidad) * lenta) + 's';
    });
  }

  // ---- La conversación de ejemplo -----------------------------------------
  // Los dos chats de «Hecho para todos» no son una captura congelada: van
  // pasando por varias conversaciones, escribiendo mensaje por mensaje, con los
  // puntitos de «Robin está escribiendo» en medio. No se detienen nunca; solo
  // se callan si su pestaña no está a la vista o si la ventana pasó a segundo
  // plano, y retoman al volver.
  const GUIONES = {
    personal: [
      {
        barra: 'Escríbele a Robin…',
        turnos: [
          { de: 'robin', texto: '¡Hola! Soy Robin 👋 ¿En qué te puedo ayudar hoy?' },
          { de: 'yo', texto: 'No entiendo la ley de gravitación universal' },
          { de: 'robin', texto: 'Imagina que dos objetos se atraen como imanes: mientras más pesados y más cerca, más se jalan. 🌍✨' }
        ]
      },
      {
        barra: 'Recuérdame algo…',
        turnos: [
          { de: 'yo', texto: 'Recuérdame entregar el informe el viernes' },
          { de: 'robin', texto: 'Apuntado ✅ «Entregar el informe», viernes. Te lo pongo arriba de la lista el jueves.' }
        ]
      },
      {
        barra: 'Ponme a prueba…',
        turnos: [
          { de: 'yo', texto: '¿Me tomas la lección de los ríos de América?' },
          { de: 'robin', texto: 'Va la primera: ¿cuál es el río más largo del continente? 🗺️' },
          { de: 'yo', texto: 'El Amazonas' },
          { de: 'robin', texto: '¡Ese es! Van 1 de 5. Sigue: ¿en qué país nace? 🔥' }
        ]
      },
      {
        barra: 'Pregúntame lo que sea…',
        turnos: [
          { de: 'yo', texto: 'Explícame la fotosíntesis como si tuviera 8 años' },
          { de: 'robin', texto: 'La planta come luz: junta sol, agua y aire, se prepara su comida y de paso nos deja el oxígeno. 🌱' }
        ]
      },
      {
        barra: 'Cuéntame cómo vas…',
        turnos: [
          { de: 'yo', texto: 'Tengo examen de fracciones mañana 😩' },
          { de: 'robin', texto: 'Tranquilo, lo vemos por partes.' },
          { de: 'robin', texto: 'Empezamos por sumar con el mismo denominador. En diez minutos le agarras el hilo. 💪' }
        ]
      }
    ],
    escuelas: [
      {
        barra: 'Buscar una cuenta…',
        turnos: [
          { de: 'robin', texto: 'Escuela inscrita 🏫 Estos son tus dos códigos de ingreso.' },
          { de: 'yo', texto: 'Estudiantes: EST-4K7Q · Profesores: PRO-9XB2' },
          { de: 'robin', texto: 'Repártelos y listo. Si alguno se filtra, generas otro y el viejo deja de servir. 🔑' }
        ]
      },
      {
        barra: 'Escribir un aviso…',
        turnos: [
          { de: 'yo', texto: 'Manda un aviso a todo tercer grado' },
          { de: 'robin', texto: 'Listo 📢 Ya está en el panel de los tres grupos de tercero.' }
        ]
      },
      {
        barra: 'Revisar entregas…',
        turnos: [
          { de: 'yo', texto: '¿Quién no ha entregado la tarea de Ciencias?' },
          { de: 'robin', texto: 'Del grupo B quedan cinco pendientes. Te dejo la lista en el panel del profesor. 📋' }
        ]
      },
      {
        barra: 'Administrar códigos…',
        turnos: [
          { de: 'yo', texto: 'Quiero regenerar el código de profesores' },
          { de: 'robin', texto: 'Hecho 🔑 El anterior deja de funcionar desde ya. Reparte el nuevo.' }
        ]
      },
      {
        barra: 'Buscar una cuenta…',
        turnos: [
          { de: 'robin', texto: 'Entró un profesor nuevo a la escuela ✉️' },
          { de: 'yo', texto: '¿Con qué código?' },
          { de: 'robin', texto: 'Con PRO-9XB2. Ya está en el panel de docentes, listo para asignarle grupos.' }
        ]
      }
    ]
  };

  const espera = ms => new Promise(r => setTimeout(r, ms));

  function initChatDemo() {
    // El pajarito de las burbujas es el Robin de siempre, el de mascot.js.
    const avatar = typeof rrMascotSVG === 'function' ? rrMascotSVG({ small: true }) : '';

    document.querySelectorAll('[data-chat]').forEach(chat => {
      const guion = GUIONES[chat.dataset.chat];
      const log = chat.querySelector('.rb-chat-log');
      const barra = chat.querySelector('[data-chat-bar]');
      if (guion && log) correrChat({ log, barra, guion, avatar });
    });
  }

  async function correrChat({ log, barra, guion, avatar }) {
    const panel = log.closest('.rb-panel');
    // Con el movimiento reducido del sistema, el guion va más pausado.
    const lento = reduced ? 1.4 : 1;
    // Un panel escondido o una ventana en segundo plano no tienen a quién
    // hablarle: el guion espera ahí hasta que vuelva a haber alguien mirando.
    const mirando = () => (!panel || panel.classList.contains('on')) && !document.hidden;

    const decir = (html) => {
      log.insertAdjacentHTML('beforeend', html);
      if (typeof rrWireMascotLife === 'function') rrWireMascotLife();
      return log.lastElementChild;
    };

    // La conversación que ya venía escrita en el HTML se deja leer un momento
    // antes de que el guion tome el control.
    await espera(3400 * lento);

    for (let i = 0; ; i++) {
      while (!mirando()) await espera(400);

      const charla = guion[i % guion.length];
      if (barra) barra.textContent = charla.barra;
      log.innerHTML = '';
      await espera(400 * lento);

      for (const turno of charla.turnos) {
        // Si te fuiste a media charla no se corta: se queda ahí quieta y sigue
        // en el mismo punto cuando vuelves.
        while (!mirando()) await espera(300);

        if (turno.de === 'robin') {
          // Los puntitos duran más si la respuesta es más larga: se siente como
          // alguien escribiendo y no como un temporizador.
          const puntos = decir(`<div class="rb-msg">${avatar}<div class="rb-typing"><i></i><i></i><i></i></div></div>`);
          await espera((620 + Math.min(turno.texto.length * 11, 1500)) * lento);
          puntos.remove();
          decir(`<div class="rb-msg">${avatar}<p>${turno.texto}</p></div>`);
        } else {
          await espera(560 * lento);
          decir(`<div class="rb-msg me"><p>${turno.texto}</p></div>`);
        }

        await espera(560 * lento);
      }

      await espera(3600 * lento);   // se deja leer antes de cambiar de tema
    }
  }

  // ---- Los precios y cada cuánto se pagan ---------------------------------
  // El selector de arriba cambia los tres planes a la vez. Los números salen
  // de /api/plans (src/plans.js), que es el mismo catálogo que usa la pantalla
  // de planes de una cuenta: así la portada no puede quedarse con precios
  // viejos escritos a mano.
  function initPrices() {
    const barra = document.getElementById('rbCycles');
    if (!barra) return;
    const botones = [...barra.querySelectorAll('[data-cycle]')];
    const tarjetas = [...document.querySelectorAll('.rb-price[data-plan]')];
    if (!tarjetas.length) return;

    const money = n => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
    let catalogo = null;

    function pintar(cicloId) {
      if (!catalogo) return;
      const ciclo = catalogo.cycles.find(c => c.id === cicloId) || catalogo.cycles[0];

      tarjetas.forEach(card => {
        const plan = catalogo.plans.find(p => p.id === card.dataset.plan);
        if (!plan) return;
        const precio = plan.prices[ciclo.id];
        const amount = card.querySelector('[data-amount]');
        const billing = card.querySelector('[data-billing]');

        if (plan.monthly === 0) {
          if (amount) amount.textContent = 'Gratis';
          if (billing) billing.textContent = 'Sin tarjeta y sin fecha de vencimiento.';
          return;
        }

        if (amount) amount.innerHTML = `${money(precio.perMonth)} <em>/mes</em>`;
        if (!billing) return;
        billing.textContent = precio.months === 1
          ? 'Se paga cada mes. Sin permanencia.'
          : `${money(precio.total)} ${precio.cycleShort} · ahorras ${money(precio.saves)} (−${precio.discountPct} %)`;
      });
    }

    // El descuento va escrito en el HTML, para que se vea aunque esto no
    // llegue a ejecutarse. Aquí solo se pone al día por si el catálogo del
    // servidor dice otra cosa que lo que quedó escrito a mano.
    function etiquetar() {
      botones.forEach(btn => {
        const ciclo = catalogo.cycles.find(c => c.id === btn.dataset.cycle);
        const etiqueta = btn.querySelector('.rb-cycle-off');
        if (!ciclo || !ciclo.discountPct) {
          if (etiqueta) etiqueta.remove();
          return;
        }
        // El nombre del ciclo también sale del catálogo: si mañana cambia de
        // "cada 4 meses" a otra cosa, el botón lo dice solo.
        if (etiqueta) {
          btn.firstChild.textContent = ciclo.label;
          etiqueta.textContent = `−${ciclo.discountPct} %`;
        } else {
          btn.textContent = ciclo.label;
          btn.insertAdjacentHTML('beforeend', `<span class="rb-cycle-off">−${ciclo.discountPct} %</span>`);
        }
      });
    }

    botones.forEach(btn => {
      btn.addEventListener('click', () => {
        botones.forEach(b => b.classList.toggle('on', b === btn));
        pintar(btn.dataset.cycle);
      });
    });

    // Si la petición falla, la portada se queda con los precios mensuales que
    // ya vienen escritos en el HTML: nada se ve roto.
    fetch('/api/plans')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => {
        catalogo = data;
        etiquetar();
        const activo = botones.find(b => b.classList.contains('on')) || botones[0];
        pintar(activo.dataset.cycle);
      })
      .catch(() => { /* se quedan los precios del HTML */ });
  }

  // ---- Quien ya entró no tiene que volver a entrar ------------------------
  // Con la sesión abierta, "Iniciar sesión / Empezar gratis" deja de tener
  // sentido: en su lugar va el atajo al panel propio, y el héroe saluda por el
  // nombre. Sin sesión no se toca nada y la portada es la de siempre.
  function initSession() {
    const cta = document.querySelector('.rb-nav-cta');
    if (!cta) return;

    fetch('/api/me')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(({ user }) => {
        const destino = panelDe(user);
        const nombre = String(user.fullName || '').split(' ')[0];

        cta.querySelector('.rb-login').outerHTML =
          `<a href="${destino}" class="rb-login rb-login-me">
             <img class="rb-login-face" src="${user.profilePic || '/images/robin.png'}" alt="" />
             <span>${escapar(nombre)}</span>
           </a>`;
        const boton = cta.querySelector('.rb-btn');
        boton.href = destino;
        boton.textContent = 'Ir a mi panel';

        // El héroe y la llamada final dejan de ofrecer una cuenta que ya existe.
        document.querySelectorAll('a[href="/registro"]').forEach(a => {
          a.href = destino;
          if (/gratis|crear cuenta|comenzar|probar/i.test(a.textContent)) {
            a.textContent = a.classList.contains('rb-btn-block') ? 'Ir a mi panel' : 'Volver a mi panel →';
          }
        });

        const saludo = document.querySelector('.rb-tag .dot');
        if (saludo && saludo.parentElement) {
          saludo.parentElement.innerHTML = `<i class="dot"></i> Hola otra vez, ${escapar(nombre)}`;
        }
      })
      .catch(() => { /* sin sesión: la portada se queda como está */ });
  }

  function panelDe(user) {
    if (!window.RR_PAGINAS_ESTATICAS) return '/dashboard/' + user.id;
    // Solo hace falta en la versión de GitHub Pages, que no tiene servidor
    // que resuelva /dashboard/<id>. Ver rrDashboardFor() en public/js/api.js.
    if (['admin', 'subdirector', 'secretary'].includes(user.role)) return '/dashboard-admin.html';
    if (user.role === 'teacher') return '/dashboard-teacher.html';
    if (user.role === 'parent') return '/dashboard-parent.html';
    if (user.role === 'student') return user.isLittle ? '/dashboard-peques.html' : '/dashboard-student.html';
    return '/dashboard-personal.html';
  }

  function escapar(texto) {
    const div = document.createElement('div');
    div.textContent = texto == null ? '' : String(texto);
    return div.innerHTML;
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
    initShowcase();
    initTabs();
    initParallax();
    initMarquee();
    initChatDemo();
    initAnchors();
    initPrices();
    initSession();
  });
})();
