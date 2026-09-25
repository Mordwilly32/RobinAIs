// src/llave.js
// ---------------------------------------------------------------------------
// La llave de la API de Anthropic: dónde vive, cómo se pone y cómo se
// comprueba que sirve.
//
// Antes esto estaba repartido: routes/ai.js sabía leerla y nadie sabía
// escribirla —había que parar el servidor, editar config.json a mano y volver
// a arrancar—. Aquí está lo uno y lo otro, para que la consola de
// demostración (Ctrl + Alt + Shift + R) pueda ponerla con el servidor en
// marcha y Robin empiece a contestar con Claude sin reiniciar nada.
//
// Dónde se guarda, y dónde NO:
//
//   config.json   en esta computadora, al lado del código. Está en el
//                 .gitignore, así que no se sube al repositorio.
//   el entorno    ANTHROPIC_API_KEY, que es lo único que existe en un
//                 servidor de verdad. Manda por encima del archivo.
//
//   NUNCA en la base de datos ni en Supabase. Una llave de API paga con la
//   tarjeta de alguien y no tiene por qué estar donde están los datos de la
//   escuela. Por eso tampoco sale entera hacia el navegador: de vuelta solo
//   viaja una pista («sk-ant-…4f2a»).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Los modelos entre los que se puede elegir. El identificador es el que viaja
// a la API; el nombre es para la persona.
const MODELOS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', note: 'El más capaz. El que conviene si vas a exigirle de verdad.' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'Equilibrado: rápido y barato para el uso de todos los días.' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', note: 'El más rápido y el más barato. Para respuestas cortas.' }
];
const MODELO_POR_DEFECTO = 'claude-opus-5';

function modeloValido(id) {
  return MODELOS.some(m => m.id === id);
}

// ---------------------------------------------------------------------------
// El archivo
// ---------------------------------------------------------------------------

function leerArchivo() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    // En un servidor no hay config.json, y está bien: ahí manda el entorno.
    return {};
  }
}

// Se escribe entero y con sangría: este archivo lo abre gente a mano.
function escribirArchivo(datos) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(datos, null, 2) + '\n', 'utf-8');
}

// La configuración que usa Robin, con el entorno mandando sobre el archivo.
// Es lo que antes hacía loadConfig() dentro de routes/ai.js.
function leerConfig() {
  const archivo = leerArchivo();

  return {
    ...archivo,
    anthropicApiKey: (process.env.ANTHROPIC_API_KEY || archivo.anthropicApiKey || '').trim(),
    aiModel: process.env.RR_AI_MODEL || archivo.aiModel || 'claude-sonnet-5',
    aiModelMax: process.env.RR_AI_MODEL_MAX || archivo.aiModelMax || MODELO_POR_DEFECTO
  };
}

// ---------------------------------------------------------------------------
// Qué hay puesto
// ---------------------------------------------------------------------------

function pista(key) {
  const limpia = String(key || '').trim();
  if (!limpia) return '';
  return `${limpia.slice(0, 7)}…${limpia.slice(-4)}`;
}

function estado() {
  const archivo = leerArchivo();
  const delEntorno = (process.env.ANTHROPIC_API_KEY || '').trim();
  const delArchivo = (archivo.anthropicApiKey || '').trim();
  const key = delEntorno || delArchivo;
  const config = leerConfig();

  return {
    puesta: Boolean(key),
    pista: pista(key),
    // De dónde salió, para que nadie se pregunte por qué borrar config.json no
    // la apagó: si viene del entorno, el archivo no pinta nada.
    origen: !key ? 'ninguna' : (delArchivo && delArchivo === key ? 'archivo' : 'entorno'),
    modelo: config.aiModel,
    modelos: MODELOS
  };
}

// ---------------------------------------------------------------------------
// Ponerla y quitarla
// ---------------------------------------------------------------------------

// Una llave de Anthropic empieza por sk-ant-. Se avisa aquí en vez de dejar
// que falle luego con un 401 que no explica nada.
function revisar(key) {
  const limpia = String(key == null ? '' : key).trim();
  if (limpia && !limpia.startsWith('sk-ant-')) {
    return { error: 'Esa no parece una llave de Anthropic. Empiezan por «sk-ant-».' };
  }
  if (limpia && limpia.length < 20) {
    return { error: 'Esa llave se ve cortada. Cópiala entera desde console.anthropic.com.' };
  }
  return { key: limpia };
}

// Guarda en config.json y además la pone en el entorno de este proceso.
//
// Lo segundo es lo que hace que valga YA, sin reiniciar: routes/ai.js relee la
// configuración en cada mensaje, y el entorno manda sobre el archivo — así que
// si no se tocara, una llave puesta a mano en .env seguiría ganándole a la que
// se acaba de escribir aquí y parecería que el botón no hizo nada.
function guardar({ key, model } = {}) {
  const archivo = leerArchivo();

  if (key !== undefined) {
    const revisada = revisar(key);
    if (revisada.error) return revisada;
    archivo.anthropicApiKey = revisada.key;
    process.env.ANTHROPIC_API_KEY = revisada.key;
  }

  if (model !== undefined) {
    const pedido = String(model || '').trim();
    if (pedido && !modeloValido(pedido)) {
      return { error: 'Ese modelo no está en la lista.' };
    }
    const elegido = pedido || MODELO_POR_DEFECTO;
    // Los dos, y no solo aiModel: aiModelMax es el que le toca a una cuenta
    // personal con plan Max (ver modelFor en routes/ai.js). Si se dejara sin
    // tocar, elegir Haiku aquí y seguir recibiendo Opus no tendría explicación
    // para quien acaba de elegirlo.
    archivo.aiModel = elegido;
    archivo.aiModelMax = elegido;
    process.env.RR_AI_MODEL = elegido;
    process.env.RR_AI_MODEL_MAX = elegido;
  }

  escribirArchivo(archivo);
  return { estado: estado() };
}

function quitar() {
  return guardar({ key: '' });
}

// ---------------------------------------------------------------------------
// Probarla de verdad
// ---------------------------------------------------------------------------

// La petición más pequeña que se puede hacer. Es lo único que contesta de
// verdad la pregunta «¿sirve esta llave?»: cualquier otra comprobación sería
// adivinar mirando la forma del texto.
async function probar(key, model) {
  const limpia = String(key || '').trim();
  if (!limpia) {
    return { ok: false, error: 'Todavía no hay ninguna llave que probar.' };
  }

  const modelo = modeloValido(model) ? model : MODELO_POR_DEFECTO;
  const empezo = Date.now();

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': limpia,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Responde solo: ok' }]
      })
    });

    const ms = Date.now() - empezo;
    const cuerpo = await res.text();

    if (!res.ok) {
      return { ok: false, status: res.status, ms, model: modelo, error: explicarError(res.status, cuerpo) };
    }

    let texto = '';
    try {
      const data = JSON.parse(cuerpo);
      const bloque = (data.content || []).find(b => b.type === 'text');
      texto = bloque ? bloque.text.trim() : '';
    } catch { /* salió bien aunque no se pueda leer el cuerpo */ }

    return { ok: true, status: res.status, ms, model: modelo, reply: texto };
  } catch (err) {
    // Aquí caen los fallos de red: sin internet, DNS caído, cortafuegos.
    return {
      ok: false,
      ms: Date.now() - empezo,
      model: modelo,
      error: `No se pudo llegar a la API de Anthropic: ${err.message}`
    };
  }
}

// Lo que contestó la API, dicho en cristiano. Un 401 a secas no le dice nada a
// quien acaba de pegar una llave.
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

module.exports = {
  MODELOS, MODELO_POR_DEFECTO, modeloValido,
  leerConfig, estado, guardar, quitar, probar, pista, explicarError,
  CONFIG_PATH
};
