// routes/dev.js
// ---------------------------------------------------------------------------
// La consola de demostración.
//
// Existe para una sola cosa: enseñar roboRobin delante de gente sin perder dos
// minutos tecleando correos y contraseñas. Deja entrar a cualquier cuenta que
// ya exista con un botón, y deja fabricar clases de mentira para que las
// pantallas no se vean vacías.
//
// Por eso mismo NO es una función del producto:
//
//   · No aparece en ningún menú. Se abre con Ctrl + Alt + Shift + R desde
//     cualquier pantalla (ver public/js/consola.js).
//   · Es de UNA sola persona. Hay dos maneras de abrirla y no hay una tercera:
//
//       - estar dentro con la cuenta dueña (RR_CONSOLA_DUENO), o
//       - escribir la contraseña de la consola (RR_CONSOLA_CLAVE).
//
//     La segunda existe porque la consola sirve sobre todo cuando NO hay
//     sesión abierta: es la pantalla desde la que se entra a las demás.
//
//   · Se apaga entera con RR_DEV_CONSOLE=0, o con "devConsole": false en
//     config.json. Apagada, estas rutas contestan 404 como si no existieran.
//
// Antes esta puerta se cerraba sola en producción (NODE_ENV=production), y eso
// tenía un efecto que no se veía desde el navegador: en el servidor de verdad
// la consola contestaba 404 y el atajo parecía roto. Ahora la puerta no se
// cierra por dónde corra el servidor, sino por quién llama.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const db = require('../src/db.js');
const { ROLE_LABEL } = require('../src/permissions.js');

function config() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

// La cuenta dueña. Cualquier otra cuenta, aunque sea de dirección, no ve nada.
const DUENO = (process.env.RR_CONSOLA_DUENO || 'cokatielcoty009@gmail.com').trim().toLowerCase();

// La contraseña de la consola. No vive en el repositorio: sale de la variable
// de entorno o de config.json, que están los dos en el .gitignore. Sin ella
// puesta, la única manera de abrir la consola es haber entrado con la cuenta
// dueña.
const CLAVE = String(process.env.RR_CONSOLA_CLAVE || config().consolaClave || '').trim();

// Cinco intentos por sesión y se acabó. No hay manera de probar contraseñas a
// ciegas contra esto sin que la propia sesión se cierre en la cara.
const INTENTOS = 5;

function apagada() {
  if (process.env.RR_DEV_CONSOLE === '1') return false;
  if (process.env.RR_DEV_CONSOLE === '0') return true;
  return config().devConsole === false;
}

function esDueno(req) {
  const user = req.session && req.session.userId ? db.getUserById(req.session.userId) : null;
  return Boolean(user && user.email && user.email.trim().toLowerCase() === DUENO);
}

function abierta(req) {
  // La versión sin servidor de GitHub Pages no tiene a quién proteger: su base
  // vive en la pestaña, se borra al cerrarla y todo lo que hay dentro es de
  // mentira. Ahí la consola está abierta, y la enciende rr-runtime.js — en un
  // servidor de verdad esta variable no existe.
  if (process.env.RR_CONSOLA_ABIERTA === '1') return true;
  return esDueno(req) || (req.session && req.session.consolaAbierta === true);
}

// Comparación que no se puede cronometrar: recorre las dos cadenas enteras
// pase lo que pase. Con === se filtraría por el tiempo cuántos caracteres van
// bien, que es exactamente cómo se adivina una clave sin saberla.
//
// A mano y sin crypto a propósito: este archivo también se empaqueta para la
// versión sin servidor, donde no hay un SHA-256 síncrono que usar.
function claveCorrecta(escrita) {
  if (!CLAVE) return false;
  const a = String(escrita == null ? '' : escrita);
  let dif = a.length ^ CLAVE.length;
  const n = Math.max(a.length, CLAVE.length);
  for (let i = 0; i < n; i++) {
    // Fuera de la cadena, charCodeAt da NaN, y NaN | 0 es 0.
    dif |= (a.charCodeAt(i) | 0) ^ (CLAVE.charCodeAt(i) | 0);
  }
  return dif === 0;
}

// Apagada del todo, estas rutas no existen. Se contesta el mismo 404 que
// cualquier dirección inventada para no confirmar que la consola está ahí.
router.use((req, res, next) => {
  if (apagada()) return res.status(404).json({ error: 'No encontrado.' });
  next();
});

// ---- La puerta -------------------------------------------------------------

// Lo único que se puede preguntar sin haber entrado: si esta sesión tiene la
// consola abierta y si hay una contraseña que escribir. Nunca dice de quién es
// la consola: ese correo no tiene por qué viajar a un navegador cualquiera.
router.get('/estado', (req, res) => {
  res.json({
    abierta: abierta(req),
    pideClave: Boolean(CLAVE),
    // Sin clave puesta y sin ser el dueño no hay nada que intentar: la pantalla
    // lo dice en vez de enseñar una casilla que no va a abrir nada.
    soloDueno: !CLAVE
  });
});

router.post('/unlock', (req, res) => {
  const sesion = req.session;
  if (abierta(req)) return res.json({ abierta: true });

  sesion.consolaFallos = Number(sesion.consolaFallos || 0);
  if (sesion.consolaFallos >= INTENTOS) {
    return res.status(429).json({ error: 'Demasiados intentos. Cierra el navegador y vuelve a empezar.' });
  }

  if (!CLAVE) {
    return res.status(403).json({ error: 'Esta consola es de una sola cuenta. Entra con ella.' });
  }

  if (!claveCorrecta((req.body || {}).clave || '')) {
    sesion.consolaFallos += 1;
    const quedan = INTENTOS - sesion.consolaFallos;
    return res.status(403).json({
      error: quedan > 0
        ? `Esa no es la contraseña. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`
        : 'Esa no es la contraseña, y se acabaron los intentos.'
    });
  }

  sesion.consolaAbierta = true;
  sesion.consolaFallos = 0;
  res.json({ abierta: true });
});

router.post('/lock', (req, res) => {
  if (req.session) req.session.consolaAbierta = false;
  res.json({ abierta: false });
});

// De aquí para abajo hay que haber pasado por la puerta.
router.use((req, res, next) => {
  if (!abierta(req)) {
    return res.status(403).json({ error: 'La consola está cerrada.', cerrada: true });
  }
  next();
});

// ---- Qué hay dentro --------------------------------------------------------

// Todas las cuentas, agrupadas por escuela, con lo justo para reconocerlas en
// una lista. Nunca sale el hash de la contraseña: entrar es un botón, no
// leerse la clave de nadie.
router.get('/accounts', (req, res) => {
  const escuelas = {};
  db.getSchools().forEach(s => { escuelas[s.id] = s.name; });

  const accounts = db.getAllUsers().map(u => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    studentCode: u.studentCode || null,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    level: u.level,
    grade: u.grade,
    status: u.status,
    schoolId: u.schoolId,
    schoolName: u.schoolId ? escuelas[u.schoolId] || null : null
  }));

  res.json({
    accounts,
    schools: db.getSchools().map(s => ({ id: s.id, name: s.name })),
    classes: db.getClasses().length
  });
});

// ---- Entrar con un botón ---------------------------------------------------

router.post('/login', (req, res) => {
  const user = db.getUserById((req.body || {}).userId);
  if (!user) return res.status(404).json({ error: 'Esa cuenta ya no existe.' });

  req.session.userId = user.id;
  req.session.role = user.role;

  const publico = db.publicUser(user);
  res.json({ user: publico });
});

// ---- Clases de mentira para que nada se vea vacío --------------------------

const MATERIAS = [
  { name: 'Matemáticas', subject: 'Matemáticas' },
  { name: 'Ciencias Naturales', subject: 'Ciencias' },
  { name: 'Lenguaje y Literatura', subject: 'Lenguaje' },
  { name: 'Estudios Sociales', subject: 'Sociales' },
  { name: 'Inglés', subject: 'Inglés' },
  { name: 'Física', subject: 'Física' },
  { name: 'Química', subject: 'Química' },
  { name: 'Biología', subject: 'Biología' },
  { name: 'Programación', subject: 'Informática' },
  { name: 'Arte', subject: 'Arte' }
];

const SECCIONES = ['A', 'B', 'C', 'D'];
const NIVELES = ['Primaria', 'Secundaria', 'Bachillerato', 'Universidad'];

// El grado tiene que pegar con el nivel: antes se elegían por separado y
// salían cosas como «Primaria · 2.º año» o «Universidad · 6.º grado».
const GRADOS_POR_NIVEL = {
  'Primaria': ['4.º grado', '5.º grado', '6.º grado'],
  'Secundaria': ['7.º grado', '8.º grado', '9.º grado'],
  'Bachillerato': ['1.º año', '2.º año', '3.º año'],
  'Universidad': ['1.º año', '2.º año', '3.º año', '4.º año', '5.º año']
};

// La lista tiene que dar para nueve clases de treinta: con los dieciséis
// nombres de antes, un aula entera se llamaba casi igual y la demostración se
// veía falsa justo en la pantalla que más se enseña.
const NOMBRES = [
  'Ana', 'Luis', 'Mía', 'Diego', 'Sofía', 'Mateo', 'Valeria', 'Carlos',
  'Camila', 'Andrés', 'Lucía', 'Javier', 'Daniela', 'Emilio', 'Renata', 'Óscar',
  'Fernanda', 'Rodrigo', 'Isabela', 'Gabriel', 'Paola', 'Héctor', 'Natalia', 'Iván',
  'Adriana', 'Sebastián', 'Marcela', 'Tomás', 'Gabriela', 'Alejandro', 'Ximena', 'Rubén',
  'Katherine', 'Josué', 'Melissa', 'Bryan', 'Wendy', 'Kevin', 'Vanessa', 'Ernesto',
  'Rocío', 'Guillermo', 'Karla', 'Nelson', 'Patricia', 'Mauricio', 'Beatriz', 'Salvador'
];
const APELLIDOS = [
  'Hernández', 'Ramírez', 'Molina', 'Castillo', 'Portillo', 'Guzmán',
  'Alvarado', 'Sandoval', 'Cruz', 'Bonilla', 'Reyes', 'Menjívar',
  'Escobar', 'Rivas', 'Zelaya', 'Argueta', 'Cañas', 'Interiano',
  'Martínez', 'Flores', 'Orellana', 'Quintanilla', 'Lemus', 'Chávez',
  'Umaña', 'Peña', 'Valladares', 'Serrano', 'Aguilar', 'Domínguez'
];

const TAREAS = [
  'Resolver la guía de ejercicios',
  'Leer el capítulo y hacer un resumen',
  'Entregar el informe de laboratorio',
  'Preparar la exposición en parejas',
  'Practicar los ejercicios del cuaderno'
];

function alAzar(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function enDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Devuelve una escuela con la que trabajar: la que se pida, la primera que
// haya, o una recién inventada si el sistema está en blanco.
function escuelaDeTrabajo(schoolId) {
  if (schoolId) {
    const pedida = db.getSchoolById(schoolId);
    if (pedida) return pedida;
  }
  const existente = db.getSchools()[0];
  if (existente) return existente;

  return db.createSchool({
    name: 'Centro Escolar de Demostración',
    directorId: null,
    directorName: 'Dirección de demostración'
  });
}

// Un profesor de esa escuela. Si no hay ninguno, se crea uno para la ocasión.
function profesorDeTrabajo(school) {
  const suyo = db.getSchoolMembers(school.id).find(u => u.role === 'teacher');
  if (suyo) return suyo;
  return nuevoProfesor(school);
}

let secuencia = 0;

// Los correos tienen que ser únicos y Date.now() se repite dentro del mismo
// milisegundo: con nueve clases seguidas, dos profesores chocaban.
function idUnico() {
  secuencia += 1;
  return `${Date.now().toString(36)}${secuencia}`;
}

function nuevoProfesor(school) {
  return db.createUser({
    fullName: `${alAzar(NOMBRES)} ${alAzar(APELLIDOS)}`,
    email: `profe.demo.${idUnico()}@roborobin.demo`,
    password: 'Demo123!',
    role: 'teacher',
    schoolId: school.id
  });
}

// Fabrica clases con su profesor, su gente dentro y un par de asignaciones,
// que es lo que hace falta para que las pantallas se vean como se ven en uso.
//
// Los topes son altos a propósito (hasta 15 clases de 40) porque una escuela
// de verdad no tiene cinco estudiantes por aula: con listas cortas, las
// pantallas de dirección y de profesorado se ven vacías justo cuando hay que
// enseñarlas. El botón de "escuela completa" de la consola pide nueve clases
// con entre 25 y 30 cada una, que es una escuela creíble.
//
//   students: un número        exactamente esa cantidad en cada clase
//   students: { min, max }     una cantidad distinta por clase, dentro del rango
router.post('/demo', (req, res) => {
  const body = req.body || {};
  const cuantas = Math.min(15, Math.max(1, Number(body.classes) || 3));
  const rango = rangoDeAlumnos(body.students);

  // Todo lo de abajo son cientos de altas seguidas. Agrupadas en un lote se
  // escribe el archivo una sola vez al final, en lugar de una vez por cada
  // estudiante — que es lo que hacía que el botón tardara casi medio minuto.
  return db.enLote(() => generarDemo(res, body, cuantas, rango));
});

function generarDemo(res, body, cuantas, rango) {
  const school = escuelaDeTrabajo(body.schoolId);
  // Con una sola clase se reaprovecha el profesor que ya haya; en una tanda
  // grande cada clase estrena el suyo, porque nueve materias las dan nueve
  // personas distintas y si no el panel de profesorado queda con una sola fila.
  const unSoloProfe = cuantas === 1 || body.sharedTeacher === true;
  const principal = profesorDeTrabajo(school);

  // La misma contraseña de mentira para todas las cuentas de la tanda: se
  // calcula su hash una vez en lugar de doscientas.
  const claveDemo = db.hashPassword('Demo123!');

  const creadas = [];
  let totalAlumnos = 0;

  for (let i = 0; i < cuantas; i++) {
    // Las materias no se repiten mientras queden sin usar: nueve clases de
    // "Matemáticas" no enseñan nada.
    const materia = MATERIAS[i % MATERIAS.length];
    const nivel = alAzar(NIVELES);
    const grado = alAzar(GRADOS_POR_NIVEL[nivel]);
    const teacher = unSoloProfe ? principal : nuevoProfesor(school);
    const porClase = rand(rango.min, rango.max);

    const classItem = db.createClass({
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      schoolId: school.id,
      name: `${materia.name} ${grado} «${alAzar(SECCIONES)}»`,
      description: `Clase de demostración generada automáticamente para ${materia.subject}.`,
      visibility: Math.random() < 0.75 ? 'public' : 'private',
      level: nivel
    });

    // Gente dentro. Sin estudiantes, una clase no enseña nada de lo que la
    // aplicación sabe hacer.
    for (let j = 0; j < porClase; j++) {
      const alumno = db.createUser({
        fullName: `${alAzar(NOMBRES)} ${alAzar(APELLIDOS)}`,
        email: null,
        passwordHash: claveDemo,
        role: 'student',
        level: nivel,
        grade: grado,
        schoolId: school.id
      });
      db.addStudentToClass(classItem.id, alumno.id);
    }
    totalAlumnos += porClase;

    // Un par de asignaciones, una ya vencida y otra por venir: así se ven los
    // dos estados en la pantalla del estudiantado.
    db.createActivity({
      classId: classItem.id,
      title: alAzar(TAREAS),
      description: 'Asignación de demostración.',
      dueDate: enDias(-2)
    });
    db.createActivity({
      classId: classItem.id,
      title: alAzar(TAREAS),
      description: 'Asignación de demostración.',
      dueDate: enDias(5)
    });

    creadas.push({
      id: classItem.id,
      name: classItem.name,
      level: classItem.level,
      joinCode: classItem.joinCode,
      teacherName: teacher.fullName,
      students: porClase
    });
  }

  res.json({
    school: { id: school.id, name: school.name },
    teacher: { id: principal.id, fullName: principal.fullName },
    sharedTeacher: unSoloProfe,
    students: totalAlumnos,
    classes: creadas
  });
}

// Cuántos estudiantes por clase. Admite un número fijo o un rango { min, max }
// para que cada aula tenga una cantidad distinta, como pasa de verdad.
function rangoDeAlumnos(pedido) {
  const tope = n => Math.min(40, Math.max(0, Math.round(n)));

  if (pedido && typeof pedido === 'object') {
    const min = tope(Number(pedido.min) || 0);
    const max = tope(Number(pedido.max) || min);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  const n = Number(pedido);
  if (Number.isFinite(n)) {
    const fijo = tope(n);
    return { min: fijo, max: fijo };
  }
  return { min: 5, max: 5 };
}

function rand(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = router;
