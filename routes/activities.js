// routes/activities.js
// Actividades dentro de una clase (tareas que el profesor publica).

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');

router.get('/class/:classId', requireLogin, (req, res) => {
  const classItem = db.getClassById(req.params.classId);
  if (!classItem) return res.status(404).json({ error: 'No encontramos esa clase.' });

  const user = db.getUserById(req.session.userId);
  if (user.role === 'teacher' && classItem.teacherId !== user.id) return res.status(403).json({ error: 'No tienes acceso a esa clase.' });
  if (user.role === 'student' && !classItem.studentIds.includes(user.id)) return res.status(403).json({ error: 'No tienes acceso a esa clase.' });

  res.json({ activities: db.getActivitiesForClass(req.params.classId) });
});

router.post('/class/:classId', requireRole('teacher'), (req, res) => {
  const classItem = db.getClassById(req.params.classId);
  if (!classItem || classItem.teacherId !== req.session.userId) return res.status(403).json({ error: 'No tienes acceso a esa clase.' });

  const { title, description, dueDate } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'La actividad necesita un título.' });

  const activity = db.createActivity({ classId: req.params.classId, title: String(title).trim(), description, dueDate });

  classItem.studentIds.forEach(studentId => {
    db.addNotification(studentId, {
      type: 'new-activity',
      classId: classItem.id,
      title: 'Nueva actividad',
      message: `${classItem.teacherName} publicó una actividad nueva: ${activity.title}`
    });
  });

  res.status(201).json({ activity });
});

module.exports = router;
