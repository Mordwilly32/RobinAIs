// routes/auth.js
// Registro e inicio de sesión. Hay cuatro formas de crear una cuenta:
//
//   mode: 'personal'  -> cuenta personal (público general / estudiante por su
//                        cuenta). Entra directo al espacio de trabajo con Robin.
//   mode: 'parent'    -> cuenta de familia, enganchada al ID de estudiante de
//                        su hijo o hija.
//   mode: 'school'    -> inscribir una escuela. Quien la inscribe queda como
//                        director (admin) y recibe los dos códigos de ingreso.
//   mode: 'join'      -> unirse a una escuela existente con un código. El
//                        código decide si la cuenta es de estudiante o de
//                        profesor; nadie elige su propio rol.
//
// Los códigos de 'join' pueden ser de dos clases y las dos se resuelven en la
// misma casilla, porque quien llega con un papelito en la mano no tiene por
// qué saber cuál le tocó:
//
//   permanente  el de la escuela entera, sirve para mucha gente
//   nominal     de un solo uso, emitido para una persona concreta, y a veces
//               ya trae puestos el nivel y el grado
//
// Todas las cuentas nacen encendidas. Hubo un tiempo en que las cuentas que
// alguien se hacía por su cuenta esperaban un código de seis cifras por
// correo: dependía de un proveedor de correo que hay que pagar y mantener, y
// el resultado en la práctica era gente que no podía entrar a su propia cuenta
// porque el correo no le llegaba nunca. Ya no hay nada de eso.

const express = require('express');
const router = express.Router();
const db = require('../src/db.js');

function startSession(req, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
}

// Al enlazar a un hijo se le avisa.
function avisarALaFamilia(user) {
  db.getChildrenOf(user.id).forEach(hijo => {
    db.addNotification(hijo.id, {
      type: 'family',
      title: 'Tu familia sigue tu asistencia',
      message: `${user.fullName} podrá ver si llegaste a clase cada día.`
    });
  });
}

// Cuándo naciste y de dónde eres. Se piden en los cuatro caminos, porque los
// dos sirven para lo mismo en todos: Robin no le explica igual a alguien de 8
// años que a alguien de 40, y el país cambia cómo se llaman los grados y qué
// ejemplos vienen al caso.
//
// La edad no se pregunta: sale de la fecha. Un número escrito a mano se queda
// viejo al día siguiente del cumpleaños.
function revisarNacimientoYPais(body) {
  const birthDate = db.normalizeBirthDate(body.birthDate);
  if (!birthDate) {
    return { error: 'Escribe cuándo naciste, con día, mes y año.' };
  }

  const age = db.edadDeNacimiento(birthDate);
  if (age < 4) {
    return { error: 'Esa fecha dice que tienes menos de 4 años. Revísala.' };
  }
  if (age > 120) {
    return { error: 'Esa fecha no parece real. Revísala.' };
  }

  const country = db.normalizeCountry(body.country);
  if (!country) return { error: 'Elige tu país.' };

  return { ok: true, birthDate, country, age };
}

router.get('/me', (req, res) => {
  const user = req.session.userId ? db.getUserById(req.session.userId) : null;
  if (!user) return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
  // El rol pudo cambiar desde otra pestaña (una invitación aceptada, por
  // ejemplo): la sesión se pone al día sola.
  req.session.role = user.role;
  res.json({ user: db.publicUser(user) });
});

// Resuelve un código de ingreso, sea permanente o nominal. Devuelve siempre la
// misma forma para que la pantalla de registro no tenga que distinguirlos.
function resolveAnyCode(raw) {
  const permanente = db.resolveJoinCode(raw);
  if (permanente) {
    return {
      ok: true,
      kind: 'permanent',
      school: permanente.school,
      role: permanente.role,
      forName: null, level: null, grade: null, classId: null, codeId: null
    };
  }

  const nominal = db.checkJoinCode(raw);
  if (nominal.ok) {
    return {
      ok: true,
      kind: 'nominal',
      school: nominal.school,
      role: nominal.code.type,
      forName: nominal.code.forName,
      level: nominal.code.level,
      grade: nominal.code.grade,
      classId: nominal.code.classId,
      codeId: nominal.code.id
    };
  }

  const motivos = {
    'no-existe': 'Ese código no existe. Revisa que no se te haya ido una letra.',
    'anulado': 'Ese código fue anulado. Pídele uno nuevo a quien te lo dio.',
    'usado': 'Ese código ya se usó. Cada código personal sirve una sola vez.'
  };
  return { ok: false, error: motivos[nominal.reason] || 'Ese código no sirve.' };
}

// Consulta pública: ¿este código existe y a qué escuela / rol corresponde?
// Se usa en el registro para mostrar el nombre de la escuela antes de crear
// la cuenta. Nunca revela ningún otro código.
router.get('/join-code/:code', (req, res) => {
  const match = resolveAnyCode(req.params.code);
  if (!match.ok) return res.status(404).json({ error: match.error });

  res.json({
    school: { id: match.school.id, name: match.school.name },
    role: match.role,
    kind: match.kind,
    forName: match.forName,
    level: match.level,
    grade: match.grade,
    className: match.classId ? (db.getClassById(match.classId) || {}).name || null : null
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

  if (email && db.getUserByEmail(email)) {
    return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  }

  // Cuándo naciste y de dónde eres, antes de mirar nada más: son los mismos
  // dos datos en los cuatro caminos y da igual cuál se eligió arriba.
  const quien = revisarNacimientoYPais(body);
  if (quien.error) return res.status(400).json({ error: quien.error });
  const { birthDate, country } = quien;

  // --- Cuenta personal ------------------------------------------------------
  // Una cuenta personal no tiene nivel ni grado, así que la fecha de
  // nacimiento es lo único que le dice a Robin a quién le está explicando.
  if (mode === 'personal') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta personal.' });

    const user = db.createUser({
      fullName, email, password, role: 'personal', plan: 'free', birthDate, country
    });
    startSession(req, user);
    return res.status(201).json({ user: db.publicUser(user) });
  }

  // --- Cuenta de padre o madre ---------------------------------------------
  // Vive en el mismo camino que la cuenta personal, porque es lo que es: una
  // cuenta de alguien de fuera de la escuela. Lo único distinto es a quién
  // acompaña, y eso se dice con el ID de estudiante de su hijo — el mismo
  // que ya usa para entrar, así que no hay un código nuevo que repartir.
  if (mode === 'parent') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta de familia.' });

    const code = String(body.studentCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Escribe el ID de estudiante de tu hijo o hija.' });
    if (!db.getUserByStudentCode(code)) {
      return res.status(400).json({ error: 'No hay ningún estudiante con ese ID. Se parece a STU-00007.' });
    }

    const user = db.createUser({
      fullName, email, password, role: 'parent', plan: 'free', birthDate, country
    });

    const enlace = db.linkChild(user.id, code);
    avisarALaFamilia(user);
    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(db.getUserById(user.id)),
      child: enlace.ok ? { fullName: enlace.student.fullName } : null
    });
  }

  // --- Inscribir una escuela (el que la crea queda como director) -----------
  if (mode === 'school') {
    const schoolName = String(body.schoolName || '').trim();
    if (!schoolName) return res.status(400).json({ error: 'Escribe el nombre de tu escuela.' });
    if (!email) return res.status(400).json({ error: 'El correo es necesario para la cuenta del director.' });

    const user = db.createUser({
      fullName, email, password, role: 'admin', birthDate, country
    });
    const school = db.createSchool({ name: schoolName, directorId: user.id, directorName: user.fullName });
    db.updateUser(user.id, { schoolId: school.id });

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(db.getUserById(user.id)),
      school: {
        id: school.id, name: school.name,
        studentCode: school.studentCode, teacherCode: school.teacherCode
      }
    });
  }

  // --- Unirse con un código (estudiante o profesor) -------------------------
  if (mode === 'join') {
    const match = resolveAnyCode(body.code);
    if (!match.ok) return res.status(400).json({ error: match.error });

    const { school, role } = match;
    // El nivel puede venir ya puesto en un código nominal; si no, lo elige
    // quien se registra.
    const level = match.level || body.level || null;
    if (role === 'student' && !level) {
      return res.status(400).json({ error: 'Elige tu nivel escolar.' });
    }

    const user = db.createUser({
      fullName,
      email,
      password,
      role,
      schoolId: school.id,
      level: role === 'student' ? level : (body.level || null),
      grade: match.grade || body.grade || null,
      birthDate,
      country
    });

    // Un código nominal se quema aquí mismo: ya cumplió su único uso.
    if (match.kind === 'nominal') {
      db.burnJoinCode(match.codeId, user.id);
      // Si venía atado a una clase, la persona entra ya matriculada en ella.
      if (match.classId && role === 'student') {
        db.addStudentToClass(match.classId, user.id);
      }
    }

    startSession(req, user);
    return res.status(201).json({
      user: db.publicUser(user),
      school: { id: school.id, name: school.name },
      joinedClass: match.classId ? (db.getClassById(match.classId) || {}).name || null : null
    });
  }

  return res.status(400).json({ error: 'Elige primero qué tipo de cuenta quieres crear.' });
});

router.post('/login', (req, res) => {
  const loginId = String((req.body && req.body.email) || '').trim();
  const password = String((req.body && req.body.password) || '');

  // Se puede entrar con correo o con el ID de estudiante (STU-00001).
  let user = db.getUserByEmail(loginId);
  if (!user && loginId.toUpperCase().startsWith('STU-')) user = db.getUserByStudentCode(loginId);

  if (!user || !db.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Esa cuenta está suspendida. Habla con la dirección de tu escuela.' });
  }

  startSession(req, user);
  res.json({ user: db.publicUser(user) });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

module.exports = router;
