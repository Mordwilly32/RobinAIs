// web/js/rr-shell.js
// ---------------------------------------------------------------------------
// Por qué existe este archivo.
//
// Esta versión no guarda nada: ni base de datos, ni cookies, ni localStorage.
// La sesión y los datos viven en variables de JavaScript. Eso tiene una
// consecuencia directa: si el navegador recarga la página de verdad, se
// pierde todo y quien acaba de entrar se encuentra otra vez fuera.
//
// Así que la aplicación no recarga nunca. Sigue habiendo un archivo .html por
// pantalla —los enlaces directos funcionan igual—, pero al navegar dentro de
// la app este shell trae el HTML de la otra pantalla, cambia el cuerpo del
// documento y vuelve a arrancar sus scripts. El documento es siempre el
// mismo, así que la memoria sigue ahí.
//
// Lo único que se pierde al cambiar de pantalla es lo que tiene que perderse:
// nada se escribe en ningún sitio.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  // ---- Qué scripts están cargados y cómo se vuelven a arrancar -------------
  //
  // Hay dos clases de archivo entre los de public/js:
  //
  //   · Bibliotecas (api.js, mascot.js, sidebar.js…). Definen funciones que
  //     usan las demás. Su código de arriba corre UNA vez —volver a
  //     ejecutarlo rompería sus const— y lo que se repite en cada pantalla
  //     es solo lo que registraron con rrAlEntrar().
  //
  //   · Pantallas (login.js, personal.js, teacher.js…). Son el guion de UNA
  //     pantalla y no le exportan nada a nadie. El build las envuelve en una
  //     función, así que se pueden volver a ejecutar enteras.

  const scripts = new Map(); // src -> { tipo, fn, alEntrar: [] }
  let definiendo = null;

  function ficha(src) {
    if (!scripts.has(src)) scripts.set(src, { tipo: 'lib', fn: null, alEntrar: [] });
    return scripts.get(src);
  }

  const RRPagina = {
    // Una biblioteca: marca el principio y el final de su código de arriba.
    inicio(src) { definiendo = src; ficha(src); },
    fin() { definiendo = null; },

    // Una pantalla: se guarda su función y se arranca ya.
    pantalla(src, fn) {
      const f = ficha(src);
      f.tipo = 'pantalla';
      f.fn = fn;
      fn();
    },

    actual() { return definiendo; },

    registrarAlEntrar(fn) {
      if (definiendo) ficha(definiendo).alEntrar.push(fn);
    },

    cargado(src) { return scripts.has(src); },

    // Volver a entrar a una pantalla cuyo script ya estaba cargado.
    reejecutar(src) {
      const f = scripts.get(src);
      if (!f) return;
      if (f.tipo === 'pantalla' && f.fn) return f.fn();
      f.alEntrar.forEach(fn => {
        try { fn(); } catch (err) { console.error('[roboRobin] al volver a ' + src, err); }
      });
    }
  };

  // Sustituye a document.addEventListener('DOMContentLoaded', fn): además de
  // correr al cargar, vuelve a correr cada vez que se entra a una pantalla
  // que use este script.
  function rrAlEntrar(fn) {
    RRPagina.registrarAlEntrar(fn);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // ---- Navegar sin recargar -----------------------------------------------

  function normalizar(url) {
    const u = new URL(url, location.href);
    return { href: u.href, ruta: u.pathname, hash: u.hash, origen: u.origin };
  }

  // Qué pantalla hay pintada ahora mismo. No sirve mirar location.pathname:
  // al volver atrás el navegador ya la cambió antes de avisarnos.
  let rutaPintada = location.pathname;

  function mismaPagina(destino) {
    return destino.ruta === rutaPintada;
  }

  function esNavegable(destino) {
    if (destino.origen !== location.origin) return false;
    return /\.html$/i.test(destino.ruta) || /\/$/.test(destino.ruta);
  }

  let navegando = false;

  async function rrIr(url, { reemplazar = false } = {}) {
    const destino = normalizar(url);

    if (!esNavegable(destino)) { location.href = destino.href; return; }

    if (mismaPagina(destino)) {
      if (reemplazar) history.replaceState({ rr: true }, '', destino.href);
      else if (destino.hash) history.pushState({ rr: true }, '', destino.href);
      irAlAncla(destino.hash);
      return;
    }

    if (navegando) return;
    navegando = true;
    document.documentElement.classList.add('rr-navegando');

    try {
      const res = await fetch(destino.ruta, { cache: 'no-cache' });
      if (!res.ok) throw new Error('No se pudo abrir ' + destino.ruta);
      const html = await res.text();

      if (reemplazar) history.replaceState({ rr: true }, '', destino.href);
      else history.pushState({ rr: true }, '', destino.href);

      await pintar(html);
      rutaPintada = destino.ruta;
      irAlAncla(destino.hash);
    } catch (err) {
      console.error('[roboRobin] navegación fallida:', err);
      // Si el shell no puede, que lo haga el navegador. Se pierde la sesión,
      // pero es mejor que quedarse clavado en la pantalla anterior.
      location.href = destino.href;
    } finally {
      navegando = false;
      document.documentElement.classList.remove('rr-navegando');
    }
  }

  function irAlAncla(hash) {
    if (!hash || hash === '#') { window.scrollTo(0, 0); return; }
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo(0, 0);
  }

  async function pintar(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    document.title = doc.title || document.title;
    ajustarHojas(doc);

    // El cuerpo nuevo, sin sus <script>: esos se arrancan aparte y en orden.
    const cuerpo = doc.body;
    const pendientes = Array.from(cuerpo.querySelectorAll('script'));
    pendientes.forEach(s => s.remove());

    document.body.className = cuerpo.className;
    Array.from(document.body.attributes).forEach(a => {
      if (a.name.startsWith('data-')) document.body.removeAttribute(a.name);
    });
    Array.from(cuerpo.attributes).forEach(a => {
      if (a.name.startsWith('data-')) document.body.setAttribute(a.name, a.value);
    });
    document.body.innerHTML = cuerpo.innerHTML;

    for (const s of pendientes) {
      const src = s.getAttribute('src');
      if (!src) continue;
      // El runtime (este archivo incluido) se carga una vez y ya. Volver a
      // ejecutarlo sería empezar de cero: otro servidor, otra base de datos
      // vacía, otra sesión — justo lo que este shell existe para evitar.
      if (/\/rr-[a-z]+\.js$/.test(src)) continue;

      const clave = new URL(src, location.href).pathname;
      if (RRPagina.cargado(clave)) RRPagina.reejecutar(clave);
      else await cargarScript(src);
    }

    document.dispatchEvent(new CustomEvent('rr:pagina'));
  }

  // Las hojas de estilo de la pantalla nueva entran; las que ya no hacen
  // falta salen. Sin esto, landing.css seguiría pintando encima del panel.
  function ajustarHojas(doc) {
    const quiere = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
      .map(l => new URL(l.getAttribute('href'), location.href).pathname);

    const tiene = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));

    tiene.forEach(l => {
      const ruta = new URL(l.getAttribute('href'), location.href).pathname;
      if (!quiere.includes(ruta)) l.remove();
    });

    const puestas = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map(l => new URL(l.getAttribute('href'), location.href).pathname);

    quiere.forEach(ruta => {
      if (puestas.includes(ruta)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ruta;
      document.head.appendChild(link);
    });
  }

  function cargarScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No cargó ' + src));
      document.body.appendChild(s);
    });
  }

  // ---- Los enlaces de la página -------------------------------------------

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;

    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href) && !href.startsWith('http')) return;

    const destino = normalizar(href);
    if (!esNavegable(destino)) return;

    e.preventDefault();
    rrIr(destino.href);
  });

  window.addEventListener('popstate', () => {
    // Volver atrás tampoco puede recargar: se pinta la pantalla anterior
    // encima, con la misma sesión en memoria.
    rrIr(location.href, { reemplazar: true });
  });

  global.RRPagina = RRPagina;
  global.rrAlEntrar = rrAlEntrar;
  global.rrIr = rrIr;
})(window);
