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
const fotos = require('../src/fotos');

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

router.put('/profile', requireLogin, async (req, res) => {
  const user = db.getUserById(req.session.userId);
  // La foto sí llega aquí, y se va a Supabase Storage: en la ficha queda solo
  // su dirección. Ver src/fotos.js.
  const { fullName, currentPassword, password, profilePic } = req.body || {};

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

  // La foto primero: si falla, el perfil no se toca y quien la subió se
  // entera. Al revés —guardar el nombre y que la foto reviente después— deja
  // media operación hecha y un mensaje de error que parece mentir.
  let profilePicUrl;
  if (profilePic !== undefined) {
    try {
      profilePicUrl = await fotos.guardarFoto(user.id, profilePic);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const updated = db.updateUser(user.id, {
    fullName: String(fullName).trim(),
    password: user.role === 'student' ? undefined : password,
    profilePicUrl
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
