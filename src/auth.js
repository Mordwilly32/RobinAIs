// src/auth.js
// Ayudantes sobre express-session para proteger rutas por sesión o por rol.

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'No tienes permiso para hacer eso.' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
