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
