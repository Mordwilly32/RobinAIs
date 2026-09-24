// routes/ai.js
// Robin, el asistente. Funciona en dos modos:
//
//   1. Modo local (por defecto): entiende órdenes sobre tus tareas
//      ("recuérdame llamar al dentista mañana", "¿qué tengo hoy?",
//      "ya terminé el informe") y responde con consejos de estudio y
//      organización. No sale nada de esta computadora.
//
//   2. Modo conectado: si pegas una clave de la API de Anthropic en
//      config.json, las preguntas abiertas las contesta Claude. Las órdenes
//      sobre tareas se siguen resolviendo localmente, así que el organizador
//      funciona igual con o sin clave.
//
// Dos reglas mandan sobre todo lo demás:
//
//   · Robin tiene un límite diario. Hasta en el plan gratis se puede hablar
//     con él, pero no infinito; los planes Pro y Max suben el techo.
//   · A un estudiante de una escuela Robin NUNCA le da la respuesta de una
//     tarea. Le pregunta, le explica el método y le devuelve la pelota. Eso no
//     es una sugerencia del prompt: es lo que también hace el modo local, para
//     que la regla se cumpla con clave de API y sin ella.

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// La clave del proyecto sale del entorno o de config.json, en ese orden.
//
// El entorno manda porque es lo único que existe en un servidor: config.json
// está en el .gitignore y nunca llega al despliegue. Y la clave no se guarda
// en la base de datos ni en Supabase a propósito — una clave de API paga con
// tu tarjeta, y no tiene por qué estar donde están los datos de la escuela.
function loadConfig() {
  let archivo = {};
  try {
    archivo = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch { /* en un servidor no hay config.json, y está bien */ }

  return {
    ...archivo,
    anthropicApiKey: (process.env.ANTHROPIC_API_KEY || archivo.anthropicApiKey || '').trim(),
    aiModel: process.env.RR_AI_MODEL || archivo.aiModel || 'claude-sonnet-5',
    aiModelMax: process.env.RR_AI_MODEL_MAX || archivo.aiModelMax || 'claude-opus-5'
  };
}

// Los modelos entre los que se puede elegir en la pantalla de configuración.
// El identificador es el que viaja a la API; el nombre es para la persona.
const MODELOS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', note: 'El más capaz. El que conviene si vas a exigirle de verdad.' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'Equilibrado: rápido y barato para el uso de todos los días.' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', note: 'El más rápido y el más barato. Para respuestas cortas.' }
];
const MODELO_POR_DEFECTO = 'claude-opus-5';

function modeloValido(id) {
  return MODELOS.some(m => m.id === id);
}

// Con qué llave y con qué modelo contesta Robin a esta persona.
//
// Manda lo que ella misma haya puesto en su configuración. Si no puso nada, se
// usa lo del proyecto entero (config.json). Si tampoco hay nada ahí, no hay
// conexión y Robin contesta en su modo local, que funciona sin internet.
function conexionDe(user, config) {
  const suya = db.aiSettingsOf(user);
  const delProyecto = (config.anthropicApiKey || '').trim();
  const key = (suya.key || '').trim() || delProyecto;

  return {
    key,
    // De dónde salió la llave: se dice en pantalla para que nadie se
    // pregunte por qué funciona cuando él no puso ninguna.
    origen: (suya.key || '').trim() ? 'propia' : (delProyecto ? 'proyecto' : 'ninguna'),
    model: suya.model && modeloValido(suya.model) ? suya.model : modelFor(user, config)
  };
}

// El plan Max estrena el modelo más capaz; el resto va con el equilibrado.
// Solo se usa cuando la persona no eligió modelo a mano.
function modelFor(user, config) {
  if (user.role === 'personal' && user.plan === 'max') {
    return config.aiModelMax || MODELO_POR_DEFECTO;
  }
  return config.aiModel || 'claude-sonnet-5';
}

// ---------------------------------------------------------------------------
// Fechas en lenguaje natural
// ---------------------------------------------------------------------------

const WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3,
  jueves: 4, viernes: 5, sabado: 6, 'sábado': 6
};

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function todayISO() { return toISODate(addDays(0)); }

// Busca una expresión de fecha dentro del texto. Devuelve la fecha en formato
// ISO y el texto sin esa expresión, para que no acabe dentro del título.
function extractDue(text) {
  const patterns = [
    { re: /\b(?:para\s+|el\s+)?pasado\s+ma[ñn]ana\b/i, get: () => addDays(2) },
    { re: /\b(?:para\s+|el\s+)?ma[ñn]ana\b/i, get: () => addDays(1) },
    { re: /\b(?:para\s+|de\s+)?hoy\b/i, get: () => addDays(0) },
    { re: /\ben\s+(\d{1,2})\s+d[ií]as?\b/i, get: m => addDays(Number(m[1])) },
    { re: /\bla\s+pr[oó]xima\s+semana\b/i, get: () => addDays(7) },
    // Por si alguien escribe en inglés
    { re: /\btomorrow\b/i, get: () => addDays(1) },
    { re: /\btoday\b/i, get: () => addDays(0) },
    { re: /\bnext\s+week\b/i, get: () => addDays(7) },
    {
      // «del lunes» y «para el lunes» se llevan también la preposición: si no,
      // el título se queda en «la reunión del» y suena a frase cortada.
      re: /\b(?:(?:para|de|del)\s+)?(?:el\s+)?(?:este\s+|pr[oó]ximo\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i,
      get: m => {
        const target = WEEKDAYS[m[1].toLowerCase()];
        const now = addDays(0);
        let delta = (target - now.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // "el lunes" dicho un lunes = el siguiente
        return addDays(delta);
      }
    },
    {
      re: /\b(?:el\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/,
      get: m => {
        const day = Number(m[1]);
        const month = Number(m[2]) - 1;
        const year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : new Date().getFullYear();
        const d = new Date(year, month, day, 12, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
      }
    }
  ];

  for (const { re, get } of patterns) {
    const match = text.match(re);
    if (match) {
      const date = get(match);
      if (date) return { due: toISODate(date), rest: text.replace(match[0], ' ').replace(/\s{2,}/g, ' ').trim() };
    }
  }
  return { due: null, rest: text };
}

function cleanTitle(text) {
  return text
    .replace(/^\s*(?:que\s+|de\s+|a\s+)?/i, '')
    .replace(/^(?:una?\s+)?tarea\s*(?:de|:)?\s*/i, '')
    .replace(/[\s.,;:!¡¿?]+$/g, '')
    // Sacar la fecha de en medio deja preposiciones colgando al final
    // («la reunión del» cuando «lunes» se fue a la fecha). Se quitan, y de
    // paso los signos que puedan haber quedado detrás de ellas.
    .replace(/\s+(?:de|del|el|la|los|las|para|en|a|al)$/i, '')
    .replace(/[\s.,;:!¡¿?]+$/g, '')
    .trim();
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function formatDue(iso) {
  if (!iso) return '';
  if (iso === todayISO()) return 'hoy';
  if (iso === toISODate(addDays(1))) return 'mañana';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------------------------------------------------------------------------
// Intenciones sobre tareas
// ---------------------------------------------------------------------------

// Ojo: en español la frase puede empezar con «¿» o «¡», así que todas las
// expresiones toleran esos signos al inicio.
// Las tres formas en que la gente pide de verdad que se le apunte algo. Están
// separadas a propósito, porque el riesgo de cada una es distinto:
//
//   A  verbos que ya significan «apúntalo» ellos solos («recuérdame …»).
//   B  verbos ambiguos que SOLO cuentan si va detrás la palabra tarea,
//      pendiente o recordatorio. Sin esa condición, «ponme un ejemplo de
//      fracciones» se convertiría en una tarea llamada «un ejemplo de
//      fracciones», que es peor que no entenderlo.
//   C  el atajo de escribir «tarea:» y ya.
const CREATE_A = String.raw`(?:recu[ée]rda(?:me|lo)?|recordarme|ap[uú]nta(?:me|lo)?|an[oó]ta(?:me|lo)?|agr[ée]ga(?:me)?|a[ñn][aá]de(?:me)?|a[ñn]adir|agregar|apuntar|anotar|necesito\s+(?:recordar|acordarme\s+de)|no\s+(?:se\s+)?me\s+(?:vaya\s+a\s+)?olvide(?:s)?|remind\s+me\s+to|add\s+(?:a\s+)?task)`;
const CREATE_B = String.raw`(?:p[oó]n(?:me|le|er)?|h[aá]z(?:me)?|hacer(?:me)?|crea(?:r|me)?|cr[ée]a(?:me)?|nuev[ao]|mete(?:me)?|met[eé]r(?:me)?|guarda(?:me)?|agenda(?:me|r)?|quiero\s+(?:agregar|a[ñn]adir|apuntar|anotar|crear|poner)|necesito\s+(?:apuntar|anotar))\s+(?:un[ao]?\s+)?(?:nuev[ao]\s+)?(?:tarea|pendiente|recordatorio|to-?do)s?`;
const CREATE_C = String.raw`(?:tarea|pendiente|to-?do|recordatorio)s?\s*:`;

const CREATE_RE = new RegExp(
  `^[¿¡\\s]*(?:por favor,?\\s+)?(?:me\\s+)?(?:puedes\\s+)?(?:${CREATE_A}|${CREATE_B}|${CREATE_C})\\s*[:,\\-–]?\\s*`,
  'i'
);

// Lo que queda pegado delante del título después de quitar el verbo y que no
// forma parte de la tarea: «agrégame UNA TAREA: estudiar» -> «estudiar»,
// «apúntame QUE tengo examen» -> «tengo examen», «mete A MIS PENDIENTES
// llamar al banco» -> «llamar al banco».
const CREATE_RELLENO_RE = /^(?:\s*(?:una?|el|la|los|las)\s+)?(?:\s*(?:a\s+)?(?:mi|mis)\s+(?:lista\s+de\s+)?(?:tareas?|pendientes?)\s*)?(?:\s*(?:nueva?\s+)?(?:tareas?|pendientes?|recordatorios?|to-?dos?)\s*)?(?:\s*[:,\-–]\s*)?(?:\s*(?:de|que|para|sobre)\s+)?/i;

const LIST_RE = /^[¿¡\s]*(?:(?:qu[eé]|cu[aá]les)\s+(?:son\s+)?(?:mis\s+)?(?:tareas|pendientes)|qu[eé]\s+(?:tengo|hay)\b|mis\s+(?:tareas|pendientes)|mi\s+agenda|pendientes\b|list(?:a|ar|ame)?\s+(?:mis\s+)?(?:tareas|pendientes)|my\s+tasks|what.?s?\s+(?:on\s+)?my)/i;

const DONE_RE = /^[¿¡\s]*(?:ya\s+)?(?:complet[ée]|termin[ée]|acab[ée]|hice|finalic[ée]|marca(?:r)?\s+(?:como\s+)?(?:lista|hecha|completa(?:da)?|terminada)|list[oa]\s+(?:la\s+)?(?:tarea)?|done)\s*(?:con\s+)?(?:la\s+tarea\s+)?(?:de\s+)?(.*)$/i;

const PRIORITY_RE = /\b(urgente|important[ea]|prioridad alta)\b/i;

function parseTaskIntent(message, userId) {
  const text = String(message).trim();

  // --- Crear -----------------------------------------------------------
  const createMatch = text.match(CREATE_RE);
  if (createMatch) {
    let rest = text.slice(createMatch[0].length);
    // Fuera el relleno que sobrevive al verbo («una tarea:», «que», «de»).
    rest = rest.replace(CREATE_RELLENO_RE, '');
    const priority = PRIORITY_RE.test(rest) ? 'alta' : 'normal';
    rest = rest.replace(PRIORITY_RE, ' ');
    const { due, rest: withoutDate } = extractDue(rest);
    const title = capitalize(cleanTitle(withoutDate));

    if (!title) {
      return { reply: '¿Qué quieres que apunte? Escríbelo así: «recuérdame entregar el informe mañana».' };
    }

    const task = db.createTask({ userId, title, due, priority });
    const when = due ? ` para ${formatDue(due)}` : '';
    const flag = priority === 'alta' ? ' La marqué como urgente.' : '';
    return {
      reply: `Listo, apunté «${task.title}»${when}.${flag}`,
      action: { type: 'task.created', taskId: task.id }
    };
  }

  // --- Listar ----------------------------------------------------------
  if (LIST_RE.test(text)) {
    const onlyToday = /\bhoy\b/i.test(text);
    let tasks = db.getTasks(userId).filter(t => !t.done);
    if (onlyToday) tasks = tasks.filter(t => t.due && t.due <= todayISO());

    if (!tasks.length) {
      return {
        reply: onlyToday
          ? 'No tienes nada pendiente para hoy. Buen momento para adelantar algo o descansar.'
          : 'Tu lista está vacía. Dime «recuérdame …» y lo apunto.',
        action: { type: 'task.listed' }
      };
    }

    const lines = tasks.slice(0, 8).map(t => {
      const when = t.due ? ` — ${formatDue(t.due)}` : '';
      const mark = t.priority === 'alta' ? '🔴' : '•';
      return `${mark} ${t.title}${when}`;
    });
    const header = onlyToday ? 'Esto es lo de hoy:' : `Tienes ${tasks.length} pendiente${tasks.length === 1 ? '' : 's'}:`;
    const more = tasks.length > 8 ? `\n…y ${tasks.length - 8} más en la lista.` : '';
    return { reply: `${header}\n${lines.join('\n')}${more}`, action: { type: 'task.listed' } };
  }

  // --- Completar -------------------------------------------------------
  const doneMatch = text.match(DONE_RE);
  if (doneMatch) {
    const needle = cleanTitle(doneMatch[1] || '').toLowerCase();
    const pending = db.getTasks(userId).filter(t => !t.done);
    if (!pending.length) return { reply: 'No tienes tareas pendientes por marcar.' };

    const target = needle
      ? pending.find(t => t.title.toLowerCase().includes(needle) || needle.includes(t.title.toLowerCase()))
      : pending[0];

    if (!target) {
      return { reply: `No encontré una tarea que se parezca a «${needle}». ¿Cómo se llama exactamente?` };
    }
    db.updateTask(userId, target.id, { done: true });
    const left = pending.length - 1;
    return {
      reply: `¡Hecho! Taché «${target.title}». ${left ? `Te queda${left === 1 ? '' : 'n'} ${left} pendiente${left === 1 ? '' : 's'}.` : 'Ya no te queda nada pendiente. 🎉'}`,
      action: { type: 'task.completed', taskId: target.id }
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// La regla del estudiante: guiar, no resolver
// ---------------------------------------------------------------------------
// Cuando alguien pega un ejercicio y pide "la respuesta", Robin no la da.
// Contesta con el método y una pregunta de vuelta. Esto se comprueba ANTES de
// llamar a la API, así que la regla se cumple también sin conexión.

const PIDE_RESPUESTA_RE = /\b(?:dame|dime|cu[aá]l\s+es|necesito|pasame|p[aá]same|escr[ií]beme|h[aá]zme(?:la)?|hazme|resu[eé]lve(?:me)?(?:lo|la)?|resolver[ií]as|contesta(?:me)?)\b[^?.!]*\b(?:la\s+)?(?:respuesta|resultado|soluci[oó]n|tarea\s+(?:hecha|resuelta)|answer)\b/i;

const PIDE_HACERLO_RE = /\b(?:h[aá]zme|hazme|hacerme|me\s+haces|puedes\s+hacer(?:me)?|escribe(?:me)?)\s+(?:la|el|mi)\s+(?:tarea|ensayo|resumen|informe|reporte|trabajo|composici[oó]n|redacci[oó]n)\b/i;

function pideLaRespuesta(text) {
  return PIDE_RESPUESTA_RE.test(text) || PIDE_HACERLO_RE.test(text);
}

// Lo que Robin contesta en vez de la respuesta. Son varias para que no suene
// a grabación cuando alguien insiste tres veces seguidas.
const DEVOLUCIONES = [
  'Esa te la vas a saber tú mejor que yo en cinco minutos. Dime qué parte entiendes ya y seguimos desde ahí.',
  'La respuesta te la dejo a ti, que es la parte que cuenta. Cuéntame cómo la empezarías y te digo si vas bien.',
  'Si te la doy, mañana en el examen no me vas a tener al lado. Vamos por partes: ¿qué te están pidiendo exactamente?',
  'No te la voy a dar hecha, pero sí te acompaño. ¿Qué datos ya tienes y cuál es el que te falta?'
];

function devolucion() {
  return DEVOLUCIONES[Math.floor(Math.random() * DEVOLUCIONES.length)];
}

// ¿A esta persona hay que guiarla en lugar de resolverle? Sí a todo el
// estudiantado de una escuela. Una cuenta personal adulta puede pedir lo que
// quiera, pero al pedir tarea escolar Robin igual prefiere explicar.
function modoTutor(user) {
  return user.role === 'student';
}

// ---------------------------------------------------------------------------
// Respuestas locales (sin clave de API)
// ---------------------------------------------------------------------------

function fallbackReply(message, user) {
  const text = String(message).toLowerCase();
  const gentle = user.level === 'Parvularia' || user.level === 'Primaria';
  const personal = user.role === 'personal';

  const bank = [
    {
      keys: ['hola', 'buenas', 'hey', 'hi ', 'qué tal', 'que tal'],
      reply: personal
        ? '¡Hola! Soy Robin. Puedo organizar tu día: dime «recuérdame …» y lo apunto, o pregúntame «¿qué tengo hoy?».'
        : '¡Hola! Soy Robin, tu ayudante. Pregúntame por tus tareas, una materia o cómo prepararte para un examen.'
    },
    {
      keys: ['organiz', 'planific', 'agenda', 'ordenar mi día', 'ordenar mi dia', 'productiv'],
      reply: 'Para ordenar el día me funciona esto: escribe todo lo que traes en la cabeza, marca las 3 cosas que de verdad importan hoy y agenda el resto para otro día. Dime «recuérdame …» y las voy apuntando una por una.'
    },
    {
      keys: ['matemát', 'matemat', 'suma', 'resta', 'multiplic', 'divid', 'álgebra', 'algebra', 'ecuación', 'ecuacion'],
      reply: gentle
        ? 'Truco de matemáticas: dibuja los números como puntitos o figuras y cuéntalos junto conmigo. Un pasito a la vez.'
        : 'Truco de matemáticas: parte el problema en pasos pequeños, anota qué datos ya tienes y busca qué fórmula conecta esos datos con lo que te piden.'
    },
    {
      keys: ['leer', 'lectura', 'libro', 'cuento', 'resumen'],
      reply: gentle
        ? 'Para leer mejor: mira los dibujos, pronuncia despacio las palabras difíciles y después de cada página pregúntate «¿qué acaba de pasar?».'
        : 'Para leer mejor: primero ojea los títulos, luego lee con calma y escribe una pregunta por sección. Se recuerda mucho más así.'
    },
    {
      keys: ['ciencia', 'experimento', 'física', 'fisica', 'química', 'quimica', 'biolog'],
      reply: 'En ciencias, escribe qué *crees* que va a pasar antes de probarlo. Comparar tu predicción con el resultado real es justo donde empieza el aprendizaje.'
    },
    {
      keys: ['tarea', 'deber', 'proyecto', 'trabajo'],
      reply: 'Divide la tarea en 3 partes, empieza por la más difícil mientras tienes la mente fresca y toma 5 minutos de descanso entre partes. Si quieres, dime «recuérdame …» y te la apunto con fecha.'
    },
    {
      keys: ['examen', 'prueba', 'estudiar', 'repasar', 'test'],
      reply: 'Técnica que funciona: explica el tema en voz alta como si se lo enseñaras a alguien. Donde te trabes, eso es exactamente lo que toca repasar.'
    },
    {
      keys: ['nervios', 'miedo', 'estrés', 'estres', 'ansi', 'preocupa', 'triste', 'cansad'],
      reply: 'Es normal sentirse así, significa que te importa. Respira despacio, recuerda una cosa que ya dominas bien y empieza por ahí. Si quieres, partimos el problema en pasos pequeños juntos.'
    },
    {
      keys: ['gracias', 'thank'],
      reply: '¡Con gusto! Aquí sigo cuando me necesites.'
    }
  ];

  for (const entry of bank) {
    if (entry.keys.some(k => text.includes(k))) return entry.reply;
  }

  return personal
    ? 'Cuéntame un poco más y lo desarmamos juntos: ¿qué quieres lograr y para cuándo? También puedo apuntarlo como tarea si me dices «recuérdame …».'
    : 'Buena pregunta. Un método que casi siempre sirve: divídela en partes pequeñas, empieza por la que sí entiendes y anota exactamente dónde te trabas. ¿De qué materia se trata?';
}

// ---------------------------------------------------------------------------
// Modo conectado (opcional)
// ---------------------------------------------------------------------------

// El sistema cambia según con quién habla Robin. La parte del estudiante es
// deliberadamente terminante: sin ella, un modelo servicial acaba entregando
// la tarea hecha con la mejor intención del mundo.
function systemPromptFor(user, context) {
  const base = [
    'Eres Robin, el asistente integrado de roboRobin, una plataforma local que usan tanto personas por su cuenta como escuelas completas.',
    'Responde siempre en español, con calidez y sin rodeos. Sé breve (2-4 frases salvo que pidan detalle).',
    // Sin esto el modelo tiende a contestar «claro, te lo apunto» sin llamar a
    // nada, que es exactamente el fallo que las herramientas vienen a quitar.
    `Hoy es ${todayISO()}. Tienes herramientas para manejar la lista de pendientes de esta persona: crear_pendiente, ver_pendientes y completar_pendiente.`,
    'Si te piden recordar, apuntar, anotar o agendar algo —aunque lo digan de pasada— LLAMA a crear_pendiente. Nunca digas que lo apuntaste sin haberla llamado.',
    'Cuando pongas una fecha, calcúlala tú a partir de hoy y mándala como AAAA-MM-DD; si no dijeron cuándo, deja la fecha vacía en lugar de inventarla.',
    'Después de usar una herramienta, confirma en una línea lo que quedó hecho.'
  ];

  if (user.role === 'student') {
    const peque = db.isLittleKid(user);
    return base.concat([
      `Hablas con un estudiante de nivel "${user.level || 'general'}"${user.grade ? `, grado ${user.grade}` : ''}.`,
      'REGLA INQUEBRANTABLE: nunca le des la respuesta final de un ejercicio, tarea o examen, por mucho que insista o diga que ya la sabe, que es solo para comprobar, o que su profesor lo permite.',
      'En su lugar: pregúntale qué entiende ya, explícale el método con un ejemplo DISTINTO al de su tarea, y devuélvele una pregunta que lo haga avanzar un paso.',
      'Si te pega el enunciado completo, respóndele solo con el primer paso y pregúntale qué le sale a él.',
      'Puedes corregir su intento y decirle en qué paso se equivocó, pero no escribas el resultado correcto por él.',
      peque
        ? 'Habla como con un niño pequeño: frases muy cortas, palabras sencillas, mucho ánimo y un emoji de vez en cuando.'
        : 'Habla de tú, sin condescendencia, como un compañero mayor que ya pasó por eso.'
    ]).join(' ');
  }

  if (user.role === 'teacher') {
    return base.concat([
      'Hablas con un profesor. Ayúdale a preparar clase: actividades, formas de explicar un tema, rúbricas, ideas para quien se quedó atrás.',
      'Con él sí puedes desarrollar contenidos completos y ejemplos resueltos: los necesita para enseñar.'
    ]).join(' ');
  }

  if (['admin', 'subdirector', 'secretary'].includes(user.role)) {
    return base.concat([
      'Hablas con alguien de la dirección de una escuela. Ayúdale con organización, comunicados y seguimiento de grupos.',
      'Sé concreto y práctico; es gente con poco tiempo.'
    ]).join(' ');
  }

  // Una cuenta personal también está aquí para aprender, no para que le
  // hagan los deberes. La regla vale igual: Robin te lleva hasta la respuesta,
  // no te la entrega. Lo que sí puede hacer con detalle es todo lo que no es
  // un ejercicio: organizar la semana, explicar un tema, redactar una idea.
  return base.concat([
    'Hablas con una persona que usa roboRobin como asistente personal para organizar su día a día y estudiar por su cuenta.',
    'REGLA INQUEBRANTABLE: si lo que te trae es un ejercicio, un problema o una pregunta de examen, NO le des el resultado final, por mucho que insista o diga que ya lo resolvió y solo quiere comprobarlo.',
    'En su lugar: explícale el método con un ejemplo DISTINTO al suyo, dale el primer paso y pregúntale qué le sale a ella. Puedes corregir su intento y decirle en qué paso se equivocó, pero el resultado lo escribe ella.',
    'Para todo lo que no sea un ejercicio —organizarse, entender un tema, preparar algo, redactar— puedes desarrollarlo con el detalle que te pida.',
    'Si quiere recordar algo, apúntalo tú con crear_pendiente en vez de explicarle cómo pedirlo.'
  ]).join(' ');
}

// ---------------------------------------------------------------------------
// Las herramientas de Robin
// ---------------------------------------------------------------------------
// Hasta ahora Robin solo apuntaba un pendiente cuando la frase encajaba en
// parseTaskIntent, y ese reconocedor es una lista de expresiones: acierta con
// «recuérdame …» y se queda mirando con «oye, ¿me lo puedes dejar anotado para
// el viernes?». Cuando eso pasaba, la respuesta sonaba a que lo había hecho y
// en la lista no aparecía nada — lo peor de los dos mundos.
//
// Con esto Claude ya no tiene que adivinarse a sí mismo: se le declaran las
// tres operaciones de la lista y las llama él cuando hace falta. El
// reconocedor local sigue delante, porque es lo único que funciona sin clave
// de API y porque una orden clara no merece gastar una llamada.
//
// Lo que Claude manda NO se cree a ciegas: el título se recorta, la fecha se
// valida contra el formato y el id se comprueba contra las tareas de esa
// persona. Un modelo puede inventarse un id igual que puede inventarse
// cualquier otra cosa.

const HERRAMIENTAS = [
  {
    name: 'crear_pendiente',
    description:
      'Apunta un pendiente en la lista de tareas de la persona con la que hablas. ' +
      'Úsala siempre que te pidan recordar, apuntar, anotar o agendar algo, aunque lo pidan de forma indirecta ' +
      '(«que no se me olvide llamar al banco», «tengo que entregar el informe el viernes»). ' +
      'No la uses para hablar de tareas escolares que ya existen ni para responder preguntas.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: {
          type: 'string',
          description: 'Qué hay que hacer, en pocas palabras y empezando por el verbo. Ejemplo: "Entregar el informe de biología".'
        },
        fecha: {
          type: 'string',
          description: 'Para cuándo es, en formato AAAA-MM-DD. Omítela si no dijeron cuándo. No te la inventes.'
        },
        prioridad: {
          type: 'string',
          enum: ['normal', 'alta'],
          description: 'Pon "alta" solo si dijeron que es urgente o importante.'
        },
        notas: {
          type: 'string',
          description: 'Detalle extra, solo si lo dieron. Opcional.'
        }
      },
      required: ['titulo']
    }
  },
  {
    name: 'ver_pendientes',
    description:
      'Devuelve los pendientes sin terminar de la persona. Úsala cuando pregunten qué tienen que hacer, ' +
      'qué tienen hoy o cómo va su lista, y también antes de completar uno para saber su número.',
    input_schema: {
      type: 'object',
      properties: {
        solo_hoy: {
          type: 'boolean',
          description: 'true para quedarte solo con los que vencen hoy o antes.'
        }
      },
      required: []
    }
  },
  {
    name: 'completar_pendiente',
    description:
      'Marca un pendiente como hecho. Necesitas su id: si no lo sabes, llama antes a ver_pendientes. ' +
      'No adivines el id.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'El id que devolvió ver_pendientes.' }
      },
      required: ['id']
    }
  }
];

const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ejecuta una herramienta y devuelve qué contestarle a Claude, más la señal
// que necesita el navegador para refrescar el panel de pendientes.
function ejecutarHerramienta(nombre, input, user) {
  const args = input && typeof input === 'object' ? input : {};

  if (nombre === 'crear_pendiente') {
    const titulo = capitalize(cleanTitle(String(args.titulo || '').trim())).slice(0, 200);
    if (!titulo) {
      return { resultado: 'No creé nada: el título venía vacío. Pregúntale qué quiere apuntar.', error: true };
    }
    // La fecha solo se acepta si de verdad es una fecha. Un modelo que se
    // equivoca de formato no puede acabar metiendo "el viernes" en un campo
    // que el resto de la aplicación lee como AAAA-MM-DD.
    const fecha = FECHA_ISO_RE.test(String(args.fecha || '')) ? args.fecha : null;
    const prioridad = args.prioridad === 'alta' ? 'alta' : 'normal';

    const task = db.createTask({
      userId: user.id,
      title: titulo,
      notes: args.notas ? String(args.notas).slice(0, 500) : undefined,
      due: fecha,
      priority: prioridad
    });
    return {
      resultado: `Apuntado. id=${task.id}, título="${task.title}"${fecha ? `, para ${fecha}` : ', sin fecha'}${prioridad === 'alta' ? ', urgente' : ''}.`,
      action: { type: 'task.created', taskId: task.id }
    };
  }

  if (nombre === 'ver_pendientes') {
    let tareas = db.getTasks(user.id).filter(t => !t.done);
    if (args.solo_hoy) tareas = tareas.filter(t => t.due && t.due <= todayISO());

    if (!tareas.length) {
      return { resultado: args.solo_hoy ? 'No tiene nada pendiente para hoy.' : 'Su lista está vacía.', action: { type: 'task.listed' } };
    }
    const lineas = tareas.slice(0, 25).map(t =>
      `id=${t.id} | ${t.title}${t.due ? ` | para ${t.due}` : ' | sin fecha'}${t.priority === 'alta' ? ' | urgente' : ''}`);
    return {
      resultado: `${tareas.length} pendiente(s):\n${lineas.join('\n')}`,
      action: { type: 'task.listed' }
    };
  }

  if (nombre === 'completar_pendiente') {
    const id = Number(args.id);
    // Que el id sea de ESTA persona lo garantiza getTasks(user.id): si el
    // modelo se inventa uno, no aparece y no se toca nada de nadie.
    const tarea = db.getTasks(user.id).find(t => t.id === id && !t.done);
    if (!tarea) {
      return { resultado: `No hay ningún pendiente sin terminar con id=${args.id}. Llama a ver_pendientes para ver los que sí existen.`, error: true };
    }
    db.updateTask(user.id, tarea.id, { done: true });
    return {
      resultado: `Tachado "${tarea.title}".`,
      action: { type: 'task.completed', taskId: tarea.id }
    };
  }

  return { resultado: `No existe ninguna herramienta llamada "${nombre}".`, error: true };
}

async function pedirAAnthropic(apiKey, model, cuerpo) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(Object.assign({ model }, cuerpo))
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Error de la API de Anthropic (${response.status}): ${errText}`);
    err.status = response.status;
    err.apiBody = errText;
    throw err;
  }
  return response.json();
}

// Cuántas veces se le deja pedir herramientas antes de cortar. Tres alcanza de
// sobra para el caso más largo (mirar la lista, tachar una, confirmar); un
// tope existe para que un modelo atascado en un bucle no se coma la espera de
// quien está mirando la pantalla.
const MAX_VUELTAS = 3;

async function callAnthropic(apiKey, model, message, user, history, context) {
  const messages = [];
  history.slice(-6).forEach(item => {
    messages.push({ role: 'user', content: item.message });
    messages.push({ role: 'assistant', content: item.response });
  });
  messages.push({ role: 'user', content: message });

  const system = systemPromptFor(user, context);
  const acciones = [];

  for (let vuelta = 0; vuelta <= MAX_VUELTAS; vuelta++) {
    // En la última vuelta se le quitan las herramientas: así está obligado a
    // contestar con palabras en vez de pedir una llamada más que ya no se le
    // va a ejecutar.
    const ultima = vuelta === MAX_VUELTAS;
    const data = await pedirAAnthropic(apiKey, model, {
      max_tokens: 2000,
      system,
      messages,
      tools: ultima ? undefined : HERRAMIENTAS
    });

    const bloques = data.content || [];
    const texto = bloques.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    const usos = bloques.filter(b => b.type === 'tool_use');

    if (data.stop_reason !== 'tool_use' || !usos.length) {
      return {
        text: texto || 'No se me ocurrió una respuesta esta vez, ¿puedes replantear la pregunta?',
        actions: acciones
      };
    }

    // La respuesta con los tool_use se devuelve tal cual, sin tocarla: es lo
    // que ata cada resultado a su petición.
    messages.push({ role: 'assistant', content: bloques });

    // TODOS los resultados van en UN SOLO mensaje de usuario. Repartirlos en
    // varios le enseña al modelo a dejar de pedir cosas en paralelo.
    const resultados = usos.map(uso => {
      const r = ejecutarHerramienta(uso.name, uso.input, user);
      if (r.action) acciones.push(r.action);
      const bloque = { type: 'tool_result', tool_use_id: uso.id, content: r.resultado };
      // Un fallo se devuelve marcado, no se calla: si no, el modelo da por
      // hecho que salió bien y se lo cuenta a la persona.
      if (r.error) bloque.is_error = true;
      return bloque;
    });
    messages.push({ role: 'user', content: resultados });
  }

  return { text: 'Me enredé con tu lista y mejor paro aquí. ¿Me lo dices otra vez, más corto?', actions: acciones };
}

// Los últimos turnos de la conversación abierta, en el formato que espera la
// llamada a la API.
function historyOf(user, chat) {
  if (chat) {
    const out = [];
    for (let i = 0; i < chat.messages.length - 1; i++) {
      if (chat.messages[i].role === 'user' && chat.messages[i + 1] && chat.messages[i + 1].role === 'robin') {
        out.push({ message: chat.messages[i].text, response: chat.messages[i + 1].text });
      }
    }
    return out;
  }
  return db.getAiHistory(user.id, 12);
}

// ---------------------------------------------------------------------------

router.post('/chat', requireLogin, async (req, res) => {
  const { message, chatId, context, classId, activityId, gameId } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Escribe una pregunta primero.' });
  }

  const me = db.getUserById(req.session.userId);
  const config = loadConfig();

  // La conversación donde guardar el turno. Si no venía ninguna, se abre una.
  let chat = chatId ? db.getChat(me.id, chatId) : null;
  if (!chat) {
    chat = db.createChat({
      userId: me.id,
      context: context || 'general',
      classId, activityId, gameId
    });
  }

  // Las órdenes sobre tareas se resuelven aquí mismo, con o sin clave de API,
  // y no gastan del límite diario: apuntar un pendiente no es hablar con la IA.
  const intent = parseTaskIntent(message, me.id);
  if (intent) {
    db.logAiChat({ userId: me.id, message, response: intent.reply });
    db.appendChatTurn(me.id, chat.id, { question: message, reply: intent.reply, mode: 'local' });
    return res.json({
      reply: intent.reply,
      mode: 'local',
      action: intent.action || null,
      chatId: chat.id,
      chat: db.chatSummary(db.getChat(me.id, chat.id)),
      usage: db.usageSummary(db.getUserById(me.id))
    });
  }

  // A partir de aquí sí cuenta como mensaje con Robin.
  const gasto = db.consumeUsage(me.id, 'aiMessages');
  if (!gasto.ok) {
    return res.status(429).json({
      error: 'Ya gastaste el 100 % de tu margen con Robin por hoy.',
      hint: me.role === 'personal'
        ? 'Mañana vuelves a empezar de cero. Si te quedas corto seguido, el plan Pro te da un 1 500 % más de margen y el Max lo quita del todo.'
        : 'Mañana vuelves a empezar de cero. Mientras tanto, tus pendientes y los minijuegos siguen funcionando igual.',
      upgrade: me.role === 'personal',
      usage: db.usageSummary(db.getUserById(me.id)),
      chatId: chat.id
    });
  }

  // La regla del estudiante, antes que nada: si lo que pide es la respuesta
  // hecha, no hay API que valga.
  if (modoTutor(me) && pideLaRespuesta(message)) {
    const reply = devolucion();
    db.logAiChat({ userId: me.id, message, response: reply });
    db.appendChatTurn(me.id, chat.id, { question: message, reply, mode: 'tutor' });
    return res.json({
      reply,
      mode: 'tutor',
      action: null,
      chatId: chat.id,
      chat: db.chatSummary(db.getChat(me.id, chat.id)),
      usage: db.usageSummary(db.getUserById(me.id))
    });
  }

  let reply;
  let mode;
  // Lo que Robin haya tocado de la lista durante su turno. El navegador lo usa
  // para refrescar el panel de pendientes sin recargar la página.
  let acciones = [];

  try {
    const conexion = conexionDe(me, config);
    if (conexion.key) {
      const salida = await callAnthropic(
        conexion.key,
        conexion.model,
        message,
        me,
        historyOf(me, chat),
        context || chat.context
      );
      reply = salida.text;
      acciones = salida.actions || [];
      mode = 'live';
    } else {
      reply = fallbackReply(message, me);
      mode = 'local';
    }
  } catch (err) {
    console.error('[roboRobin][IA]', err.message);
    reply = fallbackReply(message, me);
    mode = 'local-fallback';
  }

  db.logAiChat({ userId: me.id, message, response: reply });
  db.appendChatTurn(me.id, chat.id, { question: message, reply, mode });

  res.json({
    reply,
    mode,
    // La última es la que manda: si creó dos pendientes seguidos, refrescar
    // una vez ya los enseña los dos.
    action: acciones.length ? acciones[acciones.length - 1] : null,
    actions: acciones,
    chatId: chat.id,
    chat: db.chatSummary(db.getChat(me.id, chat.id)),
    usage: db.usageSummary(db.getUserById(me.id))
  });
});

// ---------------------------------------------------------------------------
// Ayuda con una asignación concreta
// ---------------------------------------------------------------------------
// El botón «que Robin me ayude» de una tarea de clase. Nunca la resuelve:
// la desarma en pasos y devuelve la primera pregunta. Gasta de su propia bolsa
// diaria, aparte de la del chat.

router.post('/homework', requireLogin, async (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { activityId, question } = req.body || {};

  const activity = db.getActivityById(activityId);
  if (!activity) return res.status(404).json({ error: 'No encontramos esa asignación.' });

  const clase = db.getClassById(activity.classId);
  const puedeVerla = clase && (
    (clase.studentIds || []).includes(me.id) ||
    clase.teacherId === me.id ||
    (me.schoolId && Number(clase.schoolId) === Number(me.schoolId) && me.role !== 'student')
  );
  if (!puedeVerla) return res.status(403).json({ error: 'Esa asignación no es tuya.' });

  const gasto = db.consumeUsage(me.id, 'homeworkHelp');
  if (!gasto.ok) {
    return res.status(429).json({
      error: 'Ya usaste todas tus ayudas con tareas de hoy.',
      hint: me.role === 'personal'
        ? 'Mañana tienes más. Con Pro o Max esta ayuda deja de contarse.'
        : 'Mañana tienes más. Mientras, pregúntale a tu profesor: para eso está.',
      upgrade: me.role === 'personal',
      usage: db.usageSummary(db.getUserById(me.id))
    });
  }

  const config = loadConfig();
  const enunciado = [
    `Asignación: ${activity.title}`,
    activity.description ? `Consigna: ${activity.description}` : '',
    activity.subject ? `Materia: ${activity.subject}` : '',
    question ? `Lo que no entiende: ${question}` : ''
  ].filter(Boolean).join('\n');

  const peticion = [
    'Desarma esta tarea en un plan de 3 o 4 pasos para que la persona la haga ella misma.',
    'No resuelvas ningún paso: solo di qué hay que hacer en cada uno y por qué.',
    'Termina con UNA pregunta corta que la ayude a arrancar el primer paso.',
    '',
    enunciado
  ].join('\n');

  let plan;
  let mode;
  try {
    const conexion = conexionDe(me, config);
    if (conexion.key) {
      // Aquí solo interesa el texto: ayudar con una asignación no toca la
      // lista de pendientes, así que las acciones que pudiera traer se
      // ignoran a propósito.
      plan = (await callAnthropic(
        conexion.key, conexion.model,
        peticion, me, [], 'homework'
      )).text;
      mode = 'live';
    } else {
      plan = planLocal(activity, question);
      mode = 'local';
    }
  } catch (err) {
    console.error('[roboRobin][IA]', err.message);
    plan = planLocal(activity, question);
    mode = 'local-fallback';
  }

  // Queda guardado en su propia conversación, atada a la asignación: al volver
  // a abrirla, la ayuda sigue ahí.
  const chat = db.createChat({
    userId: me.id,
    title: `Ayuda con: ${activity.title}`,
    context: 'homework',
    classId: activity.classId,
    activityId: activity.id
  });
  db.appendChatTurn(me.id, chat.id, {
    question: question || `¿Cómo empiezo «${activity.title}»?`,
    reply: plan,
    mode
  });

  res.json({
    plan, mode,
    chatId: chat.id,
    usage: db.usageSummary(db.getUserById(me.id))
  });
});

// El mismo plan, armado sin conexión. Genérico a propósito: sirve para
// cualquier materia y sigue sin resolver nada.
function planLocal(activity, question) {
  return [
    `Vamos con «${activity.title}». No te la voy a resolver, pero sí te la desarmo:`,
    '',
    '1. Lee la consigna dos veces y subraya el verbo que te dice qué hacer (explicar, comparar, calcular, opinar). Ese verbo manda sobre todo lo demás.',
    '2. Escribe en una línea qué te están pidiendo, con tus palabras. Si no te sale esa línea, ahí está tu duda real.',
    '3. Apunta qué datos ya tienes y cuál te falta. Lo que falta es lo que hay que buscar o calcular.',
    '4. Haz un borrador rápido, sin preocuparte de que quede bonito. Corregir es mucho más fácil que empezar.',
    '',
    question
      ? `Sobre lo que me preguntas: ¿qué parte de eso sí entiendes ya? Empecemos desde ahí.`
      : '¿Cuál de esos cuatro pasos te cuesta más? Empezamos por ese.'
  ].join('\n');
}

// ---------------------------------------------------------------------------

// Historial plano heredado. La pantalla nueva usa /api/chats, pero esto sigue
// en pie para no romper nada que ya lo estuviera llamando.
router.get('/history', requireLogin, (req, res) => {
  res.json({ history: db.getAiHistory(req.session.userId) });
});

router.delete('/history', requireLogin, (req, res) => {
  db.clearAiHistory(req.session.userId);
  db.deleteAllChats(req.session.userId);
  res.json({ ok: true });
});

router.get('/usage', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  res.json({ usage: db.usageSummary(me), plan: db.planInfoFor(me) });
});

// ---------------------------------------------------------------------------
// La conexión con Claude: ponerla, cambiarla y comprobar que funciona
// ---------------------------------------------------------------------------
// Cada cuenta pone su propia llave de la API. Se guarda en data/db.json, en
// esta computadora, y no vuelve nunca entera al navegador: lo que se ve en
// pantalla son los últimos caracteres, lo justo para reconocerla.
//
// Sin llave, Robin sigue funcionando: contesta con su modo local, que no se
// conecta a ningún lado. La llave es lo que lo hace contestar con Claude.

// ---------------------------------------------------------------------------
// La llave de la API, por cuenta: QUITADA POR AHORA.
//
// Cada quien podía pegar su propia llave de Anthropic en Configuración. Está
// apagada a propósito y de momento: para volver a encenderla se pone esto en
// true y se quita el return de rrMountAiSettings() en public/js/ai-settings.js.
// No se borró nada más —ni las rutas, ni la pantalla, ni db.setAiSettings()—
// justamente para que volver sea eso y no reescribirlo.
//
// Lo que NO cambia: la llave del servidor (ANTHROPIC_API_KEY). Robin sigue
// contestando con Claude si el servidor tiene la suya puesta, y si no, con su
// modo local. Para quien escribe en el chat no cambia nada.
const LLAVE_POR_CUENTA = false;

router.get('/settings', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const config = loadConfig();
  const suya = db.aiSettingsOf(me);
  const conexion = conexionDe(me, config);

  res.json({
    // La llave nunca sale entera, ni siquiera para su dueño.
    hasKey: Boolean((suya.key || '').trim()),
    keyHint: db.maskKey(suya.key),
    // Si el proyecto trae una llave suya, Robin ya funciona sin poner nada.
    projectKey: Boolean((config.anthropicApiKey || '').trim()),
    source: conexion.origen,
    model: suya.model || '',
    effectiveModel: conexion.model,
    models: MODELOS,
    lastTest: suya.lastTest || null,
    connected: conexion.origen !== 'ninguna',
    llavePorCuenta: LLAVE_POR_CUENTA
  });
});

router.put('/settings', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const body = req.body || {};
  const cambios = {};

  // La llave por cuenta está quitada por ahora (ver LLAVE_POR_CUENTA arriba).
  // El modelo sí se puede seguir eligiendo: eso no es un secreto de nadie.
  if (body.key !== undefined && !LLAVE_POR_CUENTA) {
    return res.status(403).json({
      error: 'Ahora mismo la llave de la API no se pone por cuenta. La pone quien administra el servidor.'
    });
  }

  if (body.key !== undefined) {
    const key = String(body.key || '').trim();
    // Una llave de Anthropic empieza por sk-ant-. Se avisa aquí en vez de
    // dejar que falle luego con un 401 que no explica nada.
    if (key && !key.startsWith('sk-ant-')) {
      return res.status(400).json({
        error: 'Esa no parece una llave de Anthropic. Empiezan por «sk-ant-».'
      });
    }
    cambios.key = key;
  }

  if (body.model !== undefined) {
    const model = String(body.model || '').trim();
    if (model && !modeloValido(model)) {
      return res.status(400).json({ error: 'Ese modelo no está en la lista.' });
    }
    cambios.model = model;
  }

  db.setAiSettings(me.id, cambios);
  const actualizado = db.getUserById(me.id);
  const suya = db.aiSettingsOf(actualizado);
  const conexion = conexionDe(actualizado, loadConfig());

  res.json({
    ok: true,
    hasKey: Boolean((suya.key || '').trim()),
    keyHint: db.maskKey(suya.key),
    model: suya.model || '',
    effectiveModel: conexion.model,
    source: conexion.origen,
    lastTest: suya.lastTest || null,
    message: cambios.key === ''
      ? 'Llave borrada. Robin vuelve a su modo local.'
      : 'Guardado. Prueba la conexión para comprobar que funciona.'
  });
});

// Una petición de verdad, la más pequeña posible, para saber si la llave sirve
// y cuánto tarda. Es lo único que contesta de verdad la pregunta «¿se envió
// bien?»: cualquier otra comprobación sería adivinar.
router.post('/test', requireLogin, async (req, res) => {
  const me = db.getUserById(req.session.userId);
  const config = loadConfig();
  const conexion = conexionDe(me, config);

  if (!conexion.key) {
    return res.status(400).json({
      error: 'Todavía no hay ninguna llave que probar.',
      hint: 'Pega tu llave de la API arriba y vuelve a intentarlo.'
    });
  }

  const empezo = Date.now();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': conexion.key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: conexion.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Responde solo: ok' }]
      })
    });

    const ms = Date.now() - empezo;
    const cuerpo = await response.text();

    if (!response.ok) {
      const resultado = {
        ok: false,
        status: response.status,
        ms,
        model: conexion.model,
        error: explicarError(response.status, cuerpo)
      };
      return res.status(200).json(db.recordAiTest(me.id, resultado));
    }

    let texto = '';
    let uso = null;
    try {
      const data = JSON.parse(cuerpo);
      const bloque = (data.content || []).find(b => b.type === 'text');
      texto = bloque ? bloque.text.trim() : '';
      uso = data.usage || null;
    } catch { /* la petición salió bien aunque no se pueda leer el cuerpo */ }

    const resultado = {
      ok: true,
      status: response.status,
      ms,
      model: conexion.model,
      source: conexion.origen,
      reply: texto,
      usage: uso
    };
    res.json(db.recordAiTest(me.id, resultado));
  } catch (err) {
    // Aquí caen los fallos de red: sin internet, DNS caído, cortafuegos.
    const resultado = {
      ok: false,
      status: 0,
      ms: Date.now() - empezo,
      model: conexion.model,
      error: `No se pudo llegar a la API de Anthropic: ${err.message}`
    };
    res.status(200).json(db.recordAiTest(me.id, resultado));
  }
});

// ---------------------------------------------------------------------------
// Las dos herramientas de documentos
// ---------------------------------------------------------------------------
// Antes eran dos páginas sueltas en /herramientas que se abrían en otra
// pestaña y no sabían quién eras. Ahora son dos modos del propio chat, como
// quien elige con qué modelo hablar: se elige «Traducir» o «Generar
// actividad», se suelta el PDF y la respuesta baja en el mismo sitio.
//
// El PDF lo lee el navegador (pdf.js) y lo vuelve a armar el navegador
// (jsPDF): aquí solo viaja texto. Un archivo nunca se guarda en el servidor.
//
// Un documento largo no cabe en una sola petición, así que se parte en trozos
// por párrafos y se manda uno detrás de otro. Cada trozo es una llamada de
// verdad a la API, así que cada trozo gasta un mensaje del día: cobrar uno
// solo por traducir cuarenta páginas sería mentirle a la barra del menú.

const TOOL_MAX_CHARS = 120000;   // ~60 páginas. Más que eso, se pide recortar
const TOOL_CHUNK = 7000;         // por petición, con margen para la respuesta

function partirTexto(texto, tope = TOOL_CHUNK) {
  const parrafos = String(texto).split(/\n\s*\n/);
  const trozos = [];
  let actual = '';

  parrafos.forEach(p => {
    // Un párrafo más largo que el tope entero se parte por frases; si ni así
    // cabe (una tabla, una lista sin puntos), se corta a lo bruto.
    if (p.length > tope) {
      if (actual) { trozos.push(actual); actual = ''; }
      let resto = p;
      while (resto.length > tope) {
        const corte = resto.lastIndexOf('. ', tope);
        const donde = corte > tope * 0.5 ? corte + 1 : tope;
        trozos.push(resto.slice(0, donde));
        resto = resto.slice(donde);
      }
      if (resto.trim()) actual = resto;
      return;
    }
    if ((actual + '\n\n' + p).length > tope) { trozos.push(actual); actual = p; }
    else actual = actual ? `${actual}\n\n${p}` : p;
  });

  if (actual.trim()) trozos.push(actual);
  return trozos.filter(t => t.trim());
}

const IDIOMAS = {
  es: 'español', en: 'inglés', fr: 'francés', pt: 'portugués',
  it: 'italiano', de: 'alemán'
};

function promptTraduccion(opciones) {
  const destino = IDIOMAS[opciones.to] || 'español';
  const origen = opciones.from && IDIOMAS[opciones.from]
    ? `Está en ${IDIOMAS[opciones.from]}.`
    : 'Detecta tú en qué idioma está.';
  return [
    `Eres un traductor profesional. Traduce al ${destino} el texto que te manden.`,
    origen,
    'Devuelve ÚNICAMENTE la traducción: sin saludos, sin explicaciones, sin comillas alrededor y sin decir "aquí tienes".',
    'Respeta los saltos de línea, la numeración, los títulos y las listas tal como vienen.',
    'No traduzcas nombres propios, fórmulas, código ni unidades.',
    'Si un fragmento ya está en el idioma de destino, déjalo tal cual.'
  ].join(' ');
}

function promptActividad(user, opciones) {
  const cantidad = Math.min(30, Math.max(1, Number(opciones.cantidad) || 10));
  const tipo = {
    mixta: 'mezcla preguntas de opción múltiple, de respuesta corta y de desarrollo',
    opcion: 'usa solo preguntas de opción múltiple con cuatro opciones (A, B, C, D)',
    corta: 'usa solo preguntas de respuesta corta',
    desarrollo: 'usa solo preguntas de desarrollo',
    verdadero: 'usa solo afirmaciones de verdadero o falso'
  }[opciones.tipo] || 'mezcla preguntas de opción múltiple, de respuesta corta y de desarrollo';

  // La hoja de respuestas es para quien da la clase. A un estudiante se le
  // entrega la actividad sola, que es justo el punto de que exista.
  const conClave = ['teacher', 'admin', 'subdirector', 'secretary'].includes(user.role);

  return [
    'Eres un docente que prepara material de clase a partir de un texto.',
    `A partir del texto que te manden, escribe una actividad de ${cantidad} preguntas.`,
    `Formato: ${tipo}.`,
    opciones.nivel ? `Va dirigida a estudiantes de nivel ${opciones.nivel}.` : '',
    'Todas las preguntas deben poder responderse con el texto: no inventes datos que no estén.',
    'Empieza con un título y una instrucción de una línea. Numera las preguntas.',
    conClave
      ? 'Al final, separada por una línea que diga exactamente "--- HOJA DE RESPUESTAS ---", incluye la respuesta de cada pregunta.'
      : 'NO incluyas las respuestas: quien la resuelve es quien la recibe.',
    'Devuelve solo la actividad, en texto plano, sin comentarios tuyos alrededor.'
  ].filter(Boolean).join(' ');
}

async function llamarConSistema(apiKey, model, system, contenido, maxTokens = 4000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: contenido }]
    })
  });

  if (!response.ok) {
    const cuerpo = await response.text();
    const err = new Error(explicarError(response.status, cuerpo));
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const bloque = (data.content || []).find(b => b.type === 'text');
  return bloque ? bloque.text.trim() : '';
}

router.post('/tool', requireLogin, async (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { tool, text, fileName } = req.body || {};
  const opciones = (req.body || {}).options || {};

  if (!['translate', 'activity'].includes(tool)) {
    return res.status(400).json({ error: 'Esa herramienta no existe.' });
  }

  const contenido = String(text || '').trim();
  if (!contenido) {
    return res.status(400).json({ error: 'No encontré texto que trabajar. Si el PDF es una foto escaneada, no trae letras que leer.' });
  }
  if (contenido.length > TOOL_MAX_CHARS) {
    return res.status(413).json({
      error: 'Ese documento es demasiado largo.',
      hint: `Puedo con unas 60 páginas de una vez (${TOOL_MAX_CHARS.toLocaleString('es')} caracteres). Pártelo y mándame una parte.`
    });
  }

  const config = loadConfig();
  const conexion = conexionDe(me, config);
  if (!conexion.key) {
    // Sin llave no hay nada que hacer: esto no se puede fingir en local como
    // se finge una charla. Se dice dónde se pone, y ya.
    return res.status(503).json({
      error: 'Para esto necesito estar conectado a Claude.',
      hint: 'Pega tu clave de la API en Configuración → Robin y vuelve a intentarlo. Todo lo demás sigue funcionando sin ella.',
      needsKey: true
    });
  }

  // Generar actividades con clave de respuestas es trabajo de quien enseña.
  // Un estudiante sí puede generarse una actividad para practicar, pero sin
  // la hoja de respuestas (ver promptActividad).
  const system = tool === 'translate'
    ? promptTraduccion(opciones)
    : promptActividad(me, opciones);

  // La actividad se arma de una sola vez aunque el texto sea largo: partirla
  // daría diez actividades sueltas en vez de una. Se recorta la fuente a lo
  // que cabe y se avisa.
  const trozos = tool === 'translate'
    ? partirTexto(contenido)
    : [contenido.slice(0, TOOL_CHUNK * 2)];
  const recortado = tool === 'activity' && contenido.length > TOOL_CHUNK * 2;

  // Se cobra por adelantado todo lo que se va a gastar. Si a mitad se acaba,
  // se devuelve lo que ya salió en vez de perderlo.
  const partes = [];
  let gastados = 0;
  let cortadoPorLimite = false;

  try {
    for (const trozo of trozos) {
      const gasto = db.consumeUsage(me.id, 'aiMessages');
      if (!gasto.ok) { cortadoPorLimite = true; break; }
      gastados++;
      partes.push(await llamarConSistema(conexion.key, conexion.model, system, trozo));
    }
  } catch (err) {
    console.error('[roboRobin][IA][herramienta]', err.message);
    return res.status(502).json({
      error: err.message,
      // Lo que sí salió no se tira: puede ser la mitad de un documento largo.
      partial: partes.join('\n\n') || null
    });
  }

  if (!partes.length) {
    return res.status(429).json({
      error: 'Ya gastaste el 100 % de tu margen con Robin por hoy.',
      hint: 'Mañana vuelves a empezar de cero.',
      upgrade: me.role === 'personal',
      usage: db.usageSummary(db.getUserById(me.id))
    });
  }

  const salida = partes.join('\n\n');
  db.logAiChat({
    userId: me.id,
    message: `[${tool === 'translate' ? 'Traducción' : 'Actividad'}] ${fileName || 'texto pegado'}`,
    response: salida.slice(0, 400)
  });

  res.json({
    tool,
    result: salida,
    fileName: fileName || null,
    chunks: trozos.length,
    spent: gastados,
    truncated: cortadoPorLimite || recortado,
    truncatedReason: cortadoPorLimite
      ? 'Se acabó tu margen de hoy a mitad del documento. Esto es lo que alcanzó a salir.'
      : (recortado ? 'El texto era muy largo: la actividad salió de la primera parte.' : null),
    usage: db.usageSummary(db.getUserById(me.id))
  });
});

// Un 401 diciendo «invalid x-api-key» no le dice nada a quien no programa.
function explicarError(status, cuerpo) {
  if (status === 401) return 'La llave no es válida o fue revocada. Revisa que la copiaste entera.';
  if (status === 403) return 'La llave es válida pero no tiene permiso para este modelo.';
  if (status === 404) return 'Ese modelo no existe o tu cuenta no lo tiene disponible.';
  if (status === 429) return 'Demasiadas peticiones seguidas, o te quedaste sin crédito. Espera un momento.';
  if (status >= 500) return 'La API de Anthropic está fallando ahora mismo. No es cosa tuya.';

  // Para lo demás se enseña lo que contestó el servidor, recortado.
  try {
    const data = JSON.parse(cuerpo);
    if (data.error && data.error.message) return data.error.message;
  } catch { /* no era JSON */ }
  return String(cuerpo || '').slice(0, 200) || `Error ${status}.`;
}

module.exports = router;
