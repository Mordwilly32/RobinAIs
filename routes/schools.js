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
