// routes/users.js
// Perfil propio, lista de estudiantes para profesores y administración de
// cuentas para el director. Un director solo ve las cuentas de SU escuela;
// la cuenta de director por defecto (sin escuela) ve todo el sistema.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin, requireRole } = require('../src/auth');

// Escuela desde la que trabaja quien hace la petición (null = todo el sistema).
function scopeOf(req) {
  const me = db.getUserById(req.session.userId);
  return me && me.schoolId ? Number(me.schoolId) : null;
}

function inScope(user, schoolId) {
  return schoolId == null || Number(user.schoolId) === schoolId;
}

router.put('/profile', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const { fullName, currentPassword, password, profilePic } = req.body || {};
  if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: 'El nombre completo es obligatorio.' });
  if (password && (!currentPassword || !db.verifyPassword(user, currentPassword))) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  if (password && password.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  const updated = db.updateUser(user.id, { fullName: String(fullName).trim(), password, profilePic });
  res.json({ user: db.publicUser(updated) });
});

router.get('/roster', requireRole('teacher'), (req, res) => {
  const schoolId = scopeOf(req);
  const students = db.getAllUsers()
    .filter(user => user.role === 'student' && inScope(user, schoolId) && (!req.query.level || user.level === req.query.level))
    .map(db.publicUser);
  res.json({ students });
});

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

// ---- Panel del director ----------------------------------------------------

router.get('/admin/users', requireRole('admin'), (req, res) => {
  const schoolId = scopeOf(req);
  const { q, role, level, status } = req.query;
  const users = db.getAllUsers()
    .filter(user =>
      inScope(user, schoolId) &&
      (!q || `${user.fullName} ${user.email || ''}`.toLowerCase().includes(String(q).toLowerCase())) &&
      (!role || user.role === role) &&
      (!level || user.level === level) &&
      (!status || user.status === status))
    .map(db.publicUser);
  res.json({ users });
});

router.get('/admin/stats', requireRole('admin'), (req, res) => res.json(db.getStats(scopeOf(req))));

router.post('/admin/users', requireRole('admin'), (req, res) => {
  const { fullName, email, password, role, level, grade } = req.body || {};
  if (!fullName || !password) return res.status(400).json({ error: 'El nombre y la contraseña son obligatorios.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  if (email && db.getUserByEmail(email)) return res.status(400).json({ error: 'Ese correo ya está registrado.' });

  const user = db.createUser({
    fullName, email, password, role, level, grade,
    schoolId: scopeOf(req) // la cuenta nace dentro de la escuela del director
  });
  res.status(201).json({ user: db.publicUser(user) });
});

router.put('/admin/users/:id', requireRole('admin'), (req, res) => {
  const target = db.getUserById(req.params.id);
  if (!target || !inScope(target, scopeOf(req))) return res.status(404).json({ error: 'No encontramos esa cuenta.' });
  const { schoolId, ...safe } = req.body || {}; // la escuela no se cambia desde aquí
  const user = db.updateUser(req.params.id, safe);
  res.json({ user: db.publicUser(user) });
});

router.delete('/admin/users/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === Number(req.session.userId)) {
    return res.status(400).json({ error: 'No puedes borrar tu propia cuenta de director.' });
  }
  const target = db.getUserById(req.params.id);
  if (!target || !inScope(target, scopeOf(req))) return res.status(404).json({ error: 'No encontramos esa cuenta.' });
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
