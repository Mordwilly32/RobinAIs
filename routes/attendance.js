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
