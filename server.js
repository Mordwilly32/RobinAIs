// server.js
// roboRobin — para personas y para escuelas.
// Arranca con: npm install && npm start
//
// Dónde se guarda todo (cuentas, escuelas, códigos, tareas, avisos, historial
// del chat) depende de la configuración:
//
//   sin configurar    data/db.json, en esta computadora. Nada sale de aquí.
//   con Supabase      Postgres, si existen SUPABASE_URL y
//                     SUPABASE_SERVICE_ROLE_KEY. Ver src/store.js y
//                     docs/supabase.md.
//
// Lo que nunca sale de esta computadora en ninguno de los dos casos: las caras
// del pase de lista y las fotos de perfil, que viven en el navegador de quien
// las tomó. Ver public/js/face-vault.js.
//
// La clave de la API de Anthropic tampoco se guarda en la base: es una
// variable de entorno (ANTHROPIC_API_KEY) o una línea de config.json, y ni una
// ni otra se suben al repositorio.

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

// .env solo si el archivo existe y el paquete está instalado; en un servidor
// de verdad las variables vienen del panel, no de un archivo.
try { require('dotenv').config(); } catch { /* opcional */ }

const db = require('./src/db');
const mailer = require('./src/mailer');

// config.json es para trabajar en esta computadora. En un servidor mandan las
// variables de entorno, que es donde sí se pueden guardar secretos.
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
} catch {
  if (!process.env.SESSION_SECRET) {
    console.warn('[roboRobin] No hay config.json; se usan variables de entorno y valores por defecto.');
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET || config.sessionSecret || 'roborobin-local-secret';
const EN_PRODUCCION = process.env.NODE_ENV === 'production';

if (EN_PRODUCCION && SESSION_SECRET === 'roborobin-local-secret') {
  console.error('[roboRobin] Falta SESSION_SECRET. Sin ella, cualquiera puede firmarse una sesión.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Render, Railway y Fly ponen un proxy delante. Sin esto, la cookie segura no
// se manda nunca porque Express cree que la conexión es http.
if (EN_PRODUCCION) app.set('trust proxy', 1);

// El dominio bueno, si hay uno.
//
// Un sitio con dominio propio acaba respondiendo en varias direcciones a la
// vez: roborobin.site, www.roborobin.site y la de Render. Las tres funcionan y
// las tres son la misma cosa, y eso trae dos problemas de verdad: la sesión se
// guarda en la cookie del dominio por el que entraste, así que entrar por www
// y volver por el otro es aparecer desconectado; y los buscadores cuentan tres
// sitios distintos donde hay uno.
//
// Con RR_DOMINIO puesto, cualquier otra dirección manda un 301 a esta.
const DOMINIO = (process.env.RR_DOMINIO || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

if (DOMINIO) {
  app.use((req, res, next) => {
    const host = req.headers.host;
    // Sin host, o ya es el bueno: seguir. Y las llamadas de /api no se
    // redirigen nunca: un 301 a mitad de un fetch con method POST se convierte
    // en un GET y la petición se pierde por el camino.
    if (!host || host === DOMINIO || req.path.startsWith('/api')) return next();
    res.redirect(301, 'https://' + DOMINIO + req.originalUrl);
  });
}

// Las fotos de perfil y las del pase de lista viajan como data URL, por eso
// el límite generoso: una foto de cámara recién sacada pasa de 2 MB sin
// despeinarse, y rebotarla con un 413 no le dice nada a quien la subió.
app.use(express.json({ limit: '12mb' }));

app.use(
  session({
    name: 'roborobin.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: EN_PRODUCCION,
      maxAge: 1000 * 60 * 60 * 8 // 8 horas
    }
  })
);

// Las direcciones de las pantallas van ANTES de los archivos estáticos: si no,
// express.static serviría /dashboard-teacher.html tal cual y no llegaría nunca
// a la mudanza que lo manda a /dashboard/<id>. Ver routes/paginas.js.
app.use(require('./routes/paginas'));

app.use(express.static(path.join(__dirname, 'public'), {
  // Que /login.html lo resuelva paginas.js y no el servidor de archivos: sin
  // esto, escribir /login sin extensión encontraría el archivo y se saltaría
  // la dirección nueva.
  extensions: false
}));

// La animación de espera vive en /loading y se sirve desde ahí, no copiada
// dentro de public: así hay UN solo archivo. Todas las páginas enlazan
// /loading/style.css y la carpeta se puede abrir también con doble clic.
app.use('/loading', express.static(path.join(__dirname, 'loading')));

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/users'));
app.use('/api/schools', require('./routes/schools'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/games', require('./routes/games'));
app.use('/api/codes', require('./routes/codes'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/family', require('./routes/family'));
// La consola de demostración (Ctrl + Alt + Shift + R en el navegador). Se
// apaga entera con "devConsole": false en config.json; ver routes/dev.js.
app.use('/api/dev', require('./routes/dev'));

app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'roboRobin',
  almacen: db.almacen.nombre,
  guardadoPendiente: Boolean(db.almacen.ultimoError)
}));

// La misma página de error sirve para todos los casos; el motivo se le marca
// en el <body> para que muestre el texto correcto.
const ERROR_PAGE = fs.readFileSync(path.join(__dirname, 'public', '404.html'), 'utf-8');

function sendErrorPage(res, status, motivo) {
  const html = motivo
    ? ERROR_PAGE.replace('<body class="rb-page">', `<body class="rb-page" data-motivo="${motivo}">`)
    : ERROR_PAGE;
  res.status(status).type('html').send(html);
}

// Nada coincidió. Si la petición viene del código (una llamada a /api) hace
// falta JSON; si viene de alguien navegando, se le muestra la página de error
// con el estado 404 real — sin redirigir, para que la dirección equivocada
// siga visible en la barra del navegador.
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'No encontrado.' });
  }
  sendErrorPage(res, 404);
});

// Cualquier error no previsto: mismo criterio, JSON para la API y página para
// el navegador. Sin esto, Express devolvería su pantalla blanca por defecto.
app.use((err, req, res, next) => {
  console.error('[roboRobin] Error no manejado:', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ error: 'Algo salió mal en el servidor.' });
  }
  sendErrorPage(res, 500, 'servidor');
});

// La base primero. Con Supabase hay que ir a leerla por red, y abrir el puerto
// antes de tenerla significaría atender la primera petición con la memoria en
// blanco: alguien vería su escuela vacía y, peor, escribiríamos encima.
db.listo()
  .then(() => {
    app.listen(PORT, () => {
      console.log('==============================================');
      console.log('  roboRobin está corriendo');
      console.log(`  Abre: http://localhost:${PORT}`);
      console.log(`  Base de datos: ${db.almacen.nombre}`);
      if (db.almacen.USA_SUPABASE) console.log(`  Supabase: ${db.almacen.donde}`);
      if (DOMINIO) console.log(`  Dominio: https://${DOMINIO}`);
      console.log(`  Correo: ${mailer.TRANSPORTE}`);
      console.log('==============================================');

      // Sin proveedor de correo no se puede activar ninguna cuenta, y como el
      // registro contesta con normalidad hasta el último paso, se nota tarde y
      // se nota mal: alguien esperando un código que no existe.
      if (EN_PRODUCCION && !mailer.mandaDeVerdad) {
        console.warn('[roboRobin] ATENCIÓN: no hay proveedor de correo.');
        console.warn('[roboRobin] Nadie puede registrarse: los códigos de activación');
        console.warn('[roboRobin] se están imprimiendo aquí en vez de enviarse.');
        console.warn('[roboRobin] Pon RESEND_API_KEY. Ver docs/correo.md.');
      }
    });
  })
  .catch(err => {
    console.error('[roboRobin] No se pudo arrancar:', err.message);
    process.exit(1);
  });
