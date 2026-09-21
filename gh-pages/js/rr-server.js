// web/js/rr-server.js
// ---------------------------------------------------------------------------
// El antiguo server.js, pero dentro de la pestaña.
//
// Monta las mismas rutas en el mismo orden y expone una sola función,
// RRServer.pedir(metodo, ruta, cuerpo), que es a la que llama rrApi() en
// lugar de salir a la red. No hay puerto, no hay cookie de sesión y no hay
// data/db.json: la sesión es un objeto y la base de datos es otro, los dos
// en memoria, los dos se borran al cerrar o recargar la pestaña.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  const require = RRModulos.require;
  const express = RRExpress;
  const app = express();

  // La sesión. Antes era una cookie firmada; ahora es esto: un objeto que
  // vive lo que viva la pestaña. Por eso la app no recarga páginas —ver
  // rr-shell.js—: una recarga de verdad borraría esto y con ello la sesión.
  let sesion = {};
  sesion.destroy = function (cb) {
    Object.keys(sesion).forEach(k => { if (k !== 'destroy') delete sesion[k]; });
    if (typeof cb === 'function') cb();
  };

  app.use('/api', require('routes/auth'));
  app.use('/api', require('routes/users'));
  app.use('/api/schools', require('routes/schools'));
  app.use('/api/tasks', require('routes/tasks'));
  app.use('/api/announcements', require('routes/announcements'));
  app.use('/api/ai', require('routes/ai'));
  app.use('/api/classes', require('routes/classes'));
  app.use('/api/activities', require('routes/activities'));
  app.use('/api/plans', require('routes/plans'));
  app.use('/api/games', require('routes/games'));
  app.use('/api/codes', require('routes/codes'));
  app.use('/api/chats', require('routes/chats'));
  app.use('/api/attendance', require('routes/attendance'));
  app.use('/api/family', require('routes/family'));
  app.use('/api/dev', require('routes/dev'));

  function partirRuta(ruta) {
    const i = String(ruta).indexOf('?');
    if (i === -1) return { camino: ruta, query: {} };

    const camino = ruta.slice(0, i);
    const query = {};
    new URLSearchParams(ruta.slice(i + 1)).forEach((valor, clave) => { query[clave] = valor; });
    return { camino, query };
  }

  // Devuelve { status, data } — lo mismo que antes sacábamos de un fetch.
  function pedir(metodo, ruta, cuerpo) {
    const { camino, query } = partirRuta(ruta);

    const req = {
      method: String(metodo || 'GET').toUpperCase(),
      path: camino,
      url: ruta,
      originalUrl: ruta,
      body: cuerpo === undefined ? {} : cuerpo,
      params: {},
      query,
      session: sesion,
      headers: {}
    };

    return new Promise(resolve => {
      const res = {
        statusCode: 200,
        terminado: false,
        status(c) { res.statusCode = c; return res; },
        type() { return res; },
        set() { return res; },
        json(data) {
          if (res.terminado) return res;
          res.terminado = true;
          resolve({ status: res.statusCode, data });
          return res;
        },
        send(data) { return res.json(data); },
        end() { return res.json(null); }
      };

      app(req, res, err => {
        if (res.terminado) return;
        if (err) {
          console.error('[roboRobin] Error no manejado:', err);
          return res.status(500).json({ error: 'Algo salió mal dentro del navegador.' });
        }
        res.status(404).json({ error: 'No encontrado.' });
      });
    });
  }

  // ---- fetch('/api/…') no sale a la red ------------------------------------
  //
  // Toda la interfaz pide sus datos con fetch, unas veces a través de rrApi()
  // y otras a pelo (la portada, la consola de demostración). En vez de tocar
  // cada sitio, se desvía fetch: lo que apunta a /api lo contesta el servidor
  // de aquí arriba, y lo demás —la API de Anthropic, las bibliotecas de los
  // CDN— sale de verdad, sin enterarse.

  const fetchDeVerdad = global.fetch.bind(global);

  function rutaApi(url) {
    const texto = String(url || '');
    if (texto.startsWith('/api/') || texto === '/api') return texto;

    // Por si alguien la escribe entera.
    try {
      const u = new URL(texto, location.href);
      if (u.origin === location.origin && u.pathname.startsWith('/api/')) {
        return u.pathname + u.search;
      }
    } catch { /* no era una URL */ }

    return null;
  }

  global.fetch = function (entrada, opciones) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    const ruta = rutaApi(url);
    if (!ruta) return fetchDeVerdad(entrada, opciones);

    const op = opciones || {};
    const metodo = op.method || (entrada && entrada.method) || 'GET';

    let cuerpo = op.body;
    if (typeof cuerpo === 'string') {
      try { cuerpo = JSON.parse(cuerpo); } catch { /* se manda tal cual */ }
    }

    return pedir(metodo, ruta, cuerpo).then(r => new Response(
      JSON.stringify(r.data === undefined ? null : r.data),
      { status: r.status, headers: { 'Content-Type': 'application/json' } }
    ));
  };

  global.RRServer = {
    pedir,
    // Para la consola de demostración y para las pruebas: empezar de cero sin
    // recargar (recargar también funcionaría, pero esto es más explícito).
    reiniciar() {
      sesion.destroy();
    }
  };
})(window);
