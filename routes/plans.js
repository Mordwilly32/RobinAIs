// routes/plans.js
// Los planes de una cuenta personal: Gratis, Pro y Max.
//
// Esta instalación es local y no cobra nada de verdad: no hay pasarela de pago
// ni se guarda ninguna tarjeta. Elegir un plan aquí deja constancia de la
// elección y activa sus límites, que es lo que hace falta para probar el
// producto completo. El día que exista un cobro real, va justo aquí en medio.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const plans = require('../src/plans');
const { requireLogin } = require('../src/auth');

// El catálogo con los tres planes y sus precios en los tres ciclos. Es
// público a propósito: la página de inicio también lo enseña.
router.get('/', (req, res) => {
  res.json(plans.catalog());
});

// Qué plan tengo, cuánto he usado hoy y cuánto me queda.
router.get('/mine', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  res.json({
    plan: db.planInfoFor(me),
    usage: db.usageSummary(me),
    catalog: plans.catalog()
  });
});

router.post('/choose', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);

  // Las cuentas de escuela no compran nada: lo que pueden hacer lo decide su
  // escuela. Se responde con el motivo, no con un 403 mudo.
  if (me.role !== 'personal') {
    return res.status(400).json({
      error: 'Las cuentas de escuela no llevan plan: tu acceso lo decide tu institución.'
    });
  }

  const { plan, cycle } = req.body || {};
  if (!plans.PLAN_IDS.includes(plan)) {
    return res.status(400).json({ error: 'Ese plan no existe.' });
  }
  const cycleOk = plans.CYCLES.some(c => c.id === cycle);
  if (plan !== 'free' && !cycleOk) {
    return res.status(400).json({ error: 'Elige cada cuánto quieres pagarlo.' });
  }

  const updated = db.setPlan(me.id, plan, plan === 'free' ? 'monthly' : cycle);
  const precio = plans.priceFor(plan, updated.planCycle);

  res.json({
    user: db.publicUser(updated),
    plan: db.planInfoFor(updated),
    price: precio,
    message: plan === 'free'
      ? 'Volviste al plan Gratis. Sigues teniendo todos los minijuegos y tu organizador completo.'
      : `Plan ${plans.getPlan(plan).name} activo. Robin ya no te va a decir "hasta mañana" tan pronto.`
  });
});

module.exports = router;
