// routes/games.js
// Los minijuegos. Un reto se pide, se contesta y se califica aquí; la
// respuesta correcta se queda en la sesión y nunca baja al navegador, así que
// la pista de Robin sirve de algo.
//
// Reglas que valen para todos:
//   · Una cuenta personal los tiene todos desbloqueados, siempre.
//   · A un estudiante le pueden apagar un minijuego su profesor (por clase) o
//     la dirección (para toda la escuela).
//   · La dificultad la decide el nivel escolar, no quien juega.
//   · Robin ayuda a resolver, pero la pista y el paso a paso gastan de la
//     bolsa diaria — incluso en el plan gratis, donde la bolsa es pequeña.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const games = require('../src/games');
const { requireLogin } = require('../src/auth');
const { can } = require('../src/permissions');

// El reto en curso vive en la sesión, uno por minijuego, para que se pueda
// tener el de matemáticas a medias mientras se juega el de inglés.
function roundsOf(req) {
  if (!req.session.gameRounds) req.session.gameRounds = {};
  return req.session.gameRounds;
}

// ---- Galería ---------------------------------------------------------------

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const lista = db.availableGamesFor(me);
  const marcas = db.getGameScores(me.id);

  res.json({
    games: lista.map(g => {
      const marca = marcas.find(m => m.gameId === g.id);
      return {
        ...g,
        score: marca
          ? { plays: marca.plays, correct: marca.correct, streak: marca.streak, bestStreak: marca.bestStreak }
          : { plays: 0, correct: 0, streak: 0, bestStreak: 0 }
      };
    }),
    difficulty: games.difficultyFor(me),
    level: me.level || null,
    usage: db.usageSummary(me)
  });
});

// ---- Jugar -----------------------------------------------------------------

router.post('/:gameId/round', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const game = games.getGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Ese minijuego no existe.' });

  const disponible = db.availableGamesFor(me).find(g => g.id === game.id);

  // Ni siquiera está en su lista: es lo que pasa en universidad, donde no hay
  // minijuegos en absoluto. Sin esto, pedir un reto a mano reventaba con un
  // 500 en vez de explicar por qué no lo hay.
  if (!disponible) {
    return res.status(403).json({
      error: 'En tu nivel no hay minijuegos.',
      hint: 'A partir de universidad no se muestran: a esa altura no vienen al caso.'
    });
  }

  if (!disponible.enabled) {
    return res.status(403).json({
      error: `«${game.name}» está apagado ahora mismo por ${disponible.disabledBy}.`
    });
  }

  const round = games.buildRound(game.id, games.difficultyFor(me));
  roundsOf(req)[game.id] = round.secret;
  res.json({ round: round.publicRound });
});

router.post('/:gameId/answer', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const secret = roundsOf(req)[req.params.gameId];
  if (!secret) {
    return res.status(400).json({ error: 'Ese reto ya no está en juego. Pide uno nuevo.' });
  }

  const acierto = games.isCorrect(secret, (req.body || {}).answer);
  const usoPista = Boolean(secret.hintUsed || secret.stepsUsed);
  const marca = db.recordGameResult(me.id, secret.gameId, { correct: acierto, usedHint: usoPista });

  if (acierto) {
    // El reto se cierra: ya no se puede volver a mandar la misma respuesta.
    delete roundsOf(req)[req.params.gameId];
    return res.json({
      correct: true,
      answer: secret.answer,
      message: rachaMensaje(marca.streak),
      score: { plays: marca.plays, correct: marca.correct, streak: marca.streak, bestStreak: marca.bestStreak }
    });
  }

  // Al fallar no se revela nada: el reto sigue abierto para volver a intentar.
  res.json({
    correct: false,
    message: 'Todavía no. Vuelve a mirarlo con calma, o pídeme una pista.',
    score: { plays: marca.plays, correct: marca.correct, streak: marca.streak, bestStreak: marca.bestStreak }
  });
});

function rachaMensaje(streak) {
  if (streak >= 10) return `¡${streak} seguidas! Esto ya no es suerte.`;
  if (streak >= 5) return `¡${streak} seguidas! Vas volando.`;
  if (streak >= 3) return `¡Tres seguidas! Le agarraste el truco.`;
  return '¡Correcto! Ahí está.';
}

// ---- Robin ayuda -----------------------------------------------------------
// Dos niveles de ayuda, y ninguno de los dos dice el resultado:
//
//   hint   un empujón: por dónde empezar, en qué fijarse.
//   steps  el camino completo paso a paso. La última cuenta la haces tú.
//
// Los dos gastan de la bolsa diaria de pistas. Es lo que hace que el plan Pro
// y el Max signifiquen algo sin quitarle la ayuda a quien no paga.

router.post('/:gameId/help', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const secret = roundsOf(req)[req.params.gameId];
  if (!secret) return res.status(400).json({ error: 'Pide un reto antes de pedir ayuda.' });

  const nivel = (req.body || {}).level === 'steps' ? 'steps' : 'hint';
  const gasto = db.consumeUsage(me.id, 'gameHints');
  if (!gasto.ok) {
    return res.status(429).json({
      error: 'Ya usaste todas tus pistas de hoy.',
      hint: 'Mañana vuelves a tener pistas nuevas. Si las quieres ahora mismo, los planes Pro y Max traen muchas más.',
      usage: db.usageSummary(db.getUserById(me.id)),
      upgrade: me.role === 'personal'
    });
  }

  if (nivel === 'steps') secret.stepsUsed = true;
  else secret.hintUsed = true;

  res.json({
    level: nivel,
    hint: nivel === 'hint' ? secret.hint : null,
    steps: nivel === 'steps' ? secret.steps : null,
    intro: nivel === 'hint'
      ? 'Te doy un empujón, pero la respuesta la pones tú:'
      : 'Vamos por partes. Sigue estos pasos y el último lo haces tú:',
    usage: db.usageSummary(db.getUserById(me.id))
  });
});

// ---- Qué minijuegos quedan activos -----------------------------------------
// La dirección los apaga para toda la escuela; quien da una clase, solo para
// esa clase. Nadie puede apagarle nada a una cuenta personal.

router.get('/settings/:scope/:scopeId', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { scope, scopeId } = req.params;
  if (!['school', 'class'].includes(scope)) {
    return res.status(400).json({ error: 'Ámbito desconocido.' });
  }
  if (!puedeTocar(me, scope, scopeId)) {
    return res.status(403).json({ error: 'No tienes permiso para configurar esos minijuegos.' });
  }

  const apagados = db.getDisabledGames(scope, scopeId);
  res.json({
    scope, scopeId: Number(scopeId),
    games: games.catalog().map(g => ({ ...g, enabled: !apagados.includes(g.id) }))
  });
});

router.put('/settings/:scope/:scopeId', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { scope, scopeId } = req.params;
  const { gameId, enabled } = req.body || {};

  if (!['school', 'class'].includes(scope)) {
    return res.status(400).json({ error: 'Ámbito desconocido.' });
  }
  if (!puedeTocar(me, scope, scopeId)) {
    return res.status(403).json({ error: 'No tienes permiso para configurar esos minijuegos.' });
  }
  if (!games.GAME_IDS.includes(gameId)) {
    return res.status(400).json({ error: 'Ese minijuego no existe.' });
  }

  db.setGameEnabled(scope, scopeId, gameId, Boolean(enabled));
  const apagados = db.getDisabledGames(scope, scopeId);
  res.json({
    games: games.catalog().map(g => ({ ...g, enabled: !apagados.includes(g.id) }))
  });
});

// Dirección manda en su escuela; el profesorado, solo en las clases suyas.
function puedeTocar(me, scope, scopeId) {
  if (scope === 'school') {
    return can(me.role, 'games.configureSchool') && Number(me.schoolId) === Number(scopeId);
  }
  if (!can(me.role, 'games.configureClass')) return false;
  const clase = db.getClassById(scopeId);
  return Boolean(clase && clase.teacherId === me.id);
}

module.exports = router;
