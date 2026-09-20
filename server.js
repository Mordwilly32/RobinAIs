// server.js
// roboRobin — plataforma 100% local, para personas y para escuelas.
// Arranca con: npm install && npm start
//
// Todo (cuentas, escuelas, códigos, tareas, avisos, historial del chat) se
// guarda en data/db.json, en esta computadora. Nada sale de aquí, salvo que
// tú mismo pegues una clave de la API de Anthropic en config.json para que
// Robin conteste con Claude en lugar de su modo local.

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

let config = { sessionSecret: 'roborobin-local-secret' };
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
} catch {
  console.warn('[roboRobin] No se pudo leer config.json, se usan los valores por defecto.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Las fotos de perfil viajan como data URL, por eso el límite generoso.
app.use(express.json({ limit: '2mb' }));

app.use(
  session({
    name: 'roborobin.sid',
    secret: config.sessionSecret || 'roborobin-local-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8 // 8 horas
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

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
// La consola de demostración (Ctrl + Alt + Shift + R en el navegador). Se
// apaga entera con "devConsole": false en config.json; ver routes/dev.js.
app.use('/api/dev', require('./routes/dev'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'roboRobin' }));

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

app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  roboRobin está corriendo localmente');
  console.log(`  Abre: http://localhost:${PORT}`);
  console.log('==============================================');
});
