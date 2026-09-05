// src/db.js
// ---------------------------------------------------------------------------
// Toda la base de datos de roboRobin. Sin nube, sin servicios externos:
// todo se lee y se escribe en un solo archivo local en data/db.json.
// Se mantiene un caché en memoria sincronizado con ese archivo para que las
// peticiones sean rápidas, y cada cambio se guarda al disco de inmediato.
//
// Modelo de datos
//   users        -> cuentas. role: 'personal' | 'student' | 'teacher' | 'admin'
//   schools      -> escuelas inscritas. Cada una tiene DOS códigos de ingreso:
//                   uno para estudiantes y otro para profesores. Los crea el
//                   director (admin) de esa escuela.
//   tasks        -> tareas/pendientes del organizador personal (cuenta personal)
//   classes      -> clases creadas por profesores
//   activities   -> actividades dentro de una clase
//   announcements-> avisos de la escuela
//   aiLogs       -> historial local del chat con Robin
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_ADMIN = {
  fullName: 'Robin Admin',
  email: 'admin@roborobin.local',
  password: 'Admin123!', // documentado en el README, cámbialo de inmediato
  role: 'admin'
};

const ROLES = ['personal', 'student', 'teacher', 'admin'];
const LEVELS = ['Parvularia', 'Primaria', 'Secundaria', 'Bachillerato'];

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
      nextTaskId: 1
    },
    users: [],
    schools: [],
    tasks: [],
    announcements: [],
    classes: [],
    activities: [],
    aiLogs: []
  };
}

let cache = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function save() {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = emptyDB();
    seedAdmin();
    save();
    console.log('[roboRobin] Base de datos local creada en data/db.json');
    console.log(`[roboRobin] Acceso de director por defecto -> ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`);
  } else {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      migrate();
      save();
    } catch (err) {
      console.error('[roboRobin] No se pudo leer data/db.json, empezando de cero.', err);
      cache = emptyDB();
      seedAdmin();
      save();
    }
  }
  return cache;
}

// Pone al día bases de datos creadas con versiones anteriores sin perder nada.
function migrate() {
  const base = emptyDB();
  cache.meta = Object.assign({}, base.meta, cache.meta || {});
  ['users', 'schools', 'tasks', 'announcements', 'classes', 'activities', 'aiLogs'].forEach(key => {
    cache[key] = cache[key] || [];
  });

  cache.users.forEach(user => {
    user.notifications = user.notifications || [];
    if (user.profilePic === undefined) user.profilePic = null;
    if (user.role === 'student' && !user.studentCode) {
      user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
    }
    // Los niveles se guardaban en inglés en versiones anteriores.
    user.level = normalizeLevel(user.level);
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
  'High School': 'Bachillerato'
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

function createUser({ fullName, email, password, role, level, grade, schoolId }) {
  const now = new Date().toISOString();
  const user = {
    id: cache.meta.nextUserId++,
    fullName,
    email: email ? String(email).trim().toLowerCase() : null,
    passwordHash: bcrypt.hashSync(password, 10),
    role: ROLES.includes(role) ? role : 'personal',
    schoolId: schoolId != null ? Number(schoolId) : null,
    level: normalizeLevel(level) || null,
    grade: grade || null,
    status: 'active',
    profilePic: null,
    notifications: [],
    createdAt: now
  };
  if (user.role === 'student') user.studentCode = `STU-${String(user.id).padStart(5, '0')}`;
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
  if (updates.status !== undefined) user.status = updates.status;
  if (updates.schoolId !== undefined) user.schoolId = updates.schoolId == null ? null : Number(updates.schoolId);
  if (updates.password) user.passwordHash = bcrypt.hashSync(updates.password, 10);
  if (updates.profilePic !== undefined) user.profilePic = updates.profilePic;
  save();
  return user;
}

function deleteUser(id) {
  const before = cache.users.length;
  cache.users = cache.users.filter(u => u.id !== Number(id));
  cache.tasks = cache.tasks.filter(t => t.userId !== Number(id));
  save();
  return cache.users.length < before;
}

function verifyPassword(user, password) {
  if (!user || !user.passwordHash || !password) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  const school = user.schoolId ? getSchoolById(user.schoolId) : null;
  rest.schoolName = school ? school.name : null;
  return rest;
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

load();

module.exports = {
  LEVELS,
  ROLES,
  DEFAULT_ADMIN,
  // usuarios
  getAllUsers, getUserById, getUserByEmail, getUserByStudentCode,
  createUser, updateUser, deleteUser, verifyPassword, publicUser,
  // escuelas
  createSchool, getSchools, getSchoolById, getSchoolByDirector,
  resolveJoinCode, regenerateSchoolCode, renameSchool, getSchoolMembers, schoolStats,
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
  getStats
};
