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

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { anthropicApiKey: '', aiModel: 'claude-sonnet-5' };
  }
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
      re: /\b(?:para\s+|el\s+|este\s+|pr[oó]ximo\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i,
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
const CREATE_RE = /^[¿¡\s]*(?:por favor,?\s+)?(?:me\s+)?(?:puedes\s+)?(?:agr[ée]ga(?:me)?|agregar|a[ñn]ade|a[ñn]adir|ap[uú]nta(?:me)?|an[oó]ta(?:me)?|recu[ée]rdame|recordarme|crea(?:r)?\s+(?:una\s+)?tarea|nueva\s+tarea|tarea\s*:|pendiente\s*:|add\s+(?:a\s+)?task|remind\s+me\s+to|todo\s*:)\s*[:,\-–]?\s*/i;

const LIST_RE = /^[¿¡\s]*(?:(?:qu[eé]|cu[aá]les)\s+(?:son\s+)?(?:mis\s+)?(?:tareas|pendientes)|qu[eé]\s+(?:tengo|hay)\b|mis\s+(?:tareas|pendientes)|mi\s+agenda|pendientes\b|list(?:a|ar|ame)?\s+(?:mis\s+)?(?:tareas|pendientes)|my\s+tasks|what.?s?\s+(?:on\s+)?my)/i;

const DONE_RE = /^[¿¡\s]*(?:ya\s+)?(?:complet[ée]|termin[ée]|acab[ée]|hice|finalic[ée]|marca(?:r)?\s+(?:como\s+)?(?:lista|hecha|completa(?:da)?|terminada)|list[oa]\s+(?:la\s+)?(?:tarea)?|done)\s*(?:con\s+)?(?:la\s+tarea\s+)?(?:de\s+)?(.*)$/i;

const PRIORITY_RE = /\b(urgente|important[ea]|prioridad alta)\b/i;

function parseTaskIntent(message, userId) {
  const text = String(message).trim();

  // --- Crear -----------------------------------------------------------
  const createMatch = text.match(CREATE_RE);
  if (createMatch) {
    let rest = text.slice(createMatch[0].length);
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
    'Responde siempre en español, con calidez y sin rodeos. Sé breve (2-4 frases salvo que pidan detalle).'
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
    'Si quiere recordar algo, dile que puede escribir «recuérdame …» y tú lo apuntas en su lista de tareas.'
  ]).join(' ');
}

async function callAnthropic(apiKey, model, message, user, history, context) {
  const messages = [];
  history.slice(-6).forEach(item => {
    messages.push({ role: 'user', content: item.message });
    messages.push({ role: 'assistant', content: item.response });
  });
  messages.push({ role: 'user', content: message });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: systemPromptFor(user, context),
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Error de la API de Anthropic (${response.status}): ${errText}`);
    err.status = response.status;
    err.apiBody = errText;
    throw err;
  }

  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : 'No se me ocurrió una respuesta esta vez, ¿puedes replantear la pregunta?';
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
  try {
    const conexion = conexionDe(me, config);
    if (conexion.key) {
      reply = await callAnthropic(
        conexion.key,
        conexion.model,
        message,
        me,
        historyOf(me, chat),
        context || chat.context
      );
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
    action: null,
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
      plan = await callAnthropic(
        conexion.key, conexion.model,
        peticion, me, [], 'homework'
      );
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
    connected: conexion.origen !== 'ninguna'
  });
});

router.put('/settings', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const body = req.body || {};
  const cambios = {};

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
