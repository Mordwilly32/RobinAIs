// routes/announcements.js
// Avisos de la escuela. Cada aviso pertenece a una escuela, así que dos
// escuelas que corran en la misma instalación nunca ven los avisos de la otra.

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');
const { requirePermission, can } = require('../src/permissions');

const VALID_LEVELS = [...db.LEVELS, 'Todos los niveles'];

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  if (me.role === 'personal') return res.json({ announcements: [] });

  const schoolId = me.schoolId || null;
  if (me.role === 'student') {
    return res.json({ announcements: db.getAnnouncementsForLevel(schoolId, me.level) });
  }
  return res.json({ announcements: db.getAnnouncements(schoolId) });
});

router.post('/', requirePermission('announcements.create'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const { title, content, level } = req.body || {};

  if (!title || !content || !level) {
    return res.status(400).json({ error: 'Necesitas un título, un mensaje y un nivel.' });
  }
  if (!VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: 'Ese nivel no existe.' });
  }

  const announcement = db.createAnnouncement({
    authorId: me.id,
    authorName: me.fullName,
    schoolId: me.schoolId || null,
    title, content, level
  });
  res.status(201).json({ announcement });
});

router.delete('/:id', requirePermission('announcements.create'), (req, res) => {
  const me = db.getUserById(req.session.userId);
  const announcement = db.getAnnouncementById(req.params.id);
  if (!announcement) return res.status(404).json({ error: 'No encontramos ese aviso.' });

  // Un profesor (o secretaria) solo borra los suyos; direccion y subdireccion
  // borran cualquiera de su escuela.
  const sameSchool = me.schoolId == null || Number(announcement.schoolId) === Number(me.schoolId);
  const allowed = can(me.role, 'announcements.deleteAny') ? sameSchool : announcement.authorId === me.id;
  if (!allowed) return res.status(403).json({ error: 'No puedes borrar ese aviso.' });

  db.deleteAnnouncement(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
