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
