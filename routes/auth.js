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
//
// Los códigos de 'join' pueden ser de dos clases y las dos se resuelven en la
// misma casilla, porque quien llega con un papelito en la mano no tiene por
// qué saber cuál le tocó:
//
//   permanente  el de la escuela entera, sirve para mucha gente
//   nominal     de un solo uso, emitido para una persona concreta, y a veces
//               ya trae puestos el nivel y el grado

// Quien se apunta por su cuenta —'personal', 'parent' y 'school'— no entra al
// terminar el formulario: la cuenta nace apagada y hay que escribir el código
// de seis cifras que llega al correo. 'join' no pasa por ahí, porque de esa
// persona ya responde la escuela que le dio el código de ingreso, y muchos
// estudiantes no tienen correo. Ver la sección "Activar la cuenta por correo"
// en src/db.js.

const express = require('express');
const router = express.Router();
const db = require('../src/db.js');
const mailer = require('../src/mailer.js');

function startSession(req, user) {
  req.session.userId = user.id;
  req.session.role = user.role;
  delete req.session.verificandoId;
}

// Al enlazar a un hijo se le avisa, pero solo cuando la cuenta ya es de
// alguien: avisar a un estudiante de que "su familia" lo sigue antes de que
// nadie haya demostrado ser esa familia sería mentirle.
function avisarALaFamilia(user) {
  db.getChildrenOf(user.id).forEach(hijo => {
    db.addNotification(hijo.id, {
      type: 'family',
      title: 'Tu familia sigue tu asistencia',
      message: `${user.fullName} podrá ver si llegaste a clase cada día.`
    });
  });
}

// Manda el código y deja la cuenta esperando. Quién es esa cuenta se guarda en
// la sesión y no viaja al navegador: si el id fuera por el camino, cualquiera
// podría pedir códigos para cuentas ajenas probando números.
async function pedirCodigo(req, res, user, { reenvio = false } = {}) {
  const hecho = db.nuevoCodigoDeVerificacion(user.id);

  if (!hecho || hecho.error === 'espera') {
    return res.status(429).json({
      error: `Acabo de mandarte uno. Espera ${hecho ? hecho.segundos : 60} segundos y vuelve a intentar.`,
      esperar: hecho ? hecho.segundos : 60
    });
  }
  if (hecho.error === 'demasiados') {
    return res.status(429).json({
      error: 'Se mandaron demasiados códigos a ese correo. Prueba otra vez dentro de una hora.'
    });
  }

  try {
    await mailer.enviarCodigo({
      para: user.email,
      nombre: (user.fullName || '').split(' ')[0],
      codigo: hecho.codigo,
      minutos: hecho.minutos
    });
  } catch (err) {
    // El correo no salió. La cuenta se queda esperando —el código sigue
    // valiendo— pero hay que decirlo, porque si no la persona se queda
    // mirando una pantalla que le pide algo que nunca le va a llegar.
    console.error('[roboRobin] No se pudo mandar el código a', user.email, '->', err.message);
    return res.status(502).json({
      error: 'La cuenta se creó, pero no pude mandarte el correo. Vuelve a intentarlo en un momento.',
      creada: true
    });
  }

  req.session.verificandoId = user.id;
  res.status(reenvio ? 200 : 201).json({
    verificar: true,
    email: user.email,
    minutos: hecho.minutos
  });
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

router.post('/register', async (req, res) => {
  const body = req.body || {};
  const mode = body.mode;
  const fullName = String(body.fullName || '').trim();
  const password = String(body.password || '');
  const email = body.email ? String(body.email).trim() : null;

  if (!fullName) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  // Antes de nada, barrer las cuentas que se quedaron a medias: si no, un
  // correo tecleado mal queda ocupado para siempre y su dueño no puede volver
  // a intentarlo.
  db.purgarCuentasSinActivar();

  const yaEsta = email ? db.getUserByEmail(email) : null;
  if (yaEsta) {
    // Un registro a medias no es un choque: es la misma persona volviendo a
    // intentarlo, casi siempre porque el correo no le llegó. Se le manda otro
    // código y se le lleva a la casilla, en vez de un error que no le dice
    // qué hacer.
    if (yaEsta.status === 'pending') return pedirCodigo(req, res, yaEsta, { reenvio: true });
    return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  }

  // --- Cuenta personal ------------------------------------------------------
  // Aquí sí se pide la edad. Una cuenta de escuela no la necesita porque su
  // nivel y su grado ya dicen lo mismo con más precisión; una cuenta personal
  // no tiene ninguna de las dos cosas, y sin ese dato Robin le explica igual a
  // alguien de 8 años que a alguien de 40.
  if (mode === 'personal') {
    if (!email) return res.status(400).json({ error: 'El correo es necesario para una cuenta personal.' });

    const age = Number(body.age);
    if (!Number.isFinite(age) || Math.floor(age) !== age) {
      return res.status(400).json({ error: 'Escribe tu edad en años.' });
    }
    if (age < 4 || age > 120) {
      return res.status(400).json({ error: 'Esa edad no parece real. Escríbela en años.' });
    }

    const pide = db.necesitaVerificar('personal');
    const user = db.createUser({
      fullName, email, password, role: 'personal', plan: 'free', age,
      status: pide ? 'pending' : 'active'
    });
    if (pide) return pedirCodigo(req, res, user);
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

    const pide = db.necesitaVerificar('parent');
    const user = db.createUser({
      fullName, email, password, role: 'parent', plan: 'free',
      status: pide ? 'pending' : 'active'
    });

    // El hijo se enlaza ya, pero el aviso NO se manda todavía: hasta que el
    // correo esté activado esta cuenta no es de nadie, y avisar a un
    // estudiante de que "su familia" lo sigue antes de eso sería mentirle.
    const enlace = db.linkChild(user.id, code);
    if (pide) return pedirCodigo(req, res, user);

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

    const pide = db.necesitaVerificar('school');
    const user = db.createUser({
      fullName, email, password, role: 'admin',
      status: pide ? 'pending' : 'active'
    });
    const school = db.createSchool({ name: schoolName, directorId: user.id, directorName: user.fullName });
    db.updateUser(user.id, { schoolId: school.id });

    // Los dos códigos de la escuela no se enseñan aquí: se dan al activar la
    // cuenta. Repartirlos antes sería dejar que cualquiera fabrique una
    // escuela con un correo inventado y se lleve unos códigos que funcionan.
    if (pide) return pedirCodigo(req, res, user);

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
      grade: match.grade || body.grade || null
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

  // La contraseña era buena pero la cuenta nunca se activó. Decirlo es seguro
  // —ya demostró ser su dueño al acertar la contraseña— y es lo único que le
  // saca del atolladero.
  //
  // No se manda un código aquí: puede que el primero siga valiendo y esté en
  // su bandeja. La pantalla le deja escribirlo o pedir otro.
  if (user.status === 'pending') {
    req.session.verificandoId = user.id;
    return res.status(403).json({
      error: 'Esa cuenta todavía no está activada. Escribe el código que te mandamos al correo, o pide uno nuevo.',
      verificar: true,
      email: user.email
    });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Esa cuenta está suspendida. Habla con la dirección de tu escuela.' });
  }

  startSession(req, user);
  res.json({ user: db.publicUser(user) });
});

// ---------------------------------------------------------------------------
// Activar la cuenta
// ---------------------------------------------------------------------------
// Quién se está activando sale de la sesión, no del cuerpo de la petición. Es
// lo que impide que alguien pruebe códigos contra cuentas ajenas: para llegar
// aquí hay que haber pasado antes por el registro o por el login con la
// contraseña correcta.

router.get('/verify', (req, res) => {
  const user = req.session.verificandoId ? db.getUserById(req.session.verificandoId) : null;
  if (!user) return res.status(404).json({ error: 'No hay ninguna cuenta esperando código.' });
  res.json({ email: user.email, minutos: db.VERIFICACION_MINUTOS });
});

router.post('/verify', (req, res) => {
  const id = req.session.verificandoId;
  if (!id) return res.status(400).json({ error: 'No hay ninguna cuenta esperando código. Vuelve a registrarte.' });

  const salida = db.comprobarCodigoDeVerificacion(id, (req.body || {}).code);

  if (salida.error) {
    const mensajes = {
      'no-existe': 'Esa cuenta ya no existe. Vuelve a registrarte.',
      'sin-codigo': 'No hay ningún código pendiente. Pide uno nuevo.',
      'vencido': 'Ese código ya venció. Pide uno nuevo.',
      'demasiados-intentos': 'Demasiados intentos con ese código. Pide uno nuevo.',
      'no-coincide': salida.quedan
        ? `Ese código no es. Te quedan ${salida.quedan} ${salida.quedan === 1 ? 'intento' : 'intentos'}.`
        : 'Ese código no es, y se acabaron los intentos. Pide uno nuevo.'
    };
    const estado = salida.error === 'no-coincide' ? 400 : 410;
    return res.status(estado).json({ error: mensajes[salida.error] || 'No se pudo activar la cuenta.' });
  }

  const user = salida.user;
  startSession(req, user);

  const respuesta = { user: db.publicUser(user) };

  // Si activó al inscribir una escuela, aquí es donde por fin recibe sus dos
  // códigos de ingreso: antes no, porque antes la cuenta no era de nadie.
  const escuela = user.schoolId ? db.getSchoolById(user.schoolId) : null;
  if (escuela && Number(escuela.directorId) === Number(user.id)) {
    respuesta.school = {
      id: escuela.id,
      name: escuela.name,
      studentCode: escuela.studentCode,
      teacherCode: escuela.teacherCode
    };
  }

  // Y si es una cuenta de familia, ahora sí se avisa al hijo o la hija.
  if (user.role === 'parent') {
    avisarALaFamilia(user);
    const hijos = db.getChildrenOf(user.id);
    respuesta.child = hijos.length ? { fullName: hijos[0].fullName } : null;
  }

  res.json(respuesta);
});

router.post('/verify/resend', async (req, res) => {
  const user = req.session.verificandoId ? db.getUserById(req.session.verificandoId) : null;
  if (!user) return res.status(400).json({ error: 'No hay ninguna cuenta esperando código.' });
  if (user.status === 'active') return res.status(400).json({ error: 'Esa cuenta ya está activada. Puedes entrar.' });
  return pedirCodigo(req, res, user, { reenvio: true });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

module.exports = router;
