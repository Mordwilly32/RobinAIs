// js/rr-modules.js — GENERADO por tools/build-pages.js, no se edita a mano.
// Es el backend de roboRobin (src/ y routes/) tal cual, envuelto para que
// corra dentro del navegador. Ver web/js/rr-runtime.js.

RRModulos.define("src/auth", function (require, module, exports, __dirname, __filename) {
// src/auth.js
// Ayudantes sobre express-session para proteger rutas por sesión o por rol.

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'No tienes permiso para hacer eso.' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };

});

RRModulos.define("src/db", function (require, module, exports, __dirname, __filename) {
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
function createUser({ fullName, email, password, role, level, grade, schoolId, plan, age, passwordHash }) {
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
    status: 'active',
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

});

RRModulos.define("src/games", function (require, module, exports, __dirname, __filename) {
// src/games.js
// ---------------------------------------------------------------------------
// Los minijuegos de roboRobin. Hay uno por materia y todos salen de la misma
// idea: un reto corto, con una respuesta que SIEMPRE se puede encontrar.
//
// La dificultad sube con el nivel escolar (Parvularia 1 … Bachillerato 4),
// pero nunca hasta volverse imposible: si el reto no se puede resolver con lo
// que se ve en pantalla, está mal hecho.
//
// Los retos se arman aquí, en el servidor, y la respuesta NO viaja al
// navegador. Así la pista de Robin significa algo: no se puede mirar el
// código de la página para hacer trampa.
//
// Cada reto trae dos ayudas distintas:
//   hint   una pista que empuja en la dirección correcta sin decir el resultado
//   steps  el camino paso a paso, que es lo que Robin explica cuando alguien
//          de verdad se atoró — y aun así la última palabra la pone la persona
// ---------------------------------------------------------------------------

// ---- Utilidades ------------------------------------------------------------

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Arma las opciones de un reto de opción múltiple: la correcta más distractores
// que no se repitan ni coincidan con ella.
function choices(correct, distractors) {
  const seen = new Set([String(correct)]);
  const out = [String(correct)];
  distractors.forEach(d => {
    const key = String(d);
    if (!seen.has(key) && out.length < 4) { seen.add(key); out.push(key); }
  });
  return shuffle(out);
}

// ---- Retos de armar con piezas ---------------------------------------------
// El tercer tipo de reto, además de elegir una opción y escribir la respuesta:
// hay un montón de piezas sueltas y hay que colocarlas en su sitio.
//
// Sirve para casi todo lo que no se puede preguntar con cuatro botones: armar
// una ecuación con sus números y sus signos, formar una palabra letra por
// letra, juntar dos ingredientes en una poción, ordenar las líneas de un
// programa. Es el mismo mecanismo en las siete materias, así que quien
// aprendió a jugarlo en una lo sabe jugar en todas.
//
//   answer     las piezas correctas, en su orden ('3 + 4 = 7' o un arreglo)
//   extras     piezas de más que sobran, para que no se resuelva por descarte
//   join       ' ' entre piezas (una ecuación) o '' pegadas (una palabra)
//   unordered  cuando el orden da igual: juntar sodio y cloro, o cloro y sodio
function build({ prompt, lead, answer, extras = [], join = ' ', unordered = false, hint, steps }) {
  const piezas = Array.isArray(answer) ? answer.map(String) : String(answer).split(' ');
  return {
    kind: 'build',
    prompt,
    lead,
    pieces: shuffle(piezas.concat(extras.map(String))),
    slots: piezas.length,
    join,
    unordered,
    answer: piezas.join(join === '' ? '' : ' '),
    answerPieces: piezas,
    hint,
    steps
  };
}

// Las letras de una palabra, revueltas, más un par de letras que sobran para
// que no baste con "usa todas las que hay".
function letrasDe(palabra, sobran = 2) {
  const abecedario = 'abcdefghijklmnoprstuvz'.split('');
  const usadas = palabra.split('');
  const ruido = [];
  while (ruido.length < sobran) {
    const letra = pick(abecedario);
    if (!usadas.includes(letra) && !ruido.includes(letra)) ruido.push(letra);
  }
  return ruido;
}

// La dificultad que le toca a alguien. Los más peques juegan en 1 aunque el
// nivel diga otra cosa; nadie empieza frustrado.
const LEVEL_DIFFICULTY = {
  'Parvularia': 1,
  'Primaria': 2,
  'Secundaria': 3,
  'Bachillerato': 4,
  // La universidad no juega a los minijuegos (ver availableGamesFor en db.js),
  // pero el número hace falta igual: lo usa Robin para saber a qué altura
  // explicar en el chat.
  'Universidad': 4
};

// Primero, segundo y tercer grado siguen contando como "peques": la primaria
// alta es la que salta a dificultad 2.
const LITTLE_GRADES = /^(?:k|kinder|prep|1|2|3)(?:\s*(?:°|º|er|do|ro|to|grado))?\b/i;

// Una cuenta personal no tiene nivel ni grado: lo único que sabemos de ella es
// la edad que puso al registrarse. Sin esto, alguien de 6 años y alguien de 40
// recibían exactamente el mismo reto.
function difficultyForAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  if (n <= 7) return 1;
  if (n <= 11) return 2;
  if (n <= 14) return 3;
  return 4;
}

function difficultyFor(user) {
  if (!user) return 2;
  if (!user.level && user.age) return difficultyForAge(user.age) || 2;
  const base = LEVEL_DIFFICULTY[user.level] || 2;
  if (base === 2 && user.grade && LITTLE_GRADES.test(String(user.grade).trim())) return 1;
  return base;
}

// ---- Matemáticas -----------------------------------------------------------
// Dos formas de preguntar lo mismo, alternadas al azar:
//
//   armar     las piezas de la operación están sueltas y hay que colocarlas.
//             Obliga a entender la estructura —qué va a cada lado del igual—,
//             no solo a calcular el resultado.
//   resolver  la operación ya está escrita y solo falta el número.
//
// La de armar sale más a menudo porque enseña más: el resultado correcto con
// la ecuación mal puesta no existe.

function mathBuild(d) {
  if (d <= 1) {
    const a = rand(1, 5), b = rand(1, 5);
    return build({
      prompt: `Arma la suma: Robin juntó ${a} semillas y encontró ${b} más.`,
      lead: 'Toca las piezas en el orden correcto para armar la operación.',
      answer: [String(a), '+', String(b), '=', String(a + b)],
      extras: ['−', String(a + b + 1), String(Math.max(1, a + b - 1))],
      hint: 'Primero lo que tenía, luego el signo de juntar, luego lo que encontró, y al final el igual con el total.',
      steps: [
        `La operación empieza con las semillas que ya tenía: ${a}.`,
        'Juntar cosas es sumar, así que después va el signo +.',
        `Luego va lo que encontró: ${b}.`,
        'Al final el signo = y el total de las dos cantidades juntas.'
      ]
    });
  }

  if (d === 2) {
    const a = rand(12, 60), b = rand(3, 12);
    const op = pick(['×', '+', '−']);
    const valor = op === '×' ? a * b : op === '+' ? a + b : a - b;
    return build({
      prompt: `Arma la operación completa. El resultado tiene que ser ${valor}.`,
      lead: 'Los signos también son piezas: colócalos donde van.',
      answer: [String(a), op, String(b), '=', String(valor)],
      extras: [op === '×' ? '+' : '×', String(valor + 10), String(b + 1)],
      hint: `Busca qué dos números dan ${valor} con el signo que tienes, y recuerda que el resultado va siempre después del igual.`,
      steps: [
        'Coloca primero el número más grande: es el que abre la operación.',
        `Prueba el signo que tienes con cada número hasta llegar a ${valor}.`,
        'El igual va antes del resultado, nunca al principio.'
      ]
    });
  }

  if (d === 3) {
    const x = rand(2, 9), a = rand(2, 6), b = rand(1, 20);
    const total = a * x + b;
    return build({
      prompt: `Arma la ecuación que se resuelve con x = ${x}.`,
      lead: 'Tiene que seguir siendo cierta al sustituir la x por su valor.',
      answer: [String(a) + 'x', '+', String(b), '=', String(total)],
      extras: ['−', String(total + a), String(b + 3)],
      hint: `Sustituye: el número que multiplica a la x, por ${x}, más el que se suma aparte, tiene que dar el total.`,
      steps: [
        'La ecuación empieza con el término que lleva la x.',
        'Después va el signo + y el número que se suma aparte.',
        `Comprueba: ${a} · ${x} = ${a * x}, y ${a * x} + ${b} = ${total}. Ese es el número que va tras el igual.`
      ]
    });
  }

  // Bachillerato: la factorización, armada con dos paréntesis. Se parte de las
  // raíces para que siempre exista y sea entera.
  // Las dos raíces distintas a propósito: con raíz doble, el mismo paréntesis
  // aparecía dos veces en el montón y el reto dejaba de tener sentido visual.
  const r1 = rand(1, 5);
  let r2 = rand(1, 6);
  if (r2 === r1) r2 = r1 + 1;
  const B = r1 + r2;
  const C = r1 * r2;
  return build({
    prompt: `Arma la factorización de   x² − ${B}x + ${C}`,
    lead: 'Junta los dos paréntesis que, multiplicados, dan esa expresión. El orden da igual.',
    answer: [`(x − ${r1})`, `(x − ${r2})`],
    extras: [`(x + ${r1})`, `(x + ${r2})`, `(x − ${B})`],
    unordered: true,
    hint: `Necesitas dos números que multiplicados den ${C} y sumados den ${B}. Los dos van restando.`,
    steps: [
      `Busca las parejas de números que multiplicadas den ${C}.`,
      `De esas parejas, quédate con la que sume ${B}.`,
      'Como el término del medio es negativo y el independiente positivo, los dos paréntesis llevan resta.'
    ]
  });
}

function mathSolve(d) {
  if (d <= 1) {
    const a = rand(1, 5), b = rand(1, 5);
    return {
      kind: 'choice',
      prompt: `Robin juntó ${a} semillas y luego encontró ${b} más. ¿Cuántas tiene?`,
      answer: String(a + b),
      options: choices(a + b, [a + b + 1, Math.max(1, a + b - 1), a + b + 2]),
      hint: 'Cuenta con los dedos: primero las que ya tenía y sigue contando las nuevas, una por una.',
      steps: [
        `Empieza en ${a}.`,
        `Cuenta ${b} más, de uno en uno.`,
        'El número donde te detienes es la respuesta.'
      ]
    };
  }

  if (d === 2) {
    const a = rand(12, 99), b = rand(3, 12);
    const op = pick(['x', '+', '-']);
    const value = op === 'x' ? a * b : op === '+' ? a + b : a - b;
    const decenas = Math.floor(a / 10) * 10;
    return {
      kind: 'input',
      prompt: `Resuelve: ${a} ${op} ${b}`,
      answer: String(value),
      hint: op === 'x'
        ? 'Parte el número grande: multiplica primero las decenas y luego las unidades, y suma los dos resultados.'
        : 'Ordena en columna las unidades debajo de las unidades y las decenas debajo de las decenas.',
      steps: op === 'x'
        ? [
            `Separa ${a} en ${decenas} + ${a % 10}.`,
            `Multiplica ${decenas} x ${b} = ${decenas * b}.`,
            `Multiplica ${a % 10} x ${b} = ${(a % 10) * b}.`,
            'Suma los dos resultados y ya tienes el total.'
          ]
        : [
            'Escribe los dos números uno debajo del otro, alineando las unidades.',
            `Opera columna por columna, de derecha a izquierda (${op}).`,
            'Si te pasas de 9 en una columna, lleva 1 a la siguiente.'
          ]
    };
  }

  if (d === 3) {
    const x = rand(2, 12), a = rand(2, 9), b = rand(1, 30);
    return {
      kind: 'input',
      prompt: `Despeja x:   ${a}x + ${b} = ${a * x + b}`,
      answer: String(x),
      hint: 'Deja la x sola: primero quita lo que está sumando y después quita lo que está multiplicando.',
      steps: [
        `Resta ${b} en los dos lados de la igualdad: te queda ${a}x = ${a * x}.`,
        `Divide los dos lados entre ${a}.`,
        'Lo que queda a la derecha es x. Compruébalo sustituyendo en la ecuación original.'
      ]
    };
  }

  // Bachillerato: se arma desde las raíces para que siempre tenga solución entera.
  const r1 = rand(-6, 6);
  const r2 = rand(-6, 6);
  const B = -(r1 + r2);
  const C = r1 * r2;
  const correcta = [r1, r2].sort((p, q) => p - q).join(' y ');
  const termB = B === 0 ? '' : B > 0 ? ` + ${B}x` : ` - ${Math.abs(B)}x`;
  const termC = C === 0 ? '' : C > 0 ? ` + ${C}` : ` - ${Math.abs(C)}`;

  return {
    kind: 'choice',
    prompt: `¿Cuáles son las raíces de   x²${termB}${termC} = 0 ?`,
    answer: correcta,
    options: choices(correcta, [
      [r1 + 1, r2].sort((p, q) => p - q).join(' y '),
      [-r1, -r2].sort((p, q) => p - q).join(' y '),
      [r1, r2 + 2].sort((p, q) => p - q).join(' y '),
      [r1 - 2, r2 + 1].sort((p, q) => p - q).join(' y ')
    ]),
    hint: 'Busca dos números que multiplicados den el término independiente y sumados den el coeficiente del medio con el signo cambiado.',
    steps: [
      `Necesitas dos números cuyo producto sea ${C}.`,
      `De esas parejas, quédate con la que sume ${-B}.`,
      'Esas dos son las raíces. Compruébalas sustituyendo en la ecuación.'
    ]
  };
}

function mathRound(d) {
  return Math.random() < 0.6 ? mathBuild(d) : mathSolve(d);
}

// ---- Lenguaje --------------------------------------------------------------
// Quien apenas está aprendiendo a leer no necesita que le pregunten por
// sinónimos: necesita formar la palabra. Por eso la materia está partida en
// dos mitades que casi no se parecen.
//
//   peques (1 y 2)   armar la palabra letra por letra, a partir de una pista.
//                    Es lo que de verdad se practica a esa edad.
//   grandes (3 y 4)  variedad: sinónimos, antónimos, ordenar una oración,
//                    conectores, acentuación y figuras literarias.

// Palabras para formar, con la pista que dice cuál es sin deletrearla.
const PALABRAS = {
  1: [
    { palabra: 'sol', pista: 'Sale de día y calienta todo.' },
    { palabra: 'luna', pista: 'Sale de noche y cambia de forma.' },
    { palabra: 'gato', pista: 'Hace miau y le gusta dormir.' },
    { palabra: 'casa', pista: 'Es donde vives con tu familia.' },
    { palabra: 'flor', pista: 'Nace en la planta y huele rico.' },
    { palabra: 'pato', pista: 'Nada en el agua y hace cuac.' },
    { palabra: 'mesa', pista: 'Tiene cuatro patas y comes encima.' },
    { palabra: 'nube', pista: 'Es blanca, está en el cielo y trae lluvia.' }
  ],
  2: [
    { palabra: 'escuela', pista: 'El lugar donde aprendes con tus compañeros.' },
    { palabra: 'bicicleta', pista: 'Tiene dos ruedas y pedales.' },
    { palabra: 'ventana', pista: 'Por ahí entra la luz al cuarto.' },
    { palabra: 'montaña', pista: 'Es muy alta y hay que subirla.' },
    { palabra: 'cuaderno', pista: 'Ahí escribes lo que te enseñan.' },
    { palabra: 'mariposa', pista: 'Antes fue oruga y ahora vuela con colores.' },
    { palabra: 'biblioteca', pista: 'Está llena de libros y hay que hablar bajito.' }
  ]
};

const SPELLING = [
  { ok: 'hacer', bad: ['aser', 'acer', 'haser'], why: 'Lleva h al inicio y c antes de e.' },
  { ok: 'había', bad: ['abía', 'havía', 'habia'], why: 'Viene de haber: h muda y tilde en la í.' },
  { ok: 'vaya', bad: ['valla', 'baya', 'vayá'], why: 'Vaya es del verbo ir. Valla es una cerca y baya es un fruto.' },
  { ok: 'porque', bad: ['por que', 'porqué', 'por qué'], why: 'Junto y sin tilde cuando responde a una causa.' },
  { ok: 'también', bad: ['tambien', 'tanbien', 'tanvien'], why: 'Palabra aguda terminada en n: lleva tilde.' },
  { ok: 'excelente', bad: ['ecelente', 'exelente', 'escelente'], why: 'Se escribe con x seguida de c.' },
  { ok: 'bicicleta', bad: ['bisicleta', 'vicicleta', 'bicicletta'], why: 'Con b al inicio y c en las dos sílabas siguientes.' }
];

const SYNONYMS = [
  { word: 'veloz', ok: 'rápido', bad: ['lento', 'pesado', 'quieto'] },
  { word: 'alegre', ok: 'contento', bad: ['triste', 'enojado', 'aburrido'] },
  { word: 'enorme', ok: 'gigante', bad: ['diminuto', 'estrecho', 'liviano'] },
  { word: 'sabio', ok: 'culto', bad: ['torpe', 'distraído', 'ingenuo'] },
  { word: 'efímero', ok: 'pasajero', bad: ['eterno', 'sólido', 'enorme'] },
  { word: 'perspicaz', ok: 'astuto', bad: ['lento', 'callado', 'amable'] }
];

const ANTONYMS = [
  { word: 'generoso', ok: 'tacaño', bad: ['amable', 'alegre', 'sincero'] },
  { word: 'escaso', ok: 'abundante', bad: ['pequeño', 'barato', 'lejano'] },
  { word: 'humilde', ok: 'soberbio', bad: ['sencillo', 'tranquilo', 'pobre'] },
  { word: 'efímero', ok: 'perpetuo', bad: ['veloz', 'frágil', 'raro'] }
];

const RHYMES = [
  { word: 'gato', ok: 'pato', bad: ['perro', 'casa', 'sol'] },
  { word: 'flor', ok: 'color', bad: ['árbol', 'nube', 'pez'] },
  { word: 'ratón', ok: 'balón', bad: ['queso', 'mesa', 'lápiz'] }
];

// Oraciones para ordenar. Cada una tiene un solo orden natural en español.
const ORACIONES = [
  ['El', 'gato', 'duerme', 'sobre', 'la', 'mesa'],
  ['Mañana', 'entregamos', 'el', 'informe', 'de', 'ciencias'],
  ['La', 'profesora', 'explicó', 'el', 'tema', 'con', 'calma'],
  ['Robin', 'siempre', 'responde', 'cuando', 'le', 'preguntas']
];

// Acentuación: la palabra va sin tilde y hay que decir dónde cae.
const TILDES = [
  { ok: 'cántaro', bad: ['cantaro', 'cantáro', 'cantarò'], why: 'Es esdrújula: todas llevan tilde, sin excepción.' },
  { ok: 'compás', bad: ['compas', 'cómpas', 'compàs'], why: 'Aguda terminada en s: lleva tilde.' },
  { ok: 'árbol', bad: ['arbol', 'arból', 'àrbol'], why: 'Grave que NO termina en n, s ni vocal: lleva tilde.' },
  { ok: 'examen', bad: ['exámen', 'examén', 'exàmen'], why: 'Grave terminada en n: no lleva tilde.' }
];

const FIGURAS = [
  { q: '«Sus ojos son dos luceros». ¿Qué figura es?', ok: 'Metáfora', bad: ['Símil', 'Hipérbole', 'Personificación'], hint: 'Dice que una cosa ES otra, sin usar "como".' },
  { q: '«Corre como el viento». ¿Qué figura es?', ok: 'Símil', bad: ['Metáfora', 'Ironía', 'Metonimia'], hint: 'La palabra "como" es la pista: está comparando.' },
  { q: '«Te lo he dicho un millón de veces». ¿Qué figura es?', ok: 'Hipérbole', bad: ['Metáfora', 'Símil', 'Elipsis'], hint: 'Exagera a propósito, muchísimo más de lo real.' },
  { q: '«El viento susurraba entre los árboles». ¿Qué figura es?', ok: 'Personificación', bad: ['Hipérbole', 'Símil', 'Metáfora'], hint: 'Le da a algo que no está vivo una acción de persona.' }
];

const CONECTORES = [
  { q: 'Estudié toda la noche; ___, aprobé el examen.', ok: 'por lo tanto', bad: ['sin embargo', 'aunque', 'mientras'], hint: 'La segunda parte es la consecuencia de la primera.' },
  { q: 'Estudié toda la noche; ___, reprobé el examen.', ok: 'sin embargo', bad: ['por lo tanto', 'además', 'porque'], hint: 'La segunda parte contradice lo que se esperaba.' },
  { q: 'Trajo el cuaderno ___ olvidó el lápiz.', ok: 'pero', bad: ['porque', 'entonces', 'así que'], hint: 'Une dos cosas que se oponen.' }
];

// Peques: formar la palabra letra por letra.
function palabraRound(d) {
  const item = pick(PALABRAS[d <= 1 ? 1 : 2]);
  const letras = item.palabra.split('');
  return build({
    prompt: `Forma la palabra: ${item.pista}`,
    lead: 'Toca las letras en orden. Sobran algunas.',
    answer: letras,
    extras: letrasDe(item.palabra, d <= 1 ? 2 : 3),
    join: '',
    hint: `Empieza por el sonido con el que arranca la palabra. Tiene ${letras.length} letras.`,
    steps: [
      'Di la palabra en voz alta, despacio.',
      'Escucha con qué sonido empieza y busca esa letra.',
      'Sigue sonido por sonido hasta el final; las letras que sobren no se usan.'
    ]
  });
}

function languageRound(d) {
  // Peques: siempre formar palabras. Es lo que toca practicar a esa edad y
  // repetirlo no aburre, porque la palabra cambia cada vez.
  if (d <= 2) {
    if (d <= 1) return Math.random() < 0.7 ? palabraRound(d) : rimaRound();
    return Math.random() < 0.55 ? palabraRound(d) : pick([rimaRound, ortografiaRound])();
  }

  // Grandes: seis tipos distintos de reto, uno cada vez.
  const tipos = [ortografiaRound, sinonimoRound, antonimoRound, oracionRound, tildeRound, conectorRound];
  if (d >= 4) tipos.push(figuraRound);
  return pick(tipos)(d);
}

function rimaRound() {
  const item = pick(RHYMES);
  return {
    kind: 'choice',
    prompt: `¿Cuál palabra rima con «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Rimar es terminar con el mismo sonido. Di las palabras en voz alta y escucha el final.',
    steps: [
      `Di «${item.word}» despacio y quédate con el sonido del final.`,
      'Ahora di cada opción en voz alta.',
      'La que termine igual es la que rima.'
    ]
  };
}

function ortografiaRound() {
  const item = pick(SPELLING);
  return {
    kind: 'choice',
    prompt: '¿Cuál de estas palabras está bien escrita?',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Fíjate en la h, en la b/v y en las tildes. Una sola letra cambiada ya la vuelve incorrecta.',
    steps: [
      'Lee las cuatro opciones despacio, letra por letra.',
      'Descarta las que cambien una consonante que suena igual (b/v, s/c/z).',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

function sinonimoRound(d) {
  const item = pick(SYNONYMS);
  return {
    kind: 'choice',
    prompt: d >= 4
      ? `En la frase «su fama fue ${item.word}», ¿qué palabra la reemplaza sin cambiar el sentido?`
      : `¿Cuál es un sinónimo de «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Prueba metiendo cada opción en la frase. Si la frase cambia de significado, no es sinónimo.',
    steps: [
      `Explica con tus propias palabras qué significa «${item.word}».`,
      'Descarta las opciones que signifiquen lo contrario.',
      'De las que queden, elige la que podrías intercambiar sin que la frase suene rara.'
    ]
  };
}

function antonimoRound() {
  const item = pick(ANTONYMS);
  return {
    kind: 'choice',
    prompt: `¿Cuál es lo CONTRARIO de «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Cuidado: entre las opciones hay sinónimos, que son la trampa. Buscas lo opuesto, no lo parecido.',
    steps: [
      `Di qué significa «${item.word}».`,
      'Descarta primero las que signifiquen algo parecido: esas son sinónimos.',
      'De las que quedan, la que se opone del todo es la respuesta.'
    ]
  };
}

function oracionRound() {
  const palabras = pick(ORACIONES);
  return build({
    prompt: 'Ordena las palabras para formar una oración correcta.',
    lead: 'Toca las palabras en el orden en que las dirías.',
    answer: palabras,
    hint: 'En español lo normal es sujeto, después verbo y al final el resto. Empieza buscando quién hace la acción.',
    steps: [
      'Busca el verbo: es la acción de la oración.',
      'Busca quién la hace: ese es el sujeto y va primero.',
      'Lo que queda completa la acción y va al final.'
    ]
  });
}

function tildeRound() {
  const item = pick(TILDES);
  return {
    kind: 'choice',
    prompt: '¿Cuál de estas está bien acentuada?',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Di la palabra en voz alta y localiza la sílaba que suena más fuerte. Después aplica la regla de agudas, graves y esdrújulas.',
    steps: [
      'Separa la palabra en sílabas y marca cuál suena más fuerte.',
      'Si la fuerte es la última es aguda; la penúltima, grave; la antepenúltima, esdrújula.',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

function conectorRound() {
  const item = pick(CONECTORES);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee las dos mitades de la frase por separado.',
      '¿La segunda es consecuencia de la primera, o la contradice?',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function figuraRound() {
  const item = pick(FIGURAS);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la frase y pregúntate si lo que dice puede ser literal.',
      'Si compara con "como", es símil; si dice que una cosa es otra, metáfora.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Ciencias --------------------------------------------------------------

const SCIENCE = {
  1: [
    { q: '¿Cuál de estos está vivo?', ok: 'Un árbol', bad: ['Una piedra', 'Una silla', 'Un lápiz'], hint: 'Lo que está vivo crece, come o respira.' },
    { q: '¿Qué necesitan las plantas para crecer?', ok: 'Agua y luz del sol', bad: ['Arena y viento', 'Solo piedras', 'Oscuridad'], hint: 'Piensa en lo que le das a una planta en casa.' },
    { q: '¿Dónde vive un pez?', ok: 'En el agua', bad: ['En el aire', 'Bajo la tierra', 'En el fuego'], hint: 'Fíjate cómo respira: tiene branquias, no pulmones.' }
  ],
  2: [
    { q: '¿Cómo se llama el paso del agua de líquido a gas?', ok: 'Evaporación', bad: ['Condensación', 'Solidificación', 'Filtración'], hint: 'Es lo que pasa cuando hierve el agua y sube el vapor.' },
    { q: '¿Qué órgano bombea la sangre por todo el cuerpo?', ok: 'El corazón', bad: ['El pulmón', 'El hígado', 'El estómago'], hint: 'Es el que late y puedes escuchar en el pecho.' },
    { q: '¿Qué parte de la planta absorbe el agua del suelo?', ok: 'La raíz', bad: ['La hoja', 'El tallo', 'La flor'], hint: 'Es la parte que no se ve, la que está enterrada.' }
  ],
  3: [
    { q: '¿Qué gas usan las plantas en la fotosíntesis?', ok: 'Dióxido de carbono', bad: ['Oxígeno', 'Nitrógeno', 'Hidrógeno'], hint: 'Es el gas que nosotros soltamos al exhalar.' },
    { q: '¿Cuál es la unidad básica de todos los seres vivos?', ok: 'La célula', bad: ['El átomo', 'El tejido', 'La molécula'], hint: 'Es lo más pequeño que todavía está vivo por sí mismo.' },
    { q: 'Si empujas algo y no se mueve, ¿qué fuerza lo frena contra el suelo?', ok: 'La fricción', bad: ['La gravedad', 'El magnetismo', 'La inercia'], hint: 'Piensa por qué cuesta más arrastrar una caja sobre alfombra que sobre hielo.' }
  ],
  4: [
    { q: 'En F = m·a, si la masa se duplica y la fuerza no cambia, ¿qué pasa con la aceleración?', ok: 'Se reduce a la mitad', bad: ['Se duplica', 'No cambia', 'Se hace cuatro veces mayor'], hint: 'Despeja a = F/m y mira qué le pasa al cociente cuando el de abajo crece.' },
    { q: '¿Qué enlace se forma cuando dos átomos comparten electrones?', ok: 'Covalente', bad: ['Iónico', 'Metálico', 'Puente de hidrógeno'], hint: 'Compartir, no ceder. El que cede electrones es el otro tipo.' },
    { q: '¿En qué fase de la mitosis se alinean los cromosomas en el centro de la célula?', ok: 'Metafase', bad: ['Profase', 'Anafase', 'Telofase'], hint: 'El prefijo "meta" te dice que va justo en medio del proceso.' }
  ]
};

// Las fusiones: el laboratorio de verdad. Hay un frasco vacío y un montón de
// ingredientes, y hay que meter los DOS que dan lo que se pide. El orden da
// igual (sodio con cloro es lo mismo que cloro con sodio), así que el reto es
// saber qué reacciona con qué, no en qué orden se escribe.
const FUSIONES = {
  1: [
    { sale: 'lodo', con: ['tierra', 'agua'], sobran: ['piedra', 'hoja', 'aire'], pista: 'Piensa en lo que se hace en el patio cuando llueve.' },
    { sale: 'una planta', con: ['semilla', 'agua'], sobran: ['piedra', 'arena', 'hielo'], pista: 'Algo que se siembra más algo que se riega.' },
    { sale: 'un charco congelado', con: ['agua', 'frío'], sobran: ['fuego', 'viento', 'tierra'], pista: '¿Qué le tiene que pasar al agua para ponerse dura?' },
    { sale: 'humo', con: ['fuego', 'madera'], sobran: ['agua', 'hielo', 'arena'], pista: 'Lo que sube de una fogata.' }
  ],
  2: [
    { sale: 'vapor de agua', con: ['agua', 'calor'], sobran: ['frío', 'sal', 'tierra'], pista: 'Es lo que sale de la olla cuando hierve.' },
    { sale: 'agua líquida', con: ['hielo', 'calor'], sobran: ['frío', 'vapor', 'aire'], pista: 'Fusión se llama justo a este cambio de estado.' },
    { sale: 'agua salada', con: ['agua', 'sal'], sobran: ['aceite', 'arena', 'azúcar'], pista: 'Una se disuelve en la otra y ya no se ve.' },
    { sale: 'oxígeno (fotosíntesis)', con: ['luz del sol', 'dióxido de carbono'], sobran: ['oxígeno', 'nitrógeno', 'oscuridad'], pista: 'La planta necesita luz y el gas que nosotros exhalamos.' }
  ],
  3: [
    { sale: 'agua (H₂O)', con: ['hidrógeno', 'oxígeno'], sobran: ['carbono', 'nitrógeno', 'sodio'], pista: 'La fórmula te dice los dos elementos: H y O.' },
    { sale: 'sal de mesa (NaCl)', con: ['sodio', 'cloro'], sobran: ['potasio', 'oxígeno', 'calcio'], pista: 'Na y Cl. Uno cede un electrón y el otro lo toma.' },
    { sale: 'dióxido de carbono (CO₂)', con: ['carbono', 'oxígeno'], sobran: ['hidrógeno', 'azufre', 'hierro'], pista: 'C y O: lo que sueltas al exhalar.' },
    { sale: 'óxido de hierro (herrumbre)', con: ['hierro', 'oxígeno'], sobran: ['cloro', 'sodio', 'nitrógeno'], pista: 'Es lo que le pasa a un clavo mojado con el tiempo.' }
  ],
  4: [
    { sale: 'una sal y agua', con: ['un ácido', 'una base'], sobran: ['un metal noble', 'un gas inerte', 'agua destilada'], pista: 'Se llama reacción de neutralización.' },
    { sale: 'amoníaco (NH₃)', con: ['nitrógeno', 'hidrógeno'], sobran: ['oxígeno', 'cloro', 'carbono'], pista: 'N y H, en el proceso de Haber-Bosch.' },
    { sale: 'un enlace covalente', con: ['dos no metales', 'electrones compartidos'], sobran: ['un metal', 'electrones cedidos', 'un ion'], pista: 'Compartir, no ceder: eso es lo covalente.' },
    { sale: 'un enlace iónico', con: ['un metal', 'un no metal'], sobran: ['dos no metales', 'dos metales', 'electrones compartidos'], pista: 'Uno cede electrones del todo y el otro los queda.' }
  ]
};

function fusionRound(d) {
  const item = pick(FUSIONES[Math.min(4, Math.max(1, d))]);
  return build({
    prompt: `Fusión: mete en el frasco los DOS ingredientes que dan ${item.sale}.`,
    lead: 'El orden da igual. Sobran tres ingredientes que no sirven aquí.',
    answer: item.con,
    extras: item.sobran,
    unordered: true,
    hint: item.pista,
    steps: [
      `Lee otra vez qué tiene que salir: ${item.sale}.`,
      'Descarta los ingredientes que no tienen nada que ver con eso.',
      `Pista de Robin: ${item.pista}`
    ]
  });
}

function scienceRound(d) {
  // Más o menos la mitad de las veces se juega al laboratorio de fusiones, que
  // es lo que le da cara propia a la materia; el resto son preguntas de
  // siempre, para que no se vuelva un solo mecanismo repetido.
  if (Math.random() < 0.55) return fusionRound(d);

  const item = pick(SCIENCE[Math.min(4, Math.max(1, d))]);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la pregunta otra vez y subraya la palabra clave.',
      'Descarta las opciones que sabes seguro que no son.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Estudios Sociales -----------------------------------------------------

const SOCIAL = {
  1: [
    { q: '¿Quién nos ayuda cuando hay un incendio?', ok: 'Los bomberos', bad: ['El panadero', 'El cartero', 'El pintor'], hint: 'Piensa en quién llega en el camión rojo.' },
    { q: '¿Cómo se llama el lugar donde vives con tu familia?', ok: 'El hogar', bad: ['La escuela', 'El parque', 'El mercado'], hint: 'Es el lugar donde duermes cada noche.' }
  ],
  2: [
    { q: '¿Qué instrumento sirve para orientarse y señala siempre al norte?', ok: 'La brújula', bad: ['El reloj', 'El termómetro', 'La regla'], hint: 'Tiene una aguja imantada que gira sola.' },
    { q: '¿Cómo se llama el mapa que muestra montañas y ríos?', ok: 'Mapa físico', bad: ['Mapa político', 'Mapa del metro', 'Mapa del clima'], hint: 'Físico viene del terreno mismo, no de las fronteras.' }
  ],
  3: [
    { q: 'De estos hechos, ¿cuál ocurrió primero?', ok: 'La independencia de Centroamérica (1821)', bad: ['La Segunda Guerra Mundial (1939)', 'La llegada del hombre a la Luna (1969)', 'La caída del Muro de Berlín (1989)'], hint: 'Mira solo los años y busca el número más pequeño.' },
    { q: '¿Qué es una democracia?', ok: 'Un sistema donde el pueblo elige a sus gobernantes', bad: ['Un sistema donde manda una sola familia', 'Un sistema sin leyes', 'Un sistema donde manda el ejército'], hint: 'La palabra viene del griego: demos = pueblo, kratos = poder.' }
  ],
  4: [
    { q: '¿Cuál es la función principal del poder legislativo?', ok: 'Crear y aprobar las leyes', bad: ['Aplicar las leyes', 'Juzgar los delitos', 'Dirigir el ejército'], hint: 'La palabra "legislar" ya te da casi toda la respuesta.' },
    { q: 'Que haya inflación alta significa que...', ok: 'El dinero pierde poder de compra', bad: ['Los precios bajan', 'Sube el ahorro', 'Baja el desempleo siempre'], hint: 'Si todo cuesta más, ¿qué le pasa al mismo billete de ayer?' }
  ]
};

function socialRound(d) {
  const item = pick(SOCIAL[Math.min(4, Math.max(1, d))]);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Fíjate primero en qué te está preguntando exactamente.',
      'Descarta lo que claramente pertenece a otro tema.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Inglés ----------------------------------------------------------------
// Dos juegos en uno:
//
//   spelling bee  se da la palabra en español y se deletrea en inglés, letra
//                 por letra. Es el concurso de siempre, y funciona porque en
//                 inglés casi nada se escribe como suena.
//   el resto      vocabulario, gramática, tiempos verbales y phrasal verbs.

const ENGLISH = {
  1: [
    { q: '¿Cómo se dice «perro» en inglés?', ok: 'dog', bad: ['cat', 'cow', 'bird'] },
    { q: '¿Cómo se dice «rojo» en inglés?', ok: 'red', bad: ['blue', 'green', 'black'] },
    { q: '¿Cómo se dice «casa» en inglés?', ok: 'house', bad: ['horse', 'mouse', 'chair'] }
  ],
  2: [
    { q: 'Completa: «I ___ a student.»', ok: 'am', bad: ['is', 'are', 'be'] },
    { q: '¿Cómo se dice «mañana» (el día siguiente)?', ok: 'tomorrow', bad: ['morning', 'today', 'yesterday'] },
    { q: 'Completa: «She ___ to school every day.»', ok: 'goes', bad: ['go', 'going', 'gone'] }
  ],
  3: [
    { q: 'Completa: «If it rains, we ___ stay home.»', ok: 'will', bad: ['would', 'were', 'are'] },
    { q: '¿Cuál es el pasado de «buy»?', ok: 'bought', bad: ['buyed', 'bught', 'binded'] },
    { q: 'Completa: «I have lived here ___ 2019.»', ok: 'since', bad: ['for', 'during', 'ago'] }
  ],
  4: [
    { q: 'Completa: «If I ___ more time, I would travel.»', ok: 'had', bad: ['have', 'will have', 'would have'] },
    { q: 'Completa en voz pasiva: «The report ___ by the team yesterday.»', ok: 'was written', bad: ['wrote', 'is writing', 'has wrote'] },
    { q: '¿Qué significa el phrasal verb «to give up»?', ok: 'rendirse', bad: ['regalar', 'levantarse', 'subir'] }
  ]
};

const ENGLISH_HINTS = {
  1: 'Di la palabra en voz alta. Muchas se parecen bastante al español.',
  2: 'Mira quién hace la acción: I → am, he/she/it → is, y al verbo se le agrega -s.',
  3: 'Fíjate en el tiempo que pide la frase: pasado, futuro o presente perfecto.',
  4: 'Revisa la estructura completa: condicional, voz pasiva o phrasal verb.'
};

// Spelling bee. Las palabras suben de dificultad con el nivel, y cada una trae
// el detalle que la hace caer en un concurso de verdad.
const SPELLING_BEE = {
  1: [
    { es: 'gato', en: 'cat', ojo: 'Tres letras y empieza con el sonido /k/, pero se escribe con c.' },
    { es: 'libro', en: 'book', ojo: 'Lleva dos oes juntas.' },
    { es: 'azul', en: 'blue', ojo: 'Termina en -ue, y esa e no suena.' },
    { es: 'árbol', en: 'tree', ojo: 'Doble e al final.' },
    { es: 'pez', en: 'fish', ojo: 'El sonido /sh/ se escribe con s y h juntas.' }
  ],
  2: [
    { es: 'escuela', en: 'school', ojo: 'Empieza con sch, aunque suene /sk/.' },
    { es: 'amigo', en: 'friend', ojo: 'Lleva una i que no se oye: fr-i-end.' },
    { es: 'jueves', en: 'thursday', ojo: 'Th al principio y una r después de u.' },
    { es: 'naranja', en: 'orange', ojo: 'Termina en -ge, no en -ch.' },
    { es: 'porque', en: 'because', ojo: 'Termina en -ause, con esa e final muda.' }
  ],
  3: [
    { es: 'hermoso', en: 'beautiful', ojo: 'Tres vocales seguidas al principio: b-e-a-u.' },
    { es: 'necesario', en: 'necessary', ojo: 'Una c y dos eses. Es la que más se falla.' },
    { es: 'gobierno', en: 'government', ojo: 'Lleva una n en medio que casi no se pronuncia: govern-ment.' },
    { es: 'recibir', en: 'receive', ojo: 'Después de c va ei, no ie.' },
    { es: 'separado', en: 'separate', ojo: 'La del medio es una a, no una e.' }
  ],
  4: [
    { es: 'conciencia', en: 'conscience', ojo: 'Lleva sc en medio: con-sci-ence.' },
    { es: 'vergonzoso', en: 'embarrassed', ojo: 'Dos erres y dos eses. Las dos dobles.' },
    { es: 'suceso', en: 'occurrence', ojo: 'Dos ces y dos erres.' },
    { es: 'emprendedor', en: 'entrepreneur', ojo: 'Viene del francés y se escribe tal cual: entre-pre-neur.' },
    { es: 'rítmico', en: 'rhythm', ojo: 'Solo tiene una vocal visible: la y hace de vocal.' }
  ]
};

function spellingBeeRound(d) {
  const item = pick(SPELLING_BEE[Math.min(4, Math.max(1, d))]);
  const letras = item.en.split('');
  return build({
    prompt: `Spelling bee: deletrea «${item.es}» en inglés.`,
    lead: 'Toca las letras en orden. Sobran algunas.',
    answer: letras,
    extras: letrasDe(item.en, d <= 2 ? 3 : 4),
    join: '',
    hint: item.ojo,
    steps: [
      `La palabra tiene ${letras.length} letras.`,
      'Dila en voz alta y ve escribiéndola sonido por sonido.',
      `Ojo con esto: ${item.ojo}`
    ]
  });
}

function englishRound(d) {
  const level = Math.min(4, Math.max(1, d));
  if (Math.random() < 0.5) return spellingBeeRound(level);

  const item = pick(ENGLISH[level]);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: ENGLISH_HINTS[level],
    steps: [
      'Lee la frase completa antes de mirar las opciones.',
      'Prueba cada opción dentro de la frase y escucha cuál suena natural.',
      `Pista de Robin: ${ENGLISH_HINTS[level]}`
    ]
  };
}

// ---- Arte y Música ---------------------------------------------------------
// La materia más ancha de todas: color, ritmo, notas, instrumentos, épocas y
// obras. Antes solo había dos retos (mezclar colores y seguir la escala) y se
// repetían a la tercera partida. Ahora son siete y salen al azar.

const COLOR_MIX = [
  { a: 'azul', b: 'amarillo', ok: 'verde', bad: ['morado', 'naranja', 'café'] },
  { a: 'rojo', b: 'amarillo', ok: 'naranja', bad: ['verde', 'morado', 'gris'] },
  { a: 'rojo', b: 'azul', ok: 'morado', bad: ['verde', 'naranja', 'rosa'] }
];

const NOTE_SEQ = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];

// Acordes mayores, para armar juntando sus tres notas. El orden da igual.
const ACORDES = [
  { nombre: 'do mayor', notas: ['do', 'mi', 'sol'], sobran: ['re', 'fa', 'la'] },
  { nombre: 'fa mayor', notas: ['fa', 'la', 'do'], sobran: ['mi', 'sol', 'si'] },
  { nombre: 'sol mayor', notas: ['sol', 'si', 're'], sobran: ['do', 'fa', 'la'] },
  { nombre: 're menor', notas: ['re', 'fa', 'la'], sobran: ['do', 'mi', 'si'] }
];

const INSTRUMENTOS = [
  { q: '¿A qué familia pertenece el violín?', ok: 'Cuerda', bad: ['Viento', 'Percusión', 'Teclado'], hint: 'Suena porque el arco frota unos hilos tensados.' },
  { q: '¿A qué familia pertenece la trompeta?', ok: 'Viento', bad: ['Cuerda', 'Percusión', 'Cuerda frotada'], hint: 'Suena porque soplas aire dentro.' },
  { q: '¿A qué familia pertenece el timbal?', ok: 'Percusión', bad: ['Viento', 'Cuerda', 'Teclado'], hint: 'Suena porque lo golpeas.' },
  { q: '¿Qué instrumento es a la vez de cuerda y de percusión?', ok: 'El piano', bad: ['La guitarra', 'El arpa', 'El violonchelo'], hint: 'Tiene cuerdas dentro, pero unos martillos las golpean.' }
];

const FIGURAS_MUSICALES = [
  { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una negra?', ok: '1 tiempo', bad: ['2 tiempos', '4 tiempos', 'medio tiempo'], hint: 'Cada figura dura la mitad que la anterior: redonda, blanca, negra.' },
  { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una blanca?', ok: '2 tiempos', bad: ['1 tiempo', '4 tiempos', '8 tiempos'], hint: 'La blanca es la mitad de la redonda.' },
  { q: '¿Cuántas corcheas caben en una negra?', ok: '2', bad: ['4', '1', '8'], hint: 'La corchea dura la mitad que la negra.' }
];

const COLOR_TEORIA = [
  { q: '¿Cuáles son los tres colores primarios?', ok: 'Rojo, azul y amarillo', bad: ['Verde, naranja y morado', 'Blanco, negro y gris', 'Rojo, verde y azul'], hint: 'Son los que no se pueden obtener mezclando otros.' },
  { q: '¿Qué color es complementario del rojo?', ok: 'Verde', bad: ['Azul', 'Naranja', 'Morado'], hint: 'Está justo enfrente en la rueda de color.' },
  { q: '¿Qué pasa si mezclas un color con su complementario?', ok: 'Se apaga y tira a gris', bad: ['Se vuelve más brillante', 'No cambia nada', 'Se vuelve primario'], hint: 'Los opuestos de la rueda se neutralizan entre sí.' },
  { q: 'Los colores cálidos son…', ok: 'Rojo, naranja y amarillo', bad: ['Azul, verde y morado', 'Blanco y negro', 'Solo el rojo'], hint: 'Piensa en el fuego y el sol.' }
];

const OBRAS = [
  { q: '¿Quién pintó «La noche estrellada»?', ok: 'Vincent van Gogh', bad: ['Pablo Picasso', 'Claude Monet', 'Salvador Dalí'], hint: 'Un pintor neerlandés de pinceladas gruesas y arremolinadas.' },
  { q: '¿A qué movimiento pertenece «Las señoritas de Avignon», de Picasso?', ok: 'Cubismo', bad: ['Impresionismo', 'Surrealismo', 'Romanticismo'], hint: 'Descompone las figuras en planos con esquinas.' },
  { q: '«Los relojes blandos» de Dalí pertenecen al…', ok: 'Surrealismo', bad: ['Cubismo', 'Realismo', 'Barroco'], hint: 'Pinta cosas imposibles, como de un sueño.' },
  { q: '¿Qué buscaban los impresionistas como Monet?', ok: 'Captar la luz de un instante', bad: ['Copiar la realidad al detalle', 'Pintar solo temas religiosos', 'Usar únicamente blanco y negro'], hint: 'El nombre viene de un cuadro suyo: «Impresión, sol naciente».' }
];

function artPatron() {
  const colores = shuffle(['🔴', '🔵', '🟡', '🟢']).slice(0, 2);
  const patron = [colores[0], colores[1], colores[0], colores[1], colores[0]];
  return {
    kind: 'choice',
    prompt: `Sigue el patrón:  ${patron.join('  ')}  →  ?`,
    answer: colores[1],
    options: choices(colores[1], ['🔴', '🔵', '🟡', '🟢'].filter(c => c !== colores[1])),
    hint: 'Mira cómo se turnan los colores: uno, otro, uno, otro…',
    steps: [
      'Señala cada figura con el dedo y di su color en voz alta.',
      'Escucha el ritmo: se repiten de dos en dos.',
      'Continúa con el color al que le toca el turno.'
    ]
  };
}

function artMezcla() {
  const mix = pick(COLOR_MIX);
  return {
    kind: 'choice',
    prompt: `Si mezclas ${mix.a} y ${mix.b}, ¿qué color sale?`,
    answer: mix.ok,
    options: choices(mix.ok, mix.bad),
    hint: 'Los colores primarios son rojo, azul y amarillo. Mezclar dos primarios da siempre un secundario.',
    steps: [
      'Recuerda cuáles son los tres colores primarios.',
      'Mezclar dos de ellos siempre da un color secundario.',
      'Piensa en la rueda de color: el resultado queda justo entre los dos.'
    ]
  };
}

function artEscala(d) {
  const start = rand(0, 4);
  const step = d >= 4 ? 2 : 1;
  const seq = [0, 1, 2].map(i => NOTE_SEQ[(start + i * step) % NOTE_SEQ.length]);
  const next = NOTE_SEQ[(start + 3 * step) % NOTE_SEQ.length];
  return {
    kind: 'choice',
    prompt: `La escala avanza así:  ${seq.join(' · ')} · ?  — ¿qué nota sigue?`,
    answer: next,
    options: choices(next, shuffle(NOTE_SEQ.filter(n => n !== next)).slice(0, 3)),
    hint: `Las notas van do · re · mi · fa · sol · la · si y vuelven a empezar. Aquí el salto es de ${step} nota${step === 1 ? '' : 's'}.`,
    steps: [
      'Escribe la escala completa: do re mi fa sol la si.',
      `Marca dónde cae cada nota del reto y mide cuántos pasos hay entre ellas (${step}).`,
      'Avanza ese mismo salto desde la última nota que te dieron.'
    ]
  };
}

function artEscalaArmada() {
  const start = rand(0, 3);
  const notas = [0, 1, 2, 3].map(i => NOTE_SEQ[(start + i) % NOTE_SEQ.length]);
  return build({
    prompt: `Ordena estas notas como van en la escala, empezando por «${notas[0]}».`,
    lead: 'Toca las notas en el orden en que se tocan.',
    answer: notas,
    extras: shuffle(NOTE_SEQ.filter(n => !notas.includes(n))).slice(0, 2),
    hint: 'La escala es do · re · mi · fa · sol · la · si, y después vuelve a do.',
    steps: [
      'Escribe la escala entera en una hoja: do re mi fa sol la si.',
      `Busca «${notas[0]}» en esa fila.`,
      'Sigue hacia la derecha nota por nota; al llegar al final vuelves al principio.'
    ]
  });
}

function artAcorde() {
  const item = pick(ACORDES);
  return build({
    prompt: `Arma el acorde de ${item.nombre}: mete sus tres notas.`,
    lead: 'El orden da igual: un acorde suena igual se toque como se toque.',
    answer: item.notas,
    extras: item.sobran,
    unordered: true,
    hint: 'Un acorde se arma saltando notas: tomas una, te saltas la siguiente, tomas la otra, y así.',
    steps: [
      'Escribe la escala: do re mi fa sol la si.',
      `Empieza en la nota que da nombre al acorde (${item.notas[0]}).`,
      'Salta una nota, toma la siguiente, salta otra y toma la siguiente. Esas tres son.'
    ]
  });
}

function artPregunta(lista) {
  const item = pick(lista);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la pregunta otra vez y quédate con la palabra clave.',
      'Descarta lo que claramente es de otra familia o de otra época.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function artRound(d) {
  if (d <= 1) return pick([artPatron, artMezcla])();
  if (d === 2) {
    return pick([
      artMezcla,
      artEscalaArmada,
      () => artEscala(d),
      () => artPregunta(INSTRUMENTOS)
    ])();
  }
  return pick([
    () => artEscala(d),
    artAcorde,
    artEscalaArmada,
    () => artPregunta(INSTRUMENTOS),
    () => artPregunta(FIGURAS_MUSICALES),
    () => artPregunta(COLOR_TEORIA),
    () => artPregunta(OBRAS)
  ])();
}

// ---- Programación ----------------------------------------------------------
// La materia nueva. Se aprende a programar leyendo y ordenando código, no
// eligiendo entre cuatro botones, así que casi todos los retos son de armar:
// se ordenan los pasos de un algoritmo, las líneas de un programa o las piezas
// de una condición. Los pocos de opción múltiple son para "¿qué imprime esto?",
// que es lo único que sí se contesta con un valor.

const ALGORITMOS = {
  1: [
    { que: 'lavarte los dientes', pasos: ['Tomar el cepillo', 'Ponerle pasta', 'Cepillar los dientes', 'Enjuagarse la boca'] },
    { que: 'hacer un sándwich', pasos: ['Sacar el pan', 'Poner el relleno', 'Tapar con la otra rebanada', 'Comérselo'] },
    { que: 'salir de casa', pasos: ['Ponerse los zapatos', 'Tomar la mochila', 'Abrir la puerta', 'Cerrar con llave'] }
  ],
  2: [
    { que: 'sembrar una planta', pasos: ['Hacer un hoyo en la tierra', 'Poner la semilla dentro', 'Taparla con tierra', 'Regarla con agua'] },
    { que: 'buscar un libro en la biblioteca', pasos: ['Buscar el título en el catálogo', 'Anotar en qué estante está', 'Ir a ese estante', 'Tomar el libro'] }
  ]
};

// Programas cortos en pseudocódigo, para ordenar línea por línea.
const PROGRAMAS = {
  3: [
    {
      que: 'sumar los números del 1 al 5',
      lineas: ['total = 0', 'para i desde 1 hasta 5', '    total = total + i', 'mostrar total'],
      pista: 'Una variable se crea ANTES de usarla, y el resultado se muestra al final, cuando ya está completo.'
    },
    {
      que: 'decir si alguien es mayor de edad',
      lineas: ['edad = pedirNumero()', 'si edad >= 18', '    mostrar "mayor"', 'si no', '    mostrar "menor"'],
      pista: 'Primero se consigue el dato, después se pregunta por él. No puedes comparar algo que todavía no existe.'
    }
  ],
  4: [
    {
      que: 'encontrar el número más grande de una lista',
      lineas: ['mayor = lista[0]', 'para cada n en lista', '    si n > mayor', '        mayor = n', 'mostrar mayor'],
      pista: 'Se empieza suponiendo que el primero es el mayor, y se va corrigiendo al recorrer el resto.'
    },
    {
      que: 'contar cuántas veces aparece una letra',
      lineas: ['cuenta = 0', 'para cada letra en palabra', '    si letra == buscada', '        cuenta = cuenta + 1', 'mostrar cuenta'],
      pista: 'El contador arranca en cero fuera del bucle; si lo pones dentro, se reinicia en cada vuelta.'
    }
  ]
};

const CODIGO_SALIDA = {
  2: [
    { code: 'x = 3\ny = 4\nmostrar x + y', ok: '7', bad: ['34', '12', '1'], hint: 'El signo + entre dos números los suma; no los pega uno al lado del otro.' },
    { code: 'contador = 0\ncontador = contador + 2\ncontador = contador + 2\nmostrar contador', ok: '4', bad: ['2', '0', '22'], hint: 'Cada línea reemplaza el valor anterior. Ve anotando cuánto vale después de cada una.' }
  ],
  3: [
    { code: 'total = 0\npara i desde 1 hasta 4\n    total = total + i\nmostrar total', ok: '10', bad: ['4', '24', '0'], hint: 'Da la vuelta cuatro veces: 1, luego 1+2, luego 1+2+3…' },
    { code: 'palabra = "robin"\nmostrar largo(palabra)', ok: '5', bad: ['4', '6', 'robin'], hint: 'Cuenta las letras una por una, incluida la última.' },
    { code: 'x = 10\nsi x > 5\n    mostrar "grande"\nsi no\n    mostrar "chico"', ok: 'grande', bad: ['chico', '10', 'nada'], hint: '¿Es cierto que 10 es mayor que 5? Solo se ejecuta la rama que sea verdadera.' }
  ],
  4: [
    { code: 'lista = [3, 1, 4, 1, 5]\nmostrar largo(lista)', ok: '5', bad: ['4', '14', '3'], hint: 'Cuenta los elementos, aunque alguno se repita: el 1 aparece dos veces y cuenta dos veces.' },
    { code: 'x = 7\nmostrar x % 2', ok: '1', bad: ['3', '3.5', '0'], hint: 'El % da el RESTO de la división, no el resultado.' },
    { code: 'total = 1\npara i desde 1 hasta 4\n    total = total * i\nmostrar total', ok: '24', bad: ['10', '4', '0'], hint: 'Es un producto, no una suma: 1·1·2·3·4.' }
  ]
};

const CODIGO_CONCEPTO = {
  3: [
    { q: '¿Para qué sirve un bucle (un "para" o un "mientras")?', ok: 'Repetir instrucciones sin escribirlas muchas veces', bad: ['Guardar un dato', 'Decidir entre dos caminos', 'Terminar el programa'], hint: 'Si tienes que hacer lo mismo 100 veces, ¿lo escribes 100 veces?' },
    { q: '¿Qué es una variable?', ok: 'Un nombre que guarda un valor', bad: ['Una orden que se repite', 'Un error del programa', 'Un tipo de bucle'], hint: 'Es como una caja con etiqueta: guardas algo y luego lo pides por su nombre.' },
    { q: 'Si un bucle nunca cambia su condición, ¿qué pasa?', ok: 'Se repite para siempre', bad: ['Se salta el bucle', 'Da error de sintaxis', 'Se ejecuta una sola vez'], hint: 'Si la puerta de salida nunca se abre, no se sale.' }
  ],
  4: [
    { q: '¿Qué hace una función?', ok: 'Agrupa pasos con un nombre para poder reutilizarlos', bad: ['Guarda un solo número', 'Repite siempre lo mismo sin cambiar', 'Borra las variables'], hint: 'Le das un nombre a un bloque de trabajo y lo llamas cuando lo necesitas.' },
    { q: 'Recorrer los 1 000 elementos de una lista de uno en uno es, en notación O, …', ok: 'O(n)', bad: ['O(1)', 'O(n²)', 'O(log n)'], hint: 'El trabajo crece igual que el tamaño de la lista: el doble de datos, el doble de tiempo.' },
    { q: '¿Qué es depurar (debug) un programa?', ok: 'Buscar y arreglar por qué no hace lo que debería', bad: ['Borrar el código y empezar de nuevo', 'Hacerlo más bonito', 'Traducirlo a otro idioma'], hint: 'El nombre viene de sacarle los bichos al programa.' }
  ]
};

function algoritmoRound(d) {
  const item = pick(ALGORITMOS[d <= 1 ? 1 : 2]);
  return build({
    prompt: `Ordena los pasos para ${item.que}.`,
    lead: 'Un programa es eso: pasos en el orden correcto.',
    answer: item.pasos,
    hint: 'Pregúntate cuál no se puede hacer sin haber hecho otro antes. Ese otro va primero.',
    steps: [
      'Busca el paso que se puede hacer sin nada previo: ese es el primero.',
      'De los que quedan, busca cuál ya se puede hacer ahora.',
      'Repite hasta colocarlos todos. Si un paso necesita algo que aún no pasó, va más adelante.'
    ]
  });
}

function programaRound(d) {
  const item = pick(PROGRAMAS[d >= 4 ? 4 : 3]);
  return build({
    prompt: `Ordena las líneas del programa que sirve para ${item.que}.`,
    lead: 'Las líneas con sangría van dentro de la que tienen encima.',
    answer: item.lineas,
    hint: item.pista,
    steps: [
      'Busca las líneas que crean o piden datos: siempre van antes de usarlos.',
      'Las líneas con sangría van dentro del bucle o del "si" que tienen justo arriba.',
      `Pista de Robin: ${item.pista}`
    ]
  });
}

function salidaRound(d) {
  const item = pick(CODIGO_SALIDA[Math.min(4, Math.max(2, d))]);
  return {
    kind: 'choice',
    prompt: `¿Qué muestra este programa?\n\n${item.code}`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee el programa línea por línea, de arriba abajo.',
      'Anota en una hoja cuánto vale cada variable después de cada línea.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function conceptoRound(d) {
  const item = pick(CODIGO_CONCEPTO[d >= 4 ? 4 : 3]);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Quédate con la palabra clave de la pregunta.',
      'Descarta las opciones que describen otra cosa distinta.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Completar el código que falta -----------------------------------------
// El programa ya está escrito y le falta una pieza, marcada con ___. Es el
// reto que más se parece a programar de verdad: casi nunca se empieza de la
// nada, casi siempre se mira código que ya existe y se ve qué le falta.
//
// El enunciado dice QUÉ tiene que hacer el programa, no dónde está el hueco:
// encontrar por qué ese hueco es ese y no otro es medio ejercicio.

const CODIGO_COMPLETA = {
  2: [
    {
      que: 'sumar dos números y mostrar el resultado',
      code: 'a = 5\nb = 3\nmostrar ___',
      ok: 'a + b', bad: ['a b', '"a + b"', '5 + 3 = 8'],
      hint: 'Ya tienes los dos números guardados con un nombre. Úsalos por su nombre, no vuelvas a escribir los números.'
    },
    {
      que: 'saludar tres veces',
      code: 'para i desde 1 hasta ___\n    mostrar "hola"',
      ok: '3', bad: ['1', '"hola"', 'i'],
      hint: 'Cuenta cuántas vueltas quieres que dé. El "hasta" marca la última.'
    }
  ],
  3: [
    {
      que: 'contar hasta cuánto suman los números del 1 al 10',
      code: 'total = ___\npara i desde 1 hasta 10\n    total = total + i\nmostrar total',
      ok: '0', bad: ['1', '10', 'i'],
      hint: 'El acumulador arranca en el valor que no cambia nada al sumarle el primero. Si empieza en 1, el resultado sale uno de más.'
    },
    {
      que: 'decir si un número es par',
      code: 'si numero ___ 2 == 0\n    mostrar "par"\nsi no\n    mostrar "impar"',
      ok: '%', bad: ['/', '*', '+'],
      hint: 'Par significa que al dividirlo entre dos no sobra nada. ¿Qué signo da lo que sobra?'
    },
    {
      que: 'recorrer todas las palabras de una lista',
      code: 'palabras = ["sol", "mar", "pan"]\npara cada p ___ palabras\n    mostrar p',
      ok: 'en', bad: ['de', 'con', 'hasta'],
      hint: 'Se lee como una frase: "para cada p ___ palabras". ¿Cuál suena bien?'
    }
  ],
  4: [
    {
      que: 'quedarse con el número más grande de una lista',
      code: 'mayor = lista[0]\npara cada n en lista\n    si n ___ mayor\n        mayor = n\nmostrar mayor',
      ok: '>', bad: ['<', '==', '>='],
      hint: 'Solo hay que reemplazar al campeón cuando aparece alguien que lo supera de verdad.'
    },
    {
      que: 'una función que devuelve el doble de un número',
      code: 'funcion doble(n)\n    ___ n * 2\n\nmostrar doble(7)',
      ok: 'devolver', bad: ['mostrar', 'guardar', 'n ='],
      hint: 'Mostrar lo pinta en pantalla y se acaba ahí. Para poder escribir doble(7) DENTRO de otra cosa, la función tiene que entregar el valor.'
    },
    {
      que: 'sumar solo los números pares de una lista',
      code: 'total = 0\npara cada n en lista\n    si n % 2 == 0\n        total = total ___ n\nmostrar total',
      ok: '+', bad: ['*', '-', '='],
      hint: 'El acumulador va creciendo con cada par que encuentra. ¿Qué operación hace crecer?'
    },
    {
      que: 'parar el bucle en cuanto encuentra lo que busca',
      code: 'para cada n en lista\n    si n == buscado\n        mostrar "lo encontré"\n        ___',
      ok: 'romper', bad: ['seguir', 'devolver n', 'mostrar n'],
      hint: 'Ya lo encontraste: seguir recorriendo el resto de la lista es trabajo tirado.'
    }
  ]
};

// ---- ¿Está bien este código? -----------------------------------------------
// Se enseña un programa que PARECE correcto y hay que decir qué le pasa. Uno
// de cada tres está bien de verdad, y esa es la gracia: si siempre hubiera un
// error, la respuesta se acertaría sin leer el código.
//
// Es lo que de verdad se hace al programar —mirar código ajeno y encontrar por
// qué no hace lo que dice— y no sale con ningún otro tipo de reto.

const CODIGO_REVISA = {
  3: [
    {
      que: 'sumar los números del 1 al 5',
      code: 'total = 0\npara i desde 1 hasta 5\n    total = i\nmostrar total',
      ok: 'Pisa el total en vez de sumarle',
      bad: ['Está bien', 'El bucle empieza en el número equivocado', 'Falta mostrar el total'],
      hint: 'Mira la línea de dentro del bucle. ¿Suma, o reemplaza lo que había?'
    },
    {
      que: 'mostrar los números del 1 al 3',
      code: 'para i desde 1 hasta 3\n    mostrar i',
      ok: 'Está bien',
      bad: ['El bucle no termina nunca', 'Falta crear la variable i', 'Muestra un número de más'],
      hint: 'Recórrelo con el dedo: i vale 1, luego 2, luego 3. ¿Sale algo raro?'
    },
    {
      que: 'decir si alguien es mayor de edad',
      code: 'si edad > 18\n    mostrar "mayor"\nsi no\n    mostrar "menor"',
      ok: 'Con 18 exactos dice "menor"',
      bad: ['Está bien', 'Falta pedir la edad al principio', 'Las dos ramas dicen lo mismo'],
      hint: 'Prueba con edad = 18. ¿Es 18 mayor que 18?'
    },
    {
      que: 'contar cuántas veces aparece la letra a',
      code: 'para cada letra en palabra\n    cuenta = 0\n    si letra == "a"\n        cuenta = cuenta + 1\nmostrar cuenta',
      ok: 'El contador se reinicia en cada vuelta',
      bad: ['Está bien', 'Compara con la letra equivocada', 'Le falta el bucle'],
      hint: '¿Dónde está el "cuenta = 0"? Si está dentro del bucle, ¿cuántas veces se ejecuta?'
    }
  ],
  4: [
    {
      que: 'recorrer una lista de 5 elementos',
      code: 'i = 0\nmientras i <= largo(lista)\n    mostrar lista[i]\n    i = i + 1',
      ok: 'Se pasa del último elemento',
      bad: ['Está bien', 'Nunca entra al bucle', 'Empieza por el segundo'],
      hint: 'Si la lista tiene 5, sus posiciones son 0, 1, 2, 3 y 4. ¿Hasta dónde llega ese <=?',
      steps: ['Anota qué vale i en cada vuelta.', 'Escribe las posiciones que existen de verdad en la lista.', 'Compara la última vuelta con la última posición: ahí está el fallo.']
    },
    {
      que: 'dividir dos números',
      code: 'funcion dividir(a, b)\n    devolver a / b\n\nmostrar dividir(10, 0)',
      ok: 'Revienta al dividir entre cero',
      bad: ['Está bien', 'Le faltan los paréntesis', 'Devuelve el resto en vez del cociente'],
      hint: 'Mira con qué se está llamando a la función, no solo lo que hay dentro de ella.'
    },
    {
      que: 'buscar un nombre en una lista',
      code: 'encontrado = falso\npara cada n en lista\n    si n == buscado\n        encontrado = verdadero\nsi encontrado\n    mostrar "sí está"',
      ok: 'Está bien',
      bad: ['Nunca llega a ser verdadero', 'Le falta el si no', 'Compara mal los nombres'],
      hint: 'Es lento —recorre la lista entera aunque ya lo encontró— pero lento no es incorrecto. ¿Da la respuesta buena?'
    },
    {
      que: 'invertir el orden de una lista',
      code: 'nueva = []\ni = largo(lista) - 1\nmientras i >= 0\n    agregar(nueva, lista[i])\nmostrar nueva',
      ok: 'El bucle nunca termina',
      bad: ['Está bien', 'Empieza por el primero en vez del último', 'La lista nueva no se crea'],
      hint: '¿Quién cambia el valor de i dentro del bucle? Busca bien: nadie.'
    }
  ]
};

function completaRound(d) {
  const item = pick(CODIGO_COMPLETA[Math.min(4, Math.max(2, d))]);
  return {
    kind: 'choice',
    prompt: `Este programa sirve para ${item.que}, pero le falta una pieza. ¿Cuál va en el hueco?\n\n${item.code}`,
    lead: 'El hueco está marcado con ___',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee primero qué tiene que hacer el programa, antes de mirar el hueco.',
      'Tapa el hueco y pregúntate qué falta ahí para que eso pase.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function revisaRound(d) {
  const item = pick(CODIGO_REVISA[d >= 4 ? 4 : 3]);
  return {
    kind: 'choice',
    prompt: `Este programa debería ${item.que}. ¿Está bien?\n\n${item.code}`,
    lead: 'Cuidado: a veces sí está bien.',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: item.steps || [
      'Recórrelo línea por línea como si fueras la computadora.',
      'Anota cuánto vale cada variable después de cada línea.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function codeRound(d) {
  // Antes de saber leer código hay que saber ordenar pasos: el nivel de abajo
  // juega solo a eso, sin una sola línea de programa.
  if (d <= 1) return algoritmoRound(d);

  // De aquí arriba el juego subió de nivel. Antes solo había tres cosas que
  // hacer —ordenar líneas, adivinar la salida y contestar una definición— y
  // ninguna se parecía a programar: nadie escribe un programa poniendo en
  // orden líneas que ya existen. Las dos nuevas sí:
  //
  //   completar  hay código escrito y le falta una pieza
  //   revisar    hay código escrito y hay que decir qué le pasa (o que no le
  //              pasa nada, que también sale)
  //
  // Se reparten a propósito: las de mirar código pesan más que las de
  // recitar definiciones, que son las que menos enseñan.
  if (d === 2) return pick([algoritmoRound, completaRound, salidaRound, completaRound])(d);
  if (d === 3) return pick([completaRound, revisaRound, salidaRound, programaRound, completaRound, conceptoRound])(d);
  return pick([revisaRound, completaRound, programaRound, salidaRound, revisaRound, conceptoRound])(d);
}

// ---- Catálogo --------------------------------------------------------------

const GAMES = [
  {
    id: 'mate-rescate',
    name: 'Rescate numérico',
    subject: 'Matemáticas',
    icon: '🧮',
    color: 'red',
    blurb: 'Robin cayó en un pozo de números. Cada operación correcta lo sube un escalón.',
    make: mathRound
  },
  {
    id: 'lengua-cazapalabras',
    name: 'Cazapalabras',
    subject: 'Lenguaje',
    icon: '📖',
    color: 'gold',
    blurb: 'Se escaparon las palabras del cuento. Atrápalas: rimas, ortografía y sinónimos.',
    make: languageRound
  },
  {
    id: 'ciencia-laboratorio',
    name: 'Laboratorio de Robin',
    subject: 'Ciencias',
    icon: '🔬',
    color: 'green',
    blurb: 'Experimentos que salen bien solo si entiendes qué está pasando.',
    make: scienceRound
  },
  {
    id: 'sociales-brujula',
    name: 'La brújula',
    subject: 'Estudios Sociales',
    icon: '🧭',
    color: 'blue',
    blurb: 'Mapas, fechas y cómo funciona el mundo de las personas.',
    make: socialRound
  },
  {
    id: 'ingles-wordbridge',
    name: 'Word Bridge',
    subject: 'Inglés',
    icon: '🌉',
    color: 'blue',
    blurb: 'Cruza el puente una palabra a la vez. Robin traduce solo si te trabas.',
    make: englishRound
  },
  {
    id: 'arte-nido',
    name: 'Nido de ritmos',
    subject: 'Arte y Música',
    icon: '🎨',
    color: 'gold',
    blurb: 'Colores que se mezclan, acordes que se arman y obras que hay que reconocer.',
    make: artRound
  },
  {
    id: 'codigo-taller',
    name: 'Taller de código',
    subject: 'Programación',
    icon: '💻',
    color: 'green',
    blurb: 'Ordena los pasos, arma el programa y averigua qué imprime. Sin escribir una línea desde cero.',
    make: codeRound
  }
];

const GAME_IDS = GAMES.map(g => g.id);

function getGame(id) {
  return GAMES.find(g => g.id === id) || null;
}

// La ficha pública de un minijuego: lo que se dibuja en la galería, sin nada
// de la lógica de los retos.
function gameCard(game) {
  return {
    id: game.id,
    name: game.name,
    subject: game.subject,
    icon: game.icon,
    color: game.color,
    blurb: game.blurb
  };
}

function catalog() {
  return GAMES.map(gameCard);
}

// Arma un reto. Devuelve dos objetos: el que se le manda al navegador (sin la
// respuesta) y el secreto que se guarda en la sesión para calificar y dar
// pistas después.
function buildRound(gameId, difficulty) {
  const game = getGame(gameId);
  if (!game) return null;
  const d = Math.min(4, Math.max(1, Number(difficulty) || 2));
  const round = game.make(d);

  return {
    publicRound: {
      gameId: game.id,
      gameName: game.name,
      subject: game.subject,
      icon: game.icon,
      difficulty: d,
      kind: round.kind,
      prompt: round.prompt,
      lead: round.lead || null,
      options: round.options || null,
      // Solo los retos de armar: el montón de piezas y cuántas caben. La
      // respuesta sigue sin bajar, porque las piezas vienen revueltas y con
      // sobrantes: tenerlas no dice en qué orden van.
      pieces: round.pieces || null,
      slots: round.slots || null,
      join: round.join === undefined ? null : round.join,
      unordered: Boolean(round.unordered)
    },
    secret: {
      gameId: game.id,
      difficulty: d,
      answer: String(round.answer),
      answerPieces: round.answerPieces || null,
      join: round.join === undefined ? ' ' : round.join,
      unordered: Boolean(round.unordered),
      hint: round.hint,
      steps: round.steps,
      startedAt: Date.now()
    }
  };
}

// Compara sin castigar por mayúsculas, acentos o espacios de más: el reto es
// de la materia, no de teclear exacto.
function normalize(text) {
  return String(text == null ? '' : text)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// Un reto de armar llega como arreglo de piezas; los otros dos, como texto.
//
// Cuando el orden da igual (juntar sodio y cloro) se comparan los dos montones
// ordenados alfabéticamente, no la cadena: de lo contrario "cloro, sodio"
// contaría como error cuando es exactamente la misma mezcla.
function isCorrect(secret, submitted) {
  if (Array.isArray(submitted)) {
    const esperadas = (secret.answerPieces || []).map(normalize);
    const puestas = submitted.map(normalize);
    if (puestas.length !== esperadas.length) return false;

    if (secret.unordered) {
      const a = puestas.slice().sort();
      const b = esperadas.slice().sort();
      return a.every((pieza, i) => pieza === b[i]);
    }
    return puestas.every((pieza, i) => pieza === esperadas[i]);
  }
  return normalize(secret.answer) === normalize(submitted);
}

module.exports = {
  GAMES, GAME_IDS, catalog, gameCard, getGame,
  buildRound, isCorrect, difficultyFor, difficultyForAge, normalize, LEVEL_DIFFICULTY
};

});

RRModulos.define("src/permissions", function (require, module, exports, __dirname, __filename) {
// src/permissions.js
// ---------------------------------------------------------------------------
// Quién puede hacer qué dentro de una escuela.
//
// Los roles, de más a menos alcance:
//
//   admin       Dirección. Ve TODAS las cuentas y TODAS las clases de su
//               escuela, y es el único que crea cuentas de subdirección y
//               secretaría.
//   subdirector Lo mismo que dirección, menos crear más personal de dirección.
//   secretary   Secretaría. Ve todo y lleva las cuentas de estudiantes, pero
//               NO puede generar códigos de profesor: eso queda solo en
//               dirección y subdirección, que es justo el punto de tener el
//               rol aparte.
//   teacher     Profesorado. Sus clases, sus estudiantes, sus avisos y qué
//               minijuegos quedan activos en cada clase.
//   student     Estudiantado. Solo lo suyo. No cambia su propia contraseña:
//               esa se la restablece su profesor o la dirección.
//   personal    Cuenta personal, fuera de cualquier escuela.
//
// Todo se consulta con can(rol, 'permiso'). Ninguna ruta debería mirar el rol
// a mano: si mañana aparece un rol nuevo, se agrega aquí y ya.
// ---------------------------------------------------------------------------

const PERMISSIONS = {
  admin: [
    'school.view',          // ver el panel de la escuela
    'school.viewAllUsers',  // ver todas las cuentas de la escuela
    'school.viewAllClasses',// ver todas las clases de la escuela
    'school.rename',
    'codes.teacher',        // generar códigos de profesor (un solo uso)
    'codes.student',        // generar códigos de estudiante
    'codes.revoke',
    'staff.manage',         // crear subdirección y secretaría
    'school.limits',        // subir el margen diario de Robin de su escuela
    'accounts.create',
    'accounts.edit',
    'accounts.delete',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create',
    'announcements.deleteAny',
    'games.configureSchool'
  ],
  subdirector: [
    'school.view',
    'school.viewAllUsers',
    'school.viewAllClasses',
    'codes.teacher',
    'codes.student',
    'codes.revoke',
    'accounts.create',
    'accounts.edit',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create',
    'announcements.deleteAny',
    'games.configureSchool'
  ],
  secretary: [
    'school.view',
    'school.viewAllUsers',
    'school.viewAllClasses',
    // Ojo: aquí NO va 'codes.teacher'. Secretaría lleva estudiantes, no
    // contrata profesorado.
    'codes.student',
    'accounts.create',
    'accounts.edit',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create'
  ],
  teacher: [
    'classes.create',
    'classes.invite',
    'classes.manageOwn',
    'activities.create',
    'activities.grade',
    'codes.student',
    'accounts.resetPassword',    // solo de sus propios estudiantes
    'accounts.viewCredentials',  // idem
    'announcements.create',
    'games.configureClass'
  ],
  student: [
    'classes.join',
    'activities.view',
    'games.play'
  ],
  personal: [
    'games.play',
    'plans.manage'
  ],
  // Familia. No pertenece a la escuela: acompaña a una o varias cuentas de
  // estudiante, y de ellas solo ve el pase de lista — si llegó y cuándo.
  parent: [
    'children.view'
  ]
};

// Roles que trabajan desde la dirección de la escuela.
const STAFF_ROLES = ['admin', 'subdirector', 'secretary'];
// Roles que pertenecen a una escuela (a diferencia de 'personal').
const SCHOOL_ROLES = ['admin', 'subdirector', 'secretary', 'teacher', 'student'];

const ROLE_LABEL = {
  admin: 'Dirección',
  subdirector: 'Subdirección',
  secretary: 'Secretaría',
  teacher: 'Profesor',
  student: 'Estudiante',
  personal: 'Cuenta personal',
  parent: 'Padre o madre'
};

function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

// Los permisos de un rol, tal cual, para que el navegador dibuje solo los
// botones que esa persona sí puede pulsar. Esconder un botón no protege nada
// por sí solo: la ruta del servidor vuelve a comprobarlo siempre.
function permissionsOf(role) {
  return (PERMISSIONS[role] || []).slice();
}

function isStaff(role) { return STAFF_ROLES.includes(role); }
function isSchoolRole(role) { return SCHOOL_ROLES.includes(role); }

// Middleware de Express: exige un permiso concreto en vez de un rol concreto.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
    }
    if (!can(req.session.role, permission)) {
      return res.status(403).json({ error: 'No tienes permiso para hacer eso.' });
    }
    next();
  };
}

module.exports = {
  PERMISSIONS, STAFF_ROLES, SCHOOL_ROLES, ROLE_LABEL,
  can, permissionsOf, isStaff, isSchoolRole, requirePermission
};

});

RRModulos.define("src/plans", function (require, module, exports, __dirname, __filename) {
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

});

RRModulos.define("src/store", function (require, module, exports, __dirname, __filename) {
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
//   Las caras. Ver CAMPOS_QUE_NO_SUBEN: la foto de reconocimiento, la huella
//   que face-api saca de ella y la foto de perfil se quedan en el navegador
//   de quien las tomó, en IndexedDB (public/js/face-vault.js). Son datos
//   biométricos de menores de edad; no tienen por qué estar en un servidor
//   de nadie. Si una fila ya venía con ellos, se le quitan al subirla.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const USA_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

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

// Las caras y la foto de perfil se quedan en el dispositivo. Ver la cabecera.
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


});

RRModulos.define("routes/activities", function (require, module, exports, __dirname, __filename) {
// routes/activities.js
// Las asignaciones de una clase: lo que el profesor deja y lo que el
// estudiante entrega.
//
// Un estudiante ve aquí lo que le toca, con su fecha, y tiene al lado el botón
// para que Robin le ayude — que nunca es "dame la respuesta", sino el plan
// para hacerla (eso vive en routes/ai.js, en /api/ai/homework).

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');
const { can } = require('../src/permissions');

// ¿Puede esta persona mirar dentro de esta clase?
function accesoAClase(user, classItem) {
  if (!classItem) return false;
  if (user.role === 'student') return (classItem.studentIds || []).includes(user.id);
  if (user.role === 'teacher') return classItem.teacherId === user.id;
  return can(user.role, 'school.viewAllClasses') && Number(classItem.schoolId) === Number(user.schoolId);
}

// Todas las asignaciones de quien pregunta, de todas sus clases juntas. Es la
// pantalla de "mis asignaciones" del estudiante.
router.get('/mine', requireRole('student'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const hoy = db.todayKey();
  const asignaciones = db.getAssignmentsForStudent(me.id);

  res.json({
    assignments: asignaciones.map(a => Object.assign({}, a, {
      state: a.submission ? (a.submission.grade != null ? 'calificada' : 'entregada')
        : a.dueDate && a.dueDate < hoy ? 'atrasada' : 'pendiente'
    }))
  });
});

router.get('/class/:classId', requireLogin, (req, res) => {
  const classItem = db.getClassById(req.params.classId);
  const user = db.getUserById(req.session.userId);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });
  if (!accesoAClase(user, classItem)) return res.status(403).json({ error: 'No tienes acceso a esa clase.' });

  const actividades = db.getActivitiesForClass(req.params.classId).map(a => {
    if (user.role === 'student') {
      const entrega = db.getSubmission(a.id, user.id);
      return Object.assign({}, a, {
        submission: entrega
          ? { id: entrega.id, text: entrega.text, grade: entrega.grade, feedback: entrega.feedback, updatedAt: entrega.updatedAt }
          : null
      });
    }
    // Para quien da la clase, lo que importa es cuántos entregaron ya.
    const entregas = db.getSubmissionsForActivity(a.id);
    return Object.assign({}, a, {
      submissionCount: entregas.length,
      gradedCount: entregas.filter(s => s.grade != null).length,
      studentCount: (classItem.studentIds || []).length
    });
  });

  res.json({ activities: actividades });
});

router.post('/class/:classId', requireRole('teacher'), (req, res) => {
  const classItem = db.getClassById(req.params.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  }

  const { title, description, dueDate, subject, points } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'La actividad necesita un título.' });

  const activity = db.createActivity({
    classId: req.params.classId,
    title: String(title).trim(),
    description, dueDate
  });
  db.updateActivity(activity.id, {
    subject: subject || classItem.subject || null,
    points: points === undefined ? 10 : points
  });

  (classItem.studentIds || []).forEach(studentId => {
    db.addNotification(studentId, {
      type: 'new-activity',
      classId: classItem.id,
      activityId: activity.id,
      title: 'Nueva actividad',
      message: `${classItem.teacherName} publicó una actividad nueva: ${activity.title}`
    });
  });

  res.status(201).json({ activity: db.getActivityById(activity.id) });
});

router.put('/:id', requireRole('teacher'), (req, res) => {
  const activity = db.getActivityById(req.params.id);
  const classItem = activity && db.getClassById(activity.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(404).json({ error: 'No encontramos esa actividad.' });
  }
  res.json({ activity: db.updateActivity(activity.id, req.body || {}) });
});

router.delete('/:id', requireRole('teacher'), (req, res) => {
  const activity = db.getActivityById(req.params.id);
  const classItem = activity && db.getClassById(activity.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(404).json({ error: 'No encontramos esa actividad.' });
  }
  db.deleteActivity(activity.id);
  res.json({ ok: true });
});

// ---- Entregas --------------------------------------------------------------

router.post('/:id/submit', requireRole('student'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const activity = db.getActivityById(req.params.id);
  const classItem = activity && db.getClassById(activity.classId);

  if (!classItem || !(classItem.studentIds || []).includes(me.id)) {
    return res.status(403).json({ error: 'Esa asignación no es tuya.' });
  }
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escribe tu respuesta antes de entregar.' });

  const entrega = db.saveSubmission({ activityId: activity.id, studentId: me.id, text });
  db.addNotification(classItem.teacherId, {
    type: 'submission',
    classId: classItem.id,
    activityId: activity.id,
    title: 'Entrega nueva',
    message: `${me.fullName} entregó «${activity.title}».`
  });

  res.json({ submission: entrega, message: '¡Entregado! Tu profesor ya lo tiene.' });
});

router.get('/:id/submissions', requireRole('teacher'), (req, res) => {
  const activity = db.getActivityById(req.params.id);
  const classItem = activity && db.getClassById(activity.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(404).json({ error: 'No encontramos esa actividad.' });
  }

  const entregas = db.getSubmissionsForActivity(activity.id).map(s => {
    const student = db.getUserById(s.studentId);
    return Object.assign({}, s, {
      studentName: student ? student.fullName : 'Cuenta borrada',
      studentCode: student ? student.studentCode : null
    });
  });

  // Quién falta también es información: es la mitad del trabajo de revisar.
  const entregaron = new Set(entregas.map(s => s.studentId));
  const pendientes = (classItem.studentIds || [])
    .filter(id => !entregaron.has(id))
    .map(id => db.getUserById(id))
    .filter(Boolean)
    .map(u => ({ id: u.id, fullName: u.fullName, studentCode: u.studentCode }));

  res.json({ activity, submissions: entregas, missing: pendientes });
});

router.put('/submissions/:submissionId', requireRole('teacher'), (req, res) => {
  const { grade, feedback } = req.body || {};
  const entrega = db.gradeSubmission(req.params.submissionId, { grade, feedback });
  if (!entrega) return res.status(404).json({ error: 'No encontramos esa entrega.' });

  const activity = db.getActivityById(entrega.activityId);
  const classItem = activity && db.getClassById(activity.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(403).json({ error: 'Esa entrega no es de una clase tuya.' });
  }

  db.addNotification(entrega.studentId, {
    type: 'graded',
    classId: classItem.id,
    activityId: activity.id,
    title: 'Te calificaron',
    message: `«${activity.title}»: ${entrega.grade != null ? `${entrega.grade} de ${activity.points || 10}` : 'revisada'}.`
  });

  res.json({ submission: entrega });
});

module.exports = router;

});

RRModulos.define("routes/ai", function (require, module, exports, __dirname, __filename) {
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
      'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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
      'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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

});

RRModulos.define("routes/announcements", function (require, module, exports, __dirname, __filename) {
// routes/announcements.js
// Avisos de la escuela. Cada aviso pertenece a una escuela, así que dos
// escuelas que corran en la misma instalación nunca ven los avisos de la otra.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');
const { requirePermission, can } = require('../src/permissions');

const VALID_LEVELS = [...db.LEVELS, 'Todos los niveles'];

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  if (me.role === 'personal') return res.json({ announcements: [] });

  const schoolId = me.schoolId || null;
  if (me.role === 'student') {
    return res.json({ announcements: db.getAnnouncementsForLevel(schoolId, me.level) });
  }
  return res.json({ announcements: db.getAnnouncements(schoolId) });
});

router.post('/', requirePermission('announcements.create'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { title, content, level } = req.body || {};

  if (!title || !content || !level) {
    return res.status(400).json({ error: 'Necesitas un título, un mensaje y un nivel.' });
  }
  if (!VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: 'Ese nivel no existe.' });
  }

  const announcement = db.createAnnouncement({
    authorId: me.id,
    authorName: me.fullName,
    schoolId: me.schoolId || null,
    title, content, level
  });
  res.status(201).json({ announcement });
});

router.delete('/:id', requirePermission('announcements.create'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const announcement = db.getAnnouncementById(req.params.id);
  if (!announcement) return res.status(404).json({ error: 'No encontramos ese aviso.' });

  // Un profesor (o secretaria) solo borra los suyos; direccion y subdireccion
  // borran cualquiera de su escuela.
  const sameSchool = me.schoolId == null || Number(announcement.schoolId) === Number(me.schoolId);
  const allowed = can(me.role, 'announcements.deleteAny') ? sameSchool : announcement.authorId === me.id;
  if (!allowed) return res.status(403).json({ error: 'No puedes borrar ese aviso.' });

  db.deleteAnnouncement(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

});

RRModulos.define("routes/attendance", function (require, module, exports, __dirname, __filename) {
// routes/attendance.js
// El pase de lista.
//
// La cámara y el reconocimiento de caras viven enteros en el navegador
// (face-api.js): aquí nunca llega una foto de la cámara, solo el id de a quién
// reconoció y la huella de 128 números que se guarda una vez por estudiante,
// al darlo de alta con su foto.
//
// Quién puede pasar lista:
//   profesorado          de los estudiantes de sus clases
//   dirección y demás    de cualquiera de su escuela
//
// Parvularia no lleva pase de lista: ver ATTENDANCE_LEVELS en src/db.js.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');
const { can } = require('../src/permissions');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// El día, escrito como lo diría una persona. Se arma aquí y no en el
// navegador para que la fecha que se ve sea exactamente la que se guarda.
function describirDia(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  return {
    date: iso,
    weekday: DIAS[fecha.getDay()],
    label: `${DIAS[fecha.getDay()]} ${d} de ${MESES[m - 1]} de ${y}`,
    // Sábado y domingo no son día de clase: se avisa, pero no se prohíbe —
    // hay escuelas que sí abren el sábado.
    weekend: fecha.getDay() === 0 || fecha.getDay() === 6
  };
}

function fechaValida(raw) {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

// La gente a la que esta persona sí le puede pasar lista.
function alcanceDe(me) {
  if (can(me.role, 'school.viewAllUsers')) {
    // Sin escuela no hay a quién pasarle lista. Sin esta comprobación, una
    // cuenta de dirección todavía sin escuela inscrita (schoolId null) se
    // compararía null con null y se llevaría a todas las cuentas sueltas de
    // la base.
    if (!me.schoolId) return [];
    return db.getAllUsers().filter(u =>
      u.role === 'student' && Number(u.schoolId) === Number(me.schoolId));
  }
  if (me.role === 'teacher') return db.getStudentsOfTeacher(me.id);
  return null;
}

function puedeCon(me, student) {
  if (!student || student.role !== 'student') return false;
  if (can(me.role, 'school.viewAllUsers')) {
    return Boolean(me.schoolId) && Number(student.schoolId) === Number(me.schoolId);
  }
  return me.role === 'teacher' && db.teacherTeachesStudent(me.id, student.id);
}

// ---- La lista del día ------------------------------------------------------

router.get('/roster', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  let students = alcanceDe(me);
  if (!students) return res.status(403).json({ error: 'No tienes permiso para pasar lista.' });

  const date = fechaValida(req.query.date) ? req.query.date : db.todayKey();
  const classId = req.query.classId ? Number(req.query.classId) : null;
  const level = req.query.level || '';

  if (classId) {
    const clase = db.getClassById(classId);
    const ids = clase ? clase.studentIds || [] : [];
    students = students.filter(u => ids.includes(u.id));
  }
  if (level) students = students.filter(u => u.level === level);

  const lista = db.attendanceRoster(students, date, classId);
  const presentes = lista.filter(s => s.status === 'present' || s.status === 'late').length;

  res.json({
    day: describirDia(date),
    levels: db.ATTENDANCE_LEVELS,
    classes: (me.role === 'teacher' ? db.getClassesForTeacher(me.id) : db.getClassesForSchool(me.schoolId))
      .map(c => ({ id: c.id, name: c.name, level: c.level || null })),
    students: lista,
    // Cuántos hay puestos ya, para la barra de arriba.
    tally: {
      total: lista.length,
      present: lista.filter(s => s.status === 'present').length,
      late: lista.filter(s => s.status === 'late').length,
      absent: lista.filter(s => s.status === 'absent').length,
      pending: lista.length - lista.filter(s => s.status).length,
      here: presentes
    }
  });
});

// ---- Marcar --------------------------------------------------------------

router.post('/mark', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { studentId, classId, status, method } = req.body || {};
  const date = fechaValida((req.body || {}).date) ? req.body.date : db.todayKey();

  const student = db.getUserById(studentId);
  if (!puedeCon(me, student)) {
    return res.status(403).json({ error: 'Ese estudiante no es de tus clases.' });
  }
  if (!db.attendanceAllowed(student)) {
    return res.status(400).json({
      error: 'En ese nivel no se lleva pase de lista. Va de primaria en adelante.'
    });
  }
  if (!db.ATTENDANCE_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Ese estado no existe.' });
  }

  const record = db.markAttendance({
    studentId: student.id,
    classId: classId ? Number(classId) : null,
    schoolId: student.schoolId,
    date,
    status,
    method: method === 'face' ? 'face' : 'manual',
    byId: me.id,
    byName: me.fullName
  });

  // La familia se entera de que llegó (o de que no) sin tener que estar
  // mirando la pantalla.
  avisarFamilia(student, record, me);

  res.json({ record });
});

const TEXTO_ESTADO = {
  present: 'llegó a clase',
  late: 'llegó tarde',
  absent: 'no llegó a clase'
};

function avisarFamilia(student, record, me) {
  if (!record) return;
  db.getAllUsers()
    .filter(u => u.role === 'parent' && (u.childIds || []).includes(student.id))
    .forEach(parent => {
      db.addNotification(parent.id, {
        type: 'attendance',
        title: `${student.fullName.split(' ')[0]} ${TEXTO_ESTADO[record.status]}`,
        message: `${record.date} · lo marcó ${me.fullName}.`
      });
    });
}

// Cerrar el pase: quien quedó sin marcar se da por ausente. Es el gesto que
// remata el pase de lista, y hacerlo a mano uno por uno era lo más pesado de
// toda la pantalla.
router.post('/close', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  let students = alcanceDe(me);
  if (!students) return res.status(403).json({ error: 'No tienes permiso para pasar lista.' });

  const date = fechaValida((req.body || {}).date) ? req.body.date : db.todayKey();
  const classId = (req.body || {}).classId ? Number(req.body.classId) : null;

  if (classId) {
    const clase = db.getClassById(classId);
    const ids = clase ? clase.studentIds || [] : [];
    students = students.filter(u => ids.includes(u.id));
  }

  const lista = db.attendanceRoster(students, date, classId).filter(s => !s.status);
  lista.forEach(s => {
    const record = db.markAttendance({
      studentId: s.id,
      classId,
      schoolId: me.schoolId,
      date,
      status: 'absent',
      method: 'manual',
      byId: me.id,
      byName: me.fullName
    });
    avisarFamilia(db.getUserById(s.id), record, me);
  });

  res.json({ ok: true, marked: lista.length });
});

// ---- La ficha de cada estudiante ------------------------------------------

// Aquí ya no se guarda ninguna cara.
//
// La foto de reconocimiento y su huella se quedan en el navegador del aparato
// donde se pasa lista, en IndexedDB — ver public/js/face-vault.js. Son datos
// biométricos de menores de edad y no tienen por qué estar en la base de datos
// de nadie, y menos cuando el reconocimiento ya corre entero en el navegador y
// la foto solo hace falta donde está la cámara.
//
// La ruta sigue existiendo para contestar con algo claro a una pestaña vieja
// que se quedara abierta desde antes del cambio, en lugar de un 404 mudo.
router.put('/student/:id/face', requireLogin, (req, res) => {
  res.status(410).json({
    error: 'Las fotos de reconocimiento ya no se guardan en el servidor: ahora ' +
           'viven en este navegador. Recarga la página y vuelve a subirla.'
  });
});

// El teléfono de la familia. Va aparte de la foto porque se rellena en otro
// momento —la foto el primer día, el teléfono cuando alguien lo pregunta— y
// porque una foto pesa un megabyte y un número pesa nueve dígitos: mandarlos
// juntos obligaría a resubir la foto cada vez que se corrige el número.
router.put('/student/:id/contact', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const student = db.getUserById(req.params.id);
  if (!puedeCon(me, student)) {
    return res.status(403).json({ error: 'Ese estudiante no es de tus clases.' });
  }

  const { parentPhoneCode, parentPhone } = req.body || {};
  const soloDigitos = String(parentPhone == null ? '' : parentPhone).replace(/[^0-9]/g, '');
  if (soloDigitos && soloDigitos.length < 7) {
    return res.status(400).json({ error: 'Ese número se ve corto. Escríbelo completo, sin el código de país.' });
  }

  const actualizado = db.setStudentContact(student.id, { parentPhoneCode, parentPhone });
  res.json({
    ok: true,
    parentPhoneCode: actualizado.parentPhoneCode,
    parentPhone: actualizado.parentPhone
  });
});

// El número de lista. Se puede repetir entre clases distintas, así que no se
// comprueba que sea único: lo que importa es el orden dentro de la pantalla.
router.put('/student/:id/number', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const student = db.getUserById(req.params.id);
  if (!puedeCon(me, student)) {
    return res.status(403).json({ error: 'Ese estudiante no es de tus clases.' });
  }
  db.setStudentListNumber(student.id, (req.body || {}).listNumber);
  res.json({ ok: true, listNumber: db.getUserById(student.id).listNumber });
});

// ---- Historial -------------------------------------------------------------

router.get('/history/:studentId', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const student = db.getUserById(req.params.studentId);
  const propio = me.id === Number(req.params.studentId);

  if (!student || (!propio && !puedeCon(me, student) && !db.isParentOf(me.id, student.id))) {
    return res.status(403).json({ error: 'No puedes ver esa asistencia.' });
  }

  const records = db.attendanceHistory(student.id, Number(req.query.limit) || 30);
  res.json({
    student: { id: student.id, fullName: student.fullName, studentCode: student.studentCode || null },
    records: records.map(r => Object.assign({}, r, { day: describirDia(r.date) }))
  });
});

module.exports = router;
module.exports.describirDia = describirDia;

});

RRModulos.define("routes/auth", function (require, module, exports, __dirname, __filename) {
// routes/auth.js
// Registro e inicio de sesión. Hay tres formas de crear una cuenta:
//
//   mode: 'personal'  -> cuenta personal (público general / estudiante por su
//                        cuenta). Entra directo al espacio de trabajo con Robin.
//   mode: 'school'    -> inscribir una escuela. Quien la inscribe queda como
//                        director (admin) y recibe los dos códigos de ingreso.
//   mode: 'join'      -> unirse a una escuela existente con un código. El
//                        código decide si la cuenta es de estudiante o de
//                        profesor; nadie elige su propio rol.
//
// Los códigos de 'join' pueden ser de dos clases y las dos se resuelven en la
// misma casilla, porque quien llega con un papelito en la mano no tiene por
// qué saber cuál le tocó:
//
//   permanente  el de la escuela entera, sirve para mucha gente
//   nominal     de un solo uso, emitido para una persona concreta, y a veces
//               ya trae puestos el nivel y el grado

const express = require('express');
const router = express.Router();
const db = require('../src/db.js');

function startSession(req, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
}

router.get('/me', (req, res) => {
  const user = req.session.userId ? db.getUserById(req.session.userId) : null;
  if (!user) return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
  // El rol pudo cambiar desde otra pestaña (una invitación aceptada, por
  // ejemplo): la sesión se pone al día sola.
  req.session.role = user.role;
  res.json({ user: db.publicUser(user) });
});

// Resuelve un código de ingreso, sea permanente o nominal. Devuelve siempre la
// misma forma para que la pantalla de registro no tenga que distinguirlos.
function resolveAnyCode(raw) {
  const permanente = db.resolveJoinCode(raw);
  if (permanente) {
    return {
      ok: true,
      kind: 'permanent',
      school: permanente.school,
      role: permanente.role,
      forName: null, level: null, grade: null, classId: null, codeId: null
    };
  }

  const nominal = db.checkJoinCode(raw);
  if (nominal.ok) {
    return {
      ok: true,
      kind: 'nominal',
      school: nominal.school,
      role: nominal.code.type,
      forName: nominal.code.forName,
      level: nominal.code.level,
      grade: nominal.code.grade,
      classId: nominal.code.classId,
      codeId: nominal.code.id
    };
  }

  const motivos = {
    'no-existe': 'Ese código no existe. Revisa que no se te haya ido una letra.',
    'anulado': 'Ese código fue anulado. Pídele uno nuevo a quien te lo dio.',
    'usado': 'Ese código ya se usó. Cada código personal sirve una sola vez.'
  };
  return { ok: false, error: motivos[nominal.reason] || 'Ese código no sirve.' };
}

// Consulta pública: ¿este código existe y a qué escuela / rol corresponde?
// Se usa en el registro para mostrar el nombre de la escuela antes de crear
// la cuenta. Nunca revela ningún otro código.
router.get('/join-code/:code', (req, res) => {
  const match = resolveAnyCode(req.params.code);
  if (!match.ok) return res.status(404).json({ error: match.error });

  res.json({
    school: { id: match.school.id, name: match.school.name },
    role: match.role,
    kind: match.kind,
    forName: match.forName,
    level: match.level,
    grade: match.grade,
    className: match.classId ? (db.getClassById(match.classId) || {}).name || null : null
  });
});

router.post('/register', (req, res) => {
  const body = req.body || {};
  const mode = body.mode;
  const fullName = String(body.fullName || '').trim();
  const password = String(body.password || '');
  const email = body.email ? String(body.email).trim() : null;

  if (!fullName) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  if (email && db.getUserByEmail(email)) return res.status(409).json({ error: 'Ese correo ya está registrado.' });

  // --- Cuenta personal ------------------------------------------------------
  // Aquí sí se pide la edad. Una cuenta de escuela no la necesita porque su
  // nivel y su grado ya dicen lo mismo con más precisión; una cuenta personal
  // no tiene ninguna de las dos cosas, y sin ese dato Robin le explica igual a
  // alguien de 8 años que a alguien de 40.
  if (mode === 'personal') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta personal.' });

    const age = Number(body.age);
    if (!Number.isFinite(age) || Math.floor(age) !== age) {
      return res.status(400).json({ error: 'Escribe tu edad en años.' });
    }
    if (age < 4 || age > 120) {
      return res.status(400).json({ error: 'Esa edad no parece real. Escríbela en años.' });
    }

    const user = db.createUser({ fullName, email, password, role: 'personal', plan: 'free', age });
    startSession(req, user);
    return res.status(201).json({ user: db.publicUser(user) });
  }

  // --- Cuenta de padre o madre ---------------------------------------------
  // Vive en el mismo camino que la cuenta personal, porque es lo que es: una
  // cuenta de alguien de fuera de la escuela. Lo único distinto es a quién
  // acompaña, y eso se dice con el ID de estudiante de su hijo — el mismo
  // que ya usa para entrar, así que no hay un código nuevo que repartir.
  if (mode === 'parent') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta de familia.' });

    const code = String(body.studentCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Escribe el ID de estudiante de tu hijo o hija.' });
    if (!db.getUserByStudentCode(code)) {
      return res.status(400).json({ error: 'No hay ningún estudiante con ese ID. Se parece a STU-00007.' });
    }

    const user = db.createUser({ fullName, email, password, role: 'parent', plan: 'free' });
    const enlace = db.linkChild(user.id, code);
    if (enlace.ok) {
      db.addNotification(enlace.student.id, {
        type: 'family',
        title: 'Tu familia sigue tu asistencia',
        message: `${fullName} podrá ver si llegaste a clase cada día.`
      });
    }

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(db.getUserById(user.id)),
      child: enlace.ok ? { fullName: enlace.student.fullName } : null
    });
  }

  // --- Inscribir una escuela (el que la crea queda como director) -----------
  if (mode === 'school') {
    const schoolName = String(body.schoolName || '').trim();
    if (!schoolName) return res.status(400).json({ error: 'Escribe el nombre de tu escuela.' });
    if (!email) return res.status(400).json({ error: 'El correo es necesario para la cuenta del director.' });

    const user = db.createUser({ fullName, email, password, role: 'admin' });
    const school = db.createSchool({ name: schoolName, directorId: user.id, directorName: user.fullName });
    db.updateUser(user.id, { schoolId: school.id });

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(db.getUserById(user.id)),
      school: {
        id: school.id,
        name: school.name,
        studentCode: school.studentCode,
        teacherCode: school.teacherCode
      }
    });
  }

  // --- Unirse con un código (estudiante o profesor) -------------------------
  if (mode === 'join') {
    const match = resolveAnyCode(body.code);
    if (!match.ok) return res.status(400).json({ error: match.error });

    const { school, role } = match;
    // El nivel puede venir ya puesto en un código nominal; si no, lo elige
    // quien se registra.
    const level = match.level || body.level || null;
    if (role === 'student' && !level) {
      return res.status(400).json({ error: 'Elige tu nivel escolar.' });
    }

    const user = db.createUser({
      fullName,
      email,
      password,
      role,
      schoolId: school.id,
      level: role === 'student' ? level : (body.level || null),
      grade: match.grade || body.grade || null
    });

    // Un código nominal se quema aquí mismo: ya cumplió su único uso.
    if (match.kind === 'nominal') {
      db.burnJoinCode(match.codeId, user.id);
      // Si venía atado a una clase, la persona entra ya matriculada en ella.
      if (match.classId && role === 'student') {
        db.addStudentToClass(match.classId, user.id);
      }
    }

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(user),
      school: { id: school.id, name: school.name },
      joinedClass: match.classId ? (db.getClassById(match.classId) || {}).name || null : null
    });
  }

  return res.status(400).json({ error: 'Elige primero qué tipo de cuenta quieres crear.' });
});

router.post('/login', (req, res) => {
  const loginId = String((req.body && req.body.email) || '').trim();
  const password = String((req.body && req.body.password) || '');

  // Se puede entrar con correo o con el ID de estudiante (STU-00001).
  let user = db.getUserByEmail(loginId);
  if (!user && loginId.toUpperCase().startsWith('STU-')) user = db.getUserByStudentCode(loginId);

  if (!user || user.status !== 'active' || !db.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
  }

  startSession(req, user);
  res.json({ user: db.publicUser(user) });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

module.exports = router;

});

RRModulos.define("routes/chats", function (require, module, exports, __dirname, __filename) {
// routes/chats.js
// Las conversaciones con Robin. Ya no es un historial plano: cada conversación
// tiene su título, su contexto y sus mensajes, y viven todas en la lista del
// menú lateral para poder volver a cualquiera.
//
// El contexto importa, porque cambia cómo contesta Robin:
//   general    una charla cualquiera
//   homework   una asignación concreta de una clase — aquí Robin guía, jamás
//              entrega la respuesta hecha
//   game       una mano de un minijuego

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  db.pruneChatHistory(me); // el plan decide cuántos días se guardan
  res.json({ chats: db.getChats(me.id).map(db.chatSummary) });
});

router.post('/', requireLogin, (req, res) => {
  const { title, context, classId, activityId, gameId } = req.body || {};
  const chat = db.createChat({
    userId: req.session.userId,
    title, context, classId, activityId, gameId
  });
  res.status(201).json({ chat: db.chatSummary(chat), messages: [] });
});

router.get('/:id', requireLogin, (req, res) => {
  const chat = db.getChat(req.session.userId, req.params.id);
  if (!chat) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  res.json({ chat: db.chatSummary(chat), messages: chat.messages });
});

router.put('/:id', requireLogin, (req, res) => {
  const chat = db.renameChat(req.session.userId, req.params.id, (req.body || {}).title);
  if (!chat) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  res.json({ chat: db.chatSummary(chat) });
});

router.delete('/:id', requireLogin, (req, res) => {
  if (!db.deleteChat(req.session.userId, req.params.id)) {
    return res.status(404).json({ error: 'No encontramos esa conversación.' });
  }
  res.json({ ok: true });
});

// Borrar el historial entero. Se hace explícito con ?all=1 para que no pase
// por accidente al equivocarse de ruta.
router.delete('/', requireLogin, (req, res) => {
  if (req.query.all !== '1') {
    return res.status(400).json({ error: 'Para borrar todo el historial hace falta confirmarlo.' });
  }
  db.deleteAllChats(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;

});

RRModulos.define("routes/classes", function (require, module, exports, __dirname, __filename) {
// routes/classes.js
// Clases creadas por profesores. Como los avisos, viven dentro de una escuela.
//
// Cada clase nace con su propio código para compartir, igual que en cualquier
// aula virtual: quien lo tenga entra, y quien no, pide invitación.
//
// Hay dos formas de meter a alguien en una clase:
//
//   1. Un código de estudiante (permanente o nominal), para quien todavía no
//      tiene cuenta. Eso se resuelve en routes/codes.js y routes/auth.js.
//   2. Una invitación, para quien YA tiene cuenta — incluidas las cuentas
//      personales. Si acepta, su cuenta personal se convierte en cuenta de
//      estudiante de esa escuela y conserva todo lo suyo: sus pendientes, sus
//      conversaciones con Robin y el plan que tenga pagado.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');
const { can } = require('../src/permissions');

router.get('/', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (user.role === 'personal') return res.json({ classes: [] });

  let classes;
  if (can(user.role, 'school.viewAllClasses')) {
    classes = db.getClassesForSchool(user.schoolId);
  } else if (user.role === 'teacher') {
    classes = db.getClassesForTeacher(user.id);
  } else {
    // El estudiantado ve las de su escuela para poder unirse a las públicas.
    classes = db.getClassesForSchool(user.schoolId).filter(item => !item.archived);
  }

  res.json({
    classes: classes.map(item => Object.assign({}, item, {
      studentCount: (item.studentIds || []).length,
      activityCount: db.getActivitiesForClass(item.id).length,
      // El código para compartir solo lo ve quien puede repartirlo.
      joinCode: item.teacherId === user.id || can(user.role, 'school.viewAllClasses') ? item.joinCode : null
    }))
  });
});

router.post('/', requireRole('teacher'), (req, res) => {
  const { name, description, visibility, level, subject } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'La clase necesita un nombre.' });

  const teacher = db.getUserById(req.session.userId);
  const classItem = db.createClass({
    teacherId: teacher.id,
    teacherName: teacher.fullName,
    schoolId: teacher.schoolId || null,
    name: String(name).trim(), description, visibility, level
  });
  if (subject) db.updateClass(classItem.id, { subject });

  res.status(201).json({ classItem: db.getClassById(classItem.id) });
});

router.put('/:id', requireRole('teacher'), (req, res) => {
  const classItem = db.getClassById(req.params.id);
  if (!classItem || classItem.teacherId !== req.session.userId) {
    return res.status(404).json({ error: 'No encontramos esa clase.' });
  }
  res.json({ classItem: db.updateClass(classItem.id, req.body || {}) });
});

router.delete('/:id', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const esMia = classItem.teacherId === me.id;
  const mandaEnLaEscuela = can(me.role, 'school.viewAllClasses') && Number(classItem.schoolId) === Number(me.schoolId);
  if (!esMia && !mandaEnLaEscuela) {
    return res.status(403).json({ error: 'No puedes borrar esa clase.' });
  }

  db.deleteClass(classItem.id);
  res.json({ ok: true });
});

// ---- Invitar a alguien que ya tiene cuenta ---------------------------------

router.post('/:id/invite', requireRole('teacher'), (req, res) => {
  const classItem = db.getClassById(req.params.id);
  const teacher = db.getUserById(req.session.userId);
  if (!classItem || classItem.teacherId !== teacher.id) {
    return res.status(404).json({ error: 'No encontramos esa clase.' });
  }

  // Se busca por ID de estudiante o por correo: quien invita normalmente tiene
  // uno de los dos, no siempre el mismo.
  const { studentCode, email } = req.body || {};
  let person = null;
  if (studentCode) person = db.getUserByStudentCode(studentCode);
  if (!person && email) person = db.getUserByEmail(email);

  if (!person) {
    return res.status(404).json({
      error: 'No encontramos a nadie con ese ID ni con ese correo. Si todavía no tiene cuenta, emítele un código de estudiante.'
    });
  }
  if (!['student', 'personal'].includes(person.role)) {
    return res.status(400).json({ error: 'Solo se puede invitar a estudiantes o a cuentas personales.' });
  }
  if (person.role === 'student' && teacher.schoolId && Number(person.schoolId) !== Number(teacher.schoolId)) {
    return res.status(400).json({ error: 'Ese estudiante pertenece a otra escuela.' });
  }
  if ((classItem.studentIds || []).includes(person.id)) {
    return res.status(400).json({ error: `${person.fullName} ya está en esta clase.` });
  }

  const yaInvitado = (person.notifications || []).some(n =>
    n.type === 'class-invite' && n.classId === classItem.id && !n.answered);
  if (yaInvitado) {
    return res.status(400).json({ error: `${person.fullName} ya tiene una invitación pendiente a esta clase.` });
  }

  const esPersonal = person.role === 'personal';
  const school = teacher.schoolId ? db.getSchoolById(teacher.schoolId) : null;

  db.addNotification(person.id, {
    type: 'class-invite',
    classId: classItem.id,
    schoolId: teacher.schoolId || null,
    convertsAccount: esPersonal,
    title: 'Invitación a una clase',
    message: esPersonal
      ? `${teacher.fullName} te invitó a ${classItem.name}${school ? `, en ${school.name}` : ''}. Si aceptas, tu cuenta personal pasa a ser de estudiante de esa escuela y conservas tus pendientes, tus conversaciones y tu plan.`
      : `${teacher.fullName} te invitó a unirte a ${classItem.name}.`
  });

  res.json({
    ok: true,
    invited: { id: person.id, fullName: person.fullName, role: person.role },
    convertsAccount: esPersonal,
    message: esPersonal
      ? `Invitación enviada a ${person.fullName}. Al aceptar, su cuenta personal se convertirá en cuenta de estudiante de tu escuela.`
      : `Invitación enviada a ${person.fullName}.`
  });
});

// ---- Entrar a una clase ----------------------------------------------------

router.post('/:id/join', requireLogin, (req, res) => {
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  let person = db.getUserById(req.session.userId);
  if (!['student', 'personal'].includes(person.role)) {
    return res.status(403).json({ error: 'Solo el estudiantado se une a una clase.' });
  }

  const invitacion = (person.notifications || []).find(note =>
    note.type === 'class-invite' && note.classId === classItem.id);

  // Una cuenta personal solo entra si fue invitada: no puede colarse en una
  // escuela por su cuenta escribiendo un código que vio por ahí.
  if (person.role === 'personal') {
    if (!invitacion) {
      return res.status(403).json({
        error: 'Para entrar a una clase de una escuela necesitas que un profesor te invite o te dé un código de estudiante.'
      });
    }
    person = db.convertPersonalToStudent(person.id, classItem.schoolId, { level: classItem.level });
    req.session.role = person.role;
  } else if (person.schoolId && classItem.schoolId && Number(person.schoolId) !== Number(classItem.schoolId)) {
    return res.status(403).json({ error: 'Esa clase es de otra escuela.' });
  }

  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  if (classItem.visibility === 'private' && !invitacion && String(classItem.joinCode).toUpperCase() !== code) {
    return res.status(400).json({ error: 'El código de la clase privada no es correcto.' });
  }

  db.addStudentToClass(classItem.id, person.id);
  if (invitacion) db.markNotificationRead(person.id, invitacion.id);

  db.addNotification(classItem.teacherId, {
    type: 'class-joined',
    classId: classItem.id,
    title: 'Alguien entró a tu clase',
    message: `${person.fullName} se unió a ${classItem.name}.`
  });

  res.json({
    ok: true,
    user: db.publicUser(db.getUserById(person.id)),
    className: classItem.name
  });
});

// Entrar solo con el código de la clase, sin saber su número.
router.post('/join-by-code', requireLogin, (req, res) => {
  const classItem = db.getClassByJoinCode((req.body || {}).code);
  if (!classItem) return res.status(404).json({ error: 'Ese código de clase no existe.' });

  const me = db.getUserById(req.session.userId);
  if (me.role !== 'student') {
    return res.status(403).json({ error: 'Solo el estudiantado se une con el código de una clase.' });
  }
  if (me.schoolId && Number(classItem.schoolId) !== Number(me.schoolId)) {
    return res.status(403).json({ error: 'Esa clase es de otra escuela.' });
  }

  db.addStudentToClass(classItem.id, me.id);
  res.json({ ok: true, className: classItem.name, classId: classItem.id });
});

// Sacar a alguien de una clase (no borra su cuenta, solo la matrícula).
router.delete('/:id/students/:studentId', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const esMia = classItem.teacherId === me.id;
  const mandaEnLaEscuela = can(me.role, 'school.viewAllClasses') && Number(classItem.schoolId) === Number(me.schoolId);
  if (!esMia && !mandaEnLaEscuela) return res.status(403).json({ error: 'Esa clase no es tuya.' });

  db.removeStudentFromClass(classItem.id, req.params.studentId);
  res.json({ ok: true });
});

// ---- Quién está dentro -----------------------------------------------------

router.get('/:id/members', requireLogin, (req, res) => {
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const user = db.getUserById(req.session.userId);
  const mandaEnLaEscuela = can(user.role, 'school.viewAllClasses') && Number(classItem.schoolId) === Number(user.schoolId);
  if (user.role === 'student' && !(classItem.studentIds || []).includes(user.id)) {
    return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  }
  if (user.role === 'teacher' && classItem.teacherId !== user.id && !mandaEnLaEscuela) {
    return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  }

  // Quien da la clase (o la dirección) ve el ID de cada estudiante: es lo que
  // necesita para ayudarle a entrar cuando no puede.
  const detallado = classItem.teacherId === user.id || mandaEnLaEscuela;

  const members = (classItem.studentIds || [])
    .map(id => db.getUserById(id))
    .filter(Boolean)
    .map(student => ({
      id: detallado ? student.id : undefined,
      fullName: student.fullName,
      role: 'student',
      level: student.level,
      grade: detallado ? student.grade : undefined,
      studentCode: detallado ? student.studentCode : undefined,
      email: detallado ? student.email : undefined,
      // Su avatar está en SU navegador, no aquí; la pantalla pinta el
      // muñequito gris. Ver rrFotoPropia() en public/js/api.js.
      profilePic: null
    }));

  members.unshift({ fullName: classItem.teacherName, role: 'teacher' });
  res.json({ members, joinCode: detallado ? classItem.joinCode : null });
});

module.exports = router;

});

RRModulos.define("routes/codes", function (require, module, exports, __dirname, __filename) {
// routes/codes.js
// Códigos de ingreso con nombre y apellido.
//
// La escuela tiene dos códigos permanentes (uno de estudiantes, otro de
// profesores) que sirven para dar de alta a mucha gente de golpe. Además de
// esos, aquí se emiten códigos de UN SOLO USO para una persona concreta:
//
//   teacher  lo emite dirección o subdirección. Secretaría NO puede emitirlo:
//            ese es justo el límite entre llevar las cuentas y contratar.
//   student  lo emite quien lleva el grupo — profesorado, secretaría o
//            dirección — con el nivel y el grado ya puestos, para que la
//            persona solo escriba su nombre y su contraseña.
//
// En cuanto alguien lo usa, el código se quema y deja de servir. Si se filtró
// antes de usarse, se anula y listo.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');
const { can, requirePermission } = require('../src/permissions');

// Consulta pública, la usa la pantalla de registro para decir a qué escuela
// pertenece el código antes de crear nada. Nunca revela otros códigos.
router.get('/check/:code', (req, res) => {
  const resultado = db.checkJoinCode(req.params.code);

  if (!resultado.ok) {
    const motivos = {
      'no-existe': 'Ese código no existe. Revisa que no se te haya ido una letra.',
      'anulado': 'Ese código fue anulado. Pídele uno nuevo a quien te lo dio.',
      'usado': 'Ese código ya se usó. Cada uno sirve una sola vez.'
    };
    return res.status(404).json({ error: motivos[resultado.reason] || 'Ese código no sirve.' });
  }

  const { code, school } = resultado;
  res.json({
    school: school ? { id: school.id, name: school.name } : null,
    role: code.type,
    forName: code.forName,
    level: code.level,
    grade: code.grade,
    className: code.classId ? (db.getClassById(code.classId) || {}).name || null : null
  });
});

// ---- Emitir ----------------------------------------------------------------

router.post('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { type, forName, level, grade, classId, note } = req.body || {};

  if (!['teacher', 'student'].includes(type)) {
    return res.status(400).json({ error: 'Di si el código es para un profesor o para un estudiante.' });
  }
  // Aquí está la diferencia entre secretaría y dirección.
  if (!can(me.role, type === 'teacher' ? 'codes.teacher' : 'codes.student')) {
    return res.status(403).json({
      error: type === 'teacher'
        ? 'Los códigos de profesor solo los emiten dirección y subdirección.'
        : 'No tienes permiso para emitir códigos de estudiante.'
    });
  }
  if (!me.schoolId) {
    return res.status(400).json({ error: 'Tu cuenta todavía no pertenece a ninguna escuela.' });
  }
  if (!forName || !String(forName).trim()) {
    return res.status(400).json({ error: 'Escribe para quién es el código: así sabes después quién lo usó.' });
  }
  if (type === 'student' && !level) {
    return res.status(400).json({ error: 'Elige el nivel del estudiante.' });
  }

  // Si el código va atado a una clase, esa clase tiene que ser tuya (o de tu
  // escuela, si mandas en ella).
  if (classId != null) {
    const clase = db.getClassById(classId);
    if (!clase || Number(clase.schoolId) !== Number(me.schoolId)) {
      return res.status(404).json({ error: 'No encontramos esa clase en tu escuela.' });
    }
    if (me.role === 'teacher' && clase.teacherId !== me.id) {
      return res.status(403).json({ error: 'Esa clase no es tuya.' });
    }
  }

  const code = db.createJoinCode({
    type,
    schoolId: me.schoolId,
    createdBy: me.id,
    createdByName: me.fullName,
    forName, level, grade, classId, note
  });

  res.status(201).json({ code });
});

// ---- Ver y anular ----------------------------------------------------------

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  if (!me.schoolId) return res.json({ codes: [] });

  // Quien manda en la escuela ve todos los códigos emitidos; el profesorado,
  // solo los suyos.
  const soloMios = !can(me.role, 'school.viewAllUsers');
  const codes = db.getCodesForSchool(me.schoolId, {
    type: req.query.type,
    createdBy: soloMios ? me.id : null
  });

  res.json({
    codes: codes.map(c => ({
      ...c,
      usedByName: c.usedByUserId ? (db.getUserById(c.usedByUserId) || {}).fullName || null : null,
      className: c.classId ? (db.getClassById(c.classId) || {}).name || null : null,
      state: c.revoked ? 'anulado' : c.uses >= c.maxUses ? 'usado' : 'listo'
    }))
  });
});

router.delete('/:id', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const code = (db.getCodesForSchool(me.schoolId) || []).find(c => c.id === Number(req.params.id));
  if (!code) return res.status(404).json({ error: 'No encontramos ese código.' });

  const mandaEnLaEscuela = can(me.role, 'codes.revoke');
  if (!mandaEnLaEscuela && code.createdBy !== me.id) {
    return res.status(403).json({ error: 'Solo puedes anular los códigos que tú emitiste.' });
  }
  if (code.uses >= code.maxUses) {
    return res.status(400).json({ error: 'Ese código ya se usó: anularlo no cambia nada.' });
  }

  db.revokeJoinCode(code.id);
  res.json({ ok: true });
});

// Los dos códigos permanentes de la escuela, para quien tenga permiso de
// verlos. Dirección los regenera desde /api/schools/mine/regenerate.
router.get('/school', requirePermission('school.view'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const school = me.schoolId ? db.getSchoolById(me.schoolId) : null;
  if (!school) return res.json({ school: null });

  res.json({
    school: {
      id: school.id,
      name: school.name,
      studentCode: school.studentCode,
      // Secretaría no puede emitir códigos de profesor, así que tampoco ve
      // el permanente: verlo equivale a poder repartirlo.
      teacherCode: can(me.role, 'codes.teacher') ? school.teacherCode : null
    }
  });
});

module.exports = router;

});

RRModulos.define("routes/dev", function (require, module, exports, __dirname, __filename) {
// routes/dev.js
// ---------------------------------------------------------------------------
// La consola de demostración.
//
// Existe para una sola cosa: enseñar roboRobin delante de gente sin perder dos
// minutos tecleando correos y contraseñas. Deja entrar a cualquier cuenta que
// ya exista con un botón, y deja fabricar clases de mentira para que las
// pantallas no se vean vacías.
//
// Por eso mismo NO es una función del producto:
//
//   · No aparece en ningún menú. Se abre con Ctrl + Alt + Shift + R desde
//     cualquier pantalla (ver public/js/consola.js).
//   · Se apaga entera poniendo "devConsole": false en config.json. Apagada,
//     estas rutas contestan 404 como si no existieran — ni siquiera confirman
//     que estuvieron ahí.
//
// Antes de poner esto en un sitio de verdad con datos de verdad: apágalo.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const db = require('../src/db.js');
const { ROLE_LABEL } = require('../src/permissions.js');

// La consola está encendida salvo que se diga lo contrario, y apagada en
// producción salvo que se diga que sí.
//
// Ese giro es a propósito: la consola fabrica escuelas y cuentas de mentira de
// un botonazo, que es justo lo que se quiere en una demostración y justo lo
// que no se quiere en la escuela de verdad. En un servidor no hay config.json,
// así que sin esta regla quedaría encendida por descuido.
function consolaEncendida() {
  if (process.env.RR_DEV_CONSOLE === '1') return true;
  if (process.env.RR_DEV_CONSOLE === '0') return false;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
    return config.devConsole !== false;
  } catch {
    return true; // en esta computadora, la demostración sigue siendo posible
  }
}

// Apagada, estas rutas no existen. Se contesta el mismo 404 que cualquier
// dirección inventada para no confirmar que la consola está ahí.
router.use((req, res, next) => {
  if (!consolaEncendida()) return res.status(404).json({ error: 'No encontrado.' });
  next();
});

// ---- Qué hay dentro --------------------------------------------------------

// Todas las cuentas, agrupadas por escuela, con lo justo para reconocerlas en
// una lista. Nunca sale el hash de la contraseña: entrar es un botón, no
// leerse la clave de nadie.
router.get('/accounts', (req, res) => {
  const escuelas = {};
  db.getSchools().forEach(s => { escuelas[s.id] = s.name; });

  const accounts = db.getAllUsers().map(u => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    studentCode: u.studentCode || null,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    level: u.level,
    grade: u.grade,
    status: u.status,
    schoolId: u.schoolId,
    schoolName: u.schoolId ? escuelas[u.schoolId] || null : null
  }));

  res.json({
    accounts,
    schools: db.getSchools().map(s => ({ id: s.id, name: s.name })),
    classes: db.getClasses().length
  });
});

// ---- Entrar con un botón ---------------------------------------------------

router.post('/login', (req, res) => {
  const user = db.getUserById((req.body || {}).userId);
  if (!user) return res.status(404).json({ error: 'Esa cuenta ya no existe.' });

  req.session.userId = user.id;
  req.session.role = user.role;

  const publico = db.publicUser(user);
  res.json({ user: publico });
});

// ---- Clases de mentira para que nada se vea vacío --------------------------

const MATERIAS = [
  { name: 'Matemáticas', subject: 'Matemáticas' },
  { name: 'Ciencias Naturales', subject: 'Ciencias' },
  { name: 'Lenguaje y Literatura', subject: 'Lenguaje' },
  { name: 'Estudios Sociales', subject: 'Sociales' },
  { name: 'Inglés', subject: 'Inglés' },
  { name: 'Física', subject: 'Física' },
  { name: 'Química', subject: 'Química' },
  { name: 'Biología', subject: 'Biología' },
  { name: 'Programación', subject: 'Informática' },
  { name: 'Arte', subject: 'Arte' }
];

const SECCIONES = ['A', 'B', 'C', 'D'];
const NIVELES = ['Primaria', 'Secundaria', 'Bachillerato', 'Universidad'];

// El grado tiene que pegar con el nivel: antes se elegían por separado y
// salían cosas como «Primaria · 2.º año» o «Universidad · 6.º grado».
const GRADOS_POR_NIVEL = {
  'Primaria': ['4.º grado', '5.º grado', '6.º grado'],
  'Secundaria': ['7.º grado', '8.º grado', '9.º grado'],
  'Bachillerato': ['1.º año', '2.º año', '3.º año'],
  'Universidad': ['1.º año', '2.º año', '3.º año', '4.º año', '5.º año']
};

// La lista tiene que dar para nueve clases de treinta: con los dieciséis
// nombres de antes, un aula entera se llamaba casi igual y la demostración se
// veía falsa justo en la pantalla que más se enseña.
const NOMBRES = [
  'Ana', 'Luis', 'Mía', 'Diego', 'Sofía', 'Mateo', 'Valeria', 'Carlos',
  'Camila', 'Andrés', 'Lucía', 'Javier', 'Daniela', 'Emilio', 'Renata', 'Óscar',
  'Fernanda', 'Rodrigo', 'Isabela', 'Gabriel', 'Paola', 'Héctor', 'Natalia', 'Iván',
  'Adriana', 'Sebastián', 'Marcela', 'Tomás', 'Gabriela', 'Alejandro', 'Ximena', 'Rubén',
  'Katherine', 'Josué', 'Melissa', 'Bryan', 'Wendy', 'Kevin', 'Vanessa', 'Ernesto',
  'Rocío', 'Guillermo', 'Karla', 'Nelson', 'Patricia', 'Mauricio', 'Beatriz', 'Salvador'
];
const APELLIDOS = [
  'Hernández', 'Ramírez', 'Molina', 'Castillo', 'Portillo', 'Guzmán',
  'Alvarado', 'Sandoval', 'Cruz', 'Bonilla', 'Reyes', 'Menjívar',
  'Escobar', 'Rivas', 'Zelaya', 'Argueta', 'Cañas', 'Interiano',
  'Martínez', 'Flores', 'Orellana', 'Quintanilla', 'Lemus', 'Chávez',
  'Umaña', 'Peña', 'Valladares', 'Serrano', 'Aguilar', 'Domínguez'
];

const TAREAS = [
  'Resolver la guía de ejercicios',
  'Leer el capítulo y hacer un resumen',
  'Entregar el informe de laboratorio',
  'Preparar la exposición en parejas',
  'Practicar los ejercicios del cuaderno'
];

function alAzar(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function enDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Devuelve una escuela con la que trabajar: la que se pida, la primera que
// haya, o una recién inventada si el sistema está en blanco.
function escuelaDeTrabajo(schoolId) {
  if (schoolId) {
    const pedida = db.getSchoolById(schoolId);
    if (pedida) return pedida;
  }
  const existente = db.getSchools()[0];
  if (existente) return existente;

  return db.createSchool({
    name: 'Centro Escolar de Demostración',
    directorId: null,
    directorName: 'Dirección de demostración'
  });
}

// Un profesor de esa escuela. Si no hay ninguno, se crea uno para la ocasión.
function profesorDeTrabajo(school) {
  const suyo = db.getSchoolMembers(school.id).find(u => u.role === 'teacher');
  if (suyo) return suyo;
  return nuevoProfesor(school);
}

let secuencia = 0;

// Los correos tienen que ser únicos y Date.now() se repite dentro del mismo
// milisegundo: con nueve clases seguidas, dos profesores chocaban.
function idUnico() {
  secuencia += 1;
  return `${Date.now().toString(36)}${secuencia}`;
}

function nuevoProfesor(school) {
  return db.createUser({
    fullName: `${alAzar(NOMBRES)} ${alAzar(APELLIDOS)}`,
    email: `profe.demo.${idUnico()}@roborobin.demo`,
    password: 'Demo123!',
    role: 'teacher',
    schoolId: school.id
  });
}

// Fabrica clases con su profesor, su gente dentro y un par de asignaciones,
// que es lo que hace falta para que las pantallas se vean como se ven en uso.
//
// Los topes son altos a propósito (hasta 15 clases de 40) porque una escuela
// de verdad no tiene cinco estudiantes por aula: con listas cortas, las
// pantallas de dirección y de profesorado se ven vacías justo cuando hay que
// enseñarlas. El botón de "escuela completa" de la consola pide nueve clases
// con entre 25 y 30 cada una, que es una escuela creíble.
//
//   students: un número        exactamente esa cantidad en cada clase
//   students: { min, max }     una cantidad distinta por clase, dentro del rango
router.post('/demo', (req, res) => {
  const body = req.body || {};
  const cuantas = Math.min(15, Math.max(1, Number(body.classes) || 3));
  const rango = rangoDeAlumnos(body.students);

  // Todo lo de abajo son cientos de altas seguidas. Agrupadas en un lote se
  // escribe el archivo una sola vez al final, en lugar de una vez por cada
  // estudiante — que es lo que hacía que el botón tardara casi medio minuto.
  return db.enLote(() => generarDemo(res, body, cuantas, rango));
});

function generarDemo(res, body, cuantas, rango) {
  const school = escuelaDeTrabajo(body.schoolId);
  // Con una sola clase se reaprovecha el profesor que ya haya; en una tanda
  // grande cada clase estrena el suyo, porque nueve materias las dan nueve
  // personas distintas y si no el panel de profesorado queda con una sola fila.
  const unSoloProfe = cuantas === 1 || body.sharedTeacher === true;
  const principal = profesorDeTrabajo(school);

  // La misma contraseña de mentira para todas las cuentas de la tanda: se
  // calcula su hash una vez en lugar de doscientas.
  const claveDemo = db.hashPassword('Demo123!');

  const creadas = [];
  let totalAlumnos = 0;

  for (let i = 0; i < cuantas; i++) {
    // Las materias no se repiten mientras queden sin usar: nueve clases de
    // "Matemáticas" no enseñan nada.
    const materia = MATERIAS[i % MATERIAS.length];
    const nivel = alAzar(NIVELES);
    const grado = alAzar(GRADOS_POR_NIVEL[nivel]);
    const teacher = unSoloProfe ? principal : nuevoProfesor(school);
    const porClase = rand(rango.min, rango.max);

    const classItem = db.createClass({
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      schoolId: school.id,
      name: `${materia.name} ${grado} «${alAzar(SECCIONES)}»`,
      description: `Clase de demostración generada automáticamente para ${materia.subject}.`,
      visibility: Math.random() < 0.75 ? 'public' : 'private',
      level: nivel
    });

    // Gente dentro. Sin estudiantes, una clase no enseña nada de lo que la
    // aplicación sabe hacer.
    for (let j = 0; j < porClase; j++) {
      const alumno = db.createUser({
        fullName: `${alAzar(NOMBRES)} ${alAzar(APELLIDOS)}`,
        email: null,
        passwordHash: claveDemo,
        role: 'student',
        level: nivel,
        grade: grado,
        schoolId: school.id
      });
      db.addStudentToClass(classItem.id, alumno.id);
    }
    totalAlumnos += porClase;

    // Un par de asignaciones, una ya vencida y otra por venir: así se ven los
    // dos estados en la pantalla del estudiantado.
    db.createActivity({
      classId: classItem.id,
      title: alAzar(TAREAS),
      description: 'Asignación de demostración.',
      dueDate: enDias(-2)
    });
    db.createActivity({
      classId: classItem.id,
      title: alAzar(TAREAS),
      description: 'Asignación de demostración.',
      dueDate: enDias(5)
    });

    creadas.push({
      id: classItem.id,
      name: classItem.name,
      level: classItem.level,
      joinCode: classItem.joinCode,
      teacherName: teacher.fullName,
      students: porClase
    });
  }

  res.json({
    school: { id: school.id, name: school.name },
    teacher: { id: principal.id, fullName: principal.fullName },
    sharedTeacher: unSoloProfe,
    students: totalAlumnos,
    classes: creadas
  });
}

// Cuántos estudiantes por clase. Admite un número fijo o un rango { min, max }
// para que cada aula tenga una cantidad distinta, como pasa de verdad.
function rangoDeAlumnos(pedido) {
  const tope = n => Math.min(40, Math.max(0, Math.round(n)));

  if (pedido && typeof pedido === 'object') {
    const min = tope(Number(pedido.min) || 0);
    const max = tope(Number(pedido.max) || min);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  const n = Number(pedido);
  if (Number.isFinite(n)) {
    const fijo = tope(n);
    return { min: fijo, max: fijo };
  }
  return { min: 5, max: 5 };
}

function rand(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = router;

});

RRModulos.define("routes/family", function (require, module, exports, __dirname, __filename) {
// routes/family.js
// Lo que ve una cuenta de padre o madre.
//
// Solo el pase de lista de sus hijos: si llegó hoy, a qué hora y los días
// anteriores. Nada más. Las notas, las entregas y sobre todo las
// conversaciones con Robin no se asoman por aquí — son del estudiante, y una
// cuenta de familia no es una cuenta de dirección.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { describirDia } = require('./attendance');

const soloFamilia = requireRole('parent');

// Cómo está hoy cada hijo, listo para pintar sin más cuentas en el navegador.
function retratoDe(student, date) {
  // Alguien puede estar marcado en más de una clase el mismo día (entró a
  // primera hora y luego a otra materia). Manda la marca más reciente: es la
  // que contesta «¿dónde está ahora?».
  const hoy = db.getAttendance({ studentId: student.id, date })
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
  const historial = db.attendanceHistory(student.id, 14);
  const clases = db.getClassesForStudent(student.id).map(c => ({ id: c.id, name: c.name }));
  const escuela = student.schoolId ? db.getSchoolById(student.schoolId) : null;

  return {
    id: student.id,
    fullName: student.fullName,
    studentCode: student.studentCode || null,
    level: student.level,
    grade: student.grade,
    listNumber: student.listNumber || null,
    // Sin foto: las caras y los avatares se quedan en el navegador de quien
    // los puso y no hay ninguno que el servidor pueda enseñar aquí.
    photo: null,
    schoolName: escuela ? escuela.name : null,
    classes: clases,
    // El dato de la pantalla: llegó, llegó tarde, no llegó, o todavía no le
    // han pasado lista. Los cuatro son distintos y se dicen distinto.
    today: hoy
      ? { status: hoy.status, at: hoy.at, method: hoy.method, byName: hoy.byName }
      : null,
    history: historial.map(r => ({ date: r.date, status: r.status, at: r.at, day: describirDia(r.date) }))
  };
}

router.get('/children', soloFamilia, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : db.todayKey();
  const children = db.getChildrenOf(req.session.userId).map(s => retratoDe(s, date));
  res.json({ day: describirDia(date), children });
});

// Acompañar a un estudiante más. El ID (STU-00007) se lo da la escuela o el
// propio estudiante: es lo que ya usa para entrar, así que no hay un código
// nuevo que repartir.
router.post('/children', soloFamilia, (req, res) => {
  const code = String((req.body || {}).studentCode || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Escribe el ID de estudiante de tu hijo o hija.' });

  const result = db.linkChild(req.session.userId, code);
  if (!result.ok) {
    const motivos = {
      'no-existe': 'No hay ningún estudiante con ese ID. Se parece a STU-00007.',
      'repetido': 'Ya tienes a esa persona en tu cuenta.'
    };
    return res.status(400).json({ error: motivos[result.reason] || 'No pude agregarlo.' });
  }

  // El estudiante se entera de que alguien lo sigue: no es un dato que deba
  // pasar a sus espaldas.
  db.addNotification(result.student.id, {
    type: 'family',
    title: 'Tu familia sigue tu asistencia',
    message: `${db.getUserById(req.session.userId).fullName} podrá ver si llegaste a clase cada día.`
  });

  res.status(201).json({ child: retratoDe(result.student, db.todayKey()) });
});

router.delete('/children/:id', soloFamilia, (req, res) => {
  const ok = db.unlinkChild(req.session.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Esa persona no estaba en tu cuenta.' });
  res.json({ ok: true });
});

// Consulta pública del ID antes de crear la cuenta: dice a quién pertenece
// (solo el nombre) para no agregar a un desconocido por una letra mal puesta.
router.get('/lookup/:code', (req, res) => {
  const student = db.getUserByStudentCode(String(req.params.code || '').trim());
  if (!student) return res.status(404).json({ error: 'No hay ningún estudiante con ese ID.' });
  const escuela = student.schoolId ? db.getSchoolById(student.schoolId) : null;
  res.json({
    fullName: student.fullName,
    level: student.level,
    grade: student.grade,
    schoolName: escuela ? escuela.name : null
  });
});

module.exports = router;

});

RRModulos.define("routes/games", function (require, module, exports, __dirname, __filename) {
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

});

RRModulos.define("routes/plans", function (require, module, exports, __dirname, __filename) {
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

});

RRModulos.define("routes/schools", function (require, module, exports, __dirname, __filename) {
// routes/schools.js
// La escuela del director (admin) y sus dos códigos de ingreso.
// Solo el director de una escuela puede ver o regenerar sus códigos.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireRole } = require('../src/auth');
const { can, requirePermission } = require('../src/permissions');

// Devuelve la escuela del admin que hace la petición (o null si todavía no
// ha inscrito ninguna, como pasa con la cuenta de director por defecto).
function schoolOf(req) {
  const user = db.getUserById(req.session.userId);
  if (!user) return null;
  if (user.schoolId) return db.getSchoolById(user.schoolId);
  return db.getSchoolByDirector(user.id);
}

router.get('/mine', requirePermission('school.view'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const school = schoolOf(req);
  if (!school) return res.json({ school: null });

  // Secretaria ve la escuela y sus numeros, pero no el codigo permanente de
  // profesores: verlo equivale a poder repartirlo.
  const visible = Object.assign({}, school);
  if (!can(me.role, 'codes.teacher')) visible.teacherCode = null;

  res.json({
    school: visible,
    stats: db.schoolStats(school.id),
    classes: db.getClassesForSchool(school.id).length,
    aiLimits: db.schoolAiLimits(school.id),
    aiLimitRange: { min: db.SCHOOL_LIMIT_MIN, max: db.SCHOOL_LIMIT_MAX }
  });
});

// El margen diario de Robin de toda la escuela, en porcentaje sobre el punto
// de partida. Solo lo mueve quien tiene 'school.limits' — dirección — porque
// es una decisión de escuela, no de aula.
router.put('/mine/limits', requirePermission('school.limits'), (req, res) => {
  const school = schoolOf(req);
  if (!school) return res.status(404).json({ error: 'Todavía no has inscrito una escuela.' });

  const body = req.body || {};
  const pedido = {};
  db.SCHOOL_LIMIT_GROUPS.forEach(g => {
    if (body[g] !== undefined) pedido[g] = body[g];
  });
  if (!Object.keys(pedido).length) {
    return res.status(400).json({ error: 'Indica el porcentaje de al menos un grupo.' });
  }

  res.json({ aiLimits: db.setSchoolAiLimits(school.id, pedido) });
});

// Todas las clases de la escuela, con quien las da y cuanta gente hay dentro.
// Es lo que mira la direccion para saber como va el curso.
router.get('/mine/classes', requirePermission('school.viewAllClasses'), (req, res) => {
  const school = schoolOf(req);
  if (!school) return res.json({ classes: [] });

  res.json({
    classes: db.getClassesForSchool(school.id).map(item => Object.assign({}, item, {
      studentCount: (item.studentIds || []).length,
      activityCount: db.getActivitiesForClass(item.id).length
    }))
  });
});

// Un director que aún no tiene escuela puede inscribirla desde su panel.
router.post('/mine', requireRole('admin'), (req, res) => {
  if (schoolOf(req)) return res.status(400).json({ error: 'Ya tienes una escuela inscrita.' });
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Escribe el nombre de la escuela.' });

  const me = db.getUserById(req.session.userId);
  const school = db.createSchool({ name, directorId: me.id, directorName: me.fullName });
  db.updateUser(me.id, { schoolId: school.id });
  res.status(201).json({ school, stats: db.schoolStats(school.id) });
});

router.put('/mine', requirePermission('school.rename'), (req, res) => {
  const school = schoolOf(req);
  if (!school) return res.status(404).json({ error: 'Todavía no has inscrito una escuela.' });
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Escribe el nombre de la escuela.' });
  res.json({ school: db.renameSchool(school.id, name) });
});

// Genera un código nuevo. El anterior deja de funcionar de inmediato, que es
// justo lo que se quiere cuando un código se filtró.
router.post('/mine/regenerate', requirePermission('codes.revoke'), (req, res) => {
  const school = schoolOf(req);
  if (!school) return res.status(404).json({ error: 'Todavía no has inscrito una escuela.' });
  const which = (req.body && req.body.which) || '';
  if (!['student', 'teacher'].includes(which)) {
    return res.status(400).json({ error: 'Indica si quieres regenerar el código de estudiantes o el de profesores.' });
  }
  res.json({ school: db.regenerateSchoolCode(school.id, which) });
});

module.exports = router;

});

RRModulos.define("routes/tasks", function (require, module, exports, __dirname, __filename) {
// routes/tasks.js
// El organizador personal: tareas y pendientes del día a día.
// Disponible para cualquier cuenta con sesión iniciada (personal, estudiante,
// profesor o director) — cada quien solo ve y edita las suyas.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');

router.get('/', requireLogin, (req, res) => {
  res.json({ tasks: db.getTasks(req.session.userId) });
});

router.post('/', requireLogin, (req, res) => {
  const { title, notes, due, priority, category } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Escribe de qué se trata la tarea.' });
  const task = db.createTask({ userId: req.session.userId, title, notes, due, priority, category });
  res.status(201).json({ task });
});

router.put('/:id', requireLogin, (req, res) => {
  const task = db.updateTask(req.session.userId, req.params.id, req.body || {});
  if (!task) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  res.json({ task });
});

router.delete('/:id', requireLogin, (req, res) => {
  if (!db.deleteTask(req.session.userId, req.params.id)) {
    return res.status(404).json({ error: 'No encontramos esa tarea.' });
  }
  res.json({ ok: true });
});

module.exports = router;

});

RRModulos.define("routes/users", function (require, module, exports, __dirname, __filename) {
// routes/users.js
// El perfil de cada quien, las listas de estudiantes y la administración de
// cuentas de una escuela.
//
// Quién ve a quién:
//   dirección, subdirección y secretaría  ->  todas las cuentas de SU escuela
//   profesorado                           ->  los estudiantes de SUS clases
//   estudiantado y cuentas personales     ->  solo lo suyo
//
// Una regla que se cumple en todo el archivo: un estudiante NO cambia su
// propia contraseña. Se la restablece su profesor o alguien de dirección. Es
// lo que pasa de verdad en una escuela cuando un niño de segundo grado olvida
// la suya, y evita que la pierda para siempre.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');
const { can, requirePermission, ROLE_LABEL } = require('../src/permissions');

// Escuela desde la que trabaja quien hace la petición (null = todo el sistema,
// que es el caso de la cuenta de director por defecto sin escuela inscrita).
function scopeOf(req) {
  const me = db.getUserById(req.session.userId);
  return me && me.schoolId ? Number(me.schoolId) : null;
}

function inScope(user, schoolId) {
  return schoolId == null || Number(user.schoolId) === schoolId;
}

// ---- Perfil propio ---------------------------------------------------------

router.put('/profile', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  // La foto no llega aquí: public/js/api.js la aparta antes de enviar y la
  // guarda en el navegador de quien la puso. Ver rrGuardarFotoPropia().
  const { fullName, currentPassword, password } = req.body || {};

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'El nombre completo es obligatorio.' });
  }

  if (password) {
    if (user.role === 'student') {
      return res.status(403).json({
        error: 'Tu contraseña la cambia tu profesor o la dirección de tu escuela. Pídesela a quien te dio tu cuenta.'
      });
    }
    if (!currentPassword || !db.verifyPassword(user, currentPassword)) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
  }

  const updated = db.updateUser(user.id, {
    fullName: String(fullName).trim(),
    password: user.role === 'student' ? undefined : password
  });
  res.json({ user: db.publicUser(updated) });
});

// El resumen de la cuenta, que ahora vive dentro del perfil en lugar de ocupar
// una pantalla propia: quién eres, de qué escuela, cuánto llevas y cómo vas.
router.get('/profile/summary', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const tasks = db.getTasks(me.id);
  const scores = db.getGameScores(me.id);

  const base = {
    user: db.publicUser(me),
    roleLabel: ROLE_LABEL[me.role] || me.role,
    tasks: {
      total: tasks.length,
      pending: tasks.filter(t => !t.done).length,
      done: tasks.filter(t => t.done).length
    },
    games: {
      played: scores.reduce((n, s) => n + s.plays, 0),
      correct: scores.reduce((n, s) => n + s.correct, 0),
      bestStreak: scores.reduce((n, s) => Math.max(n, s.bestStreak), 0)
    },
    chats: db.getChats(me.id).length,
    usage: db.usageSummary(me),
    plan: db.planInfoFor(me)
  };

  if (me.role === 'student') {
    const clases = db.getClassesForStudent(me.id);
    const asignaciones = db.getAssignmentsForStudent(me.id);
    const hoy = db.todayKey();
    base.school = {
      name: me.schoolName || (db.getSchoolById(me.schoolId) || {}).name || null,
      level: me.level,
      grade: me.grade,
      studentCode: me.studentCode,
      classes: clases.length,
      assignments: asignaciones.length,
      pendingAssignments: asignaciones.filter(a => !a.submission).length,
      dueSoon: asignaciones.filter(a => !a.submission && a.dueDate && a.dueDate >= hoy).length
    };
  }

  if (me.role === 'teacher') {
    const clases = db.getClassesForTeacher(me.id);
    base.school = {
      name: me.schoolName,
      classes: clases.length,
      students: db.getStudentsOfTeacher(me.id).length,
      activities: clases.reduce((n, c) => n + db.getActivitiesForClass(c.id).length, 0)
    };
  }

  if (can(me.role, 'school.view') && me.schoolId) {
    base.school = Object.assign({}, base.school, {
      name: me.schoolName,
      stats: db.schoolStats(me.schoolId),
      classes: db.getClassesForSchool(me.schoolId).length
    });
  }

  res.json(base);
});

// ---- Listas de estudiantes -------------------------------------------------

// Para el profesorado: los estudiantes de SUS clases. Quien manda en la
// escuela ve a todos, que para eso está ahí.
router.get('/roster', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  const schoolId = scopeOf(req);

  let students;
  if (can(me.role, 'school.viewAllUsers')) {
    students = db.getAllUsers().filter(u => u.role === 'student' && inScope(u, schoolId));
  } else if (me.role === 'teacher') {
    students = db.getStudentsOfTeacher(me.id);
  } else {
    return res.status(403).json({ error: 'No tienes permiso para ver esa lista.' });
  }

  if (req.query.level) students = students.filter(u => u.level === req.query.level);
  if (req.query.classId) {
    const clase = db.getClassById(req.query.classId);
    const ids = clase ? clase.studentIds || [] : [];
    students = students.filter(u => ids.includes(u.id));
  }

  res.json({
    students: students.map(student => {
      const salida = db.publicUser(student);
      // El acceso de la persona: correo, ID y en qué clases está. La
      // contraseña NUNCA viaja — ni siquiera cifrada — porque no hace falta:
      // quien tenga permiso puede restablecerla, que es lo que de verdad
      // resuelve el problema de "se me olvidó".
      salida.classes = db.getClassesForStudent(student.id).map(c => ({ id: c.id, name: c.name }));
      return salida;
    })
  });
});

// Restablecer la contraseña de un estudiante. Lo puede hacer quien da clase a
// esa persona o quien manda en la escuela.
router.post('/students/:id/password', requirePermission('accounts.resetPassword'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const student = db.getUserById(req.params.id);
  const password = String((req.body || {}).password || '');

  if (!student || student.role !== 'student') {
    return res.status(404).json({ error: 'No encontramos ese estudiante.' });
  }
  if (me.schoolId && Number(student.schoolId) !== Number(me.schoolId)) {
    return res.status(403).json({ error: 'Ese estudiante no es de tu escuela.' });
  }
  // Un profesor solo toca a los suyos; dirección, a cualquiera de la escuela.
  if (!can(me.role, 'school.viewAllUsers') && !db.teacherTeachesStudent(me.id, student.id)) {
    return res.status(403).json({ error: 'Ese estudiante no está en ninguna de tus clases.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres.' });
  }

  db.updateUser(student.id, { password });
  db.addNotification(student.id, {
    type: 'password-reset',
    title: 'Tu contraseña cambió',
    message: `${me.fullName} te puso una contraseña nueva. Pídesela si no la sabes.`
  });
  res.json({ ok: true, message: `Contraseña de ${student.fullName} actualizada.` });
});

// ---- Notificaciones --------------------------------------------------------

router.get('/notifications', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.json({ notifications: user.notifications || [] });
});

router.put('/notifications/:id/read', requireLogin, (req, res) => {
  if (!db.markNotificationRead(req.session.userId, req.params.id)) {
    return res.status(404).json({ error: 'No encontramos esa notificación.' });
  }
  res.json({ ok: true });
});

// ---- Panel de dirección ----------------------------------------------------

router.get('/admin/users', requirePermission('school.viewAllUsers'), (req, res) => {
  const schoolId = scopeOf(req);
  const { q, role, level, status } = req.query;
  const users = db.getAllUsers()
    .filter(user =>
      inScope(user, schoolId) &&
      (!q || `${user.fullName} ${user.email || ''} ${user.studentCode || ''}`.toLowerCase().includes(String(q).toLowerCase())) &&
      (!role || user.role === role) &&
      (!level || user.level === level) &&
      (!status || user.status === status))
    .map(user => {
      const salida = db.publicUser(user);
      if (user.role === 'student') {
        salida.classes = db.getClassesForStudent(user.id).map(c => ({ id: c.id, name: c.name }));
      }
      if (user.role === 'teacher') {
        salida.classes = db.getClassesForTeacher(user.id).map(c => ({ id: c.id, name: c.name }));
      }
      return salida;
    });
  res.json({ users });
});

router.get('/admin/stats', requirePermission('school.view'), (req, res) => {
  const schoolId = scopeOf(req);
  const stats = db.getStats(schoolId);
  const miembros = schoolId == null ? db.getAllUsers() : db.getSchoolMembers(schoolId);
  res.json(Object.assign(stats, {
    totalSubdirectors: miembros.filter(u => u.role === 'subdirector').length,
    totalSecretaries: miembros.filter(u => u.role === 'secretary').length,
    totalClasses: db.getClassesForSchool(schoolId).length
  }));
});

router.post('/admin/users', requirePermission('accounts.create'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { fullName, email, password, role, level, grade } = req.body || {};

  if (!fullName || !password) return res.status(400).json({ error: 'El nombre y la contraseña son obligatorios.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  if (email && db.getUserByEmail(email)) return res.status(400).json({ error: 'Ese correo ya está registrado.' });

  // Crear personal de dirección es otro permiso distinto: solo dirección.
  const esPersonalDeDireccion = ['admin', 'subdirector', 'secretary'].includes(role);
  if (esPersonalDeDireccion && !can(me.role, 'staff.manage')) {
    return res.status(403).json({
      error: 'Solo la dirección puede crear cuentas de subdirección, secretaría o dirección.'
    });
  }

  const user = db.createUser({
    fullName, email, password, role, level, grade,
    schoolId: scopeOf(req) // la cuenta nace dentro de la escuela de quien la crea
  });
  res.status(201).json({ user: db.publicUser(user) });
});

router.put('/admin/users/:id', requirePermission('accounts.edit'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const target = db.getUserById(req.params.id);
  if (!target || !inScope(target, scopeOf(req))) return res.status(404).json({ error: 'No encontramos esa cuenta.' });

  const { schoolId, ...safe } = req.body || {}; // la escuela no se cambia desde aquí

  // Nadie asciende a nadie a dirección sin ser dirección. Y nadie se cambia el
  // rol a sí mismo, que es la forma más fácil de dejar una escuela sin quien
  // mande en ella.
  if (safe.role !== undefined) {
    if (Number(target.id) === Number(me.id)) {
      return res.status(400).json({ error: 'No puedes cambiarte el rol a ti mismo.' });
    }
    if (['admin', 'subdirector', 'secretary'].includes(safe.role) && !can(me.role, 'staff.manage')) {
      return res.status(403).json({ error: 'Solo la dirección reparte los cargos de dirección.' });
    }
  }
  if (safe.password && !can(me.role, 'accounts.resetPassword')) {
    return res.status(403).json({ error: 'No tienes permiso para cambiar contraseñas.' });
  }

  const user = db.updateUser(req.params.id, safe);
  res.json({ user: db.publicUser(user) });
});

router.delete('/admin/users/:id', requirePermission('accounts.delete'), (req, res) => {
  if (Number(req.params.id) === Number(req.session.userId)) {
    return res.status(400).json({ error: 'No puedes borrar tu propia cuenta.' });
  }
  const target = db.getUserById(req.params.id);
  if (!target || !inScope(target, scopeOf(req))) return res.status(404).json({ error: 'No encontramos esa cuenta.' });

  // La dirección que fundó la escuela no se borra: dejaría la escuela huérfana.
  const school = target.schoolId ? db.getSchoolById(target.schoolId) : null;
  if (school && Number(school.directorId) === Number(target.id)) {
    return res.status(400).json({ error: 'Esa es la cuenta que fundó la escuela; no se puede borrar.' });
  }

  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

// El personal de dirección, en su propia lista: es lo que se mira al preguntar
// "¿quién tiene llaves de qué?".
router.get('/admin/staff', requirePermission('school.view'), (req, res) => {
  const schoolId = scopeOf(req);
  const staff = (schoolId == null ? db.getAllUsers() : db.getSchoolStaff(schoolId))
    .filter(u => ['admin', 'subdirector', 'secretary'].includes(u.role))
    .map(u => {
      const salida = db.publicUser(u);
      salida.canIssueTeacherCodes = can(u.role, 'codes.teacher');
      return salida;
    });
  res.json({ staff });
});

module.exports = router;

});
