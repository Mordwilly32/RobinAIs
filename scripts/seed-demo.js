// scripts/seed-demo.js
// ---------------------------------------------------------------------------
// Deja data/db.json en estado de exposición: borra todo lo que haya (cuentas
// reales, correos, chats, avisos) y siembra un elenco 100 % inventado para que
// los cuatro paneles se vean con vida el día de la presentación.
//
//   node scripts/seed-demo.js
//
// Todos los correos son @demo.local (un dominio que no existe) y la contraseña
// de todas las cuentas de demostración es Demo123!. El director sigue siendo el
// que documenta el README: admin@roborobin.local / Admin123!.
//
// Correrlo otra vez vuelve a empezar de cero: es la forma de limpiar lo que el
// público haya escrito durante la exposición.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const DEMO_PASSWORD = 'Demo123!';

// Borrar el archivo antes de cargar db.js hace que se cree uno limpio, con el
// director por defecto ya sembrado.
if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

const db = require('../src/db');

const admin = db.getUserByEmail('admin@roborobin.local');
const school = db.createSchool({
  name: 'Escuela Demo roboRobin',
  directorId: admin.id,
  directorName: admin.fullName
});
db.updateUser(admin.id, { schoolId: school.id });

const persona = (fullName, email, role, extra = {}) =>
  db.createUser({ fullName, email, password: DEMO_PASSWORD, role, schoolId: school.id, ...extra });

const profesora = persona('Marbella Ríos', 'profesora@demo.local', 'teacher', {
  level: 'Bachillerato', grade: '1° Bachillerato'
});
const profesor = persona('Tomás Alvarenga', 'profesor@demo.local', 'teacher', {
  level: 'Secundaria', grade: '9° Grado'
});

const estudiantes = [
  persona('Ana Sofía Cruz', 'estudiante@demo.local', 'student', { level: 'Bachillerato', grade: '1° Bachillerato' }),
  persona('Diego Menjívar', 'diego@demo.local', 'student', { level: 'Bachillerato', grade: '1° Bachillerato' }),
  persona('Camila Portillo', 'camila@demo.local', 'student', { level: 'Secundaria', grade: '9° Grado' }),
  persona('Iván Quintanilla', 'ivan@demo.local', 'student', { level: 'Secundaria', grade: '8° Grado' })
];

// La cuenta personal no pertenece a ninguna escuela: es el otro camino de la app.
const personal = db.createUser({
  fullName: 'Renata Solís',
  email: 'personal@demo.local',
  password: DEMO_PASSWORD,
  role: 'personal'
});

// ---- Clases y actividades --------------------------------------------------

const biologia = db.createClass({
  teacherId: profesora.id, teacherName: profesora.fullName, schoolId: school.id,
  name: 'Biología I', description: 'La célula, la fotosíntesis y los ecosistemas.',
  visibility: 'public', level: 'Bachillerato'
});
const mate = db.createClass({
  teacherId: profesor.id, teacherName: profesor.fullName, schoolId: school.id,
  name: 'Matemática 9°', description: 'Álgebra, ecuaciones y geometría del plano.',
  visibility: 'private', level: 'Secundaria'
});

db.addStudentToClass(biologia.id, estudiantes[0].id);
db.addStudentToClass(biologia.id, estudiantes[1].id);
db.addStudentToClass(mate.id, estudiantes[2].id);

const enDias = n => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.createActivity({ classId: biologia.id, title: 'Maqueta de la célula vegetal', description: 'En parejas, con materiales reciclados.', dueDate: enDias(3) });
db.createActivity({ classId: biologia.id, title: 'Cuestionario de fotosíntesis', description: 'Diez preguntas de la guía 4.', dueDate: enDias(7) });
db.createActivity({ classId: mate.id, title: 'Ejercicios de ecuaciones lineales', description: 'Páginas 44 y 45 del libro.', dueDate: enDias(1) });

// ---- Avisos ----------------------------------------------------------------

db.createAnnouncement({
  authorId: admin.id, authorName: admin.fullName, schoolId: school.id,
  title: 'Feria de ciencias el próximo viernes',
  content: 'Cada grupo presenta su proyecto en el gimnasio a partir de las 8:00 a. m. Traigan sus materiales un día antes.',
  level: ''
});
db.createAnnouncement({
  authorId: profesora.id, authorName: profesora.fullName, schoolId: school.id,
  title: 'Recordatorio: laboratorio de Biología',
  content: 'Para la práctica del jueves necesitan gabacha y cuaderno de campo.',
  level: 'Bachillerato'
});

// ---- Pendientes y notificaciones -------------------------------------------

db.createTask({ userId: personal.id, title: 'Preparar la exposición de roboRobin', due: enDias(1), priority: 'alta' });
db.createTask({ userId: personal.id, title: 'Comprar cartulina y marcadores', due: enDias(0) });
db.createTask({ userId: personal.id, title: 'Practicar la presentación en voz alta', due: enDias(2) });

db.createTask({ userId: estudiantes[0].id, title: 'Terminar la maqueta de la célula', due: enDias(3), priority: 'alta' });
db.createTask({ userId: estudiantes[0].id, title: 'Estudiar para el examen de Lenguaje', due: enDias(4) });

db.addNotification(estudiantes[0].id, {
  type: 'class-invite',
  classId: biologia.id,
  title: 'Invitación a una clase',
  message: `${profesora.fullName} te invitó a unirte a ${biologia.name}.`
});

// ---- Resumen ---------------------------------------------------------------

console.log('\n  roboRobin — base de datos de exposición lista\n');
console.log('  Escuela:', school.name);
console.log('  Código de estudiantes:', school.studentCode);
console.log('  Código de profesores: ', school.teacherCode);
console.log('\n  Cuentas (contraseña de todas las de demo: ' + DEMO_PASSWORD + ')');
console.log('  ─────────────────────────────────────────────────────');
console.log('  Director    admin@roborobin.local   Admin123!');
console.log('  Profesora   profesora@demo.local    ' + DEMO_PASSWORD);
console.log('  Profesor    profesor@demo.local     ' + DEMO_PASSWORD);
console.log('  Estudiante  estudiante@demo.local   ' + DEMO_PASSWORD);
console.log('  Personal    personal@demo.local     ' + DEMO_PASSWORD);
console.log('\n  Vuelve a correr este script para dejarlo todo limpio de nuevo.\n');
