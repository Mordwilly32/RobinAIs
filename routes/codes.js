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
