// scripts/seed-demo.mjs
// ---------------------------------------------------------------------------
// Deja el proyecto de Supabase en estado de exposición: borra las cuentas que
// haya y siembra un elenco 100 % inventado para que los cuatro paneles se vean
// con vida el día de la presentación.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
//
// Usa la clave de servicio, así que solo se corre desde tu computadora y nunca
// desde el navegador. Todos los correos son @demo.local (un dominio que no
// existe) y la contraseña de todas las cuentas de demostración es Demo123!.
//
// Correrlo otra vez vuelve a empezar de cero: es la forma de limpiar lo que el
// público haya escrito durante la exposición.
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

const URL_PROYECTO = process.env.SUPABASE_URL;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_PROYECTO || !CLAVE) {
  console.error(
    '\n  Faltan datos. Copia .env.example a .env, pega ahí la URL y la clave\n' +
    '  service_role de tu proyecto (Supabase → Project Settings → API), y corre:\n\n' +
    '    npm run seed\n'
  );
  process.exit(1);
}

const sb = createClient(URL_PROYECTO, CLAVE, { auth: { persistSession: false } });
const CONTRASENA = 'Demo123!';

const enDias = n => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function reventar(mensaje, error) {
  if (!error) return;
  console.error(`\n  ${mensaje}:`, error.message || error, '\n');
  process.exit(1);
}

// ---- Borrón y cuenta nueva -------------------------------------------------
// Borrar las cuentas arrastra en cascada perfiles, tareas, clases y avisos.

console.log('\n  Limpiando lo que hubiera…');
{
  let pagina = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page: pagina, perPage: 200 });
    reventar('No se pudieron listar las cuentas', error);
    if (!data.users.length) break;
    for (const cuenta of data.users) {
      const { error: errorBorrado } = await sb.auth.admin.deleteUser(cuenta.id);
      reventar(`No se pudo borrar ${cuenta.email}`, errorBorrado);
    }
    if (data.users.length < 200) break;
    pagina += 1;
  }
  // Las escuelas no cuelgan de ninguna cuenta, así que van aparte.
  await sb.from('schools').delete().gt('id', 0);
}

// ---- Cuentas ---------------------------------------------------------------

// El alta pasa por el mismo disparador que usa la aplicación: el rol y la
// escuela salen del modo y del código, no de lo que diga este script.
async function crearCuenta({ fullName, email, meta = {} }) {
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: CONTRASENA,
    email_confirm: true,
    user_metadata: { full_name: fullName, ...meta }
  });
  reventar(`No se pudo crear ${email}`, error);
  return data.user.id;
}

console.log('  Inscribiendo la escuela…');
const directorId = await crearCuenta({
  fullName: 'Robin Admin',
  email: 'admin@roborobin.local',
  meta: { mode: 'school', school_name: 'Escuela Demo roboRobin' }
});

const { data: perfilDirector } = await sb
  .from('profiles').select('school_id').eq('id', directorId).single();
const escuelaId = perfilDirector.school_id;

const { data: codigos } = await sb
  .from('school_codes').select('student_code, teacher_code').eq('school_id', escuelaId).single();

console.log('  Creando profesores y estudiantes…');
const unirse = (codigo, extra = {}) => ({ mode: 'join', join_code: codigo, ...extra });

const profesoraId = await crearCuenta({
  fullName: 'Marbella Ríos', email: 'profesora@demo.local',
  meta: unirse(codigos.teacher_code, { level: 'Bachillerato', grade: '1° Bachillerato' })
});
const profesorId = await crearCuenta({
  fullName: 'Tomás Alvarenga', email: 'profesor@demo.local',
  meta: unirse(codigos.teacher_code, { level: 'Secundaria', grade: '9° Grado' })
});

const estudiantes = [];
for (const alumno of [
  { fullName: 'Ana Sofía Cruz',    email: 'estudiante@demo.local', level: 'Bachillerato', grade: '1° Bachillerato' },
  { fullName: 'Diego Menjívar',    email: 'diego@demo.local',      level: 'Bachillerato', grade: '1° Bachillerato' },
  { fullName: 'Camila Portillo',   email: 'camila@demo.local',     level: 'Secundaria',   grade: '9° Grado' },
  { fullName: 'Iván Quintanilla',  email: 'ivan@demo.local',       level: 'Secundaria',   grade: '8° Grado' }
]) {
  estudiantes.push(await crearCuenta({
    fullName: alumno.fullName, email: alumno.email,
    meta: unirse(codigos.student_code, { level: alumno.level, grade: alumno.grade })
  }));
}

// La cuenta personal no pertenece a ninguna escuela: es el otro camino de la app.
const personalId = await crearCuenta({
  fullName: 'Renata Solís', email: 'personal@demo.local', meta: { mode: 'personal' }
});

// ---- Clases y actividades --------------------------------------------------

console.log('  Abriendo clases…');
const { data: biologia, error: errorBio } = await sb.from('classes').insert({
  teacher_id: profesoraId, teacher_name: 'Marbella Ríos', school_id: escuelaId,
  name: 'Biología I', description: 'La célula, la fotosíntesis y los ecosistemas.',
  visibility: 'public', level: 'Bachillerato'
}).select('id').single();
reventar('No se pudo crear la clase de Biología', errorBio);

const { data: mate, error: errorMate } = await sb.from('classes').insert({
  teacher_id: profesorId, teacher_name: 'Tomás Alvarenga', school_id: escuelaId,
  name: 'Matemática 9°', description: 'Álgebra, ecuaciones y geometría del plano.',
  visibility: 'private', level: 'Secundaria'
}).select('id').single();
reventar('No se pudo crear la clase de Matemática', errorMate);

await sb.from('class_members').insert([
  { class_id: biologia.id, student_id: estudiantes[0] },
  { class_id: biologia.id, student_id: estudiantes[1] },
  { class_id: mate.id,     student_id: estudiantes[2] }
]);

await sb.from('activities').insert([
  { class_id: biologia.id, title: 'Maqueta de la célula vegetal', description: 'En parejas, con materiales reciclados.', due_date: enDias(3) },
  { class_id: biologia.id, title: 'Cuestionario de fotosíntesis', description: 'Diez preguntas de la guía 4.', due_date: enDias(7) },
  { class_id: mate.id,     title: 'Ejercicios de ecuaciones lineales', description: 'Páginas 44 y 45 del libro.', due_date: enDias(1) }
]);

// ---- Avisos ----------------------------------------------------------------

await sb.from('announcements').insert([
  {
    author_id: directorId, author_name: 'Robin Admin', school_id: escuelaId,
    title: 'Feria de ciencias el próximo viernes',
    content: 'Cada grupo presenta su proyecto en el gimnasio a partir de las 8:00 a. m. Traigan sus materiales un día antes.',
    level: 'Todos los niveles'
  },
  {
    author_id: profesoraId, author_name: 'Marbella Ríos', school_id: escuelaId,
    title: 'Recordatorio: laboratorio de Biología',
    content: 'Para la práctica del jueves necesitan gabacha y cuaderno de campo.',
    level: 'Bachillerato'
  }
]);

// ---- Pendientes y notificaciones -------------------------------------------

await sb.from('tasks').insert([
  { user_id: personalId, title: 'Preparar la exposición de roboRobin', due: enDias(1), priority: 'alta' },
  { user_id: personalId, title: 'Comprar cartulina y marcadores', due: enDias(0) },
  { user_id: personalId, title: 'Practicar la presentación en voz alta', due: enDias(2) },
  { user_id: estudiantes[0], title: 'Terminar la maqueta de la célula', due: enDias(3), priority: 'alta' },
  { user_id: estudiantes[0], title: 'Estudiar para el examen de Lenguaje', due: enDias(4) }
]);

await sb.from('notifications').insert({
  user_id: estudiantes[0], type: 'class-invite', class_id: biologia.id,
  title: 'Invitación a una clase',
  message: 'Marbella Ríos te invitó a unirte a Biología I.'
});

// ---- Resumen ---------------------------------------------------------------

const { data: idAna } = await sb
  .from('profiles').select('student_code').eq('id', estudiantes[0]).single();

console.log('\n  roboRobin — proyecto de exposición listo\n');
console.log('  Escuela: Escuela Demo roboRobin');
console.log('  Código de estudiantes:', codigos.student_code);
console.log('  Código de profesores: ', codigos.teacher_code);
console.log(`\n  Cuentas (contraseña de todas: ${CONTRASENA})`);
console.log('  ─────────────────────────────────────────────────────');
console.log('  Director    admin@roborobin.local');
console.log('  Profesora   profesora@demo.local');
console.log('  Profesor    profesor@demo.local');
console.log(`  Estudiante  estudiante@demo.local  (o su ID: ${idAna?.student_code ?? 'STU-…'})`);
console.log('  Personal    personal@demo.local');
console.log('\n  Vuelve a correr este script para dejarlo todo limpio de nuevo.\n');
