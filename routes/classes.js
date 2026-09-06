// routes/classes.js
// Clases creadas por profesores. Como los avisos, viven dentro de una escuela.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');

router.get('/', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (user.role === 'personal') return res.json({ classes: [] });

  const sameSchool = item => user.schoolId == null || Number(item.schoolId) === Number(user.schoolId);
  const classes = db.getClasses().filter(item =>
    sameSchool(item) && (user.role === 'teacher' ? item.teacherId === user.id : true));
  res.json({ classes });
});

router.post('/', requireRole('teacher'), (req, res) => {
  const { name, description, visibility, level } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'La clase necesita un nombre.' });
  const teacher = db.getUserById(req.session.userId);
  const classItem = db.createClass({
    teacherId: teacher.id,
    teacherName: teacher.fullName,
    schoolId: teacher.schoolId || null,
    name: String(name).trim(), description, visibility, level
  });
  res.status(201).json({ classItem });
});

router.post('/:id/invite', requireRole('teacher'), (req, res) => {
  const classItem = db.getClassById(req.params.id);
  const teacher = db.getUserById(req.session.userId);
  if (!classItem || classItem.teacherId !== teacher.id) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const student = db.getUserByStudentCode(req.body && req.body.studentCode);
  if (!student || student.role !== 'student') return res.status(404).json({ error: 'No encontramos ese ID de estudiante.' });
  if (teacher.schoolId && Number(student.schoolId) !== Number(teacher.schoolId)) {
    return res.status(400).json({ error: 'Ese estudiante no pertenece a tu escuela.' });
  }

  db.addNotification(student.id, {
    type: 'class-invite',
    classId: classItem.id,
    title: 'Invitación a una clase',
    message: `${teacher.fullName} te invitó a unirte a ${classItem.name}.`
  });
  res.json({ ok: true });
});

router.post('/:id/join', requireRole('student'), (req, res) => {
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const student = db.getUserById(req.session.userId);
  if (student.schoolId && classItem.schoolId && Number(student.schoolId) !== Number(classItem.schoolId)) {
    return res.status(403).json({ error: 'Esa clase es de otra escuela.' });
  }

  const invited = (student.notifications || []).some(note => note.type === 'class-invite' && note.classId === classItem.id);
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  if (classItem.visibility === 'private' && !invited && classItem.joinCode !== code) {
    return res.status(400).json({ error: 'El código de la clase privada no es correcto.' });
  }

  db.addStudentToClass(classItem.id, student.id);
  res.json({ ok: true });
});

router.get('/:id/members', requireLogin, (req, res) => {
  const classItem = db.getClassById(req.params.id);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const user = db.getUserById(req.session.userId);
  if (user.role === 'student' && !classItem.studentIds.includes(user.id)) {
    return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  }
  if (user.role === 'teacher' && classItem.teacherId !== user.id) {
    return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  }

  const allUsers = db.getAllUsers();
  const members = classItem.studentIds
    .map(id => allUsers.find(u => u.id === id))
    .filter(Boolean)
    .map(student => ({ fullName: student.fullName, role: 'student', level: student.level }));

  members.unshift({ fullName: classItem.teacherName, role: 'teacher' });
  res.json({ members });
});

module.exports = router;
