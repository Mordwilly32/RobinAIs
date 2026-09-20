// routes/chats.js
// Las conversaciones con Robin. Ya no es un historial plano: cada conversación
// tiene su título, su contexto y sus mensajes, y viven todas en la lista del
// menú lateral para poder volver a cualquiera.
//
// El contexto importa, porque cambia cómo contesta Robin:
//   general    una charla cualquiera
//   homework   una asignación concreta de una clase — aquí Robin guía, jamás
//              entrega la respuesta hecha
//   game       una mano de un minijuego

const express = require('express');
const router = express.Router();
const db = require('../src/db');
const { requireLogin } = require('../src/auth');

router.get('/', requireLogin, (req, res) => {
  const me = db.getUserById(req.session.userId);
  db.pruneChatHistory(me); // el plan decide cuántos días se guardan
  res.json({ chats: db.getChats(me.id).map(db.chatSummary) });
});

router.post('/', requireLogin, (req, res) => {
  const { title, context, classId, activityId, gameId } = req.body || {};
  const chat = db.createChat({
    userId: req.session.userId,
    title, context, classId, activityId, gameId
  });
  res.status(201).json({ chat: db.chatSummary(chat), messages: [] });
});

router.get('/:id', requireLogin, (req, res) => {
  const chat = db.getChat(req.session.userId, req.params.id);
  if (!chat) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  res.json({ chat: db.chatSummary(chat), messages: chat.messages });
});

router.put('/:id', requireLogin, (req, res) => {
  const chat = db.renameChat(req.session.userId, req.params.id, (req.body || {}).title);
  if (!chat) return res.status(404).json({ error: 'No encontramos esa conversación.' });
  res.json({ chat: db.chatSummary(chat) });
});

router.delete('/:id', requireLogin, (req, res) => {
  if (!db.deleteChat(req.session.userId, req.params.id)) {
    return res.status(404).json({ error: 'No encontramos esa conversación.' });
  }
  res.json({ ok: true });
});

// Borrar el historial entero. Se hace explícito con ?all=1 para que no pase
// por accidente al equivocarse de ruta.
router.delete('/', requireLogin, (req, res) => {
  if (req.query.all !== '1') {
    return res.status(400).json({ error: 'Para borrar todo el historial hace falta confirmarlo.' });
  }
  db.deleteAllChats(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
