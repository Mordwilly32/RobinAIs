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

async function callAnthropic(apiKey, model, message, user, history) {
  const who = user.role === 'personal'
    ? 'una persona que usa roboRobin como asistente personal para organizar su día a día'
    : `un ${user.role === 'teacher' ? 'profesor' : user.role === 'admin' ? 'director' : 'estudiante'} de nivel "${user.level || 'general'}"`;

  const systemPrompt = [
    'Eres Robin, el asistente integrado de roboRobin, una plataforma local que usan tanto personas por su cuenta como escuelas completas.',
    `Estás hablando con ${who}.`,
    'Responde siempre en español, con calidez y sin rodeos. Sé breve (2-4 frases salvo que pidan detalle).',
    'Cuando sea trabajo escolar, explica el razonamiento y guía; no entregues respuestas hechas de tareas calificadas.',
    'Si la persona quiere recordar algo, dile que puede escribir «recuérdame …» y tú lo apuntas en su lista de tareas.'
  ].join(' ');

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
    body: JSON.stringify({ model, max_tokens: 600, system: systemPrompt, messages })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de la API de Anthropic (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : 'No se me ocurrió una respuesta esta vez, ¿puedes replantear la pregunta?';
}

// ---------------------------------------------------------------------------

router.post('/chat', requireLogin, async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Escribe una pregunta primero.' });
  }

  const me = db.getUserById(req.session.userId);
  const config = loadConfig();

  // Las órdenes sobre tareas se resuelven aquí mismo, con o sin clave de API.
  const intent = parseTaskIntent(message, me.id);
  if (intent) {
    db.logAiChat({ userId: me.id, message, response: intent.reply });
    return res.json({ reply: intent.reply, mode: 'local', action: intent.action || null });
  }

  let reply;
  let mode;
  try {
    if (config.anthropicApiKey && config.anthropicApiKey.trim()) {
      reply = await callAnthropic(
        config.anthropicApiKey.trim(),
        config.aiModel || 'claude-sonnet-5',
        message,
        me,
        db.getAiHistory(me.id, 12)
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
  res.json({ reply, mode, action: null });
});

router.get('/history', requireLogin, (req, res) => {
  res.json({ history: db.getAiHistory(req.session.userId) });
});

router.delete('/history', requireLogin, (req, res) => {
  db.clearAiHistory(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
