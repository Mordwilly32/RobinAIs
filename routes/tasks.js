// routes/tasks.js
// El organizador personal: tareas y pendientes del día a día.
// Disponible para cualquier cuenta con sesión iniciada (personal, estudiante,
// profesor o director) — cada quien solo ve y edita las suyas.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');

router.get('/', requireLogin, (req, res) => {
  res.json({ tasks: db.getTasks(req.session.userId) });
});

router.post('/', requireLogin, (req, res) => {
  const { title, notes, due, priority, category } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Escribe de qué se trata la tarea.' });
  const task = db.createTask({ userId: req.session.userId, title, notes, due, priority, category });
  res.status(201).json({ task });
});

router.put('/:id', requireLogin, (req, res) => {
  const task = db.updateTask(req.session.userId, req.params.id, req.body || {});
  if (!task) return res.status(404).json({ error: 'No encontramos esa tarea.' });
  res.json({ task });
});

router.delete('/:id', requireLogin, (req, res) => {
  if (!db.deleteTask(req.session.userId, req.params.id)) {
    return res.status(404).json({ error: 'No encontramos esa tarea.' });
  }
  res.json({ ok: true });
});

module.exports = router;
