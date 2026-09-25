// routes/paginas.js
// ---------------------------------------------------------------------------
// Las direcciones que se ven en la barra del navegador.
//
// Antes cada pantalla era su archivo: /dashboard-student.html, /login.html.
// Eso enseña cómo está hecho el sitio por dentro, que a nadie le importa, y
// ata la dirección al nombre del archivo — el día que un panel se parta en
// dos, la dirección que alguien guardó en favoritos deja de existir.
//
// Ahora:
//
//   /                  la portada
//   /entrar            entrar
//   /registro          crear cuenta o inscribir escuela
//   /dashboard/:id     el panel de esa cuenta
//   /-/robinAI         solo el chat con Robin, sin salida
//   /-/minijuegos      solo los minijuegos, sin salida
//   /guia              la guía
//   /terminos          términos, privacidad y aviso
//
// Las direcciones viejas siguen funcionando: contestan 301 a la nueva, para
// que un enlace guardado hace meses no se rompa.
//
// Sobre el id de /dashboard/:id
//   Es para que la dirección diga de quién es el panel, no para decidir nada.
//   Quien manda es la sesión: si el id no es el tuyo, aquí te devuelven al
//   tuyo, y los datos de la pantalla los sirve /api/… mirando la sesión y no
//   la barra de direcciones. Cambiar el número a mano no enseña nada de nadie.
// ---------------------------------------------------------------------------

const path = require('path');
const express = require('express');

const router = express.Router();
const db = require('../src/db');

const PAGINAS = path.join(__dirname, '..', 'public');

function enviar(res, archivo) {
  res.sendFile(path.join(PAGINAS, archivo));
}

// Qué panel le toca a cada quien. Es la misma tabla que rrDashboardFor() en
// public/js/api.js, y tienen que decir lo mismo: si aquí mandamos a un peque
// al panel normal, su propio JavaScript lo va a rebotar al de peques y la
// pantalla parpadea dos veces antes de asentarse.
function panelDe(user) {
  if (['admin', 'subdirector', 'secretary'].includes(user.role)) return 'dashboard-admin.html';
  if (user.role === 'teacher') return 'dashboard-teacher.html';
  if (user.role === 'parent') return 'dashboard-parent.html';
  if (user.role === 'student') {
    return db.isLittleKid(user) ? 'dashboard-peques.html' : 'dashboard-student.html';
  }
  return 'dashboard-personal.html';
}

// ---- Las páginas sueltas ---------------------------------------------------

const SUELTAS = {
  '/entrar': 'login.html',
  '/registro': 'register.html',
  '/guia': 'guia.html',
  '/terminos': 'terminos.html'
};

for (const [ruta, archivo] of Object.entries(SUELTAS)) {
  router.get(ruta, (req, res) => enviar(res, archivo));
}

// ---- El panel --------------------------------------------------------------

router.get('/dashboard/:id', (req, res) => {
  if (!req.session.userId) return res.redirect('/entrar');

  const yo = db.getUserById(req.session.userId);
  if (!yo) {
    // La sesión apunta a una cuenta que ya no existe: la borraron mientras
    // esta pestaña seguía abierta. Se cierra en vez de dejarla a medias.
    return req.session.destroy(() => res.redirect('/entrar'));
  }

  // El panel de otro no se abre. No es que enseñara sus datos —los datos
  // vienen de /api/ mirando la sesión— pero una dirección que contesta a
  // medias es peor que una que te manda a donde te toca.
  if (String(yo.id) !== String(req.params.id)) return res.redirect('/dashboard/' + yo.id);

  enviar(res, panelDe(yo));
});

// Sin id: al tuyo. Es la dirección que conviene teclear de memoria.
router.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/entrar');
  res.redirect('/dashboard/' + req.session.userId);
});

// ---- Las pantallas de una sola cosa ----------------------------------------
//
//   /-/robinAI       solo el chat con Robin
//   /-/minijuegos    solo los minijuegos
//
// Es el mismo panel de siempre, servido igual, pero abierto en «modo
// enfocado»: sin menú lateral, sin las otras secciones y sin ninguna manera de
// salirse a otra pantalla desde dentro. Ver public/js/enfoque.js.
//
// Para qué: una exposición, una tablet en el aula, o cualquier sitio donde se
// deja el aparato delante de alguien para que use UNA cosa. Con el panel
// entero abierto, en dos clics se acaba en la configuración de la cuenta.
//
// Por qué el prefijo /-/ y no /robinAI a secas: deja claro de un vistazo que
// esto no es una pantalla más del sitio sino un modo, y aparta estas dos
// direcciones de cualquier ruta futura que se llame igual. Las versiones sin
// prefijo funcionan igual y mandan aquí, porque son las que alguien teclea.
//
// Quién manda sigue siendo la sesión: sin ella, a entrar. El modo enfocado no
// da acceso a nada que la cuenta no tuviera ya.

const ENFOCADAS = {
  'robinai': 'robinAI',
  'minijuegos': 'minijuegos'
};

router.get('/-/:modo', (req, res, next) => {
  const canonico = ENFOCADAS[String(req.params.modo).toLowerCase()];
  if (!canonico) return next();

  if (!req.session.userId) return res.redirect('/entrar');
  const yo = db.getUserById(req.session.userId);
  if (!yo) return req.session.destroy(() => res.redirect('/entrar'));

  // Escrito con otras mayúsculas, se manda a la dirección buena: una sola
  // dirección por pantalla, que es lo que se puede guardar en favoritos y lo
  // que mira el JavaScript para saber en qué modo está.
  if (req.params.modo !== canonico) return res.redirect(301, '/-/' + canonico);

  enviar(res, panelDe(yo));
});

// Sin el prefijo. Son las que se teclean de memoria.
for (const canonico of Object.values(ENFOCADAS)) {
  router.get('/' + canonico, (req, res) => res.redirect('/-/' + canonico));
}

// ---- Las direcciones de antes ----------------------------------------------

const MUDANZAS = {
  '/login.html': '/entrar',
  '/register.html': '/registro',
  '/guia.html': '/guia',
  '/terminos.html': '/terminos',
  '/index.html': '/'
};

for (const [vieja, nueva] of Object.entries(MUDANZAS)) {
  router.get(vieja, (req, res) => res.redirect(301, nueva));
}

// Los paneles viejos van todos al tuyo: /dashboard-teacher.html no puede
// llevar a un sitio distinto según quién lo abra, y el único panel que alguien
// puede abrir es el suyo.
for (const archivo of ['admin', 'teacher', 'student', 'peques', 'personal', 'parent']) {
  router.get('/dashboard-' + archivo + '.html', (req, res) => {
    if (!req.session.userId) return res.redirect(301, '/entrar');
    res.redirect(301, '/dashboard/' + req.session.userId);
  });
}

module.exports = router;
