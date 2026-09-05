// supabase/functions/robin/index.ts
// Robin, el asistente. Es la misma cabeza que tenía routes/ai.js, ahora
// corriendo como Edge Function. Funciona en dos modos:
//
//   1. Modo local (por defecto): entiende órdenes sobre tus tareas
//      («recuérdame llamar al dentista mañana», «¿qué tengo hoy?»,
//      «ya terminé el informe») y responde con consejos de estudio y
//      organización. No sale nada hacia terceros.
//
//   2. Modo conectado: si guardas el secreto ANTHROPIC_API_KEY en el
//      proyecto, las preguntas abiertas las contesta Claude. Las órdenes sobre
//      tareas se siguen resolviendo aquí, así que el organizador funciona igual
//      con o sin clave.
//
// La clave nunca llega al navegador: vive como secreto de la función.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { cors, json, preflight } from '../_shared/cors.ts';

const MODELO = Deno.env.get('AI_MODEL') ?? 'claude-sonnet-5';
const CLAVE_ANTHROPIC = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim();

type Perfil = { id: string; full_name: string; role: string; level: string | null };
type Tarea = { id: number; title: string; due: string | null; priority: string; done: boolean };

// ---------------------------------------------------------------------------
// Fechas en lenguaje natural
// ---------------------------------------------------------------------------

const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3,
  jueves: 4, viernes: 5, sabado: 6, 'sábado': 6,
};

function aISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function enDias(dias: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return d;
}

const hoyISO = () => aISO(enDias(0));

// Busca una expresión de fecha dentro del texto. Devuelve la fecha en formato
// ISO y el texto sin esa expresión, para que no acabe dentro del título.
function extraerFecha(texto: string): { due: string | null; resto: string } {
  const patrones: Array<{ re: RegExp; get: (m: RegExpMatchArray) => Date | null }> = [
    { re: /\b(?:para\s+|el\s+)?pasado\s+ma[ñn]ana\b/i, get: () => enDias(2) },
    { re: /\b(?:para\s+|el\s+)?ma[ñn]ana\b/i, get: () => enDias(1) },
    { re: /\b(?:para\s+|de\s+)?hoy\b/i, get: () => enDias(0) },
    { re: /\ben\s+(\d{1,2})\s+d[ií]as?\b/i, get: (m) => enDias(Number(m[1])) },
    { re: /\bla\s+pr[oó]xima\s+semana\b/i, get: () => enDias(7) },
    // Por si alguien escribe en inglés
    { re: /\btomorrow\b/i, get: () => enDias(1) },
    { re: /\btoday\b/i, get: () => enDias(0) },
    { re: /\bnext\s+week\b/i, get: () => enDias(7) },
    {
      re: /\b(?:para\s+|el\s+|este\s+|pr[oó]ximo\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i,
      get: (m) => {
        const objetivo = DIAS[m[1].toLowerCase()];
        const ahora = enDias(0);
        let delta = (objetivo - ahora.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // «el lunes» dicho un lunes = el siguiente
        return enDias(delta);
      },
    },
    {
      re: /\b(?:el\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/,
      get: (m) => {
        const dia = Number(m[1]);
        const mes = Number(m[2]) - 1;
        const anio = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : new Date().getFullYear();
        const d = new Date(anio, mes, dia, 12, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
      },
    },
  ];

  for (const { re, get } of patrones) {
    const m = texto.match(re);
    if (m) {
      const fecha = get(m);
      if (fecha) {
        return { due: aISO(fecha), resto: texto.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim() };
      }
    }
  }
  return { due: null, resto: texto };
}

function limpiarTitulo(texto: string): string {
  return texto
    .replace(/^\s*(?:que\s+|de\s+|a\s+)?/i, '')
    .replace(/^(?:una?\s+)?tarea\s*(?:de|:)?\s*/i, '')
    .replace(/[\s.,;:!¡¿?]+$/g, '')
    .trim();
}

const mayuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function formatoFecha(iso: string | null): string {
  if (!iso) return '';
  if (iso === hoyISO()) return 'hoy';
  if (iso === aISO(enDias(1))) return 'mañana';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------------------------------------------------------------------------
// Intenciones sobre tareas
// ---------------------------------------------------------------------------

// Ojo: en español la frase puede empezar con «¿» o «¡», así que todas las
// expresiones toleran esos signos al inicio.
const CREAR_RE = /^[¿¡\s]*(?:por favor,?\s+)?(?:me\s+)?(?:puedes\s+)?(?:agr[ée]ga(?:me)?|agregar|a[ñn]ade|a[ñn]adir|ap[uú]nta(?:me)?|an[oó]ta(?:me)?|recu[ée]rdame|recordarme|crea(?:r)?\s+(?:una\s+)?tarea|nueva\s+tarea|tarea\s*:|pendiente\s*:|add\s+(?:a\s+)?task|remind\s+me\s+to|todo\s*:)\s*[:,\-–]?\s*/i;

const LISTAR_RE = /^[¿¡\s]*(?:(?:qu[eé]|cu[aá]les)\s+(?:son\s+)?(?:mis\s+)?(?:tareas|pendientes)|qu[eé]\s+(?:tengo|hay)\b|mis\s+(?:tareas|pendientes)|mi\s+agenda|pendientes\b|list(?:a|ar|ame)?\s+(?:mis\s+)?(?:tareas|pendientes)|my\s+tasks|what.?s?\s+(?:on\s+)?my)/i;

const HECHA_RE = /^[¿¡\s]*(?:ya\s+)?(?:complet[ée]|termin[ée]|acab[ée]|hice|finalic[ée]|marca(?:r)?\s+(?:como\s+)?(?:lista|hecha|completa(?:da)?|terminada)|list[oa]\s+(?:la\s+)?(?:tarea)?|done)\s*(?:con\s+)?(?:la\s+tarea\s+)?(?:de\s+)?(.*)$/i;

const PRIORIDAD_RE = /\b(urgente|important[ea]|prioridad alta)\b/i;

type Respuesta = { reply: string; action?: { type: string; taskId?: number } | null };

async function pendientes(sb: SupabaseClient, userId: string): Promise<Tarea[]> {
  const { data } = await sb
    .from('tasks')
    .select('id, title, due, priority, done')
    .eq('user_id', userId)
    .eq('done', false)
    .order('due', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  return (data ?? []) as Tarea[];
}

async function intencionDeTarea(
  sb: SupabaseClient,
  mensaje: string,
  userId: string,
): Promise<Respuesta | null> {
  const texto = String(mensaje).trim();

  // --- Crear ---------------------------------------------------------------
  const crear = texto.match(CREAR_RE);
  if (crear) {
    let resto = texto.slice(crear[0].length);
    const priority = PRIORIDAD_RE.test(resto) ? 'alta' : 'normal';
    resto = resto.replace(PRIORIDAD_RE, ' ');
    const { due, resto: sinFecha } = extraerFecha(resto);
    const title = mayuscula(limpiarTitulo(sinFecha));

    if (!title) {
      return { reply: '¿Qué quieres que apunte? Escríbelo así: «recuérdame entregar el informe mañana».' };
    }

    const { data: tarea, error } = await sb
      .from('tasks')
      .insert({ user_id: userId, title, due, priority })
      .select('id, title')
      .single();
    if (error) return { reply: 'No pude apuntar esa tarea. Inténtalo otra vez en un momento.' };

    const cuando = due ? ` para ${formatoFecha(due)}` : '';
    const marca = priority === 'alta' ? ' La marqué como urgente.' : '';
    return {
      reply: `Listo, apunté «${tarea.title}»${cuando}.${marca}`,
      action: { type: 'task.created', taskId: tarea.id },
    };
  }

  // --- Listar --------------------------------------------------------------
  if (LISTAR_RE.test(texto)) {
    const soloHoy = /\bhoy\b/i.test(texto);
    let tareas = await pendientes(sb, userId);
    if (soloHoy) tareas = tareas.filter((t) => t.due && t.due <= hoyISO());

    if (!tareas.length) {
      return {
        reply: soloHoy
          ? 'No tienes nada pendiente para hoy. Buen momento para adelantar algo o descansar.'
          : 'Tu lista está vacía. Dime «recuérdame …» y lo apunto.',
        action: { type: 'task.listed' },
      };
    }

    const lineas = tareas.slice(0, 8).map((t) => {
      const cuando = t.due ? ` — ${formatoFecha(t.due)}` : '';
      const marca = t.priority === 'alta' ? '🔴' : '•';
      return `${marca} ${t.title}${cuando}`;
    });
    const encabezado = soloHoy
      ? 'Esto es lo de hoy:'
      : `Tienes ${tareas.length} pendiente${tareas.length === 1 ? '' : 's'}:`;
    const mas = tareas.length > 8 ? `\n…y ${tareas.length - 8} más en la lista.` : '';
    return { reply: `${encabezado}\n${lineas.join('\n')}${mas}`, action: { type: 'task.listed' } };
  }

  // --- Completar -----------------------------------------------------------
  const hecha = texto.match(HECHA_RE);
  if (hecha) {
    const aguja = limpiarTitulo(hecha[1] || '').toLowerCase();
    const abiertas = await pendientes(sb, userId);
    if (!abiertas.length) return { reply: 'No tienes tareas pendientes por marcar.' };

    const objetivo = aguja
      ? abiertas.find((t) =>
          t.title.toLowerCase().includes(aguja) || aguja.includes(t.title.toLowerCase()))
      : abiertas[0];

    if (!objetivo) {
      return { reply: `No encontré una tarea que se parezca a «${aguja}». ¿Cómo se llama exactamente?` };
    }

    await sb
      .from('tasks')
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq('id', objetivo.id);

    const quedan = abiertas.length - 1;
    return {
      reply: `¡Hecho! Taché «${objetivo.title}». ${
        quedan
          ? `Te queda${quedan === 1 ? '' : 'n'} ${quedan} pendiente${quedan === 1 ? '' : 's'}.`
          : 'Ya no te queda nada pendiente. 🎉'
      }`,
      action: { type: 'task.completed', taskId: objetivo.id },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Respuestas locales (sin clave de API)
// ---------------------------------------------------------------------------

function respuestaLocal(mensaje: string, perfil: Perfil): string {
  const texto = String(mensaje).toLowerCase();
  const suave = perfil.level === 'Parvularia' || perfil.level === 'Primaria';
  const personal = perfil.role === 'personal';

  const banco: Array<{ keys: string[]; reply: string }> = [
    {
      keys: ['hola', 'buenas', 'hey', 'hi ', 'qué tal', 'que tal'],
      reply: personal
        ? '¡Hola! Soy Robin. Puedo organizar tu día: dime «recuérdame …» y lo apunto, o pregúntame «¿qué tengo hoy?».'
        : '¡Hola! Soy Robin, tu ayudante. Pregúntame por tus tareas, una materia o cómo prepararte para un examen.',
    },
    {
      keys: ['organiz', 'planific', 'agenda', 'ordenar mi día', 'ordenar mi dia', 'productiv'],
      reply: 'Para ordenar el día me funciona esto: escribe todo lo que traes en la cabeza, marca las 3 cosas que de verdad importan hoy y agenda el resto para otro día. Dime «recuérdame …» y las voy apuntando una por una.',
    },
    {
      keys: ['matemát', 'matemat', 'suma', 'resta', 'multiplic', 'divid', 'álgebra', 'algebra', 'ecuación', 'ecuacion'],
      reply: suave
        ? 'Truco de matemáticas: dibuja los números como puntitos o figuras y cuéntalos junto conmigo. Un pasito a la vez.'
        : 'Truco de matemáticas: parte el problema en pasos pequeños, anota qué datos ya tienes y busca qué fórmula conecta esos datos con lo que te piden.',
    },
    {
      keys: ['leer', 'lectura', 'libro', 'cuento', 'resumen'],
      reply: suave
        ? 'Para leer mejor: mira los dibujos, pronuncia despacio las palabras difíciles y después de cada página pregúntate «¿qué acaba de pasar?».'
        : 'Para leer mejor: primero ojea los títulos, luego lee con calma y escribe una pregunta por sección. Se recuerda mucho más así.',
    },
    {
      keys: ['ciencia', 'experimento', 'física', 'fisica', 'química', 'quimica', 'biolog'],
      reply: 'En ciencias, escribe qué *crees* que va a pasar antes de probarlo. Comparar tu predicción con el resultado real es justo donde empieza el aprendizaje.',
    },
    {
      keys: ['tarea', 'deber', 'proyecto', 'trabajo'],
      reply: 'Divide la tarea en 3 partes, empieza por la más difícil mientras tienes la mente fresca y toma 5 minutos de descanso entre partes. Si quieres, dime «recuérdame …» y te la apunto con fecha.',
    },
    {
      keys: ['examen', 'prueba', 'estudiar', 'repasar', 'test'],
      reply: 'Técnica que funciona: explica el tema en voz alta como si se lo enseñaras a alguien. Donde te trabes, eso es exactamente lo que toca repasar.',
    },
    {
      keys: ['nervios', 'miedo', 'estrés', 'estres', 'ansi', 'preocupa', 'triste', 'cansad'],
      reply: 'Es normal sentirse así, significa que te importa. Respira despacio, recuerda una cosa que ya dominas bien y empieza por ahí. Si quieres, partimos el problema en pasos pequeños juntos.',
    },
    { keys: ['gracias', 'thank'], reply: '¡Con gusto! Aquí sigo cuando me necesites.' },
  ];

  for (const entrada of banco) {
    if (entrada.keys.some((k) => texto.includes(k))) return entrada.reply;
  }

  return personal
    ? 'Cuéntame un poco más y lo desarmamos juntos: ¿qué quieres lograr y para cuándo? También puedo apuntarlo como tarea si me dices «recuérdame …».'
    : 'Buena pregunta. Un método que casi siempre sirve: divídela en partes pequeñas, empieza por la que sí entiendes y anota exactamente dónde te trabas. ¿De qué materia se trata?';
}

// ---------------------------------------------------------------------------
// Modo conectado (opcional)
// ---------------------------------------------------------------------------

async function llamarAnthropic(
  mensaje: string,
  perfil: Perfil,
  historial: Array<{ message: string; response: string }>,
): Promise<string> {
  const quien = perfil.role === 'personal'
    ? 'una persona que usa roboRobin como asistente personal para organizar su día a día'
    : `un ${
      perfil.role === 'teacher' ? 'profesor' : perfil.role === 'admin' ? 'director' : 'estudiante'
    } de nivel "${perfil.level || 'general'}"`;

  const system = [
    'Eres Robin, el asistente integrado de roboRobin, una plataforma que usan tanto personas por su cuenta como escuelas completas.',
    `Estás hablando con ${quien}.`,
    'Responde siempre en español, con calidez y sin rodeos. Sé breve (2-4 frases salvo que pidan detalle).',
    'Cuando sea trabajo escolar, explica el razonamiento y guía; no entregues respuestas hechas de tareas calificadas.',
    'Si la persona quiere recordar algo, dile que puede escribir «recuérdame …» y tú lo apuntas en su lista de tareas.',
  ].join(' ');

  const messages: Array<{ role: string; content: string }> = [];
  historial.slice(-6).forEach((item) => {
    messages.push({ role: 'user', content: item.message });
    messages.push({ role: 'assistant', content: item.response });
  });
  messages.push({ role: 'user', content: mensaje });

  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAVE_ANTHROPIC,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODELO, max_tokens: 600, system, messages }),
  });

  if (!respuesta.ok) {
    throw new Error(`Error de la API de Anthropic (${respuesta.status}): ${await respuesta.text()}`);
  }

  const data = await respuesta.json();
  const bloque = (data.content ?? []).find((b: { type: string }) => b.type === 'text');
  return bloque ? bloque.text : 'No se me ocurrió una respuesta esta vez, ¿puedes replantear la pregunta?';
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const vuelo = preflight(req);
  if (vuelo) return vuelo;

  const autorizacion = req.headers.get('Authorization') ?? '';
  if (!autorizacion) return json({ error: 'Primero necesitas iniciar sesión.' }, 401);

  // El cliente hereda el token de quien llama, así que todo lo que lea o
  // escriba pasa por las mismas reglas de RLS que el resto de la aplicación.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: autorizacion } }, auth: { persistSession: false } },
  );

  const { data: sesion } = await sb.auth.getUser();
  const usuario = sesion?.user;
  if (!usuario) return json({ error: 'Primero necesitas iniciar sesión.' }, 401);

  let cuerpo: { message?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: 'Escribe una pregunta primero.' }, 400);
  }

  const mensaje = String(cuerpo.message ?? '').trim();
  if (!mensaje) return json({ error: 'Escribe una pregunta primero.' }, 400);

  const { data: perfil } = await sb
    .from('profiles')
    .select('id, full_name, role, level')
    .eq('id', usuario.id)
    .single();
  if (!perfil) return json({ error: 'Primero necesitas iniciar sesión.' }, 401);

  const registrar = (respuesta: string) =>
    sb.from('ai_logs').insert({ user_id: usuario.id, message: mensaje, response: respuesta });

  // Las órdenes sobre tareas se resuelven aquí mismo, con o sin clave de API.
  const intencion = await intencionDeTarea(sb, mensaje, usuario.id);
  if (intencion) {
    await registrar(intencion.reply);
    return json({ reply: intencion.reply, mode: 'local', action: intencion.action ?? null });
  }

  let reply: string;
  let mode: string;
  try {
    if (CLAVE_ANTHROPIC) {
      const { data: historial } = await sb
        .from('ai_logs')
        .select('message, response')
        .eq('user_id', usuario.id)
        .order('id', { ascending: false })
        .limit(12);
      reply = await llamarAnthropic(mensaje, perfil as Perfil, (historial ?? []).reverse());
      mode = 'live';
    } else {
      reply = respuestaLocal(mensaje, perfil as Perfil);
      mode = 'local';
    }
  } catch (err) {
    console.error('[roboRobin][IA]', err instanceof Error ? err.message : err);
    reply = respuestaLocal(mensaje, perfil as Perfil);
    mode = 'local-fallback';
  }

  await registrar(reply);
  return json({ reply, mode, action: null });
});
