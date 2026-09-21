// src/permissions.js
// ---------------------------------------------------------------------------
// Quién puede hacer qué dentro de una escuela.
//
// Los roles, de más a menos alcance:
//
//   admin       Dirección. Ve TODAS las cuentas y TODAS las clases de su
//               escuela, y es el único que crea cuentas de subdirección y
//               secretaría.
//   subdirector Lo mismo que dirección, menos crear más personal de dirección.
//   secretary   Secretaría. Ve todo y lleva las cuentas de estudiantes, pero
//               NO puede generar códigos de profesor: eso queda solo en
//               dirección y subdirección, que es justo el punto de tener el
//               rol aparte.
//   teacher     Profesorado. Sus clases, sus estudiantes, sus avisos y qué
//               minijuegos quedan activos en cada clase.
//   student     Estudiantado. Solo lo suyo. No cambia su propia contraseña:
//               esa se la restablece su profesor o la dirección.
//   personal    Cuenta personal, fuera de cualquier escuela.
//
// Todo se consulta con can(rol, 'permiso'). Ninguna ruta debería mirar el rol
// a mano: si mañana aparece un rol nuevo, se agrega aquí y ya.
// ---------------------------------------------------------------------------

const PERMISSIONS = {
  admin: [
    'school.view',          // ver el panel de la escuela
    'school.viewAllUsers',  // ver todas las cuentas de la escuela
    'school.viewAllClasses',// ver todas las clases de la escuela
    'school.rename',
    'codes.teacher',        // generar códigos de profesor (un solo uso)
    'codes.student',        // generar códigos de estudiante
    'codes.revoke',
    'staff.manage',         // crear subdirección y secretaría
    'school.limits',        // subir el margen diario de Robin de su escuela
    'accounts.create',
    'accounts.edit',
    'accounts.delete',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create',
    'announcements.deleteAny',
    'games.configureSchool'
  ],
  subdirector: [
    'school.view',
    'school.viewAllUsers',
    'school.viewAllClasses',
    'codes.teacher',
    'codes.student',
    'codes.revoke',
    'accounts.create',
    'accounts.edit',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create',
    'announcements.deleteAny',
    'games.configureSchool'
  ],
  secretary: [
    'school.view',
    'school.viewAllUsers',
    'school.viewAllClasses',
    // Ojo: aquí NO va 'codes.teacher'. Secretaría lleva estudiantes, no
    // contrata profesorado.
    'codes.student',
    'accounts.create',
    'accounts.edit',
    'accounts.resetPassword',
    'accounts.viewCredentials',
    'announcements.create'
  ],
  teacher: [
    'classes.create',
    'classes.invite',
    'classes.manageOwn',
    'activities.create',
    'activities.grade',
    'codes.student',
    'accounts.resetPassword',    // solo de sus propios estudiantes
    'accounts.viewCredentials',  // idem
    'announcements.create',
    'games.configureClass'
  ],
  student: [
    'classes.join',
    'activities.view',
    'games.play'
  ],
  personal: [
    'games.play',
    'plans.manage'
  ],
  // Familia. No pertenece a la escuela: acompaña a una o varias cuentas de
  // estudiante, y de ellas solo ve el pase de lista — si llegó y cuándo.
  parent: [
    'children.view'
  ]
};

// Roles que trabajan desde la dirección de la escuela.
const STAFF_ROLES = ['admin', 'subdirector', 'secretary'];
// Roles que pertenecen a una escuela (a diferencia de 'personal').
const SCHOOL_ROLES = ['admin', 'subdirector', 'secretary', 'teacher', 'student'];

const ROLE_LABEL = {
  admin: 'Dirección',
  subdirector: 'Subdirección',
  secretary: 'Secretaría',
  teacher: 'Profesor',
  student: 'Estudiante',
  personal: 'Cuenta personal',
  parent: 'Padre o madre'
};

function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

// Los permisos de un rol, tal cual, para que el navegador dibuje solo los
// botones que esa persona sí puede pulsar. Esconder un botón no protege nada
// por sí solo: la ruta del servidor vuelve a comprobarlo siempre.
function permissionsOf(role) {
  return (PERMISSIONS[role] || []).slice();
}

function isStaff(role) { return STAFF_ROLES.includes(role); }
function isSchoolRole(role) { return SCHOOL_ROLES.includes(role); }

// Middleware de Express: exige un permiso concreto en vez de un rol concreto.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Primero necesitas iniciar sesión.' });
    }
    if (!can(req.session.role, permission)) {
      return res.status(403).json({ error: 'No tienes permiso para hacer eso.' });
    }
    next();
  };
}

module.exports = {
  PERMISSIONS, STAFF_ROLES, SCHOOL_ROLES, ROLE_LABEL,
  can, permissionsOf, isStaff, isSchoolRole, requirePermission
};
