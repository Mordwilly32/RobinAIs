// routes/auth.js
// Registro e inicio de sesión. Hay tres formas de crear una cuenta:
//
//   mode: 'personal'  -> cuenta personal (público general / estudiante por su
//                        cuenta). Entra directo al espacio de trabajo con Robin.
//   mode: 'school'    -> inscribir una escuela. Quien la inscribe queda como
//                        director (admin) y recibe los dos códigos de ingreso.
//   mode: 'join'      -> unirse a una escuela existente con un código. El
//                        código decide si la cuenta es de estudiante o de
//                        profesor; nadie elige su propio rol.

const express = require('express');
const router = express.Router();
const db = require('../src/db.js');

function startSession(req, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
}

router.get('/me', (req, res) => {
  const user = req.session.userId ? db.getUserById(req.session.userId) : null;
  if (!user) return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
  res.json({ user: db.publicUser(user) });
});

// Consulta pública: ¿este código existe y a qué escuela / rol corresponde?
// Se usa en el registro para mostrar el nombre de la escuela antes de crear
// la cuenta. Nunca revela ningún otro código.
router.get('/join-code/:code', (req, res) => {
  const match = db.resolveJoinCode(req.params.code);
  if (!match) return res.status(404).json({ error: 'Ese código no existe. Pídele el código correcto a tu director.' });
  res.json({
    school: { id: match.school.id, name: match.school.name },
    role: match.role
  });
});

router.post('/register', (req, res) => {
  const body = req.body || {};
  const mode = body.mode;
  const fullName = String(body.fullName || '').trim();
  const password = String(body.password || '');
  const email = body.email ? String(body.email).trim() : null;

  if (!fullName) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  if (email && db.getUserByEmail(email)) return res.status(409).json({ error: 'Ese correo ya está registrado.' });

  // --- Cuenta personal ------------------------------------------------------
  if (mode === 'personal') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta personal.' });
    const user = db.createUser({ fullName, email, password, role: 'personal' });
    startSession(req, user);
    return res.status(201).json({ user: db.publicUser(user) });
  }

  // --- Inscribir una escuela (el que la crea queda como director) -----------
  if (mode === 'school') {
    const schoolName = String(body.schoolName || '').trim();
    if (!schoolName) return res.status(400).json({ error: 'Escribe el nombre de tu escuela.' });
    if (!email) return res.status(400).json({ error: 'El correo es necesario para la cuenta del director.' });

    const user = db.createUser({ fullName, email, password, role: 'admin' });
    const school = db.createSchool({ name: schoolName, directorId: user.id, directorName: user.fullName });
    db.updateUser(user.id, { schoolId: school.id });

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(db.getUserById(user.id)),
      school: {
        id: school.id,
        name: school.name,
        studentCode: school.studentCode,
        teacherCode: school.teacherCode
      }
    });
  }

  // --- Unirse con un código (estudiante o profesor) -------------------------
  if (mode === 'join') {
    const match = db.resolveJoinCode(body.code);
    if (!match) return res.status(400).json({ error: 'Ese código no existe. Pídele el código correcto a tu director.' });

    const { school, role } = match;
    if (role === 'student' && !body.level) {
      return res.status(400).json({ error: 'Elige tu nivel escolar.' });
    }

    const user = db.createUser({
      fullName,
      email,
      password,
      role,
      schoolId: school.id,
      level: role === 'student' ? body.level : (body.level || null),
      grade: body.grade || null
    });

    startSession(req, user);
    return res.status(201).json({ user: db.publicUser(user), school: { id: school.id, name: school.name } });
  }

  return res.status(400).json({ error: 'Elige primero qué tipo de cuenta quieres crear.' });
});

router.post('/login', (req, res) => {
  const loginId = String((req.body && req.body.email) || '').trim();
  const password = String((req.body && req.body.password) || '');

  // Se puede entrar con correo o con el ID de estudiante (STU-00001).
  let user = db.getUserByEmail(loginId);
  if (!user && loginId.toUpperCase().startsWith('STU-')) user = db.getUserByStudentCode(loginId);

  if (!user || user.status !== 'active' || !db.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
  }

  startSession(req, user);
  res.json({ user: db.publicUser(user) });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

module.exports = router;
