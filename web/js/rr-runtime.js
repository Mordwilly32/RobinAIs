// web/js/rr-runtime.js
// ---------------------------------------------------------------------------
// roboRobin en GitHub Pages: el servidor entero vive dentro del navegador.
//
// Esta versión no tiene backend ni base de datos. Los mismos archivos que
// antes corrían en Node (src/ y routes/) se cargan aquí tal cual, y lo poco
// que necesitaban de Node —fs, path, bcryptjs, express— se lo damos imitado:
//
//   · fs.writeFileSync no escribe NADA, en ningún lado. Es la pieza clave:
//     la base de datos existe solo como un objeto en memoria y desaparece
//     con la pestaña.
//   · fs.readFileSync solo sabe devolver la configuración de aquí abajo, que
//     está escrita en este archivo en vez de en un config.json.
//   · process.env está vacío, y esa es la respuesta correcta: sin
//     SUPABASE_URL, src/store.js elige guardar en archivo, y el fs de aquí
//     arriba hace que ese archivo no exista nunca. La demostración se queda
//     en memoria sin tener que saber nada de Supabase.
//   · express es un remedo mínimo: Router, use, get/post/put/delete,
//     req.body/params/query/session y res.status().json(). Nada más, porque
//     nada más usaban las rutas.
//
// Nada de esto toca localStorage, sessionStorage, cookies, IndexedDB ni el
// disco. Al cerrar la pestaña no queda rastro.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  // ---- Lo que antes era config.json ---------------------------------------
  // La llave de la API va vacía a propósito: la pone cada quien desde la
  // pantalla de Robin y se queda en memoria mientras la pestaña siga abierta.
  const RR_CONFIG = {
    sessionSecret: 'sin-servidor-no-hay-cookie-que-firmar',
    anthropicApiKey: '',
    aiModel: 'claude-sonnet-5',
    aiModelMax: 'claude-opus-5',
    devConsole: true
  };

  // ---- fs: el que nunca escribe -------------------------------------------

  const fs = {
    existsSync() { return false; },          // nunca hay archivo guardado
    mkdirSync() { },
    writeFileSync() { },                     // aquí muere cualquier "guardar"
    appendFileSync() { },
    unlinkSync() { },
    readFileSync(ruta) {
      if (String(ruta).replace(/\\/g, '/').endsWith('config.json')) {
        return JSON.stringify(RR_CONFIG);
      }
      const err = new Error('ENOENT: no existe ' + ruta);
      err.code = 'ENOENT';
      throw err;
    }
  };

  // ---- path: lo justo para unir rutas -------------------------------------

  const path = {
    sep: '/',
    join() {
      const partes = Array.prototype.slice.call(arguments).filter(Boolean);
      return partes.join('/').replace(/\/{2,}/g, '/');
    },
    resolve() { return path.join.apply(null, arguments); },
    dirname(p) { return String(p).split('/').slice(0, -1).join('/') || '.'; },
    basename(p) { return String(p).split('/').pop(); },
    extname(p) {
      const b = path.basename(p);
      const i = b.lastIndexOf('.');
      return i <= 0 ? '' : b.slice(i);
    }
  };

  // ---- bcryptjs: teatro honesto -------------------------------------------
  // Sin base de datos que sobreviva a la pestaña, cifrar contraseñas no
  // protege de nada: el "hash" y la contraseña se borran juntos en el mismo
  // instante. Se deja la misma forma (hashSync/compareSync) para no tocar ni
  // una línea de src/db.js, pero es una huella simple, no criptografía. Si
  // algún día vuelve a haber servidor, aquí vuelve bcrypt de verdad.

  function huella(texto) {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < texto.length; i++) {
      const c = texto.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = Math.imul(b ^ (c + i), 2654435761) >>> 0;
    }
    return a.toString(36) + '.' + b.toString(36);
  }

  const bcryptjs = {
    genSaltSync() { return 'rr'; },
    hashSync(pw) { return 'rr$' + huella(String(pw)); },
    compareSync(pw, hash) { return bcryptjs.hashSync(pw) === hash; },
    hash(pw, _s, cb) { cb(null, bcryptjs.hashSync(pw)); },
    compare(pw, hash, cb) { cb(null, bcryptjs.compareSync(pw, hash)); }
  };

  // ---- express: el remedo --------------------------------------------------

  function escaparSegmento(seg) {
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // '/clases/:id/miembros' -> expresión regular + los nombres de los huecos.
  function compilar(ruta, comoPrefijo) {
    const claves = [];
    let limpia = String(ruta || '/');
    if (limpia.length > 1) limpia = limpia.replace(/\/+$/, '');

    const cuerpo = limpia === '/' ? '' : limpia.split('/').slice(1).map(seg => {
      if (seg.charAt(0) === ':') { claves.push(seg.slice(1)); return '/([^/]+)'; }
      return '/' + escaparSegmento(seg);
    }).join('');

    const final = comoPrefijo ? '(?=/|$)' : '/?$';
    return { re: new RegExp('^' + cuerpo + final), claves };
  }

  function Router() {
    const capas = [];

    const router = function (req, res, next) {
      return recorrer(capas, req, req.path, res, next);
    };
    router.__capas = capas;

    ['get', 'post', 'put', 'patch', 'delete'].forEach(metodo => {
      router[metodo] = function (ruta) {
        const manejadores = Array.prototype.slice.call(arguments, 1);
        const c = compilar(ruta, false);
        capas.push({ metodo: metodo.toUpperCase(), re: c.re, claves: c.claves, manejadores });
        return router;
      };
    });

    router.use = function () {
      const args = Array.prototype.slice.call(arguments);
      const ruta = typeof args[0] === 'string' ? args.shift() : '/';
      const c = compilar(ruta, true);
      capas.push({ metodo: null, montaje: true, re: c.re, claves: c.claves, manejadores: args });
      return router;
    };

    return router;
  }

  // Recorre una pila de capas. `resto` es la ruta que le toca ver a ESTA pila
  // (ya sin el prefijo con el que se montó), igual que hace Express.
  async function recorrer(capas, req, resto, res, listo) {
    let i = 0;

    async function siguiente(err) {
      if (err) return listo(err);

      while (i < capas.length) {
        const capa = capas[i++];
        if (capa.metodo && capa.metodo !== req.method) continue;

        const m = capa.re.exec(resto);
        if (!m) continue;

        capa.claves.forEach((clave, idx) => {
          req.params[clave] = decodeURIComponent(m[idx + 1]);
        });

        let sub = resto;
        if (capa.montaje) {
          sub = resto.slice(m[0].length) || '/';
          if (sub.charAt(0) !== '/') sub = '/' + sub;
        }

        return correrManejadores(capa.manejadores, req, sub, res, siguiente, listo);
      }

      return listo();
    }

    await siguiente();
  }

  async function correrManejadores(manejadores, req, resto, res, seguirFuera, listo) {
    let j = 0;

    async function siguiente(err) {
      if (err) return listo(err);
      if (res.terminado) return;            // alguien ya contestó
      if (j >= manejadores.length) return seguirFuera();

      const h = manejadores[j++];
      try {
        if (h && h.__capas) {
          return await recorrer(h.__capas, req, resto, res, e => (e ? listo(e) : siguiente()));
        }
        const salida = h(req, res, siguiente);
        if (salida && typeof salida.then === 'function') await salida;
      } catch (e) {
        return listo(e);
      }
    }

    await siguiente();
  }

  function express() {
    const app = Router();
    app.__esApp = true;
    return app;
  }
  express.Router = Router;
  express.json = function () { return function (req, res, next) { next(); }; };
  express.static = function () { return function (req, res, next) { next(); }; };
  express.urlencoded = express.json;

  // ---- Las direcciones: aquí cada pantalla vuelve a ser su archivo --------
  //
  // Con servidor, el panel de alguien es /dashboard/<su id> y routes/paginas.js
  // decide qué pantalla mandarle. Aquí no hay quien decida nada: GitHub Pages
  // sirve archivos y punto, así que se vuelve a dashboard-teacher.html y
  // compañía. Quien mira esta bandera es rrDashboardFor(), en public/js/api.js.
  //
  // Los enlaces escritos a mano (/entrar, /guia) no la necesitan: esos ya los
  // deshizo tools/build-pages.js al armar el sitio.
  global.RR_PAGINAS_ESTATICAS = true;

  // ---- process: el que no lleva nada puesto ------------------------------
  //
  // Varios archivos leen process.env para decidir cosas —dónde guardar, con
  // qué clave hablarle a Claude, si encender la consola de demostración—. En
  // el navegador no existe, y sin esto el primer require reventaría con un
  // ReferenceError antes de pintar nada.
  //
  // Va vacío a propósito: cada una de esas decisiones cae entonces en su
  // camino por defecto, que es justo el que quiere una demostración.
  if (typeof global.process === 'undefined') {
    global.process = {
      // Vacío salvo una cosa: aquí no hay base que proteger —la de esta
      // versión vive en la pestaña y se borra al cerrarla, y todo lo que hay
      // dentro es de mentira—, así que la consola de demostración está abierta
      // sin contraseña. Ver abierta() en routes/dev.js.
      env: { RR_CONSOLA_ABIERTA: '1' },
      argv: [],
      platform: 'browser',
      once() { },
      on() { },
      exit() { },
      nextTick(fn) { Promise.resolve().then(fn); }
    };
  }

  // ---- crypto: lo justo, y lo demás avisando -----------------------------
  //
  // Ya casi nadie lo pide —los códigos por correo se fueron— pero algún módulo
  // puede hacer el require al cargarse, y sin esto reventaría antes de pintar
  // nada.
  //
  // randomInt sí está de verdad, porque es fácil y honesto hacerlo bien con
  // el generador del navegador. Lo que no se puede imitar en dos líneas
  // —createHmac necesita SHA-256 síncrono, y el del navegador es asíncrono—
  // avisa en voz alta en lugar de devolver algo que parezca una firma sin
  // serlo. Si alguien enciende la verificación aquí, se va a enterar.
  const cryptoShim = {
    randomInt(min, max) {
      if (max === undefined) { max = min; min = 0; }
      const rango = max - min;
      const buf = new Uint32Array(1);
      global.crypto.getRandomValues(buf);
      return min + (buf[0] % rango);
    },
    randomUUID() { return global.crypto.randomUUID(); },
    createHmac() {
      throw new Error('roboRobin: la versión sin servidor no firma nada. Ver el cryptoShim en rr-runtime.js.');
    },
    timingSafeEqual() {
      throw new Error('roboRobin: la versión sin servidor no compara firmas. Ver el cryptoShim en rr-runtime.js.');
    }
  };

  // ---- Registro de módulos (el require del navegador) ----------------------

  const definiciones = Object.create(null);
  const enCache = Object.create(null);
  const nativos = { fs, path, bcryptjs, express, crypto: cryptoShim };

  function normalizar(dir, id) {
    if (id.charAt(0) !== '.') return id;
    const partes = (dir + '/' + id).split('/');
    const salida = [];
    for (const p of partes) {
      if (!p || p === '.') continue;
      if (p === '..') salida.pop();
      else salida.push(p);
    }
    let r = salida.join('/');
    if (r.slice(-3) === '.js') r = r.slice(0, -3);
    return r;
  }

  function pedir(dir, id) {
    const clave = normalizar(dir, id);
    if (nativos[clave]) return nativos[clave];
    if (enCache[clave]) return enCache[clave].exports;

    const fabrica = definiciones[clave];
    if (!fabrica) throw new Error('roboRobin: falta el módulo «' + clave + '» (pedido desde ' + dir + ').');

    const mod = { exports: {} };
    enCache[clave] = mod;
    const miDir = clave.split('/').slice(0, -1).join('/') || '.';
    fabrica(otro => pedir(miDir, otro), mod, mod.exports, miDir, clave);
    return mod.exports;
  }

  global.RRModulos = {
    define(id, fabrica) { definiciones[id] = fabrica; },
    require(id) { return pedir('.', id); },
    config: RR_CONFIG
  };

  global.RRExpress = express;
})(window);
