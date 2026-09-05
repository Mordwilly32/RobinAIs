// supabase/functions/admin-usuarios/index.ts
// Lo que antes era POST/PUT/DELETE /api/admin/users. Crear o borrar una cuenta
// toca Supabase Auth, y eso exige la llave de servicio, que jamás puede estar
// en el navegador: por eso vive aquí como secreto de la función.
//
// Antes de tocar nada se comprueba, con el token de quien llama, que sea
// director activo y que la cuenta afectada sea de SU escuela. Un director no
// alcanza cuentas de otra escuela ni puede borrarse a sí mismo.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/cors.ts';

const URL_PROYECTO = Deno.env.get('SUPABASE_URL')!;
const CLAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ROLES = ['personal', 'student', 'teacher', 'admin'];
const NIVELES = ['Parvularia', 'Primaria', 'Secundaria', 'Bachillerato'];

type Cuerpo = {
  action?: 'create' | 'update' | 'delete';
  id?: string;
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  status?: string;
  level?: string | null;
  grade?: string | null;
};

// El correo interno de un estudiante sin correo propio. Nunca se le muestra:
// para entrar escribe su ID (STU-00001), que la interfaz traduce a esto.
const correoInterno = (idEstudiante: string) =>
  `${idEstudiante.toLowerCase()}@estudiantes.roborobin.local`;

Deno.serve(async (req: Request) => {
  const vuelo = preflight(req);
  if (vuelo) return vuelo;

  const autorizacion = req.headers.get('Authorization') ?? '';
  if (!autorizacion) return json({ error: 'Primero necesitas iniciar sesión.' }, 401);

  const comoUsuario = createClient(URL_PROYECTO, CLAVE_ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false },
  });

  const { data: sesion } = await comoUsuario.auth.getUser();
  const usuario = sesion?.user;
  if (!usuario) return json({ error: 'Primero necesitas iniciar sesión.' }, 401);

  const { data: director } = await comoUsuario
    .from('profiles')
    .select('id, role, status, school_id')
    .eq('id', usuario.id)
    .single();

  if (!director || director.role !== 'admin' || director.status !== 'active') {
    return json({ error: 'No tienes permiso para hacer eso.' }, 403);
  }

  let cuerpo: Cuerpo;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: 'Falta el cuerpo de la petición.' }, 400);
  }

  const admin = createClient(URL_PROYECTO, CLAVE_SERVICIO, { auth: { persistSession: false } });

  // La cuenta afectada tiene que ser de la escuela del director.
  const enMiEscuela = async (id: string) => {
    const { data } = await admin
      .from('profiles')
      .select('id, school_id, student_code')
      .eq('id', id)
      .single();
    if (!data) return null;
    if (data.school_id !== director.school_id) return null;
    return data;
  };

  // ---- Crear --------------------------------------------------------------
  if (cuerpo.action === 'create') {
    const fullName = String(cuerpo.fullName ?? '').trim();
    const password = String(cuerpo.password ?? '');
    const role = ROLES.includes(String(cuerpo.role)) ? String(cuerpo.role) : 'student';
    const level = cuerpo.level && NIVELES.includes(cuerpo.level) ? cuerpo.level : null;
    const correo = String(cuerpo.email ?? '').trim().toLowerCase();

    if (!fullName || !password) {
      return json({ error: 'El nombre y la contraseña son obligatorios.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
    }
    if (role === 'student' && !level) {
      return json({ error: 'Elige el nivel escolar del estudiante.' }, 400);
    }

    // Un estudiante sin correo entra con su ID, así que el ID va primero.
    let idEstudiante: string | null = null;
    if (role === 'student') {
      const { data } = await admin.rpc('next_student_code');
      idEstudiante = data as string;
    }
    const correoAuth = correo || (idEstudiante ? correoInterno(idEstudiante) : '');
    if (!correoAuth) {
      return json({ error: 'Escribe un correo para esa cuenta.' }, 400);
    }

    const { data: creada, error: errorAuth } = await admin.auth.admin.createUser({
      email: correoAuth,
      password,
      email_confirm: true,
      user_metadata: { mode: 'personal', full_name: fullName },
    });
    if (errorAuth || !creada?.user) {
      const yaExiste = (errorAuth?.message ?? '').toLowerCase().includes('already');
      return json(
        { error: yaExiste ? 'Ese correo ya está registrado.' : 'No se pudo crear la cuenta.' },
        400,
      );
    }

    // El disparador de alta creó el perfil como cuenta personal; el rol y la
    // escuela los pone el director, no quien se registra.
    const { data: perfil, error: errorPerfil } = await admin
      .from('profiles')
      .update({
        role,
        school_id: director.school_id,
        level,
        grade: cuerpo.grade || null,
        email: correo || null,
        student_code: idEstudiante,
      })
      .eq('id', creada.user.id)
      .select('*')
      .single();

    if (errorPerfil) {
      await admin.auth.admin.deleteUser(creada.user.id); // no dejar cuentas a medias
      return json({ error: 'No se pudo crear la cuenta.' }, 400);
    }
    return json({ user: perfil }, 201);
  }

  // ---- Editar -------------------------------------------------------------
  if (cuerpo.action === 'update') {
    const id = String(cuerpo.id ?? '');
    const objetivo = await enMiEscuela(id);
    if (!objetivo) return json({ error: 'No encontramos esa cuenta.' }, 404);

    const fullName = String(cuerpo.fullName ?? '').trim();
    if (!fullName) return json({ error: 'El nombre completo es obligatorio.' }, 400);
    if (cuerpo.password && cuerpo.password.length < 6) {
      return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' }, 400);
    }

    const correo = String(cuerpo.email ?? '').trim().toLowerCase();
    const cambiosAuth: Record<string, string> = {};
    if (cuerpo.password) cambiosAuth.password = cuerpo.password;
    if (correo) cambiosAuth.email = correo;

    if (Object.keys(cambiosAuth).length) {
      const { error } = await admin.auth.admin.updateUserById(id, cambiosAuth);
      if (error) {
        const yaExiste = error.message.toLowerCase().includes('already');
        return json(
          { error: yaExiste ? 'Ese correo ya está registrado.' : 'No se pudo guardar el cambio.' },
          400,
        );
      }
    }

    const cambios: Record<string, unknown> = { full_name: fullName, email: correo || null };
    if (ROLES.includes(String(cuerpo.role))) cambios.role = cuerpo.role;
    if (cuerpo.status === 'active' || cuerpo.status === 'inactive') cambios.status = cuerpo.status;
    if (cuerpo.level === null || NIVELES.includes(String(cuerpo.level))) cambios.level = cuerpo.level ?? null;
    if (cuerpo.grade !== undefined) cambios.grade = cuerpo.grade || null;

    // Un estudiante siempre necesita su ID, aunque llegue desde otro rol.
    if (cambios.role === 'student' && !objetivo.student_code) {
      const { data } = await admin.rpc('next_student_code');
      cambios.student_code = data as string;
    }

    const { data: perfil, error } = await admin
      .from('profiles').update(cambios).eq('id', id).select('*').single();
    if (error) return json({ error: 'No se pudo guardar el cambio.' }, 400);
    return json({ user: perfil });
  }

  // ---- Borrar -------------------------------------------------------------
  if (cuerpo.action === 'delete') {
    const id = String(cuerpo.id ?? '');
    if (id === director.id) {
      return json({ error: 'No puedes borrar tu propia cuenta de director.' }, 400);
    }
    if (!(await enMiEscuela(id))) return json({ error: 'No encontramos esa cuenta.' }, 404);

    // Borrar de Auth arrastra el perfil, las tareas y todo lo demás en cascada.
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return json({ error: 'No se pudo borrar la cuenta.' }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida.' }, 400);
});
