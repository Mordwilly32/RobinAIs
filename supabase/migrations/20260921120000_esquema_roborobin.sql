-- roboRobin — esquema de la base de datos en Supabase
-- ---------------------------------------------------------------------------
-- Pégalo entero en el SQL Editor de Supabase y dale a Run. Se puede correr
-- otra vez sin romper nada: todo va con IF NOT EXISTS.
--
-- Cada colección de la aplicación es una tabla con dos columnas: el id y el
-- registro entero en jsonb. Así cada usuario, cada tarea y cada marca de
-- asistencia es una fila de verdad —se puede consultar con SQL y mirar desde
-- el Table Editor— sin tener que partir en cincuenta columnas un formato que
-- todavía cambia de una versión a otra.
--
-- Quién puede leer esto
--   Nadie desde fuera. Las tablas llevan RLS encendido y CERO políticas, que
--   en Postgres significa "no pasa nadie". La anon key que va en el navegador
--   no saca ni una fila. La única que entra es la service_role key, que vive
--   en el servidor de roboRobin y nunca en el navegador ni en el repositorio.
--
-- Lo que NO está aquí a propósito
--   Las caras del pase de lista (facePhoto, faceDescriptor) y las fotos de
--   perfil. Son datos biométricos de menores de edad y se quedan en el
--   navegador de quien las tomó. El servidor se las quita a cada fila antes
--   de subirla; ver CAMPOS_QUE_NO_SUBEN en src/store.js.
--
--   Y la clave de la API de Anthropic, que es una variable de entorno del
--   servidor y no un dato de nadie.
-- ---------------------------------------------------------------------------

-- Los contadores de ids (nextUserId, nextSchoolId, …). Una sola fila, 'meta'.
create table if not exists public.rr_meta (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Cuentas: dirección, profesorado, estudiantes, familias y cuentas personales.
-- El campo passwordHash es un hash de bcrypt, no la contraseña.
create table if not exists public.rr_users (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Escuelas inscritas, con sus dos códigos de ingreso.
create table if not exists public.rr_schools (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Códigos nominales de un solo uso.
create table if not exists public.rr_codes (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Pendientes del organizador personal.
create table if not exists public.rr_tasks (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Avisos de la escuela.
create table if not exists public.rr_announcements (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Clases y lo que cuelga de ellas.
create table if not exists public.rr_classes (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rr_activities (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rr_submissions (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Conversaciones con Robin. Es lo que más crece: ver docs/supabase.md.
create table if not exists public.rr_chats (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Marcas de los minijuegos. El id es 'userId::gameId'.
create table if not exists public.rr_game_scores (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Qué minijuegos quedan apagados. El id es 'scope::scopeId'.
create table if not exists public.rr_game_settings (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Pase de lista: una fila por persona y por día. SIN la foto ni la huella.
create table if not exists public.rr_attendance (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Historial plano heredado del chat. Se conserva por compatibilidad.
create table if not exists public.rr_ai_logs (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
-- No los necesita la aplicación —que trabaja con todo en memoria— sino tú,
-- cuando entres al SQL Editor a preguntar algo concreto.

create index if not exists rr_users_email_idx     on public.rr_users    ((data->>'email'));
create index if not exists rr_users_school_idx    on public.rr_users    ((data->>'schoolId'));
create index if not exists rr_users_role_idx      on public.rr_users    ((data->>'role'));
create index if not exists rr_tasks_user_idx      on public.rr_tasks    ((data->>'userId'));
create index if not exists rr_chats_user_idx      on public.rr_chats    ((data->>'userId'));
create index if not exists rr_attendance_date_idx on public.rr_attendance ((data->>'date'));
create index if not exists rr_attendance_stu_idx  on public.rr_attendance ((data->>'studentId'));
create index if not exists rr_codes_code_idx      on public.rr_codes    ((data->>'code'));

-- ---------------------------------------------------------------------------
-- Quién entra
-- ---------------------------------------------------------------------------
-- RLS encendido y ninguna política: nadie pasa. La service_role key se salta
-- RLS por diseño, y es la única que usa roboRobin. Si algún día el navegador
-- hablara directo con Supabase, habría que escribir políticas aquí; mientras
-- tanto, cerrado.

do $$
declare t text;
begin
  foreach t in array array[
    'rr_meta','rr_users','rr_schools','rr_codes','rr_tasks','rr_announcements',
    'rr_classes','rr_activities','rr_submissions','rr_chats','rr_game_scores',
    'rr_game_settings','rr_attendance','rr_ai_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Y que las tablas que se creen después nazcan igual de cerradas.
alter default privileges in schema public revoke all on tables from anon, authenticated;
