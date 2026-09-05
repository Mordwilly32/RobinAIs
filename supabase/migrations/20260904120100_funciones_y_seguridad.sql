-- ============================================================================
-- roboRobin — funciones, disparadores y Row Level Security
-- ----------------------------------------------------------------------------
-- Aquí vive lo que antes hacían src/auth.js y los `if` de cada archivo de
-- routes/. Todo lo que necesita saltarse RLS para funcionar (resolver un código
-- de ingreso, avisarle a otro usuario, contar miembros de la escuela) está en
-- funciones SECURITY DEFINER que siempre comprueban quién llama.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Quién soy. Se consultan en casi todas las políticas, así que son SECURITY
-- DEFINER (leen profiles sin pasar por RLS, lo que además evita la recursión
-- de una política de profiles que consulte profiles).
--
-- Una cuenta suspendida (status <> 'active') no tiene rol ni escuela: pierde
-- de golpe todos los permisos que dependen de ellos.
-- ---------------------------------------------------------------------------

create or replace function private.my_role()
returns public.rol
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.status = 'active';
$$;

create or replace function private.my_school_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.school_id
    from public.profiles p
   where p.id = (select auth.uid())
     and p.status = 'active';
$$;

create or replace function private.my_level()
returns public.nivel
language sql
stable
security definer
set search_path = ''
as $$
  select p.level
    from public.profiles p
   where p.id = (select auth.uid())
     and p.status = 'active';
$$;

create or replace function private.is_class_teacher(p_class_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.classes c
     where c.id = p_class_id
       and c.teacher_id = (select auth.uid())
  );
$$;

create or replace function private.is_class_member(p_class_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.class_members m
     where m.class_id = p_class_id
       and m.student_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Códigos
-- ---------------------------------------------------------------------------

-- Alfabeto sin caracteres confusos (nada de O/0 ni I/1): estos códigos se
-- dictan en voz alta y se copian a mano.
create or replace function private.random_code(p_prefix text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  salida text := '';
  i int;
begin
  for i in 1..4 loop
    salida := salida || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
  end loop;
  return p_prefix || '-' || salida;
end;
$$;

create or replace function private.unique_school_code(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  codigo text;
begin
  loop
    codigo := private.random_code(p_prefix);
    exit when not exists (
      select 1 from public.school_codes sc
       where sc.student_code = codigo or sc.teacher_code = codigo
    );
  end loop;
  return codigo;
end;
$$;

-- El ID de estudiante se pide ANTES de crear la cuenta, porque cuando no hay
-- correo propio ese mismo ID es el que forma el correo interno con el que
-- Supabase Auth guarda la sesión.
create sequence if not exists public.student_code_seq as bigint start 1;

create or replace function public.next_student_code()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'STU-' || lpad(nextval('public.student_code_seq')::text, 5, '0');
$$;

-- Busca una escuela por cualquiera de sus dos códigos y dice qué rol otorga.
create or replace function private.resolve_join_code(p_code text)
returns table (school_id bigint, school_name text, role public.rol)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         (case when sc.student_code = upper(btrim(p_code)) then 'student' else 'teacher' end)::public.rol
    from public.school_codes sc
    join public.schools s on s.id = sc.school_id
   where upper(btrim(p_code)) <> ''
     and (sc.student_code = upper(btrim(p_code)) or sc.teacher_code = upper(btrim(p_code)));
$$;

-- Versión pública: la usa la pantalla de registro para mostrar el nombre de la
-- escuela antes de crear la cuenta. Nunca devuelve el otro código.
create or replace function public.resolve_join_code(p_code text)
returns table (school_id bigint, school_name text, role public.rol)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.resolve_join_code(p_code);
$$;

-- Traduce un ID de estudiante al correo interno con el que se inicia sesión.
-- Devuelve nulo si lo que se escribió no es un ID de estudiante, y entonces la
-- interfaz lo trata como un correo normal.
create or replace function public.resolve_login_id(p_login_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.student_code = upper(btrim(p_login_id))
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Alta de cuentas
-- ---------------------------------------------------------------------------

create or replace function private.create_school(
  p_name          text,
  p_director_id   uuid,
  p_director_name text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  nueva_id bigint;
begin
  insert into public.schools (name, director_id, director_name)
  values (btrim(p_name), p_director_id, p_director_name)
  returning id into nueva_id;

  insert into public.school_codes (school_id, student_code, teacher_code)
  values (nueva_id, private.unique_school_code('EST'), private.unique_school_code('PRO'));

  return nueva_id;
end;
$$;

-- Se dispara cuando Supabase Auth crea la cuenta. El rol NO lo elige quien se
-- registra: o es 'personal', o es 'admin' porque está inscribiendo su escuela,
-- o lo decide el código de ingreso que escribió. Si algo no cuadra la excepción
-- cancela el alta entera, así que no quedan cuentas a medias.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta          jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_modo        text  := coalesce(meta->>'mode', 'personal');
  v_nombre      text  := nullif(btrim(coalesce(meta->>'full_name', '')), '');
  v_nivel       text  := nullif(btrim(coalesce(meta->>'level', '')), '');
  v_grado       text  := nullif(btrim(coalesce(meta->>'grade', '')), '');
  v_codigo      text  := nullif(btrim(coalesce(meta->>'join_code', '')), '');
  v_escuela     text  := nullif(btrim(coalesce(meta->>'school_name', '')), '');
  v_id_estud    text  := nullif(btrim(coalesce(meta->>'student_code', '')), '');
  v_correo      text  := new.email;
  v_rol         public.rol := 'personal';
  v_school_id   bigint;
  v_match       record;
begin
  if v_nombre is null then
    raise exception 'Escribe tu nombre completo.';
  end if;

  -- El correo interno de un estudiante sin correo propio no se muestra nunca.
  if v_correo like '%@estudiantes.roborobin.local' then
    v_correo := null;
  end if;

  if v_modo = 'school' then
    if v_escuela is null then
      raise exception 'Escribe el nombre de tu escuela.';
    end if;
    v_rol := 'admin';

  elsif v_modo = 'join' then
    select * into v_match from private.resolve_join_code(v_codigo);
    if v_match.school_id is null then
      raise exception 'Ese código no existe. Pídele el código correcto a tu director.';
    end if;
    v_rol := v_match.role;
    v_school_id := v_match.school_id;
    if v_rol = 'student' and v_nivel is null then
      raise exception 'Elige tu nivel escolar.';
    end if;

  elsif v_modo <> 'personal' then
    raise exception 'Elige primero qué tipo de cuenta quieres crear.';
  end if;

  insert into public.profiles (id, full_name, email, role, school_id, level, grade, student_code)
  values (
    new.id,
    v_nombre,
    v_correo,
    v_rol,
    v_school_id,
    case when v_rol in ('student', 'teacher') then v_nivel::public.nivel else null end,
    v_grado,
    case when v_rol = 'student' then coalesce(v_id_estud, public.next_student_code()) else null end
  );

  -- La escuela se crea después del perfil porque su director apunta a él.
  if v_modo = 'school' then
    v_school_id := private.create_school(v_escuela, new.id, v_nombre);
    update public.profiles set school_id = v_school_id where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nadie se asciende a sí mismo. Un director puede administrar las cuentas de
-- SU escuela; cualquier otra actualización solo toca datos no privilegiados.
create or replace function private.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rol_llamante    public.rol := private.my_role();
  escuela_llamante bigint    := private.my_school_id();
begin
  -- Sin sesión de usuario detrás: son los propios disparadores del alta o la
  -- función admin-usuarios con la llave de servicio, que nunca llega al
  -- navegador. El rol 'anon' no puede llegar aquí porque no tiene UPDATE.
  if (select auth.uid()) is null then
    return new;
  end if;

  new.id         := old.id;
  new.created_at := old.created_at;
  new.school_id  := old.school_id;  -- mover cuentas de escuela no se hace desde aquí

  if rol_llamante = 'admin'
     and old.school_id is not null
     and old.school_id = escuela_llamante
     and old.id <> (select auth.uid()) then
    new.student_code := old.student_code;
    return new;
  end if;

  new.role         := old.role;
  new.status       := old.status;
  new.student_code := old.student_code;
  new.email        := old.email;  -- el correo pertenece a la cuenta, no al perfil
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function private.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- La escuela del director
-- ---------------------------------------------------------------------------

create or replace function public.create_my_school(p_name text)
returns table (id bigint, name text, student_code text, teacher_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  yo       public.profiles;
  nueva_id bigint;
begin
  select * into yo from public.profiles where profiles.id = (select auth.uid()) and status = 'active';
  if yo.id is null or yo.role <> 'admin' then
    raise exception 'No tienes permiso para hacer eso.';
  end if;
  if yo.school_id is not null then
    raise exception 'Ya tienes una escuela inscrita.';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Escribe el nombre de la escuela.';
  end if;

  nueva_id := private.create_school(p_name, yo.id, yo.full_name);
  update public.profiles set school_id = nueva_id where profiles.id = yo.id;

  return query
    select s.id, s.name, sc.student_code, sc.teacher_code
      from public.schools s
      join public.school_codes sc on sc.school_id = s.id
     where s.id = nueva_id;
end;
$$;

create or replace function public.rename_my_school(p_name text)
returns public.schools
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  escuela public.schools;
begin
  if private.my_role() <> 'admin' then
    raise exception 'No tienes permiso para hacer eso.';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Escribe el nombre de la escuela.';
  end if;

  update public.schools
     set name = btrim(p_name)
   where id = private.my_school_id()
  returning * into escuela;

  if escuela.id is null then
    raise exception 'Todavía no has inscrito una escuela.';
  end if;
  return escuela;
end;
$$;

-- Genera un código nuevo. El anterior deja de funcionar de inmediato, que es
-- justo lo que se quiere cuando un código se filtró.
create or replace function public.regenerate_school_code(p_which text)
returns public.school_codes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  codigos public.school_codes;
  escuela bigint := private.my_school_id();
begin
  if private.my_role() <> 'admin' then
    raise exception 'No tienes permiso para hacer eso.';
  end if;
  if escuela is null then
    raise exception 'Todavía no has inscrito una escuela.';
  end if;
  if p_which not in ('student', 'teacher') then
    raise exception 'Indica si quieres regenerar el código de estudiantes o el de profesores.';
  end if;

  update public.school_codes
     set student_code = case when p_which = 'student' then private.unique_school_code('EST') else student_code end,
         teacher_code = case when p_which = 'teacher' then private.unique_school_code('PRO') else teacher_code end,
         updated_at   = now()
   where school_id = escuela
  returning * into codigos;

  return codigos;
end;
$$;

create or replace function public.school_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'totalUsers',    count(*),
    'totalAdmins',   count(*) filter (where p.role = 'admin'),
    'totalTeachers', count(*) filter (where p.role = 'teacher'),
    'totalStudents', count(*) filter (where p.role = 'student'),
    'activeUsers',   count(*) filter (where p.status = 'active'),
    'inactiveUsers', count(*) filter (where p.status = 'inactive'),
    'byLevel', (
      select coalesce(jsonb_agg(jsonb_build_object('level', n.nivel, 'count', (
        select count(*) from public.profiles q
         where q.school_id = private.my_school_id()
           and q.role = 'student'
           and q.level = n.nivel
      )) order by n.orden), '[]'::jsonb)
      from (values ('Parvularia', 1), ('Primaria', 2), ('Secundaria', 3), ('Bachillerato', 4))
        as n(nivel, orden)
    ),
    'students', count(*) filter (where p.role = 'student'),
    'teachers', count(*) filter (where p.role = 'teacher'),
    'admins',   count(*) filter (where p.role = 'admin'),
    'total',    count(*)
  )
  from public.profiles p
  where private.my_role() = 'admin'
    and p.school_id is not null
    and p.school_id = private.my_school_id();
$$;

-- ---------------------------------------------------------------------------
-- Clases
-- ---------------------------------------------------------------------------

create or replace function public.class_members_list(p_class_id bigint)
returns table (full_name text, role public.rol, level public.nivel)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clase public.classes;
begin
  select * into clase from public.classes where id = p_class_id;
  if clase.id is null then
    raise exception 'No encontramos esa clase.';
  end if;
  if not (private.is_class_teacher(p_class_id) or private.is_class_member(p_class_id)) then
    raise exception 'No tienes acceso a esa clase.';
  end if;

  return query
    select clase.teacher_name, 'teacher'::public.rol, null::public.nivel
    union all
    select p.full_name, 'student'::public.rol, p.level
      from public.class_members m
      join public.profiles p on p.id = m.student_id
     where m.class_id = p_class_id
     order by 2 desc, 1;
end;
$$;

create or replace function public.invite_student_to_class(p_class_id bigint, p_student_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clase      public.classes;
  profesor   public.profiles;
  estudiante public.profiles;
begin
  select * into profesor from public.profiles where id = (select auth.uid()) and status = 'active';
  select * into clase from public.classes where id = p_class_id;
  if clase.id is null or profesor.role <> 'teacher' or clase.teacher_id <> profesor.id then
    raise exception 'No encontramos esa clase.';
  end if;

  select * into estudiante
    from public.profiles
   where student_code = upper(btrim(coalesce(p_student_code, '')))
     and role = 'student';
  if estudiante.id is null then
    raise exception 'No encontramos ese ID de estudiante.';
  end if;
  if profesor.school_id is not null and estudiante.school_id is distinct from profesor.school_id then
    raise exception 'Ese estudiante no pertenece a tu escuela.';
  end if;

  insert into public.notifications (user_id, type, class_id, title, message)
  values (
    estudiante.id,
    'class-invite',
    clase.id,
    'Invitación a una clase',
    profesor.full_name || ' te invitó a unirte a ' || clase.name || '.'
  );
  return true;
end;
$$;

create or replace function public.join_class(p_class_id bigint, p_code text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clase      public.classes;
  estudiante public.profiles;
  invitado   boolean;
begin
  select * into estudiante from public.profiles where id = (select auth.uid()) and status = 'active';
  if estudiante.role <> 'student' then
    raise exception 'No tienes permiso para hacer eso.';
  end if;

  select * into clase from public.classes where id = p_class_id;
  if clase.id is null then
    raise exception 'No encontramos esa clase.';
  end if;
  if estudiante.school_id is not null and clase.school_id is not null
     and clase.school_id <> estudiante.school_id then
    raise exception 'Esa clase es de otra escuela.';
  end if;

  select exists (
    select 1 from public.notifications n
     where n.user_id = estudiante.id and n.type = 'class-invite' and n.class_id = clase.id
  ) into invitado;

  if clase.visibility = 'private' and not invitado
     and clase.join_code <> upper(btrim(coalesce(p_code, ''))) then
    raise exception 'El código de la clase privada no es correcto.';
  end if;

  insert into public.class_members (class_id, student_id)
  values (clase.id, estudiante.id)
  on conflict do nothing;
  return true;
end;
$$;

-- Al publicar una actividad se avisa a todos los estudiantes de la clase.
create or replace function private.notify_new_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, class_id, title, message)
  select m.student_id,
         'new-activity',
         c.id,
         'Nueva actividad',
         c.teacher_name || ' publicó una actividad nueva: ' || new.title
    from public.classes c
    join public.class_members m on m.class_id = c.id
   where c.id = new.class_id;
  return new;
end;
$$;

create trigger activities_notify_students
  after insert on public.activities
  for each row execute function private.notify_new_activity();

-- El código de ingreso de una clase se genera solo, como antes.
create or replace function private.set_class_join_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.join_code, '')), '') is null then
    new.join_code := split_part(private.random_code('CLS'), '-', 2);
  end if;
  return new;
end;
$$;

create trigger classes_set_join_code
  before insert on public.classes
  for each row execute function private.set_class_join_code();

-- El historial del chat no crece sin límite en una instalación de larga vida.
create or replace function private.trim_ai_logs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_logs
   where user_id = new.user_id
     and id not in (
       select id from public.ai_logs
        where user_id = new.user_id
        order by id desc
        limit 200
     );
  return null;
end;
$$;

create trigger ai_logs_trim
  after insert on public.ai_logs
  for each row execute function private.trim_ai_logs();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.schools       enable row level security;
alter table public.school_codes  enable row level security;
alter table public.tasks         enable row level security;
alter table public.classes       enable row level security;
alter table public.class_members enable row level security;
alter table public.activities    enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.ai_logs       enable row level security;

-- ---- Perfiles -------------------------------------------------------------
-- El propio, y los de la misma escuela (de ahí salen la lista del director, el
-- listado de estudiantes del profesor y los nombres en una clase). Una cuenta
-- personal no tiene escuela, así que solo se ve a sí misma.

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_school on public.profiles
  for select to authenticated
  using (school_id is not null and school_id = (select private.my_school_id()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select private.my_role()) = 'admin' and school_id = (select private.my_school_id()))
  with check ((select private.my_role()) = 'admin' and school_id = (select private.my_school_id()));

-- Borrar una cuenta se hace desde la función admin-usuarios, que también borra
-- el acceso en Supabase Auth. Sin política de DELETE aquí, un perfil borrado a
-- mano no puede dejar una cuenta huérfana que todavía inicie sesión.

-- ---- Escuelas -------------------------------------------------------------

create policy schools_select_member on public.schools
  for select to authenticated
  using (id = (select private.my_school_id()) or director_id = (select auth.uid()));

-- Los códigos, solo el director de esa escuela. Se cambian con
-- public.regenerate_school_code().
create policy school_codes_select_admin on public.school_codes
  for select to authenticated
  using ((select private.my_role()) = 'admin' and school_id = (select private.my_school_id()));

-- ---- Tareas ---------------------------------------------------------------

create policy tasks_all_own on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---- Clases ---------------------------------------------------------------
-- Un profesor ve las suyas; estudiantes y dirección ven las de la escuela.

create policy classes_select on public.classes
  for select to authenticated
  using (
    school_id = (select private.my_school_id())
    and ((select private.my_role()) <> 'teacher' or teacher_id = (select auth.uid()))
  );

create policy classes_insert_teacher on public.classes
  for insert to authenticated
  with check (
    (select private.my_role()) = 'teacher'
    and teacher_id = (select auth.uid())
    and school_id is not distinct from (select private.my_school_id())
  );

create policy classes_update_teacher on public.classes
  for update to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

create policy classes_delete_teacher on public.classes
  for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- Unirse a una clase pasa por public.join_class(), que comprueba invitación o
-- código antes de escribir aquí.
create policy class_members_select on public.class_members
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select private.is_class_teacher(class_id))
  );

-- ---- Actividades ----------------------------------------------------------

create policy activities_select on public.activities
  for select to authenticated
  using (
    (select private.is_class_teacher(class_id))
    or (select private.is_class_member(class_id))
  );

create policy activities_insert_teacher on public.activities
  for insert to authenticated
  with check ((select private.is_class_teacher(class_id)));

-- ---- Avisos ---------------------------------------------------------------
-- Los estudiantes solo ven los de su nivel (o los dirigidos a todos).

create policy announcements_select on public.announcements
  for select to authenticated
  using (
    school_id is not null
    and school_id = (select private.my_school_id())
    and (
      (select private.my_role()) <> 'student'
      or level = 'Todos los niveles'
      or level = (select private.my_level())
    )
  );

create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    (select private.my_role()) in ('teacher', 'admin')
    and author_id = (select auth.uid())
    and school_id is not distinct from (select private.my_school_id())
  );

-- El profesor borra los suyos; el director, cualquiera de su escuela.
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    school_id = (select private.my_school_id())
    and (
      (select private.my_role()) = 'admin'
      or author_id = (select auth.uid())
    )
  );

-- ---- Notificaciones -------------------------------------------------------
-- Las escribe el sistema (invitaciones y actividades nuevas), no el usuario.

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---- Historial del chat ---------------------------------------------------

create policy ai_logs_select_own on public.ai_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy ai_logs_insert_own on public.ai_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy ai_logs_delete_own on public.ai_logs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================================
-- Permisos. Solo lo que cada rol necesita: nadie sin sesión toca una tabla, y
-- lo que se escribe por función (escuelas, códigos, miembros, avisos a otros)
-- no tiene permiso directo de escritura.
-- ============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant select, update           on public.profiles      to authenticated;
grant select                   on public.schools       to authenticated;
grant select                   on public.school_codes  to authenticated;
grant select, insert, update, delete on public.tasks   to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select                   on public.class_members to authenticated;
grant select, insert           on public.activities    to authenticated;
grant select, insert, delete   on public.announcements to authenticated;
grant select, update           on public.notifications to authenticated;
grant select, insert, delete   on public.ai_logs       to authenticated;

-- La secuencia de IDs de estudiante no se toca directamente: solo la avanza
-- public.next_student_code(), que corre con los permisos de su dueño.

-- Estas tres se llaman antes de tener sesión, en la pantalla de registro y en
-- la de inicio de sesión.
grant execute on function public.resolve_join_code(text) to anon, authenticated;
grant execute on function public.resolve_login_id(text)  to anon, authenticated;
grant execute on function public.next_student_code()     to anon, authenticated;

grant execute on function public.create_my_school(text)                    to authenticated;
grant execute on function public.rename_my_school(text)                    to authenticated;
grant execute on function public.regenerate_school_code(text)              to authenticated;
grant execute on function public.school_stats()                            to authenticated;
grant execute on function public.class_members_list(bigint)                to authenticated;
grant execute on function public.invite_student_to_class(bigint, text)     to authenticated;
grant execute on function public.join_class(bigint, text)                  to authenticated;

-- Las de private no se llaman desde fuera: solo las evalúan las políticas y
-- otras funciones. Se abren una por una y el resto queda cerrado.
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function private.my_role()                to authenticated;
grant execute on function private.my_school_id()           to authenticated;
grant execute on function private.my_level()               to authenticated;
grant execute on function private.is_class_teacher(bigint) to authenticated;
grant execute on function private.is_class_member(bigint)  to authenticated;

-- El disparador de alta lo ejecuta el servicio de autenticación, no un usuario.
grant execute on function public.handle_new_user() to supabase_auth_admin;
