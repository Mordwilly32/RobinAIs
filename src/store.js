// src/store.js
// ---------------------------------------------------------------------------
// Dónde se guarda la base de datos.
//
// roboRobin siempre ha trabajado igual por dentro: un objeto en memoria con
// todas las colecciones, y cada cambio llama a save(). Este archivo es lo que
// hay debajo de ese save(), y tiene dos formas de ser:
//
//   archivo    data/db.json, en esta computadora. Es lo de siempre y sigue
//              siendo lo que pasa si no configuras nada.
//
//   supabase   Postgres en la nube. Se enciende solo si existen las dos
//              variables de entorno SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
//
// El resto del programa no se entera de cuál de las dos está puesta.
//
// Cómo se guarda en Supabase
//   Cada colección es una tabla —rr_users, rr_tasks, …— con dos columnas:
//   el id y el registro entero en jsonb. Así cada usuario, cada tarea y cada
//   marca de asistencia es una fila de verdad, consultable con SQL, y no un
//   archivo gigante que se reescribe completo cada vez.
//
//   Guardar no manda todo: se compara contra lo último que se subió y solo
//   viajan las filas que cambiaron. Y no viaja en cada save() sino agrupado,
//   porque una tanda de altas son cientos de save() seguidos.
//
// Lo que NUNCA sube a Supabase
//   Las caras del pase de lista. Ver CAMPOS_QUE_NO_SUBEN: la foto de
//   reconocimiento y la huella que face-api saca de ella se quedan en el
//   navegador de quien las tomó, en IndexedDB (public/js/face-vault.js). Son
//   datos biométricos de menores de edad; no tienen por qué estar en un
//   servidor de nadie. Si una fila ya venía con ellos, se le quitan al subirla.
//
//   'profilePic' sigue en esa lista, pero por otro motivo y no por el mismo:
//   la foto de perfil SÍ se guarda ahora, solo que en Supabase Storage y no
//   aquí. Lo que no puede entrar en una fila es la imagen en base64 — la base
//   entera vive en memoria y se compara campo por campo en cada guardado, así
//   que meter fotos sería cargarlas todas en RAM para siempre. En la ficha
//   queda 'profilePicUrl', que es una línea de texto. Ver src/fotos.js.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// El interruptor para trabajar sin red: con RR_SOLO_LOCAL=1 la base es
// data/db.json pase lo que pase, aunque el .env tenga las dos variables de
// Supabase puestas.
//
// Existe porque el caso de verdad es este: alguien baja el proyecto, lo
// arranca con `npm start` y quiere que TODO se quede en su computadora —sin
// tocar la base de la nube, que es la de verdad, y sin tener que vaciar el
// .env y acordarse luego de volver a llenarlo.
const SOLO_LOCAL = process.env.RR_SOLO_LOCAL === '1';

const USA_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY) && !SOLO_LOCAL;

if (SOLO_LOCAL && SUPABASE_URL && SUPABASE_KEY) {
  console.log('[roboRobin] RR_SOLO_LOCAL=1: se guarda en data/db.json y no se toca Supabase.');
}

// Cada colección del caché y la tabla donde vive.
const TABLAS = {
  users: 'rr_users',
  schools: 'rr_schools',
  codes: 'rr_codes',
  tasks: 'rr_tasks',
  announcements: 'rr_announcements',
  classes: 'rr_classes',
  activities: 'rr_activities',
  submissions: 'rr_submissions',
  chats: 'rr_chats',
  gameScores: 'rr_game_scores',
  gameSettings: 'rr_game_settings',
  attendance: 'rr_attendance',
  aiLogs: 'rr_ai_logs'
};

const TABLA_META = 'rr_meta';

// Las caras se quedan en el dispositivo; la foto de perfil va a Storage y no a
// una fila. Ver la cabecera y src/fotos.js.
const CAMPOS_QUE_NO_SUBEN = {
  users: ['facePhoto', 'faceDescriptor', 'profilePic']
};

// Cada cuánto se agrupan los save() antes de salir a la red, en milisegundos.
// Corto para que un fallo de luz se lleve poco, largo para que una tanda de
// cien altas seguidas sea una sola subida.
const ESPERA_ANTES_DE_SUBIR = 400;

// Postgres normaliza el orden de las claves de un jsonb, así que el texto que
// devuelve al leer no es el mismo que se le mandó al escribir aunque el dato
// sea idéntico. Para comparar hay que ordenar las claves en los dos lados; sin
// esto, el primer guardado de cada arranque reescribiría la base entera.
function textoEstable(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return '[' + valor.map(textoEstable).join(',') + ']';
  const claves = Object.keys(valor).filter(k => valor[k] !== undefined).sort();
  return '{' + claves.map(k => JSON.stringify(k) + ':' + textoEstable(valor[k])).join(',') + '}';
}

// La llave de cada fila. Casi todo tiene id; los dos que no, se identifican
// por la pareja de campos que los hace únicos.
function llaveDe(coleccion, registro) {
  if (!registro || typeof registro !== 'object') return null;
  if (coleccion === 'gameScores') {
    if (registro.userId === undefined || !registro.gameId) return null;
    return `${registro.userId}::${registro.gameId}`;
  }
  if (coleccion === 'gameSettings') {
    if (!registro.scope || registro.scopeId === undefined) return null;
    return `${registro.scope}::${registro.scopeId}`;
  }
  if (registro.id === undefined || registro.id === null) return null;
  return String(registro.id);
}

function sinLoQueNoSube(coleccion, registro) {
  const fuera = CAMPOS_QUE_NO_SUBEN[coleccion];
  if (!fuera) return registro;
  const copia = { ...registro };
  for (const campo of fuera) delete copia[campo];
  return copia;
}

// ---------------------------------------------------------------------------
// Guardado en archivo — lo de siempre
// ---------------------------------------------------------------------------

const enArchivo = {
  nombre: 'archivo',
  donde: DB_FILE,

  async cargar() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) return null;
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  },

  guardar(datos) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(datos, null, 2), 'utf-8');
  }
};

// ---------------------------------------------------------------------------
// Guardado en Supabase
// ---------------------------------------------------------------------------

function clienteSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' }
  });
}

// PostgREST devuelve como mucho mil filas por petición, así que leer una tabla
// es pedirla por tramos hasta que uno venga corto.
async function leerTabla(sb, tabla) {
  const TRAMO = 1000;
  const filas = [];
  for (let desde = 0; ; desde += TRAMO) {
    const { data, error } = await sb.from(tabla).select('id,data').range(desde, desde + TRAMO - 1);
    if (error) throw new Error('No se pudo leer ' + tabla + ': ' + error.message);
    filas.push(...data);
    if (data.length < TRAMO) return filas;
  }
}

async function enTandas(lista, tamano, trabajo) {
  for (let i = 0; i < lista.length; i += tamano) {
    await trabajo(lista.slice(i, i + tamano));
  }
}

const enSupabase = {
  nombre: 'supabase',
  donde: SUPABASE_URL,
  sb: null,

  // Lo último que se sabe que está arriba: colección -> Map(id -> texto).
  // Es contra esto que se compara para mandar solo lo que cambió.
  subido: new Map(),
  metaSubida: null,

  cliente() {
    if (!this.sb) this.sb = clienteSupabase();
    return this.sb;
  },

  async cargar() {
    const sb = this.cliente();
    const datos = {};
    let filasTotales = 0;

    for (const [coleccion, tabla] of Object.entries(TABLAS)) {
      const filas = await leerTabla(sb, tabla);
      datos[coleccion] = filas.map(f => f.data);
      filasTotales += filas.length;

      const visto = new Map();
      for (const fila of filas) visto.set(String(fila.id), textoEstable(fila.data));
      this.subido.set(coleccion, visto);
    }

    const { data: meta, error } = await sb.from(TABLA_META).select('data').eq('id', 'meta').maybeSingle();
    if (error) throw new Error('No se pudo leer ' + TABLA_META + ': ' + error.message);
    if (meta) {
      datos.meta = meta.data;
      this.metaSubida = textoEstable(meta.data);
      filasTotales += 1;
    }

    return filasTotales === 0 ? null : datos;
  },

  // Sube lo que cambió desde la última vez. Si una tabla falla, su marca de
  // "esto ya está arriba" no se toca, así que el siguiente intento la vuelve a
  // mandar entera en lugar de darla por subida.
  async guardar(datos) {
    const sb = this.cliente();

    for (const [coleccion, tabla] of Object.entries(TABLAS)) {
      const ahora = new Map();
      for (const registro of datos[coleccion] || []) {
        const id = llaveDe(coleccion, registro);
        if (id === null) continue;
        ahora.set(id, textoEstable(sinLoQueNoSube(coleccion, registro)));
      }

      const antes = this.subido.get(coleccion) || new Map();
      const cambiadas = [];
      for (const [id, texto] of ahora) {
        if (antes.get(id) !== texto) cambiadas.push({ id, data: JSON.parse(texto) });
      }
      const borradas = [];
      for (const id of antes.keys()) if (!ahora.has(id)) borradas.push(id);

      if (!cambiadas.length && !borradas.length) continue;

      await enTandas(cambiadas, 200, async tanda => {
        const { error } = await sb.from(tabla).upsert(tanda, { onConflict: 'id' });
        if (error) throw new Error('No se pudo guardar en ' + tabla + ': ' + error.message);
      });
      await enTandas(borradas, 200, async tanda => {
        const { error } = await sb.from(tabla).delete().in('id', tanda);
        if (error) throw new Error('No se pudo borrar de ' + tabla + ': ' + error.message);
      });

      this.subido.set(coleccion, ahora);
    }

    const meta = textoEstable(datos.meta || {});
    if (meta !== this.metaSubida) {
      const { error } = await sb.from(TABLA_META).upsert({ id: 'meta', data: JSON.parse(meta) }, { onConflict: 'id' });
      if (error) throw new Error('No se pudo guardar en ' + TABLA_META + ': ' + error.message);
      this.metaSubida = meta;
    }
  }
};

// ---------------------------------------------------------------------------
// Lo que ve el resto del programa
// ---------------------------------------------------------------------------

const motor = USA_SUPABASE ? enSupabase : enArchivo;

// En archivo se escribe al momento, como siempre. En Supabase no se puede:
// save() se llama cientos de veces seguidas y cada una sería un viaje a la
// red, así que se apuntan y se mandan juntas un instante después.
let hayCambios = false;
let reloj = null;
let subiendo = null;
let ultimoError = null;
let leerCache = () => null;

async function subirAhora() {
  reloj = null;
  if (!hayCambios) return;
  hayCambios = false;

  const datos = leerCache();
  if (!datos) return;

  subiendo = motor.guardar(datos)
    .then(() => { ultimoError = null; })
    .catch(err => {
      ultimoError = err;
      // No se subió: vuelve a la cola. El dato sigue en memoria, así que no se
      // pierde mientras el proceso viva.
      hayCambios = true;
      console.error('[roboRobin] No se pudo guardar en Supabase:', err.message);
    })
    .finally(() => { subiendo = null; });

  await subiendo;
  if (hayCambios && !reloj) reloj = setTimeout(subirAhora, ESPERA_ANTES_DE_SUBIR * 5);
}

function guardar(datos) {
  if (!USA_SUPABASE) return motor.guardar(datos);
  hayCambios = true;
  if (!reloj && !subiendo) reloj = setTimeout(subirAhora, ESPERA_ANTES_DE_SUBIR);
}

// Espera a que no quede nada por subir. La usan el apagado y los scripts.
async function vaciar() {
  if (!USA_SUPABASE) return;
  if (reloj) { clearTimeout(reloj); reloj = null; }
  if (subiendo) await subiendo;
  if (hayCambios) await subirAhora();
}

async function cargar() {
  return motor.cargar();
}

// Solo sirve con el guardado en archivo, y existe para que el arranque local
// siga siendo lo que era: se lee en el mismo require, sin esperar a nadie.
function cargarSincrono() {
  if (USA_SUPABASE) throw new Error('Con Supabase hay que esperar a db.listo().');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

// Render, Railway y Fly avisan con SIGTERM antes de apagar el contenedor. Es la
// única oportunidad de subir lo que quedó en el aire.
function alApagar() {
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.once(senal, async () => {
      try { await vaciar(); } catch { /* ya quedó en consola */ }
      process.exit(0);
    });
  }
}

function conectar(fn) {
  leerCache = fn;
  if (USA_SUPABASE) alApagar();
}

module.exports = {
  USA_SUPABASE,
  nombre: motor.nombre,
  donde: motor.donde,
  TABLAS,
  TABLA_META,
  llaveDe,
  sinLoQueNoSube,
  textoEstable,
  DB_FILE,
  DATA_DIR,
  CAMPOS_QUE_NO_SUBEN,
  cargar,
  cargarSincrono,
  guardar,
  vaciar,
  conectar,
  clienteSupabase,
  get ultimoError() { return ultimoError; }
};

