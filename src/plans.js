// src/plans.js
// ---------------------------------------------------------------------------
// Los planes de roboRobin para cuentas personales.
//
//   free  Gratis para siempre. Todo el organizador de tareas, todos los
//         minijuegos y a Robin con el margen diario de partida.
//   pro   20 $ al mes. Mucho más de todo: el margen sube un 1 500 %.
//   max   99 $ al mes. Sin techo y con el modelo más capaz.
//
// De cara a quien lee la página, los planes se comparan en PORCENTAJE sobre el
// plan Gratis, no en cifras sueltas: "1 500 % más" se entiende de un vistazo y
// "400 mensajes" no dice nada si no sabes con qué compararlo. Los números de
// aquí abajo siguen siendo los que manda el servidor —son los que de verdad se
// cuentan— y quedan publicados en /terminos.html#limites para quien los busque.
//
// Los ciclos largos traen descuento: 4 meses, medio año y anual. Los precios
// se calculan a partir del precio mensual, así que cambiar un número de arriba
// actualiza toda la página de planes sin tocar nada más.
//
// Las cuentas de escuela (estudiante, profesor, dirección) NO tienen planes:
// lo que pueden hacer lo decide su escuela, no una suscripción.
// ---------------------------------------------------------------------------

// Un descuento por comprometerse más tiempo. 0.15 = 15 % menos.
//
// Son cuatro formas de pagarlo, en este orden y con el descuento subiendo con
// el compromiso:
//
//   mensual          1 mes      sin descuento
//   cada 4 meses     4 meses    −5 %
//   cada medio año   6 meses    −15 %
//   anual            12 meses   −25 %
//
// Ese es el rango entero: por debajo del 5 % el descuento no se nota, y por
// encima del 25 % el mensual deja de tener sentido. Cambiar un número de aquí
// actualiza a la vez la portada y la pantalla de planes, porque las dos leen
// este mismo catálogo.
const CYCLES = [
  { id: 'monthly', months: 1, label: 'Mensual', short: 'al mes', discount: 0 },
  { id: 'quarterly', months: 4, label: 'Cada 4 meses', short: 'cada 4 meses', discount: 0.05 },
  { id: 'semiannual', months: 6, label: 'Cada medio año', short: 'cada 6 meses', discount: 0.15 },
  { id: 'yearly', months: 12, label: 'Anual', short: 'al año', discount: 0.25 }
];

// El identificador 'quarterly' se quedó de cuando ese ciclo era de tres meses.
// Ahora son cuatro, pero el nombre interno no se toca: es el que está guardado
// en la ficha de quien ya eligió ese ciclo, y cambiarlo los devolvería a todos
// al plan mensual sin avisar. Lo que se lee en pantalla es 'label'.

// -1 significa «sin límite».
const PLANS = {
  free: {
    id: 'free',
    name: 'Gratis',
    tagline: 'Todo lo importante, sin pagar nada.',
    compare: 'El punto de partida',
    monthly: 0,
    accent: 'blue',
    limits: {
      aiMessages: 25,   // mensajes al día con Robin
      gameHints: 5,     // pistas de minijuego al día
      homeworkHelp: 5,  // veces al día que Robin desarma una tarea paso a paso
      historyDays: 30   // días de historial de conversaciones que se guardan
    },
    features: [
      'Organizador de tareas completo, con recordatorios y notificaciones',
      'Todos los minijuegos desbloqueados, de todas las materias',
      'Conversación diaria con Robin: el punto de partida',
      'Pistas en los minijuegos cuando te trabes',
      'Historial de tus conversaciones de los últimos 30 días'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Para cuando Robin se vuelve tu compañero de estudio diario.',
    compare: '1 500 % más que Gratis',
    monthly: 20,
    accent: 'red',
    popular: true,
    limits: {
      aiMessages: 400,
      gameHints: 100,
      homeworkHelp: 100,
      historyDays: 365
    },
    features: [
      'Todo lo del plan Gratis',
      '1 500 % más de conversación diaria con Robin que en Gratis',
      '1 900 % más de pistas en los minijuegos',
      'Robin te acompaña paso a paso en cualquier tarea, sin contar los usos',
      'Historial de un año entero',
      'Respuestas con prioridad: Robin contesta primero'
    ]
  },
  max: {
    id: 'max',
    name: 'Max',
    tagline: 'Sin techo. Robin al máximo, todo el día.',
    compare: 'Sin límite',
    monthly: 99,
    accent: 'gold',
    limits: {
      aiMessages: -1,
      gameHints: -1,
      homeworkHelp: -1,
      historyDays: -1
    },
    features: [
      'Todo lo del plan Pro',
      'Sin techo: conversación con Robin ilimitada',
      'Sin techo: pistas ilimitadas en todos los minijuegos',
      'Historial para siempre, nunca se borra solo',
      'Planes de estudio largos: Robin arma tu semana y te la ajusta',
      'Acceso anticipado a los minijuegos nuevos'
    ]
  }
};

const PLAN_IDS = Object.keys(PLANS);

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Cuánto cuesta un plan en un ciclo: el total que se paga de una vez y a
// cuánto sale el mes, que es el número con el que la gente compara.
function priceFor(planId, cycleId) {
  const plan = PLANS[planId];
  const cycle = CYCLES.find(c => c.id === cycleId) || CYCLES[0];
  if (!plan) return null;

  const full = plan.monthly * cycle.months;
  const total = round2(full * (1 - cycle.discount));
  return {
    cycle: cycle.id,
    cycleLabel: cycle.label,
    cycleShort: cycle.short,
    months: cycle.months,
    listTotal: round2(full),
    total,
    perMonth: round2(total / cycle.months),
    saves: round2(full - total),
    discountPct: Math.round(cycle.discount * 100)
  };
}

// El catálogo entero, ya con los precios calculados en los tres ciclos. Es lo
// que consume la pantalla de planes del espacio personal.
function catalog() {
  return {
    cycles: CYCLES.map(c => ({ ...c, discountPct: Math.round(c.discount * 100) })),
    plans: PLAN_IDS.map(id => ({
      ...PLANS[id],
      prices: CYCLES.reduce((acc, c) => {
        acc[c.id] = priceFor(id, c.id);
        return acc;
      }, {})
    }))
  };
}

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

// El límite que le toca a una cuenta. Las cuentas de escuela no pagan nada,
// así que van por el plan gratis (pero el trabajo escolar tiene su propia
// bolsa, ver src/limits en db.js).
function limitFor(user, key) {
  const plan = getPlan(user && user.role === 'personal' ? user.plan : 'free');
  const value = plan.limits[key];
  return value === undefined ? -1 : value;
}

module.exports = { PLANS, PLAN_IDS, CYCLES, catalog, priceFor, getPlan, limitFor };
