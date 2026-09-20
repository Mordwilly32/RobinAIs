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
      profilePic: student.profilePic || null
    }));

  members.unshift({ fullName: classItem.teacherName, role: 'teacher' });
  res.json({ members, joinCode: detallado ? classItem.joinCode : null });
});

module.exports = router;
