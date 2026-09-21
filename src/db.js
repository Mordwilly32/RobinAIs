// src/db.js
// ---------------------------------------------------------------------------
// Toda la base de datos de roboRobin. Un caché en memoria con todas las
// colecciones, y cada cambio llamando a save() para que quede guardado.
//
// Dónde queda guardado no se decide aquí sino en src/store.js: en
// data/db.json si no hay nada configurado, o en Postgres de Supabase si
// existen SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Para todo lo que hay de
// este punto hacia abajo, las dos son lo mismo.
//
// Modelo de datos
//   users        -> cuentas. role: 'personal' | 'student' | 'teacher' |
//                   'secretary' | 'subdirector' | 'admin'
//   schools      -> escuelas inscritas. Cada una tiene DOS códigos de ingreso:
//                   uno para estudiantes y otro para profesores. Los crea el
//                   director (admin) de esa escuela.
//   codes        -> códigos nominales de un solo uso (profesorado) o de un
//                   estudiante concreto. Se emiten y se queman.
//   tasks        -> tareas/pendientes del organizador personal (cuenta personal)
//   classes      -> clases creadas por profesores
//   activities   -> actividades dentro de una clase
//   submissions  -> entregas de los estudiantes a esas actividades
//   announcements-> avisos de la escuela
//   chats        -> conversaciones con Robin (varias por persona, como en un
//                   chat de verdad: cada una con su título y sus mensajes)
//   gameScores   -> mejores marcas de cada quien en cada minijuego
//   gameSettings -> qué minijuegos quedan activos en una escuela o una clase
//   aiLogs       -> historial plano heredado; se conserva por compatibilidad
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const plans = require('./plans');
const games = require('./games');
const permissions = require('./permissions');
const store = require('./store');

const DEFAULT_ADMIN = {
  fullName: 'Robin Admin',
  email: 'admin@roborobin.local',
  password: 'Admin123!', // documentado en el README, cámbialo de inmediato
  role: 'admin'
};

const ROLES = ['personal', 'parent', 'student', 'teacher', 'secretary', 'subdirector', 'admin'];
// Universidad es el último nivel y el único que NO lleva minijuegos: a esa
// edad los retos de "arma la suma" no enseñan nada y sobran en pantalla. Todo
// lo demás —clases, asignaciones, avisos, Robin— funciona igual que en los
// otros niveles. Ver availableGamesFor().
const LEVELS = ['Parvularia', 'Primaria', 'Secundaria', 'Bachillerato', 'Universidad'];

// El código de país que viene puesto en el teléfono de la familia. El
// Salvador, que es de donde es la escuela; se cambia en cada ficha, así que
// una escuela de otro país solo lo corrige al dar de alta a su gente.
const DEFAULT_PHONE_CODE = '503';

// Alfabeto sin caracteres confusos (nada de O/0 ni I/1) para códigos que la
// gente va a dictar en voz alta o copiar a mano.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function emptyDB() {
  return {
    meta: {
      nextUserId: 1,
      nextAnnouncementId: 1,
      nextClassId: 1,
      nextActivityId: 1,
      nextSchoolId: 1,
      nextTaskId: 1,
      nextCodeId: 1,
      nextChatId: 1,
      nextSubmissionId: 1,
      nextAttendanceId: 1
    },
    users: [],
    schools: [],
    codes: [],
    tasks: [],
    announcements: [],
    classes: [],
    activities: [],
    submissions: [],
    chats: [],
    gameScores: [],
    gameSettings: [],
    attendance: [],
    aiLogs: []
  };
}

const COLLECTIONS = [
  'users', 'schools', 'codes', 'tasks', 'announcements', 'classes',
  'activities', 'submissions', 'chats', 'gameScores', 'gameSettings',
  'attendance', 'aiLogs'
];

let cache = null;

// Guardar el archivo entero una vez por cada dato que se toca sale carísimo en
// una tanda grande: fabricar una escuela de demostración son cientos de altas
// seguidas, y a archivo completo por alta la espera crecía con el tamaño de la
// base.
//
// enLote() agrupa todo eso en un solo guardado al final. Fuera de un lote,
// save() se comporta como siempre: guarda y punto.
let guardadoEnPausa = 0;
let quedoPendiente = false;

function save() {
  if (guardadoEnPausa > 0) { quedoPendiente = true; return; }
  store.guardar(cache);
}

// Ejecuta `trabajo` guardando una sola vez al terminar. Si algo falla a mitad,
// se guarda igual lo que ya se hizo: lo que queda escrito es lo que de verdad
// está en memoria, no un estado a medias inventado.
function enLote(trabajo) {
  guardadoEnPausa++;
  try {
    return trabajo();
  } finally {
    guardadoEnPausa--;
    if (guardadoEnPausa === 0 && quedoPendiente) {
      quedoPendiente = false;
      save();
    }
  }
}

// Base recién nacida.
//
// El director de fábrica solo se crea cuando la base vive en este disco. En
// Supabase no: la contraseña estaría escrita en un README público y eso no es
// una cuenta, es una puerta abierta. Allá el primer director es quien inscribe
// la primera escuela.
function estrenar() {
  cache = emptyDB();
  if (!store.USA_SUPABASE) seedAdmin();
}

function adoptar(datos) {
  cache = datos;
  migrate();
  save();
}

let listoPromesa = null;

// Espera a que la base esté cargada. Con el guardado en archivo ya lo está
// desde el require y esto devuelve de inmediato; con Supabase hay que ir a la
// red, y server.js no abre el puerto hasta que esto termine.
function listo() {
  if (!listoPromesa) {
    listoPromesa = (async () => {
      let datos = null;
      try {
        datos = await store.cargar();
      } catch (err) {
        // Sin base no se puede atender a nadie: mejor no arrancar que arrancar
        // con la memoria en blanco y empezar a escribir encima de lo que haya.
        throw new Error('No se pudo leer la base de datos de Supabase: ' + err.message);
      }

      if (datos) {
        adoptar(datos);
      } else {
        estrenar();
        save();
        console.log('[roboRobin] Base de datos de Supabase vacía: se estrena.');
        console.log('[roboRobin] La primera escuela que se inscriba crea a su director.');
      }
      await store.vaciar();
      return cache;
    })();
  }
  return listoPromesa;
}

// Arranque con el guardado en archivo: se lee aquí mismo, en el require, tal y
// como ha sido siempre.
function loadDesdeArchivo() {
  let datos = null;
  try {
    datos = store.cargarSincrono();
  } catch (err) {
    console.error('[roboRobin] No se pudo leer data/db.json, empezando de cero.', err);
  }

  if (datos) {
    adoptar(datos);
  } else {
    estrenar();
    save();
    console.log('[roboRobin] Base de datos local creada en data/db.json');
    console.log(`[roboRobin] Acceso de director por defecto -> ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`);
  }
  return cache;
}

// Pone al día bases de datos creadas con versiones anteriores sin perder nada.
function migrate() {
  const base = emptyDB();
  cache.meta = Object.assign({}, base.meta, cache.meta || {});
  COLLECTIONS.forEach(key => { cache[key] = cache[key] || []; });

  cache.users.forEach(user => {
    user.notifications = user.notifications || [];
    if (user.profilePic === undefined) user.profilePic = null;
    if (user.role === 'student' && !user.studentCode) {
      user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
    }
    // Los niveles se guardaban en inglés en versiones anteriores.
    user.level = normalizeLevel(user.level);

    // Plan de la cuenta. Solo significa algo en las cuentas personales; las de
    // escuela lo llevan en 'free' y nunca se les cobra nada.
    if (!plans.PLAN_IDS.includes(user.plan)) user.plan = 'free';
    if (!user.planCycle) user.planCycle = 'monthly';
    if (user.planSince === undefined) user.planSince = user.createdAt || new Date().toISOString();
    if (user.planRenewsAt === undefined) user.planRenewsAt = null;

    // Lo que necesita el pase de lista: el número de la persona en la lista,
    // su foto de reconocimiento y la huella que saca de ella face-api.
    if (user.role === 'student') {
      if (user.listNumber === undefined) user.listNumber = null;
      if (user.facePhoto === undefined) user.facePhoto = null;
      if (user.faceDescriptor === undefined) user.faceDescriptor = null;
      // El teléfono de la familia, para avisar cuando alguien no llegó. Se
      // guarda partido en dos —código de país y número— porque es lo que se
      // corrige por separado: el código se pone una vez y el número cambia
      // con cada persona.
      if (user.parentPhoneCode === undefined) user.parentPhoneCode = DEFAULT_PHONE_CODE;
      if (user.parentPhone === undefined) user.parentPhone = null;
    }
    // Una cuenta de familia lleva a quién acompaña.
    if (user.role === 'parent' && !Array.isArray(user.childIds)) user.childIds = [];

    // Contador diario del uso de Robin. Se reinicia solo al cambiar el día.
    if (!user.usage || typeof user.usage !== 'object') {
      user.usage = { date: todayKey(), aiMessages: 0, gameHints: 0, homeworkHelp: 0 };
    }
  });

  // El conteo de mensajes vive por día: si el archivo se guardó ayer, hoy
  // empieza de cero sin que nadie tenga que hacer nada.
  rollUsageDay();

  // Las conversaciones antiguas eran una lista plana de pregunta/respuesta.
  // Se recogen en una conversación por persona para que el historial nuevo no
  // nazca vacío.
  if (cache.aiLogs.length && !cache.chats.length) {
    const porUsuario = new Map();
    cache.aiLogs.forEach(log => {
      if (!porUsuario.has(log.userId)) porUsuario.set(log.userId, []);
      porUsuario.get(log.userId).push(log);
    });
    porUsuario.forEach((logs, userId) => {
      const messages = [];
      logs.forEach(log => {
        messages.push({ role: 'user', text: log.message, at: log.createdAt });
        messages.push({ role: 'robin', text: log.response, at: log.createdAt });
      });
      cache.chats.push({
        id: cache.meta.nextChatId++,
        userId: Number(userId),
        title: 'Conversaciones anteriores',
        context: 'general',
        messages,
        createdAt: logs[0].createdAt,
        updatedAt: logs[logs.length - 1].createdAt
      });
    });
    console.log(`[roboRobin] ${porUsuario.size} historial(es) de chat convertidos al formato nuevo.`);
  }

  // Las actividades ganaron materia y puntos.
  cache.activities.forEach(item => {
    if (item.subject === undefined) item.subject = null;
    if (item.points === undefined) item.points = 10;
    if (item.classId != null) item.classId = Number(item.classId);
  });

  cache.classes.forEach(item => {
    if (!Array.isArray(item.studentIds)) item.studentIds = [];
    if (item.subject === undefined) item.subject = null;
    if (item.archived === undefined) item.archived = false;
  });

  // Versiones anteriores guardaban "schoolCodes" (un solo código por escuela).
  // Ahora cada escuela tiene un código de estudiante y otro de profesor.
  if (Array.isArray(cache.schoolCodes) && cache.schoolCodes.length) {
    cache.schoolCodes.forEach(old => {
      const school = createSchool({
        name: old.name || 'Escuela',
        directorId: old.createdByAdminId || null,
        directorName: null,
        silent: true
      });
      cache.users.forEach(user => {
        if (user.schoolCodeId === old.id) user.schoolId = school.id;
      });
    });
  }
  delete cache.schoolCodes;

  // Si ya había cuentas de escuela pero ninguna escuela registrada (bases de
  // datos anteriores a este cambio), se agrupan en una escuela inicial para
  // que nada quede huérfano.
  const schoolUsers = cache.users.filter(u => ['student', 'teacher', 'admin'].includes(u.role));
  if (schoolUsers.length && !cache.schools.length) {
    const director = schoolUsers.find(u => u.role === 'admin');
    const school = createSchool({
      name: 'Mi Escuela',
      directorId: director ? director.id : null,
      directorName: director ? director.fullName : null,
      silent: true
    });
    schoolUsers.forEach(user => { user.schoolId = school.id; });
    console.log(`[roboRobin] Cuentas anteriores agrupadas en "${school.name}".`);
    console.log(`[roboRobin] Código de estudiantes: ${school.studentCode} · Código de profesores: ${school.teacherCode}`);
  }

  cache.schools.forEach(school => {
    if (!school.studentCode) school.studentCode = generateUniqueCode('EST');
    if (!school.teacherCode) school.teacherCode = generateUniqueCode('PRO');
  });

  cache.classes.forEach(item => {
    if (item.schoolId === undefined) {
      const teacher = cache.users.find(u => u.id === item.teacherId);
      item.schoolId = teacher ? teacher.schoolId || null : null;
    }
  });
  cache.announcements.forEach(item => {
    if (item.schoolId === undefined) {
      const author = cache.users.find(u => u.id === item.authorId);
      item.schoolId = author ? author.schoolId || null : null;
    }
    item.level = item.level === 'All Levels' ? 'Todos los niveles' : normalizeLevel(item.level);
  });
}

// Traduce los nombres de nivel en inglés que usaban versiones anteriores.
const LEVEL_ALIASES = {
  'Preschool': 'Parvularia',
  'Elementary': 'Primaria',
  'Middle School': 'Secundaria',
  'High School': 'Bachillerato',
  'University': 'Universidad',
  'College': 'Universidad'
};
function normalizeLevel(level) {
  if (!level) return level || null;
  return LEVEL_ALIASES[level] || level;
}

function seedAdmin() {
  const now = new Date().toISOString();
  cache.users.push({
    id: cache.meta.nextUserId++,
    fullName: DEFAULT_ADMIN.fullName,
    email: DEFAULT_ADMIN.email,
    passwordHash: bcrypt.hashSync(DEFAULT_ADMIN.password, 10),
    role: 'admin',
    schoolId: null, // aún no ha inscrito su escuela
    level: null,
    grade: null,
    status: 'active',
    profilePic: null,
    notifications: [],
    plan: 'free',
    planCycle: 'monthly',
    planSince: now,
    planRenewsAt: null,
    usage: { date: todayKey(), aiMessages: 0, gameHints: 0, homeworkHelp: 0 },
    // Su propia conexión con Claude. Vacía significa "usa la del proyecto"
    // (la de config.json), si es que hay alguna. Ver routes/ai.js.
    ai: { key: '', model: '', lastTest: null },
    createdAt: now
  });
}

// ---------------------------------------------------------------------------
// Activar la cuenta por correo
// ---------------------------------------------------------------------------
// Quien se apunta por su cuenta —cuenta personal, de familia, o quien inscribe
// una escuela— nace con status 'pending' y no puede entrar hasta que escriba
// el código de seis cifras que le llega al correo. Quien entra con un código
// de ingreso no pasa por aquí: de ese ya responde la escuela que le dio el
// código, y muchos estudiantes ni siquiera tienen correo.
//
// El código no se guarda. Se guarda un HMAC suyo, así que quien consiguiera
// mirar la base de datos no podría activar cuentas ajenas con lo que ve. La
// llave del HMAC es la de las sesiones: si cambia, los códigos que estuvieran
// en el aire dejan de valer, y como duran quince minutos eso no molesta a
// nadie.

const VERIFICACION_MINUTOS = 15;     // cuánto vive un código
const VERIFICACION_INTENTOS = 5;     // fallos antes de tener que pedir otro
const VERIFICACION_ENVIOS = 5;       // códigos por hora y cuenta
const VERIFICACION_ESPERA = 60;      // segundos entre un envío y el siguiente
const PENDIENTE_HORAS = 24;          // cuánto sobrevive una cuenta sin activar

// Los modos de registro que piden activar el correo.
const MODOS_QUE_VERIFICAN = ['personal', 'parent', 'school'];

function llaveHmac() {
  return process.env.SESSION_SECRET || 'roborobin-local-secret';
}

function sellar(codigo) {
  return crypto.createHmac('sha256', llaveHmac()).update(String(codigo)).digest('hex');
}

// Seis cifras, sacadas del generador de verdad y no de Math.random(): esto es
// lo único que separa una cuenta de estar activa.
function codigoDeSeis() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function necesitaVerificar(modo) {
  // La versión de GitHub Pages no tiene correo que mandar ni base que
  // proteger: la suya vive en la pestaña y se borra al cerrarla. Pedir ahí un
  // código dejaría el registro en un callejón sin salida, con la persona
  // esperando un correo que nadie puede mandar. Lo enciende rr-runtime.js, y
  // solo él: en un servidor de verdad esta variable no existe.
  if (process.env.RR_SIN_VERIFICACION === '1') return false;
  return MODOS_QUE_VERIFICAN.includes(modo);
}

// Fabrica un código nuevo y lo deja apuntado en la ficha. Devuelve el código
// en claro, que es lo único que sale de aquí y solo para metértelo en el
// correo: no se guarda en ningún lado.
function nuevoCodigoDeVerificacion(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const ahora = Date.now();
  const v = user.verificacion || { envios: 0, ultimoEnvio: null };

  // Dos frenos distintos. El de los segundos es contra el botón de "reenviar"
  // pulsado con ansiedad; el de la hora, contra quien quiera usar la cuenta
  // ajena de otro como máquina de mandarle correo.
  if (v.ultimoEnvio && ahora - Date.parse(v.ultimoEnvio) < VERIFICACION_ESPERA * 1000) {
    const faltan = Math.ceil((VERIFICACION_ESPERA * 1000 - (ahora - Date.parse(v.ultimoEnvio))) / 1000);
    return { error: 'espera', segundos: faltan };
  }

  const haceUnaHora = ahora - 60 * 60 * 1000;
  const envios = (v.primerEnvio && Date.parse(v.primerEnvio) > haceUnaHora) ? v.envios : 0;
  if (envios >= VERIFICACION_ENVIOS) {
    return { error: 'demasiados' };
  }

  const codigo = codigoDeSeis();
  user.verificacion = {
    hash: sellar(codigo),
    expira: new Date(ahora + VERIFICACION_MINUTOS * 60 * 1000).toISOString(),
    intentos: 0,
    envios: envios + 1,
    primerEnvio: envios === 0 ? new Date(ahora).toISOString() : v.primerEnvio,
    ultimoEnvio: new Date(ahora).toISOString()
  };
  save();

  return { codigo, minutos: VERIFICACION_MINUTOS };
}

// Comprueba el código. Devuelve { ok } o { error } con un motivo que la
// pantalla pueda contar en palabras.
function comprobarCodigoDeVerificacion(userId, codigo) {
  const user = getUserById(userId);
  if (!user) return { error: 'no-existe' };
  if (user.status === 'active') return { ok: true, user, yaEstaba: true };

  const v = user.verificacion;
  if (!v || !v.hash) return { error: 'sin-codigo' };
  if (Date.parse(v.expira) < Date.now()) return { error: 'vencido' };
  if (v.intentos >= VERIFICACION_INTENTOS) return { error: 'demasiados-intentos' };

  const limpio = String(codigo || '').replace(/[^0-9]/g, '');
  // timingSafeEqual sobre los dos HMAC, que miden lo mismo siempre. Comparar
  // con === filtraría por el tiempo cuántas cifras van bien.
  const esperado = Buffer.from(v.hash, 'hex');
  const recibido = Buffer.from(sellar(limpio), 'hex');
  if (limpio.length !== 6 || !crypto.timingSafeEqual(esperado, recibido)) {
    v.intentos += 1;
    save();
    const quedan = VERIFICACION_INTENTOS - v.intentos;
    return { error: 'no-coincide', quedan: Math.max(0, quedan) };
  }

  user.status = 'active';
  user.emailVerifiedAt = new Date().toISOString();
  delete user.verificacion;
  save();
  return { ok: true, user };
}

// Las cuentas que se quedaron a medias. Se borran para que el correo vuelva a
// quedar libre —si no, alguien que se equivocó al teclearlo no podría volver a
// intentarlo nunca— y para que no se acumulen.
function purgarCuentasSinActivar() {
  const limite = Date.now() - PENDIENTE_HORAS * 60 * 60 * 1000;
  const condenadas = cache.users.filter(u =>
    u.status === 'pending' && Date.parse(u.createdAt || 0) < limite);

  if (!condenadas.length) return 0;
  return enLote(() => {
    condenadas.forEach(u => deleteUser(u.id));
    return condenadas.length;
  });
}

// ---- Códigos ---------------------------------------------------------------

function randomCode(prefix, length = 4) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${out}`;
}

function codeExists(code) {
  return cache.schools.some(s => s.studentCode === code || s.teacherCode === code);
}

function generateUniqueCode(prefix) {
  let code;
  do { code = randomCode(prefix); } while (codeExists(code));
  return code;
}

// ---- Escuelas --------------------------------------------------------------

function createSchool({ name, directorId, directorName, silent }) {
  const school = {
    id: cache.meta.nextSchoolId++,
    name: name || 'Escuela sin nombre',
    directorId: directorId || null,
    directorName: directorName || null,
    studentCode: generateUniqueCode('EST'),
    teacherCode: generateUniqueCode('PRO'),
    createdAt: new Date().toISOString()
  };
  cache.schools.push(school);
  if (!silent) save();
  return school;
}

function getSchools() { return cache.schools; }

function getSchoolById(id) {
  return cache.schools.find(s => s.id === Number(id)) || null;
}

function getSchoolByDirector(userId) {
  return cache.schools.find(s => s.directorId === Number(userId)) || null;
}

// Busca una escuela por cualquiera de sus dos códigos y dice qué rol otorga.
function resolveJoinCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  const school = cache.schools.find(s => s.studentCode === clean || s.teacherCode === clean);
  if (!school) return null;
  return { school, role: school.studentCode === clean ? 'student' : 'teacher' };
}

function regenerateSchoolCode(schoolId, which) {
  const school = getSchoolById(schoolId);
  if (!school) return null;
  if (which === 'student') school.studentCode = generateUniqueCode('EST');
  else if (which === 'teacher') school.teacherCode = generateUniqueCode('PRO');
  else return null;
  save();
  return school;
}

function renameSchool(schoolId, name) {
  const school = getSchoolById(schoolId);
  if (!school) return null;
  school.name = name;
  save();
  return school;
}

function getSchoolMembers(schoolId) {
  return cache.users.filter(u => Number(u.schoolId) === Number(schoolId));
}

function schoolStats(schoolId) {
  const members = getSchoolMembers(schoolId);
  return {
    students: members.filter(u => u.role === 'student').length,
    teachers: members.filter(u => u.role === 'teacher').length,
    admins: members.filter(u => u.role === 'admin').length,
    total: members.length
  };
}

// ---- Usuarios --------------------------------------------------------------

function getAllUsers() { return cache.users; }

function getUserById(id) {
  return cache.users.find(u => u.id === Number(id)) || null;
}

function getUserByEmail(email) {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  return cache.users.find(u => u.email && u.email.toLowerCase() === normalized) || null;
}

function getUserByStudentCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return cache.users.find(u => u.studentCode === clean) || null;
}

// La edad, o null si no viene o no tiene sentido. Nunca revienta: una cuenta
// sin edad es una cuenta válida (todas las de escuela lo son).
function normalizeAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  const entero = Math.floor(n);
  return entero >= 4 && entero <= 120 ? entero : null;
}

// `passwordHash` es un atajo SOLO para la consola de demostración, que da de
// alta cientos de cuentas con la misma contraseña de mentira: calcular el hash
// una vez y reutilizarlo ahorra la mayor parte del tiempo. Una cuenta de
// verdad nunca lo pasa, y entonces se calcula aquí como siempre.
function createUser({ fullName, email, password, role, level, grade, schoolId, plan, age, passwordHash, status }) {
  const now = new Date().toISOString();
  const user = {
    id: cache.meta.nextUserId++,
    fullName,
    email: email ? String(email).trim().toLowerCase() : null,
    passwordHash: passwordHash || bcrypt.hashSync(password, 10),
    role: ROLES.includes(role) ? role : 'personal',
    schoolId: schoolId != null ? Number(schoolId) : null,
    level: normalizeLevel(level) || null,
    grade: grade || null,
    // Solo la traen las cuentas personales; en una de escuela el nivel y el
    // grado dicen lo mismo con más precisión (ver routes/auth.js).
    age: normalizeAge(age),
    // 'pending' mientras espera el código del correo; ver
    // nuevoCodigoDeVerificacion(). Con cualquier cosa que no sea 'active' no
    // se puede entrar (routes/auth.js).
    status: status === 'pending' ? 'pending' : 'active',
    profilePic: null,
    notifications: [],
    plan: plans.PLAN_IDS.includes(plan) ? plan : 'free',
    planCycle: 'monthly',
    planSince: now,
    planRenewsAt: null,
    usage: { date: todayKey(), aiMessages: 0, gameHints: 0, homeworkHelp: 0 },
    createdAt: now
  };
  if (user.role === 'student') {
    user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
    // Lo del pase de lista: número en la lista y foto de reconocimiento. Se
    // llenan después, desde la pantalla de asistencia del profesorado.
    user.listNumber = null;
    user.facePhoto = null;
    user.faceDescriptor = null;
    user.parentPhoneCode = DEFAULT_PHONE_CODE;
    user.parentPhone = null;
  }
  if (user.role === 'parent') user.childIds = [];
  cache.users.push(user);
  save();
  return user;
}

function updateUser(id, updates) {
  const user = getUserById(id);
  if (!user) return null;
  if (updates.fullName !== undefined) user.fullName = updates.fullName;
  if (updates.email !== undefined) user.email = updates.email ? String(updates.email).trim().toLowerCase() : null;
  if (updates.role !== undefined && ROLES.includes(updates.role)) {
    user.role = updates.role;
    if (user.role === 'student' && !user.studentCode) user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
  }
  if (updates.level !== undefined) user.level = normalizeLevel(updates.level);
  if (updates.grade !== undefined) user.grade = updates.grade;
  if (updates.age !== undefined) user.age = normalizeAge(updates.age);
  if (updates.status !== undefined) user.status = updates.status;
  if (updates.schoolId !== undefined) user.schoolId = updates.schoolId == null ? null : Number(updates.schoolId);
  if (updates.password) user.passwordHash = bcrypt.hashSync(updates.password, 10);
  if (updates.profilePic !== undefined) user.profilePic = updates.profilePic;
  if (updates.plan !== undefined && plans.PLAN_IDS.includes(updates.plan)) user.plan = updates.plan;
  if (updates.planCycle !== undefined) user.planCycle = updates.planCycle;
  save();
  return user;
}

function deleteUser(id) {
  const target = Number(id);
  const before = cache.users.length;
  cache.users = cache.users.filter(u => u.id !== target);
  cache.tasks = cache.tasks.filter(t => t.userId !== target);
  cache.chats = cache.chats.filter(c => c.userId !== target);
  cache.submissions = cache.submissions.filter(s => s.studentId !== target);
  cache.gameScores = cache.gameScores.filter(s => s.userId !== target);
  cache.aiLogs = cache.aiLogs.filter(l => l.userId !== target);
  // La persona sale tambien de las clases en las que estaba.
  cache.classes.forEach(item => {
    item.studentIds = (item.studentIds || []).filter(sid => sid !== target);
  });
  save();
  return cache.users.length < before;
}

function verifyPassword(user, password) {
  if (!user || !user.passwordHash || !password) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

// Lo que el navegador puede saber de una cuenta: todo menos el hash de la
// contraseña, más lo que se calcula (escuela, permisos, plan, cuánto le queda
// de Robin hoy y si le toca la interfaz de los peques).
// Calcular un hash sin crear la cuenta. La consola de demostración lo usa para
// hacerlo una sola vez y repartirlo entre todas las cuentas de la tanda.
function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function publicUser(user) {
  if (!user) return null;
  // Fuera la contraseña y fuera la llave de la API: ninguna de las dos tiene
  // por qué viajar al navegador. El estado de la conexión sí, porque es lo que
  // se enseña en la pantalla de configuración.
  const { passwordHash, ai, faceDescriptor, ...rest } = user;
  rest.hasFace = Boolean(faceDescriptor && faceDescriptor.length);
  rest.ai = {
    hasKey: Boolean(ai && ai.key),
    keyHint: maskKey(ai && ai.key),
    model: (ai && ai.model) || '',
    lastTest: (ai && ai.lastTest) || null
  };
  const school = user.schoolId ? getSchoolById(user.schoolId) : null;
  rest.schoolName = school ? school.name : null;
  rest.roleLabel = permissions.ROLE_LABEL[user.role] || user.role;
  rest.permissions = permissions.permissionsOf(user.role);
  rest.difficulty = games.difficultyFor(user);
  rest.isLittle = isLittleKid(user);
  rest.planInfo = planInfoFor(user);
  rest.usageToday = usageSummary(user);
  rest.limitPct = ['personal', 'parent'].includes(user.role)
    ? null
    : schoolLimitPct(school, limitGroupOf(user.role));
  return rest;
}

// Parvularia y los primeros grados de primaria usan una pantalla distinta:
// Robin en grande, letras grandes y casi nada más. Lo decide el nivel y el
// grado, no la edad, porque es el dato que sí tenemos.
function isLittleKid(user) {
  if (!user || user.role !== 'student') return false;
  if (user.level === 'Parvularia') return true;
  return user.level === 'Primaria' && games.difficultyFor(user) === 1;
}

// ---- La conexión con Claude de cada cuenta --------------------------------
// Cada quien pone su propia llave de la API. Se guarda en data/db.json, que no
// sale de esta computadora, y NUNCA vuelve al navegador entera: lo que se
// enseña en pantalla son los últimos cuatro caracteres, lo justo para
// reconocer cuál pusiste.
//
// Una cuenta sin llave propia usa la del proyecto (config.json) si la hay, y
// si tampoco la hay, Robin contesta en su modo local sin conectarse a nada.

function aiSettingsOf(user) {
  if (!user) return { key: '', model: '', lastTest: null };
  if (!user.ai) user.ai = { key: '', model: '', lastTest: null };
  return user.ai;
}

// Solo los últimos cuatro, y nunca la llave entera.
function maskKey(key) {
  const limpia = String(key || '').trim();
  if (!limpia) return '';
  return `${limpia.slice(0, 7)}…${limpia.slice(-4)}`;
}

function setAiSettings(userId, { key, model }) {
  const user = getUserById(userId);
  if (!user) return null;
  const ai = aiSettingsOf(user);

  if (key !== undefined) {
    ai.key = String(key || '').trim();
    // La llave cambió: lo que dijera la última prueba ya no vale para esta.
    ai.lastTest = null;
  }
  if (model !== undefined) ai.model = String(model || '').trim();

  save();
  return ai;
}

// Queda anotado cómo fue la última petición de verdad, para poder enseñar en
// pantalla si la conexión funciona sin tener que volver a probarla.
function recordAiTest(userId, resultado) {
  const user = getUserById(userId);
  if (!user) return null;
  const ai = aiSettingsOf(user);
  ai.lastTest = { at: new Date().toISOString(), ...resultado };
  save();
  return ai.lastTest;
}

// ---- Tareas (organizador personal) ----------------------------------------

function getTasks(userId) {
  return cache.tasks
    .filter(t => t.userId === Number(userId))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if (a.due) return -1;
      if (b.due) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function createTask({ userId, title, notes, due, priority, category }) {
  const task = {
    id: cache.meta.nextTaskId++,
    userId: Number(userId),
    title: String(title).trim(),
    notes: notes ? String(notes).trim() : '',
    due: due || null,               // 'YYYY-MM-DD'
    priority: ['baja', 'normal', 'alta'].includes(priority) ? priority : 'normal',
    category: category || 'General',
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  cache.tasks.push(task);
  save();
  return task;
}

function updateTask(userId, id, updates) {
  const task = cache.tasks.find(t => t.id === Number(id) && t.userId === Number(userId));
  if (!task) return null;
  if (updates.title !== undefined) task.title = String(updates.title).trim();
  if (updates.notes !== undefined) task.notes = String(updates.notes).trim();
  if (updates.due !== undefined) task.due = updates.due || null;
  if (updates.priority !== undefined && ['baja', 'normal', 'alta'].includes(updates.priority)) task.priority = updates.priority;
  if (updates.category !== undefined) task.category = updates.category || 'General';
  if (updates.done !== undefined) {
    task.done = Boolean(updates.done);
    task.completedAt = task.done ? new Date().toISOString() : null;
  }
  save();
  return task;
}

function deleteTask(userId, id) {
  const before = cache.tasks.length;
  cache.tasks = cache.tasks.filter(t => !(t.id === Number(id) && t.userId === Number(userId)));
  save();
  return cache.tasks.length < before;
}

// ---- Clases ----------------------------------------------------------------

function createClass({ teacherId, teacherName, schoolId, name, description, visibility, level }) {
  const classItem = {
    id: cache.meta.nextClassId++,
    teacherId,
    teacherName,
    schoolId: schoolId != null ? Number(schoolId) : null,
    name,
    description: description || '',
    visibility: visibility === 'private' ? 'private' : 'public',
    level: normalizeLevel(level) || null,
    joinCode: randomCode('CLS', 4).split('-')[1],
    studentIds: [],
    createdAt: new Date().toISOString()
  };
  cache.classes.push(classItem);
  save();
  return classItem;
}

function getClasses() { return cache.classes; }

function getClassById(id) {
  return cache.classes.find(item => item.id === Number(id)) || null;
}

function addStudentToClass(classId, studentId) {
  const item = getClassById(classId);
  if (!item) return null;
  if (!item.studentIds.includes(Number(studentId))) item.studentIds.push(Number(studentId));
  save();
  return item;
}

function addNotification(userId, notification) {
  const user = getUserById(userId);
  if (!user) return null;
  user.notifications = user.notifications || [];
  user.notifications.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
    createdAt: new Date().toISOString(),
    ...notification
  });
  save();
  return user.notifications[0];
}

function markNotificationRead(userId, notificationId) {
  const user = getUserById(userId);
  const item = user && (user.notifications || []).find(note => note.id === String(notificationId));
  if (!item) return false;
  item.read = true;
  save();
  return true;
}

// ---- Avisos ----------------------------------------------------------------

function getAnnouncements(schoolId) {
  return cache.announcements
    .filter(a => schoolId == null || Number(a.schoolId) === Number(schoolId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getAnnouncementsForLevel(schoolId, level) {
  return getAnnouncements(schoolId).filter(a => a.level === 'Todos los niveles' || a.level === level);
}

function createAnnouncement({ authorId, authorName, schoolId, title, content, level }) {
  const announcement = {
    id: cache.meta.nextAnnouncementId++,
    authorId,
    authorName,
    schoolId: schoolId != null ? Number(schoolId) : null,
    title,
    content,
    level,
    createdAt: new Date().toISOString()
  };
  cache.announcements.push(announcement);
  save();
  return announcement;
}

function getAnnouncementById(id) {
  return cache.announcements.find(a => a.id === Number(id)) || null;
}

function deleteAnnouncement(id) {
  const before = cache.announcements.length;
  cache.announcements = cache.announcements.filter(a => a.id !== Number(id));
  save();
  return cache.announcements.length < before;
}

// ---- Historial del chat con Robin ------------------------------------------

function logAiChat({ userId, message, response }) {
  cache.aiLogs.push({
    id: cache.aiLogs.length + 1,
    userId,
    message,
    response,
    createdAt: new Date().toISOString()
  });
  // Evita que el archivo crezca sin límite en una instalación de larga vida.
  if (cache.aiLogs.length > 500) cache.aiLogs = cache.aiLogs.slice(-500);
  save();
}

function getAiHistory(userId, limit = 30) {
  return cache.aiLogs.filter(l => l.userId === Number(userId)).slice(-limit);
}

function clearAiHistory(userId) {
  cache.aiLogs = cache.aiLogs.filter(l => l.userId !== Number(userId));
  save();
}

// ---- Estadísticas ----------------------------------------------------------

function getStats(schoolId) {
  const users = schoolId == null ? cache.users : getSchoolMembers(schoolId);
  return {
    totalUsers: users.length,
    totalAdmins: users.filter(u => u.role === 'admin').length,
    totalTeachers: users.filter(u => u.role === 'teacher').length,
    totalStudents: users.filter(u => u.role === 'student').length,
    activeUsers: users.filter(u => u.status === 'active').length,
    inactiveUsers: users.filter(u => u.status === 'inactive').length,
    byLevel: LEVELS.map(level => ({
      level,
      count: users.filter(u => u.role === 'student' && u.level === level).length
    }))
  };
}

// ---- Actividades -----------------------------------------------------------

function getActivitiesForClass(classId) {
  return cache.activities
    .filter(a => a.classId === Number(classId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createActivity({ classId, title, description, dueDate }) {
  const activity = {
    id: cache.meta.nextActivityId++,
    classId: Number(classId),
    title,
    description: description || '',
    dueDate: dueDate || null,
    createdAt: new Date().toISOString()
  };
  cache.activities.push(activity);
  save();
  return activity;
}

// ---- Límite diario de Robin y planes ---------------------------------------
// Robin no es infinito. Cada cuenta tiene una bolsa diaria de mensajes, de
// pistas de minijuego y de "explícame esta tarea paso a paso". La bolsa se
// vacía y se vuelve a llenar sola cada día: no hay ninguna tarea programada
// corriendo por detrás, simplemente se compara la fecha guardada con la de hoy.

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rollUsageDay() {
  const hoy = todayKey();
  let cambio = false;
  cache.users.forEach(user => {
    if (!user.usage || user.usage.date !== hoy) {
      user.usage = { date: hoy, aiMessages: 0, gameHints: 0, homeworkHelp: 0 };
      cambio = true;
    }
  });
  return cambio;
}

// Los límites de una cuenta. Las de escuela no pagan nada, así que van con los
// números del plan gratis pero con más margen: el trabajo escolar no se hace
// en 25 mensajes.
//
// Este es el 100 %: el punto de partida de cualquier escuela.
const SCHOOL_LIMITS = { aiMessages: 60, gameHints: 15, homeworkHelp: 15 };

// La dirección puede subir ese margen desde su panel, por separado para
// estudiantado, profesorado y dirección. Se guarda en porcentaje y no en
// cifras: es lo que se ve en pantalla, así que es lo que conviene guardar —
// si mañana cambia SCHOOL_LIMITS, lo que la escuela decidió sigue valiendo.
const SCHOOL_LIMIT_GROUPS = ['student', 'teacher', 'staff'];
const SCHOOL_LIMIT_MIN = 100;   // nunca por debajo del punto de partida
const SCHOOL_LIMIT_MAX = 500;   // cinco veces: más que de sobra para una clase

// A qué grupo de margen pertenece un rol. Subdirección y secretaría cuentan
// como dirección: hacen el mismo trabajo y gastan a Robin igual.
function limitGroupOf(role) {
  if (role === 'student') return 'student';
  if (role === 'teacher') return 'teacher';
  if (permissions.isStaff(role)) return 'staff';
  return null;
}

// El porcentaje que tiene puesto una escuela para un grupo. Sin nada guardado,
// el 100 %: el punto de partida de siempre.
function schoolLimitPct(school, group) {
  const guardado = school && school.aiLimits && school.aiLimits[group];
  const n = Number(guardado);
  if (!Number.isFinite(n)) return SCHOOL_LIMIT_MIN;
  return Math.min(SCHOOL_LIMIT_MAX, Math.max(SCHOOL_LIMIT_MIN, Math.round(n)));
}

function limitsFor(user) {
  if (!user) return SCHOOL_LIMITS;
  // Una cuenta de familia tampoco pertenece a ninguna escuela, así que su
  // margen sale de su plan igual que el de una cuenta personal.
  if (user.role === 'personal' || user.role === 'parent') {
    const plan = plans.getPlan(user.plan);
    return plan.limits;
  }
  // El profesorado y la dirección usan a Robin para preparar clase, no para
  // estudiar: parten del mismo margen amplio que el estudiantado, y a partir
  // de ahí manda lo que haya decidido su escuela.
  const group = limitGroupOf(user.role);
  const school = user.schoolId ? getSchoolById(user.schoolId) : null;
  const pct = group ? schoolLimitPct(school, group) : SCHOOL_LIMIT_MIN;
  if (pct === 100) return SCHOOL_LIMITS;

  const factor = pct / 100;
  return {
    aiMessages: Math.round(SCHOOL_LIMITS.aiMessages * factor),
    gameHints: Math.round(SCHOOL_LIMITS.gameHints * factor),
    homeworkHelp: Math.round(SCHOOL_LIMITS.homeworkHelp * factor)
  };
}

// Los tres porcentajes de una escuela, ya normalizados. Es lo que dibuja el
// panel de dirección.
function schoolAiLimits(schoolId) {
  const school = getSchoolById(schoolId);
  const out = {};
  SCHOOL_LIMIT_GROUPS.forEach(g => { out[g] = schoolLimitPct(school, g); });
  return out;
}

// Guarda los porcentajes que eligió la dirección. Solo toca los grupos que
// vengan en la petición, y siempre dentro del rango permitido: un 900 %
// escrito a mano en la petición no puede colarse.
function setSchoolAiLimits(schoolId, cambios) {
  const school = getSchoolById(schoolId);
  if (!school) return null;
  if (!school.aiLimits) school.aiLimits = {};

  SCHOOL_LIMIT_GROUPS.forEach(g => {
    if (cambios[g] === undefined || cambios[g] === null || cambios[g] === '') return;
    const n = Number(cambios[g]);
    if (!Number.isFinite(n)) return;
    school.aiLimits[g] = Math.min(SCHOOL_LIMIT_MAX, Math.max(SCHOOL_LIMIT_MIN, Math.round(n)));
  });

  save();
  return schoolAiLimits(school.id);
}

// Cuánto le queda hoy a alguien, en el formato que dibuja la barrita del menú.
function usageSummary(user) {
  const hoy = todayKey();
  const usage = user.usage && user.usage.date === hoy
    ? user.usage
    : { date: hoy, aiMessages: 0, gameHints: 0, homeworkHelp: 0 };
  const limits = limitsFor(user);

  const linea = key => {
    const limit = limits[key] === undefined ? -1 : limits[key];
    const used = usage[key] || 0;
    return {
      used,
      limit,
      left: limit < 0 ? -1 : Math.max(0, limit - used),
      unlimited: limit < 0
    };
  };

  return {
    date: hoy,
    aiMessages: linea('aiMessages'),
    gameHints: linea('gameHints'),
    homeworkHelp: linea('homeworkHelp')
  };
}

// Gasta un uso. Devuelve { ok, left, limit }. Si ok es false, quien llama
// tiene que contestar con el mensaje de "hasta mañana" en lugar de trabajar.
function consumeUsage(userId, key) {
  const user = getUserById(userId);
  if (!user) return { ok: false, left: 0, limit: 0 };

  const hoy = todayKey();
  if (!user.usage || user.usage.date !== hoy) {
    user.usage = { date: hoy, aiMessages: 0, gameHints: 0, homeworkHelp: 0 };
  }

  const limits = limitsFor(user);
  const limit = limits[key] === undefined ? -1 : limits[key];
  if (limit >= 0 && (user.usage[key] || 0) >= limit) {
    return { ok: false, left: 0, limit, unlimited: false };
  }

  user.usage[key] = (user.usage[key] || 0) + 1;
  save();
  return {
    ok: true,
    left: limit < 0 ? -1 : Math.max(0, limit - user.usage[key]),
    limit,
    unlimited: limit < 0
  };
}

// La ficha del plan de una cuenta, ya con precio y límites resueltos.
function planInfoFor(user) {
  const plan = plans.getPlan(user && user.role === 'personal' ? user.plan : 'free');
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    accent: plan.accent,
    cycle: user ? user.planCycle || 'monthly' : 'monthly',
    since: user ? user.planSince : null,
    renewsAt: user ? user.planRenewsAt : null,
    limits: limitsFor(user),
    appliesToAccount: !user || user.role === 'personal'
  };
}

// Cambiar de plan. En una instalación local no hay cobro de verdad: se guarda
// la elección y la fecha de la próxima renovación para que la pantalla de
// planes diga la verdad sobre lo que está activo.
function setPlan(userId, planId, cycleId) {
  const user = getUserById(userId);
  if (!user) return null;
  if (!plans.PLAN_IDS.includes(planId)) return null;

  const cycle = plans.CYCLES.find(c => c.id === cycleId) || plans.CYCLES[0];
  const ahora = new Date();
  const renueva = new Date(ahora);
  renueva.setMonth(renueva.getMonth() + cycle.months);

  user.plan = planId;
  user.planCycle = cycle.id;
  user.planSince = ahora.toISOString();
  user.planRenewsAt = planId === 'free' ? null : renueva.toISOString();
  save();
  return user;
}

// ---- Códigos de ingreso nominales ------------------------------------------
// Además de los dos códigos permanentes de la escuela, dirección y profesorado
// pueden emitir códigos con nombre y apellido:
//
//   teacher  un solo uso, lo emite dirección o subdirección para contratar a
//            una persona concreta. En cuanto se usa, se quema.
//   student  un solo uso, lo emite quien lleve el grupo para dar de alta a un
//            estudiante concreto (con su nivel y grado ya puestos).
//
// Secretaría puede emitir los de estudiante pero NUNCA los de profesor: eso lo
// comprueba la ruta con src/permissions.js.

const CODE_PREFIX = { teacher: 'PRO', student: 'EST' };

function nominalCodeExists(code) {
  return cache.codes.some(c => c.code === code) || codeExists(code);
}

function createJoinCode({ type, schoolId, createdBy, createdByName, forName, level, grade, classId, note }) {
  if (!CODE_PREFIX[type]) return null;

  let code;
  do { code = randomCode(CODE_PREFIX[type], 5); } while (nominalCodeExists(code));

  const item = {
    id: cache.meta.nextCodeId++,
    code,
    type,
    schoolId: schoolId != null ? Number(schoolId) : null,
    createdBy: createdBy != null ? Number(createdBy) : null,
    createdByName: createdByName || null,
    forName: forName ? String(forName).trim() : null,
    level: type === 'student' ? normalizeLevel(level) || null : null,
    grade: type === 'student' ? grade || null : null,
    classId: classId != null ? Number(classId) : null,
    note: note ? String(note).trim() : '',
    maxUses: 1,               // siempre de un solo uso: es su razón de ser
    uses: 0,
    usedByUserId: null,
    usedAt: null,
    revoked: false,
    createdAt: new Date().toISOString()
  };
  cache.codes.push(item);
  save();
  return item;
}

function getCodesForSchool(schoolId, { type, createdBy } = {}) {
  return cache.codes
    .filter(c =>
      (schoolId == null || Number(c.schoolId) === Number(schoolId)) &&
      (!type || c.type === type) &&
      (createdBy == null || Number(c.createdBy) === Number(createdBy)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getJoinCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return cache.codes.find(c => c.code === clean) || null;
}

// ¿Este código sirve todavía? Devuelve el motivo exacto cuando no, porque
// "código incorrecto" a secas deja a la persona sin saber a quién preguntarle.
function checkJoinCode(code) {
  const item = getJoinCode(code);
  if (!item) return { ok: false, reason: 'no-existe' };
  if (item.revoked) return { ok: false, reason: 'anulado', code: item };
  if (item.uses >= item.maxUses) return { ok: false, reason: 'usado', code: item };
  return { ok: true, code: item, school: getSchoolById(item.schoolId) };
}

function burnJoinCode(codeId, userId) {
  const item = cache.codes.find(c => c.id === Number(codeId));
  if (!item) return null;
  item.uses += 1;
  item.usedByUserId = Number(userId);
  item.usedAt = new Date().toISOString();
  save();
  return item;
}

function revokeJoinCode(codeId) {
  const item = cache.codes.find(c => c.id === Number(codeId));
  if (!item) return null;
  item.revoked = true;
  save();
  return item;
}

// ---- Conversaciones con Robin ----------------------------------------------
// Ya no es una lista plana: cada conversación tiene su título, su contexto
// (general, una clase, una tarea o un minijuego) y sus mensajes, igual que
// cualquier chat al que la gente ya está acostumbrada.

function createChat({ userId, title, context, classId, activityId, gameId }) {
  const now = new Date().toISOString();
  const chat = {
    id: cache.meta.nextChatId++,
    userId: Number(userId),
    title: title ? String(title).slice(0, 80) : 'Conversación nueva',
    context: context || 'general',
    classId: classId != null ? Number(classId) : null,
    activityId: activityId != null ? Number(activityId) : null,
    gameId: gameId || null,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
  cache.chats.push(chat);
  save();
  return chat;
}

function getChats(userId) {
  return cache.chats
    .filter(c => c.userId === Number(userId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// La lista del menú lateral: sin los mensajes, que ahí no caben.
function chatSummary(chat) {
  const last = chat.messages[chat.messages.length - 1];
  return {
    id: chat.id,
    title: chat.title,
    context: chat.context,
    classId: chat.classId,
    activityId: chat.activityId,
    gameId: chat.gameId,
    messageCount: chat.messages.length,
    preview: last ? String(last.text).slice(0, 90) : '',
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt
  };
}

function getChat(userId, chatId) {
  return cache.chats.find(c => c.id === Number(chatId) && c.userId === Number(userId)) || null;
}

// Guarda un turno completo. El título se pone solo con la primera pregunta:
// es lo que la persona reconoce después en la lista.
function appendChatTurn(userId, chatId, { question, reply, mode }) {
  const chat = getChat(userId, chatId);
  if (!chat) return null;
  const now = new Date().toISOString();

  chat.messages.push({ role: 'user', text: question, at: now });
  chat.messages.push({ role: 'robin', text: reply, at: now, mode: mode || 'local' });

  if (chat.title === 'Conversación nueva' || !chat.title) {
    chat.title = String(question).replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  chat.updatedAt = now;
  save();
  return chat;
}

function renameChat(userId, chatId, title) {
  const chat = getChat(userId, chatId);
  if (!chat) return null;
  chat.title = String(title || '').trim().slice(0, 80) || chat.title;
  save();
  return chat;
}

function deleteChat(userId, chatId) {
  const before = cache.chats.length;
  cache.chats = cache.chats.filter(c => !(c.id === Number(chatId) && c.userId === Number(userId)));
  save();
  return cache.chats.length < before;
}

function deleteAllChats(userId) {
  cache.chats = cache.chats.filter(c => c.userId !== Number(userId));
  cache.aiLogs = cache.aiLogs.filter(l => l.userId !== Number(userId));
  save();
  return true;
}

// Los planes guardan el historial distintos días. Lo viejo se va solo, sin que
// nadie tenga que acordarse de limpiar.
function pruneChatHistory(user) {
  const dias = plans.limitFor(user, 'historyDays');
  if (dias < 0) return 0;
  const corte = Date.now() - dias * 86400000;
  const before = cache.chats.length;
  cache.chats = cache.chats.filter(c =>
    c.userId !== Number(user.id) || new Date(c.updatedAt).getTime() >= corte);
  const borrados = before - cache.chats.length;
  if (borrados) save();
  return borrados;
}

// ---- Minijuegos: qué está activo y quién va ganando ------------------------
// Un ajuste vive en un ámbito: 'school' (lo pone dirección) o 'class' (lo pone
// quien da esa clase). Una cuenta personal no tiene ámbito: los tiene todos
// desbloqueados y no hay nada que apagar.

function gameSettingKey(scope, scopeId) {
  return cache.gameSettings.find(s => s.scope === scope && Number(s.scopeId) === Number(scopeId)) || null;
}

function getDisabledGames(scope, scopeId) {
  const item = gameSettingKey(scope, scopeId);
  return item ? item.disabled.slice() : [];
}

function setGameEnabled(scope, scopeId, gameId, enabled) {
  if (!games.GAME_IDS.includes(gameId)) return null;
  let item = gameSettingKey(scope, scopeId);
  if (!item) {
    item = { scope, scopeId: Number(scopeId), disabled: [], updatedAt: null };
    cache.gameSettings.push(item);
  }
  item.disabled = item.disabled.filter(id => id !== gameId);
  if (!enabled) item.disabled.push(gameId);
  item.updatedAt = new Date().toISOString();
  save();
  return item;
}

// Los minijuegos que esta persona puede abrir ahora mismo.
//
//   personal  todos, siempre. Es parte de lo que ofrece la cuenta personal.
//   escuela   los que no haya apagado la dirección ni ninguna de sus clases.
//             Si una clase lo apagó, se apagó para quien esté en esa clase.
function availableGamesFor(user) {
  const todos = games.catalog();

  // La universidad no tiene minijuegos, ni para el estudiantado ni para una
  // cuenta personal que diga estar en ese nivel. No es que se los apaguen:
  // es que a esa altura no vienen al caso, y se dice tal cual.
  if (user && user.level === 'Universidad') {
    return [];
  }

  if (!user || user.role !== 'student') {
    return todos.map(g => ({ ...g, enabled: true, disabledBy: null }));
  }

  const apagadosEscuela = user.schoolId ? getDisabledGames('school', user.schoolId) : [];
  const misClases = cache.classes.filter(c => (c.studentIds || []).includes(user.id));
  const apagadosClase = new Map();
  misClases.forEach(item => {
    getDisabledGames('class', item.id).forEach(gameId => {
      if (!apagadosClase.has(gameId)) apagadosClase.set(gameId, item.name);
    });
  });

  return todos.map(g => {
    if (apagadosEscuela.includes(g.id)) {
      return { ...g, enabled: false, disabledBy: 'la dirección de tu escuela' };
    }
    if (apagadosClase.has(g.id)) {
      return { ...g, enabled: false, disabledBy: `tu clase de ${apagadosClase.get(g.id)}` };
    }
    return { ...g, enabled: true, disabledBy: null };
  });
}

function canPlayGame(user, gameId) {
  const item = availableGamesFor(user).find(g => g.id === gameId);
  return item ? item.enabled : false;
}

// Marca de una persona en un minijuego: racha actual, mejor racha y aciertos.
function scoreFor(userId, gameId) {
  let item = cache.gameScores.find(s => s.userId === Number(userId) && s.gameId === gameId);
  if (!item) {
    item = {
      userId: Number(userId), gameId,
      plays: 0, correct: 0, streak: 0, bestStreak: 0,
      hintsUsed: 0, lastPlayedAt: null
    };
    cache.gameScores.push(item);
  }
  return item;
}

function recordGameResult(userId, gameId, { correct, usedHint }) {
  const item = scoreFor(userId, gameId);
  item.plays += 1;
  if (usedHint) item.hintsUsed += 1;
  if (correct) {
    item.correct += 1;
    item.streak += 1;
    if (item.streak > item.bestStreak) item.bestStreak = item.streak;
  } else {
    item.streak = 0;
  }
  item.lastPlayedAt = new Date().toISOString();
  save();
  return item;
}

function getGameScores(userId) {
  return cache.gameScores.filter(s => s.userId === Number(userId));
}

// ---- Entregas de actividades -----------------------------------------------

function getSubmission(activityId, studentId) {
  return cache.submissions.find(s =>
    s.activityId === Number(activityId) && s.studentId === Number(studentId)) || null;
}

function getSubmissionsForActivity(activityId) {
  return cache.submissions.filter(s => s.activityId === Number(activityId));
}

function saveSubmission({ activityId, studentId, text }) {
  let item = getSubmission(activityId, studentId);
  const now = new Date().toISOString();
  if (!item) {
    item = {
      id: cache.meta.nextSubmissionId++,
      activityId: Number(activityId),
      studentId: Number(studentId),
      text: '',
      grade: null,
      feedback: '',
      submittedAt: now,
      updatedAt: now
    };
    cache.submissions.push(item);
  }
  item.text = String(text || '').trim();
  item.updatedAt = now;
  save();
  return item;
}

function gradeSubmission(submissionId, { grade, feedback }) {
  const item = cache.submissions.find(s => s.id === Number(submissionId));
  if (!item) return null;
  if (grade !== undefined) item.grade = grade === null || grade === '' ? null : Number(grade);
  if (feedback !== undefined) item.feedback = String(feedback || '').trim();
  item.updatedAt = new Date().toISOString();
  save();
  return item;
}

// ---- Clases y actividades: consultas que faltaban ---------------------------

function getClassesForTeacher(teacherId) {
  return cache.classes.filter(c => c.teacherId === Number(teacherId) && !c.archived);
}

function getClassesForStudent(studentId) {
  return cache.classes.filter(c => (c.studentIds || []).includes(Number(studentId)));
}

function getClassesForSchool(schoolId) {
  return cache.classes.filter(c => schoolId == null || Number(c.schoolId) === Number(schoolId));
}

function getClassByJoinCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return cache.classes.find(c => String(c.joinCode).toUpperCase() === clean) || null;
}

function removeStudentFromClass(classId, studentId) {
  const item = getClassById(classId);
  if (!item) return null;
  item.studentIds = (item.studentIds || []).filter(id => id !== Number(studentId));
  save();
  return item;
}

function updateClass(classId, updates) {
  const item = getClassById(classId);
  if (!item) return null;
  if (updates.name !== undefined) item.name = String(updates.name).trim() || item.name;
  if (updates.description !== undefined) item.description = String(updates.description || '').trim();
  if (updates.subject !== undefined) item.subject = updates.subject || null;
  if (updates.level !== undefined) item.level = normalizeLevel(updates.level);
  if (updates.visibility !== undefined) item.visibility = updates.visibility === 'private' ? 'private' : 'public';
  if (updates.archived !== undefined) item.archived = Boolean(updates.archived);
  save();
  return item;
}

function deleteClass(classId) {
  const id = Number(classId);
  const before = cache.classes.length;
  cache.classes = cache.classes.filter(c => c.id !== id);
  const actividades = cache.activities.filter(a => a.classId === id).map(a => a.id);
  cache.activities = cache.activities.filter(a => a.classId !== id);
  cache.submissions = cache.submissions.filter(s => !actividades.includes(s.activityId));
  cache.gameSettings = cache.gameSettings.filter(s => !(s.scope === 'class' && Number(s.scopeId) === id));
  save();
  return cache.classes.length < before;
}

function getActivityById(id) {
  return cache.activities.find(a => a.id === Number(id)) || null;
}

// Todas las asignaciones que le tocan a un estudiante, de todas sus clases,
// ya con el nombre de la clase y su entrega pegados: es exactamente lo que
// necesita dibujar la pantalla de "mis asignaciones".
function getAssignmentsForStudent(studentId) {
  const misClases = getClassesForStudent(studentId);
  const porClase = new Map(misClases.map(c => [c.id, c]));

  return cache.activities
    .filter(a => porClase.has(a.classId))
    .map(a => {
      const clase = porClase.get(a.classId);
      const entrega = getSubmission(a.id, studentId);
      return {
        ...a,
        className: clase.name,
        classSubject: clase.subject,
        teacherName: clase.teacherName,
        submission: entrega
          ? { id: entrega.id, text: entrega.text, grade: entrega.grade, feedback: entrega.feedback, updatedAt: entrega.updatedAt }
          : null
      };
    })
    .sort((a, b) => {
      // Primero lo que vence antes; lo que no tiene fecha, al final.
      if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function updateActivity(id, updates) {
  const item = getActivityById(id);
  if (!item) return null;
  if (updates.title !== undefined) item.title = String(updates.title).trim() || item.title;
  if (updates.description !== undefined) item.description = String(updates.description || '').trim();
  if (updates.dueDate !== undefined) item.dueDate = updates.dueDate || null;
  if (updates.subject !== undefined) item.subject = updates.subject || null;
  if (updates.points !== undefined) item.points = Number(updates.points) || 0;
  save();
  return item;
}

function deleteActivity(id) {
  const target = Number(id);
  const before = cache.activities.length;
  cache.activities = cache.activities.filter(a => a.id !== target);
  cache.submissions = cache.submissions.filter(s => s.activityId !== target);
  save();
  return cache.activities.length < before;
}

// ---- La escuela por dentro --------------------------------------------------

function getSchoolStaff(schoolId) {
  return getSchoolMembers(schoolId).filter(u => permissions.isStaff(u.role));
}

// Los estudiantes que de verdad le tocan a un profesor: los de sus clases.
function getStudentsOfTeacher(teacherId) {
  const misClases = getClassesForTeacher(teacherId);
  const ids = new Set();
  misClases.forEach(c => (c.studentIds || []).forEach(id => ids.add(id)));
  return cache.users.filter(u => ids.has(u.id));
}

function teacherTeachesStudent(teacherId, studentId) {
  return getClassesForTeacher(teacherId).some(c => (c.studentIds || []).includes(Number(studentId)));
}

// Una cuenta personal que acepta la invitación de un profesor se convierte en
// estudiante de esa escuela. Conserva TODO lo suyo: sus pendientes, sus
// conversaciones con Robin y el plan que haya pagado.
function convertPersonalToStudent(userId, schoolId, { level, grade } = {}) {
  const user = getUserById(userId);
  if (!user || user.role !== 'personal') return null;
  user.role = 'student';
  user.schoolId = Number(schoolId);
  user.level = normalizeLevel(level) || user.level || 'Secundaria';
  user.grade = grade || user.grade || null;
  if (!user.studentCode) user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
  save();
  return user;
}

// ---------------------------------------------------------------------------
// Pase de lista
// ---------------------------------------------------------------------------
// Una marca por persona y por día. Se puede poner a mano o dejar que la ponga
// la cámara: el navegador compara la cara que ve con las fotos que el profesor
// guardó EN ESE APARATO, y cuando reconoce a alguien manda su id aquí. Lo
// único que llega al servidor es el id; la cara no sale del navegador.
//
// Parvularia se queda fuera a propósito: a esa edad el pase de lista lo hace
// la maestra mirando, no una cámara. Ver ATTENDANCE_LEVELS.

const ATTENDANCE_LEVELS = ['Primaria', 'Secundaria', 'Bachillerato', 'Universidad'];
const ATTENDANCE_STATUS = ['present', 'late', 'absent'];

function attendanceAllowed(user) {
  return Boolean(user) && user.role === 'student' && ATTENDANCE_LEVELS.includes(normalizeLevel(user.level));
}

// La foto de reconocimiento y su huella ya no se guardan aquí: viven en el
// navegador del aparato donde se pasa lista (public/js/face-vault.js). Ver la
// nota de arriba y CAMPOS_QUE_NO_SUBEN en src/store.js.

// El teléfono de la familia. El número se guarda solo con dígitos —los
// espacios y guiones que escriba cada quien no son parte del número— y el
// código de país sin el "+", que se pinta en pantalla.
function setStudentContact(studentId, { parentPhoneCode, parentPhone }) {
  const user = getUserById(studentId);
  if (!user || user.role !== 'student') return null;

  if (parentPhoneCode !== undefined) {
    const code = String(parentPhoneCode || '').replace(/[^0-9]/g, '').slice(0, 4);
    user.parentPhoneCode = code || DEFAULT_PHONE_CODE;
  }
  if (parentPhone !== undefined) {
    const num = String(parentPhone || '').replace(/[^0-9]/g, '').slice(0, 15);
    user.parentPhone = num || null;
  }
  save();
  return user;
}

function setStudentListNumber(studentId, number) {
  const user = getUserById(studentId);
  if (!user || user.role !== 'student') return null;
  const n = Number(number);
  user.listNumber = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  save();
  return user;
}

function findAttendance(studentId, date, classId) {
  return cache.attendance.find(r =>
    r.studentId === Number(studentId)
    && r.date === date
    && Number(r.classId || 0) === Number(classId || 0)
  ) || null;
}

// Poner (o corregir) la marca de alguien en un día. Reescribe la que ya
// hubiera en vez de apilar otra: un día tiene un solo estado.
function markAttendance({ studentId, classId, schoolId, date, status, method, byId, byName }) {
  const student = getUserById(studentId);
  if (!student || student.role !== 'student') return null;

  const dia = date || todayKey();
  const estado = ATTENDANCE_STATUS.includes(status) ? status : 'present';
  const ahora = new Date().toISOString();
  let record = findAttendance(student.id, dia, classId);

  if (!record) {
    record = {
      id: cache.meta.nextAttendanceId++,
      studentId: student.id,
      classId: classId != null ? Number(classId) : null,
      schoolId: schoolId != null ? Number(schoolId) : student.schoolId || null,
      date: dia,
      status: estado,
      method: method || 'manual',
      at: ahora,
      byId: byId || null,
      byName: byName || null
    };
    cache.attendance.push(record);
  } else {
    record.status = estado;
    record.method = method || record.method;
    record.at = ahora;
    record.byId = byId || record.byId;
    record.byName = byName || record.byName;
  }
  save();
  return record;
}

function getAttendance({ date, classId, studentId, schoolId } = {}) {
  return cache.attendance.filter(r => {
    if (date && r.date !== date) return false;
    if (classId != null && Number(r.classId || 0) !== Number(classId)) return false;
    if (studentId != null && r.studentId !== Number(studentId)) return false;
    if (schoolId != null && Number(r.schoolId || 0) !== Number(schoolId)) return false;
    return true;
  });
}

// El historial de una persona, del día más reciente al más viejo.
function attendanceHistory(studentId, limit = 30) {
  return cache.attendance
    .filter(r => r.studentId === Number(studentId))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

// Lo que necesita la pantalla del pase de lista: la gente que sí lleva
// asistencia, con su número, su foto, su huella y lo que ya tenga marcado hoy.
function attendanceRoster(students, date, classId) {
  const dia = date || todayKey();
  return students
    .filter(attendanceAllowed)
    .map(student => {
      const marca = findAttendance(student.id, dia, classId);
      return {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode || null,
        level: student.level,
        grade: student.grade,
        listNumber: student.listNumber || null,
        parentPhoneCode: student.parentPhoneCode || DEFAULT_PHONE_CODE,
        parentPhone: student.parentPhone || null,
        // Sin foto ni huella: eso lo pone el navegador desde su propio
        // archivo de caras, justo después de recibir esta lista.
        status: marca ? marca.status : null,
        method: marca ? marca.method : null,
        at: marca ? marca.at : null
      };
    })
    .sort((a, b) => {
      // Por número de lista; quien todavía no tiene número va al final por
      // orden alfabético, para que la lista se parezca a la de papel.
      if (a.listNumber && b.listNumber) return a.listNumber - b.listNumber;
      if (a.listNumber) return -1;
      if (b.listNumber) return 1;
      return a.fullName.localeCompare(b.fullName, 'es');
    });
}

// ---------------------------------------------------------------------------
// Cuentas de familia
// ---------------------------------------------------------------------------
// Una cuenta de padre o madre no pertenece a la escuela: acompaña a una o
// varias cuentas de estudiante. De cada hijo ve si llegó hoy y su historial de
// asistencia — ni sus notas ni sus conversaciones con Robin, que son suyas.

function getChildrenOf(parentId) {
  const parent = getUserById(parentId);
  if (!parent || parent.role !== 'parent') return [];
  return (parent.childIds || []).map(id => getUserById(id)).filter(Boolean);
}

function linkChild(parentId, studentCode) {
  const parent = getUserById(parentId);
  if (!parent || parent.role !== 'parent') return { ok: false, reason: 'no-parent' };

  const student = getUserByStudentCode(String(studentCode || '').trim());
  if (!student) return { ok: false, reason: 'no-existe' };

  parent.childIds = parent.childIds || [];
  if (parent.childIds.includes(student.id)) return { ok: false, reason: 'repetido', student };

  parent.childIds.push(student.id);
  save();
  return { ok: true, student };
}

function unlinkChild(parentId, studentId) {
  const parent = getUserById(parentId);
  if (!parent || parent.role !== 'parent') return false;
  const antes = (parent.childIds || []).length;
  parent.childIds = (parent.childIds || []).filter(id => id !== Number(studentId));
  save();
  return parent.childIds.length < antes;
}

function isParentOf(parentId, studentId) {
  const parent = getUserById(parentId);
  return Boolean(parent && parent.role === 'parent' && (parent.childIds || []).includes(Number(studentId)));
}

// El store necesita poder mirar el caché para subirlo, y engancha el apagado
// ordenado: con Supabase, lo que esté sin subir se sube al recibir SIGTERM.
store.conectar(() => cache);

if (store.USA_SUPABASE) {
  // Todavía no hay nada: lo pone listo(), y hasta entonces nadie atiende.
  cache = emptyDB();
} else {
  loadDesdeArchivo();
  listoPromesa = Promise.resolve(cache);
}

module.exports = {
  // arranque y guardado
  listo, guardar: () => store.vaciar(), almacen: store,
  LEVELS,
  ROLES,
  DEFAULT_ADMIN,
  // usuarios
  getAllUsers, getUserById, getUserByEmail, getUserByStudentCode,
  createUser, updateUser, deleteUser, verifyPassword, publicUser,
  // escuelas
  createSchool, getSchools, getSchoolById, getSchoolByDirector,
  resolveJoinCode, regenerateSchoolCode, renameSchool, getSchoolMembers, schoolStats,
  // margen de Robin por escuela
  SCHOOL_LIMITS, SCHOOL_LIMIT_GROUPS, SCHOOL_LIMIT_MIN, SCHOOL_LIMIT_MAX,
  schoolAiLimits, setSchoolAiLimits, limitGroupOf,
  // tareas
  getTasks, createTask, updateTask, deleteTask,
  // clases y actividades
  createClass, getClasses, getClassById, addStudentToClass,
  getActivitiesForClass, createActivity,
  // notificaciones
  addNotification, markNotificationRead,
  // avisos
  getAnnouncements, getAnnouncementsForLevel, createAnnouncement, getAnnouncementById, deleteAnnouncement,
  // ia
  logAiChat, getAiHistory, clearAiHistory,
  // estadísticas
  getStats,
  // planes y límite diario de Robin
  todayKey, rollUsageDay, limitsFor, usageSummary, consumeUsage, planInfoFor, setPlan,
  // agrupar muchas escrituras en una sola (lo usa la consola de demostración)
  enLote, hashPassword,
  // la conexión con Claude de cada cuenta
  aiSettingsOf, setAiSettings, recordAiTest, maskKey,
  // activar la cuenta por correo
  necesitaVerificar, nuevoCodigoDeVerificacion, comprobarCodigoDeVerificacion,
  purgarCuentasSinActivar, VERIFICACION_MINUTOS, MODOS_QUE_VERIFICAN,
  // códigos nominales
  createJoinCode, getCodesForSchool, getJoinCode, checkJoinCode, burnJoinCode, revokeJoinCode,
  // conversaciones con Robin
  createChat, getChats, chatSummary, getChat, appendChatTurn, renameChat,
  deleteChat, deleteAllChats, pruneChatHistory,
  // minijuegos
  getDisabledGames, setGameEnabled, availableGamesFor, canPlayGame,
  scoreFor, recordGameResult, getGameScores,
  // entregas
  getSubmission, getSubmissionsForActivity, saveSubmission, gradeSubmission,
  // clases y actividades
  getClassesForTeacher, getClassesForStudent, getClassesForSchool, getClassByJoinCode,
  removeStudentFromClass, updateClass, deleteClass,
  getActivityById, getAssignmentsForStudent, updateActivity, deleteActivity,
  // la escuela por dentro
  getSchoolStaff, getStudentsOfTeacher, teacherTeachesStudent, convertPersonalToStudent,
  isLittleKid,
  // pase de lista
  ATTENDANCE_LEVELS, ATTENDANCE_STATUS, DEFAULT_PHONE_CODE, attendanceAllowed,
  setStudentListNumber, setStudentContact, markAttendance, getAttendance,
  attendanceHistory, attendanceRoster,
  // cuentas de familia
  getChildrenOf, linkChild, unlinkChild, isParentOf
};
