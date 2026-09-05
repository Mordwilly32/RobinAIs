// public/js/api.js
// La única puerta de salida del navegador. Antes hablaba con el servidor de
// Express en /api/...; ahora habla con Supabase, pero conserva exactamente la
// misma forma (rrApi('/api/tareas', { method, body }) y las mismas respuestas)
// para que las pantallas no tengan que enterarse del cambio.
//
// Aquí no hay reglas de permisos: las aplica Postgres con Row Level Security.
// Si algo no se puede hacer, la base de datos lo rechaza aunque este archivo
// se modifique desde las herramientas del navegador.

const rrSupabase = window.supabase.createClient(
  window.RR_SUPABASE.url,
  window.RR_SUPABASE.anonKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
);

// Correo interno de un estudiante que se registró sin correo propio. No se le
// muestra nunca: entra escribiendo su ID (STU-00001) y aquí se traduce.
const RR_DOMINIO_INTERNO = '@estudiantes.roborobin.local';
const rrCorreoInterno = code => `${String(code).toLowerCase()}${RR_DOMINIO_INTERNO}`;

// ---- Traducción de nombres -------------------------------------------------
// La base de datos usa snake_case (la convención de Postgres) y las pantallas
// camelCase. La conversión es automática en ambos sentidos para no tener que
// escribir el mapeo tabla por tabla.

function rrACamel(valor) {
  if (Array.isArray(valor)) return valor.map(rrACamel);
  if (!valor || typeof valor !== 'object' || valor instanceof Date) return valor;
  const salida = {};
  for (const [clave, v] of Object.entries(valor)) {
    salida[clave.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = rrACamel(v);
  }
  return salida;
}

function rrASnake(valor) {
  if (Array.isArray(valor)) return valor.map(rrASnake);
  if (!valor || typeof valor !== 'object' || valor instanceof Date) return valor;
  const salida = {};
  for (const [clave, v] of Object.entries(valor)) {
    salida[clave.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)] = rrASnake(v);
  }
  return salida;
}

// ---- Errores ---------------------------------------------------------------
// Las excepciones que lanzan las funciones de Postgres ya vienen redactadas en
// español; el resto se traduce aquí para que nadie vea jerga técnica.

const RR_MENSAJES = [
  [/invalid login credentials/i,        'El usuario o la contraseña no son correctos.'],
  [/email not confirmed/i,              'Esa cuenta todavía no está confirmada.'],
  [/user already registered|already been registered|already exists/i, 'Ese correo ya está registrado.'],
  [/password should be at least/i,      'La contraseña debe tener al menos 6 caracteres.'],
  [/row-level security|permission denied|not authorized/i, 'No tienes permiso para hacer eso.'],
  [/duplicate key/i,                    'Ese dato ya está registrado.'],
  [/jwt|session|refresh token/i,        'Primero necesitas iniciar sesión.'],
  [/failed to fetch|networkerror/i,     'No se pudo conectar. Revisa tu conexión.']
];

function rrError(error, respaldo = 'Algo salió mal.') {
  const texto = (error && (error.message || error.error_description)) || '';
  for (const [patron, mensaje] of RR_MENSAJES) {
    if (patron.test(texto)) return new Error(mensaje);
  }
  // Los mensajes de nuestras propias funciones ya están en español y son útiles.
  return new Error(texto && !/^[A-Z_]+$/.test(texto) ? texto : respaldo);
}

function rrOk({ data, error }, respaldo) {
  if (error) throw rrError(error, respaldo);
  return data;
}

// ---- Sesión ----------------------------------------------------------------

async function rrUsuarioActual() {
  const { data } = await rrSupabase.auth.getUser();
  if (!data || !data.user) throw new Error('Primero necesitas iniciar sesión.');
  return data.user;
}

// El perfil con el nombre de la escuela ya resuelto, que es lo que esperan las
// pantallas desde la primera versión.
async function rrPerfil(id) {
  const fila = rrOk(
    await rrSupabase.from('profiles').select('*, schools(name)').eq('id', id).single(),
    'No encontramos esa cuenta.'
  );
  const usuario = rrACamel(fila);
  usuario.schoolName = fila.schools ? fila.schools.name : null;
  delete usuario.schools;
  return usuario;
}

async function rrMiPerfil() {
  const usuario = await rrUsuarioActual();
  return rrPerfil(usuario.id);
}

// ---- Registro --------------------------------------------------------------

async function rrRegistrar(body) {
  const modo = body.mode;
  const fullName = String(body.fullName || '').trim();
  const password = String(body.password || '');
  const correo = body.email ? String(body.email).trim().toLowerCase() : '';

  if (!fullName) throw new Error('Escribe tu nombre completo.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  const meta = { mode: modo, full_name: fullName };
  let correoAuth = correo;

  if (modo === 'personal') {
    if (!correo) throw new Error('El correo es necesario para una cuenta personal.');

  } else if (modo === 'school') {
    const schoolName = String(body.schoolName || '').trim();
    if (!schoolName) throw new Error('Escribe el nombre de tu escuela.');
    if (!correo) throw new Error('El correo es necesario para la cuenta del director.');
    meta.school_name = schoolName;

  } else if (modo === 'join') {
    const codigo = String(body.code || '').trim().toUpperCase();
    const match = await rrResolverCodigo(codigo);
    meta.join_code = codigo;
    if (body.level) meta.level = body.level;
    if (body.grade) meta.grade = body.grade;
    if (match.role === 'student' && !body.level) throw new Error('Elige tu nivel escolar.');

    // Un estudiante sin correo entra con su ID, así que hay que reservarlo
    // antes de crear la cuenta: ese ID es también su correo interno.
    if (match.role === 'student' && !correo) {
      const codigoEstudiante = rrOk(
        await rrSupabase.rpc('next_student_code'),
        'No se pudo generar tu ID de estudiante.'
      );
      meta.student_code = codigoEstudiante;
      correoAuth = rrCorreoInterno(codigoEstudiante);
    } else if (!correo) {
      throw new Error('El correo es necesario para la cuenta de profesor.');
    }

  } else {
    throw new Error('Elige primero qué tipo de cuenta quieres crear.');
  }

  const { data, error } = await rrSupabase.auth.signUp({
    email: correoAuth,
    password,
    options: { data: meta }
  });
  if (error) throw rrError(error, 'No se pudo crear la cuenta.');
  if (!data.session) {
    throw new Error(
      'La cuenta se creó, pero falta confirmarla por correo. Desactiva "Confirm email" en Supabase para entrar directo.'
    );
  }

  const user = await rrPerfil(data.user.id);

  if (modo === 'school') {
    const escuela = rrOk(
      await rrSupabase.from('schools').select('*, school_codes(student_code, teacher_code)')
        .eq('id', user.schoolId).single(),
      'No se pudo leer la escuela recién creada.'
    );
    return { user, school: rrEscuela(escuela) };
  }
  if (modo === 'join') {
    return { user, school: { id: user.schoolId, name: user.schoolName } };
  }
  return { user };
}

async function rrResolverCodigo(codigo) {
  const filas = rrOk(
    await rrSupabase.rpc('resolve_join_code', { p_code: String(codigo || '').trim().toUpperCase() }),
    'No se pudo comprobar ese código.'
  );
  if (!filas || !filas.length) {
    throw new Error('Ese código no existe. Pídele el código correcto a tu director.');
  }
  return filas[0];
}

// Aplana la escuela y sus códigos en el objeto plano que espera el panel del
// director: { id, name, studentCode, teacherCode, ... }.
function rrEscuela(fila) {
  if (!fila) return null;
  const codigos = Array.isArray(fila.school_codes) ? fila.school_codes[0] : fila.school_codes;
  const escuela = rrACamel({ ...fila, school_codes: undefined });
  delete escuela.schoolCodes;
  escuela.studentCode = codigos ? codigos.student_code : null;
  escuela.teacherCode = codigos ? codigos.teacher_code : null;
  return escuela;
}

// ---- Llamadas a las Edge Functions ----------------------------------------

async function rrFuncion(nombre, body) {
  const { data, error } = await rrSupabase.functions.invoke(nombre, { body });
  if (error) {
    // El cuerpo de un error de función trae nuestro mensaje en español.
    let mensaje = '';
    try { mensaje = (await error.context.json()).error; } catch { /* sin cuerpo */ }
    throw new Error(mensaje || 'Algo salió mal en el servidor.');
  }
  return data;
}

// ---------------------------------------------------------------------------
// El enrutador. Cada entrada es [método, patrón, qué hacer].
// El orden importa: gana el primero que encaje.
// ---------------------------------------------------------------------------

const RR_RUTAS = [
  // ---- Sesión y cuentas ----------------------------------------------------
  ['GET', /^\/api\/me$/, async () => ({ user: await rrMiPerfil() })],

  ['POST', /^\/api\/register$/, (_, body) => rrRegistrar(body)],

  ['POST', /^\/api\/login$/, async (_, body) => {
    const escrito = String((body && body.email) || '').trim();
    const password = String((body && body.password) || '');

    // Se puede entrar con correo o con el ID de estudiante (STU-00001).
    let correo = escrito.toLowerCase();
    if (/^stu-/i.test(escrito)) {
      const encontrado = rrOk(
        await rrSupabase.rpc('resolve_login_id', { p_login_id: escrito }),
        'El usuario o la contraseña no son correctos.'
      );
      if (!encontrado) throw new Error('El usuario o la contraseña no son correctos.');
      correo = encontrado;
    }

    const { data, error } = await rrSupabase.auth.signInWithPassword({ email: correo, password });
    if (error) throw rrError(error, 'El usuario o la contraseña no son correctos.');

    const user = await rrPerfil(data.user.id);
    if (user.status !== 'active') {
      await rrSupabase.auth.signOut();
      throw new Error('El usuario o la contraseña no son correctos.');
    }
    return { user };
  }],

  ['POST', /^\/api\/logout$/, async () => {
    await rrSupabase.auth.signOut();
    return { ok: true };
  }],

  ['GET', /^\/api\/join-code\/(.+)$/, async ([codigo]) => {
    const match = await rrResolverCodigo(decodeURIComponent(codigo));
    return { school: { id: match.school_id, name: match.school_name }, role: match.role };
  }],

  ['PUT', /^\/api\/profile$/, async (_, body) => {
    const cuenta = await rrUsuarioActual();
    const fullName = String((body && body.fullName) || '').trim();
    if (!fullName) throw new Error('El nombre completo es obligatorio.');

    if (body.password) {
      if (body.password.length < 6) {
        throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
      }
      // Supabase no pide la contraseña anterior, pero cambiarla sin conocerla
      // convertiría una sesión olvidada en un secuestro de cuenta.
      const { error } = await rrSupabase.auth.signInWithPassword({
        email: cuenta.email,
        password: String(body.currentPassword || '')
      });
      if (error) throw new Error('La contraseña actual no es correcta.');
      rrOk(await rrSupabase.auth.updateUser({ password: body.password }), 'No se pudo cambiar la contraseña.');
    }

    const cambios = { full_name: fullName };
    if (body.profilePic !== undefined) cambios.profile_pic = body.profilePic;
    rrOk(
      await rrSupabase.from('profiles').update(cambios).eq('id', cuenta.id),
      'No se pudo guardar tu perfil.'
    );
    return { user: await rrPerfil(cuenta.id) };
  }],

  // ---- Listado de estudiantes (profesores) ---------------------------------
  ['GET', /^\/api\/roster/, async (_, __, params) => {
    let consulta = rrSupabase.from('profiles').select('*').eq('role', 'student');
    if (params.get('level')) consulta = consulta.eq('level', params.get('level'));
    const filas = rrOk(await consulta.order('full_name'), 'No se pudo leer la lista.');
    return { students: rrACamel(filas) };
  }],

  // ---- Notificaciones ------------------------------------------------------
  ['GET', /^\/api\/notifications$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('notifications').select('*').order('created_at', { ascending: false }),
      'No se pudieron leer las notificaciones.'
    );
    return { notifications: rrACamel(filas) };
  }],

  ['PUT', /^\/api\/notifications\/([^/]+)\/read$/, async ([id]) => {
    rrOk(
      await rrSupabase.from('notifications').update({ read: true }).eq('id', id),
      'No encontramos esa notificación.'
    );
    return { ok: true };
  }],

  // ---- Panel del director --------------------------------------------------
  ['GET', /^\/api\/admin\/stats$/, async () => {
    return rrOk(await rrSupabase.rpc('school_stats'), 'No se pudieron leer las estadísticas.');
  }],

  ['GET', /^\/api\/admin\/users/, async (_, __, params) => {
    let consulta = rrSupabase.from('profiles').select('*');
    if (params.get('role')) consulta = consulta.eq('role', params.get('role'));
    if (params.get('level')) consulta = consulta.eq('level', params.get('level'));
    if (params.get('status')) consulta = consulta.eq('status', params.get('status'));
    if (params.get('q')) {
      const q = params.get('q').replace(/[%,()]/g, ' ');
      consulta = consulta.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    const filas = rrOk(await consulta.order('created_at'), 'No se pudo leer la lista de cuentas.');
    return { users: rrACamel(filas) };
  }],

  ['POST', /^\/api\/admin\/users$/, async (_, body) => {
    const data = await rrFuncion('admin-usuarios', { action: 'create', ...body });
    return { user: rrACamel(data.user) };
  }],

  ['PUT', /^\/api\/admin\/users\/([^/]+)$/, async ([id], body) => {
    const data = await rrFuncion('admin-usuarios', { action: 'update', id, ...body });
    return { user: rrACamel(data.user) };
  }],

  ['DELETE', /^\/api\/admin\/users\/([^/]+)$/, async ([id]) =>
    rrFuncion('admin-usuarios', { action: 'delete', id })],

  // ---- La escuela del director ---------------------------------------------
  ['GET', /^\/api\/schools\/mine$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('schools').select('*, school_codes(student_code, teacher_code)').limit(1),
      'No se pudo leer tu escuela.'
    );
    if (!filas.length) return { school: null };
    const stats = rrOk(await rrSupabase.rpc('school_stats'), 'No se pudieron leer las estadísticas.');
    return { school: rrEscuela(filas[0]), stats };
  }],

  ['POST', /^\/api\/schools\/mine$/, async (_, body) => {
    const filas = rrOk(
      await rrSupabase.rpc('create_my_school', { p_name: String((body && body.name) || '').trim() }),
      'No se pudo inscribir la escuela.'
    );
    const escuela = rrACamel(filas[0]);
    const stats = rrOk(await rrSupabase.rpc('school_stats'), 'No se pudieron leer las estadísticas.');
    return { school: escuela, stats };
  }],

  ['PUT', /^\/api\/schools\/mine$/, async (_, body) => {
    const fila = rrOk(
      await rrSupabase.rpc('rename_my_school', { p_name: String((body && body.name) || '').trim() }),
      'No se pudo cambiar el nombre.'
    );
    return { school: rrACamel(fila) };
  }],

  ['POST', /^\/api\/schools\/mine\/regenerate$/, async (_, body) => {
    const fila = rrOk(
      await rrSupabase.rpc('regenerate_school_code', { p_which: (body && body.which) || '' }),
      'No se pudo regenerar el código.'
    );
    return { school: rrACamel(fila) };
  }],

  // ---- Organizador personal ------------------------------------------------
  ['GET', /^\/api\/tasks$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('tasks').select('*')
        .order('done').order('due', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      'No se pudieron leer tus tareas.'
    );
    return { tasks: rrACamel(filas) };
  }],

  ['POST', /^\/api\/tasks$/, async (_, body) => {
    const title = String((body && body.title) || '').trim();
    if (!title) throw new Error('Escribe de qué se trata la tarea.');
    const cuenta = await rrUsuarioActual();
    const fila = rrOk(
      await rrSupabase.from('tasks').insert({
        user_id: cuenta.id,
        title,
        notes: (body.notes || '').trim(),
        due: body.due || null,
        priority: ['baja', 'normal', 'alta'].includes(body.priority) ? body.priority : 'normal',
        category: body.category || 'General'
      }).select('*').single(),
      'No se pudo guardar la tarea.'
    );
    return { task: rrACamel(fila) };
  }],

  ['PUT', /^\/api\/tasks\/([^/]+)$/, async ([id], body) => {
    const cambios = rrASnake(body || {});
    // Tachar o destachar una tarea también mueve su fecha de término.
    if (cambios.done !== undefined) {
      cambios.done = Boolean(cambios.done);
      cambios.completed_at = cambios.done ? new Date().toISOString() : null;
    }
    const fila = rrOk(
      await rrSupabase.from('tasks').update(cambios).eq('id', id).select('*').maybeSingle(),
      'No encontramos esa tarea.'
    );
    if (!fila) throw new Error('No encontramos esa tarea.');
    return { task: rrACamel(fila) };
  }],

  ['DELETE', /^\/api\/tasks\/([^/]+)$/, async ([id]) => {
    const filas = rrOk(
      await rrSupabase.from('tasks').delete().eq('id', id).select('id'),
      'No encontramos esa tarea.'
    );
    if (!filas.length) throw new Error('No encontramos esa tarea.');
    return { ok: true };
  }],

  // ---- Avisos --------------------------------------------------------------
  ['GET', /^\/api\/announcements$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('announcements').select('*').order('created_at', { ascending: false }),
      'No se pudieron leer los avisos.'
    );
    return { announcements: rrACamel(filas) };
  }],

  ['POST', /^\/api\/announcements$/, async (_, body) => {
    const { title, content, level } = body || {};
    if (!title || !content || !level) {
      throw new Error('Necesitas un título, un mensaje y un nivel.');
    }
    const yo = await rrMiPerfil();
    const fila = rrOk(
      await rrSupabase.from('announcements').insert({
        author_id: yo.id,
        author_name: yo.fullName,
        school_id: yo.schoolId,
        title, content, level
      }).select('*').single(),
      'No se pudo publicar el aviso.'
    );
    return { announcement: rrACamel(fila) };
  }],

  ['DELETE', /^\/api\/announcements\/([^/]+)$/, async ([id]) => {
    const filas = rrOk(
      await rrSupabase.from('announcements').delete().eq('id', id).select('id'),
      'No puedes borrar ese aviso.'
    );
    if (!filas.length) throw new Error('No puedes borrar ese aviso.');
    return { ok: true };
  }],

  // ---- Clases --------------------------------------------------------------
  ['GET', /^\/api\/classes$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('classes').select('*, class_members(student_id)')
        .order('created_at', { ascending: false }),
      'No se pudieron leer las clases.'
    );
    const classes = filas.map(fila => {
      const item = rrACamel({ ...fila, class_members: undefined });
      delete item.classMembers;
      item.studentIds = (fila.class_members || []).map(m => m.student_id);
      return item;
    });
    return { classes };
  }],

  ['POST', /^\/api\/classes$/, async (_, body) => {
    const name = String((body && body.name) || '').trim();
    if (!name) throw new Error('La clase necesita un nombre.');
    const yo = await rrMiPerfil();
    const fila = rrOk(
      await rrSupabase.from('classes').insert({
        teacher_id: yo.id,
        teacher_name: yo.fullName,
        school_id: yo.schoolId,
        name,
        description: body.description || '',
        visibility: body.visibility === 'private' ? 'private' : 'public',
        level: body.level || null
      }).select('*').single(),
      'No se pudo crear la clase.'
    );
    const classItem = rrACamel(fila);
    classItem.studentIds = [];
    return { classItem };
  }],

  ['POST', /^\/api\/classes\/([^/]+)\/invite$/, async ([id], body) => {
    rrOk(
      await rrSupabase.rpc('invite_student_to_class', {
        p_class_id: Number(id),
        p_student_code: (body && body.studentCode) || ''
      }),
      'No se pudo enviar la invitación.'
    );
    return { ok: true };
  }],

  ['POST', /^\/api\/classes\/([^/]+)\/join$/, async ([id], body) => {
    rrOk(
      await rrSupabase.rpc('join_class', {
        p_class_id: Number(id),
        p_code: (body && body.code) || null
      }),
      'No se pudo unir a la clase.'
    );
    return { ok: true };
  }],

  ['GET', /^\/api\/classes\/([^/]+)\/members$/, async ([id]) => {
    const filas = rrOk(
      await rrSupabase.rpc('class_members_list', { p_class_id: Number(id) }),
      'No tienes acceso a esa clase.'
    );
    return { members: rrACamel(filas) };
  }],

  // ---- Actividades ---------------------------------------------------------
  ['GET', /^\/api\/activities\/class\/([^/]+)$/, async ([classId]) => {
    const filas = rrOk(
      await rrSupabase.from('activities').select('*').eq('class_id', classId)
        .order('created_at', { ascending: false }),
      'No tienes acceso a esa clase.'
    );
    return { activities: rrACamel(filas) };
  }],

  ['POST', /^\/api\/activities\/class\/([^/]+)$/, async ([classId], body) => {
    const title = String((body && body.title) || '').trim();
    if (!title) throw new Error('La actividad necesita un título.');
    const fila = rrOk(
      await rrSupabase.from('activities').insert({
        class_id: Number(classId),
        title,
        description: body.description || '',
        due_date: body.dueDate || null
      }).select('*').single(),
      'No tienes acceso a esa clase.'
    );
    return { activity: rrACamel(fila) };
  }],

  // ---- Robin ---------------------------------------------------------------
  ['POST', /^\/api\/ai\/chat$/, async (_, body) => {
    const mensaje = String((body && body.message) || '').trim();
    if (!mensaje) throw new Error('Escribe una pregunta primero.');
    return rrFuncion('robin', { message: mensaje });
  }],

  ['GET', /^\/api\/ai\/history$/, async () => {
    const filas = rrOk(
      await rrSupabase.from('ai_logs').select('*').order('id').limit(30),
      'No se pudo leer el historial.'
    );
    return { history: rrACamel(filas) };
  }],

  ['DELETE', /^\/api\/ai\/history$/, async () => {
    const cuenta = await rrUsuarioActual();
    rrOk(
      await rrSupabase.from('ai_logs').delete().eq('user_id', cuenta.id),
      'No se pudo borrar el historial.'
    );
    return { ok: true };
  }]
];

async function rrApi(path, { method = 'GET', body } = {}) {
  const [ruta, cadena] = String(path).split('?');
  const params = new URLSearchParams(cadena || '');

  for (const [verbo, patron, manejar] of RR_RUTAS) {
    if (verbo !== method) continue;
    const encaje = ruta.match(patron);
    if (encaje) return manejar(encaje.slice(1), body || {}, params);
  }
  throw new Error(`No encontrado (${method} ${ruta}).`);
}

// ---- Avisos flotantes ------------------------------------------------------

function rrToast(message, type = 'info') {
  let stack = document.querySelector('.rr-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'rr-toast-stack';
    document.body.appendChild(stack);
  }

  const el = document.createElement('div');
  el.className = `rr-toast ${type}`;
  // Aquí va Robin a color y no un boceto: a 30 px el trazo a lápiz se pierde.
  el.innerHTML = '<img class="rr-mini-robin" src="/images/robin.png" alt="" /><span></span>';
  el.querySelector('span').textContent = message;
  stack.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity .3s ease, transform .3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

// ---- Sesión ----------------------------------------------------------------

function rrDashboardFor(role) {
  if (role === 'admin') return '/dashboard-admin.html';
  if (role === 'teacher') return '/dashboard-teacher.html';
  if (role === 'student') return '/dashboard-student.html';
  return '/dashboard-personal.html';
}

const RR_ROLE_LABEL = {
  admin: 'Director',
  teacher: 'Profesor',
  student: 'Estudiante',
  personal: 'Cuenta personal'
};

// Manda a la página de error explicando qué pasó, en vez de rebotar en
// silencio a otra pantalla: quien se equivocó de dirección tiene que verlo.
function rrShowError(motivo) {
  const ruta = encodeURIComponent(window.location.pathname);
  window.location.replace(`/404.html?motivo=${motivo}&ruta=${ruta}`);
}

// Se usa al inicio de cada panel protegido.
async function rrRequireSession(allowedRoles) {
  try {
    const { user } = await rrApi('/api/me');
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      rrShowError('permiso'); // este panel es de otro rol
      return null;
    }
    return user;
  } catch {
    rrShowError('sesion'); // sin sesión abierta o ya venció
    return null;
  }
}

// Si ya hay sesión abierta, no tiene sentido quedarse en entrar/registrarse.
async function rrRedirectIfSignedIn() {
  try {
    const { user } = await rrApi('/api/me');
    window.location.href = rrDashboardFor(user.role);
  } catch { /* sin sesión: seguimos aquí */ }
}

// ---- Texto y fechas --------------------------------------------------------

function rrEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function rrFormatDate(iso) {
  try {
    return new Date(iso).toLocaleString('es', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function rrTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "hoy", "mañana", "ayer" o la fecha corta: más fácil de leer de un vistazo.
function rrDayLabel(isoDate) {
  if (!isoDate) return '';
  const today = rrTodayISO();
  if (isoDate === today) return 'hoy';

  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date - new Date(today + 'T00:00:00')) / 86400000);
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  if (diff > 1 && diff < 7) return date.toLocaleDateString('es', { weekday: 'long' });
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function rrGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// ---- Aparición al hacer scroll --------------------------------------------

function rrRevealInit() {
  const items = document.querySelectorAll('.rr-reveal');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('in'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  items.forEach(el => observer.observe(el));
}

document.addEventListener('DOMContentLoaded', rrRevealInit);

// Copia al portapapeles y confirma en el propio botón.
async function rrCopy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = '¡Copiado!';
      button.disabled = true;
      setTimeout(() => { button.textContent = original; button.disabled = false; }, 1400);
    } else {
      rrToast('Copiado al portapapeles.', 'info');
    }
  } catch {
    rrToast(`Código: ${text}`, 'info');
  }
}
