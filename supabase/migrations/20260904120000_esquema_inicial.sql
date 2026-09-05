-- ============================================================================
-- roboRobin — esquema inicial en Supabase
-- ----------------------------------------------------------------------------
-- Reemplaza a data/db.json y a todo el backend de Express. Las reglas que antes
-- vivían en routes/ (quién puede ver qué, quién puede borrar qué) ahora las
-- aplica Postgres con Row Level Security, así que siguen valiendo aunque
-- alguien llame a la API directamente sin pasar por la interfaz.
--
-- Idea central: cada escuela es un inquilino aislado. Nadie ve datos de otra
-- escuela, y los dos códigos de ingreso (estudiantes y profesores) solo los ve
-- el director de esa escuela.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Vocabulario. Se guarda como texto con restricción para que los valores
-- coincidan exactamente con los que muestra la interfaz, en español.
-- ---------------------------------------------------------------------------

create domain public.rol as text
  check (value in ('personal', 'student', 'teacher', 'admin'));

create domain public.nivel as text
  check (value in ('Parvularia', 'Primaria', 'Secundaria', 'Bachillerato'));

create domain public.nivel_aviso as text
  check (value in ('Parvularia', 'Primaria', 'Secundaria', 'Bachillerato', 'Todos los niveles'));

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

-- Una fila por cuenta. El id es el mismo de auth.users: la contraseña, el
-- correo y la sesión los maneja Supabase Auth; aquí va todo lo demás.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null check (length(btrim(full_name)) > 0),
  email        text,
  role         public.rol not null default 'personal',
  school_id    bigint,
  level        public.nivel,
  grade        text,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  profile_pic  text,
  student_code text unique,
  created_at   timestamptz not null default now()
);

comment on column public.profiles.email is
  'Nulo cuando la cuenta se creó con un código de escuela y sin correo propio.';
comment on column public.profiles.student_code is
  'ID de estudiante (STU-00001): sirve para entrar sin correo y para invitar a clases.';

create table public.schools (
  id            bigint generated always as identity primary key,
  name          text not null check (length(btrim(name)) > 0),
  director_id   uuid references public.profiles (id) on delete set null,
  director_name text,
  created_at    timestamptz not null default now()
);

-- Los códigos viven aparte de la escuela a propósito: así el permiso de leer la
-- escuela (lo tiene cualquier miembro) queda separado del permiso de leer sus
-- códigos de ingreso (solo el director).
create table public.school_codes (
  school_id    bigint primary key references public.schools (id) on delete cascade,
  student_code text not null unique,
  teacher_code text not null unique,
  updated_at   timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_school_id_fkey
  foreign key (school_id) references public.schools (id) on delete set null;

-- El organizador personal. Disponible para cualquier cuenta, no solo las
-- personales: cada quien ve únicamente las suyas.
create table public.tasks (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  notes        text not null default '',
  due          date,
  priority     text not null default 'normal' check (priority in ('baja', 'normal', 'alta')),
  category     text not null default 'General',
  done         boolean not null default false,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table public.classes (
  id           bigint generated always as identity primary key,
  teacher_id   uuid not null references public.profiles (id) on delete cascade,
  teacher_name text not null,
  school_id    bigint references public.schools (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  description  text not null default '',
  visibility   text not null default 'public' check (visibility in ('public', 'private')),
  level        public.nivel,
  join_code    text not null,
  created_at   timestamptz not null default now()
);

create table public.class_members (
  class_id   bigint not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.activities (
  id          bigint generated always as identity primary key,
  class_id    bigint not null references public.classes (id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  due_date    date,
  created_at  timestamptz not null default now()
);

create table public.announcements (
  id          bigint generated always as identity primary key,
  author_id   uuid references public.profiles (id) on delete set null,
  author_name text not null,
  school_id   bigint references public.schools (id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  content     text not null check (length(btrim(content)) > 0),
  level       public.nivel_aviso not null,
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  class_id   bigint references public.classes (id) on delete cascade,
  title      text not null,
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Historial del chat con Robin, para que recuerde el hilo de la conversación.
create table public.ai_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message    text not null,
  response   text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Índices. Postgres no indexa las llaves foráneas por su cuenta, y además
-- todas estas columnas se usan dentro de las políticas de seguridad.
-- ---------------------------------------------------------------------------

create index profiles_school_id_idx    on public.profiles (school_id);
create index profiles_school_role_idx  on public.profiles (school_id, role);
create index schools_director_id_idx   on public.schools (director_id);
create index tasks_user_id_idx         on public.tasks (user_id, done, due);
create index classes_teacher_id_idx    on public.classes (teacher_id);
create index classes_school_id_idx     on public.classes (school_id);
create index class_members_student_idx on public.class_members (student_id);
create index activities_class_id_idx   on public.activities (class_id, created_at desc);
create index announcements_school_idx  on public.announcements (school_id, created_at desc);
create index announcements_author_idx  on public.announcements (author_id);
create index notifications_user_idx    on public.notifications (user_id, created_at desc);
create index notifications_class_idx   on public.notifications (class_id);
create index ai_logs_user_idx          on public.ai_logs (user_id, created_at);
