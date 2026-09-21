// public/js/api.js
// Envoltorio de fetch (agrega cabeceras JSON y lanza errores legibles),
// avisos flotantes y utilidades compartidas por todas las páginas.

// La foto de perfil no viaja al servidor. Es una cara, y las caras se quedan
// en el aparato de quien las puso — el mismo criterio que el pase de lista,
// ver public/js/face-vault.js. Vive en localStorage y no en IndexedDB porque
// es un solo dato pequeño y hace falta en páginas que no cargan el archivo de
// caras, como la de entrar.
//
// Lo que eso cuesta: solo tú ves tu foto, y solo en este navegador. En la
// lista del profesor o en la de la dirección sales con el muñequito gris,
// porque tu foto no está en ningún servidor que puedan consultar. Si algún día
// se prefiere lo contrario, se quita 'profilePic' de CAMPOS_QUE_NO_SUBEN en
// src/store.js y se borra este bloque.
// Con el id de quien la puso, no a secas: la tablet del aula la usan treinta
// personas, y una sola llave haría que cada quien entrara con la cara de la
// anterior.
function rrLlaveFoto(userId) {
  return 'roborobin.miFoto.' + userId;
}

function rrFotoPropia(userId) {
  if (userId === undefined || userId === null) return null;
  try { return localStorage.getItem(rrLlaveFoto(userId)) || null; } catch { return null; }
}

function rrGuardarFotoPropia(userId, dataUrl) {
  // undefined es "no tocaste la foto"; null o cadena vacía es "quítala".
  if (dataUrl === undefined) return rrFotoPropia(userId);
  try {
    if (dataUrl) localStorage.setItem(rrLlaveFoto(userId), dataUrl);
    else localStorage.removeItem(rrLlaveFoto(userId));
  } catch {
    // Sin espacio o en ventana privada. No es motivo para tumbar el guardado
    // del resto del perfil, que sí importa.
    rrToast('No pude guardar la foto en este navegador, pero lo demás sí se guardó.', 'error');
    return rrFotoPropia(userId);
  }
  return dataUrl || null;
}

async function rrApi(path, { method = 'GET', body } = {}) {
  // Único desvío de este envoltorio, y está aquí y no repetido en los cinco
  // paneles para que sea una sola regla y no cinco que se van separando: al
  // guardar el perfil, la foto se queda en este navegador y al servidor va
  // todo lo demás. La respuesta vuelve con la foto puesta para que la pantalla
  // no note la diferencia.
  let fotoLocal;
  if (method === 'PUT' && path === '/api/profile' && body && 'profilePic' in body) {
    fotoLocal = body.profilePic;
    body = { ...body };
    delete body.profilePic;
  }

  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }

  if (!res.ok) {
    // El error lleva pegado el cuerpo completo: hay respuestas que traen mucho
    // más que un texto (el límite diario trae la pista y el botón de planes).
    const err = new Error((data && data.error) || `Algo salió mal (${res.status}).`);
    err.status = res.status;
    err.payload = data || {};
    throw err;
  }

  if (fotoLocal !== undefined && data && data.user) {
    data.user.profilePic = rrGuardarFotoPropia(data.user.id, fotoLocal);
  }
  return data;
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

// A dónde va cada quien al entrar. Subdirección y secretaría comparten el
// panel de dirección (con menos botones), y los más peques tienen el suyo.
function rrDashboardFor(role, user) {
  if (['admin', 'subdirector', 'secretary'].includes(role)) return '/dashboard-admin.html';
  if (role === 'teacher') return '/dashboard-teacher.html';
  if (role === 'parent') return '/dashboard-parent.html';
  if (role === 'student') {
    return user && user.isLittle ? '/dashboard-peques.html' : '/dashboard-student.html';
  }
  return '/dashboard-personal.html';
}

const RR_ROLE_LABEL = {
  admin: 'Dirección',
  subdirector: 'Subdirección',
  secretary: 'Secretaría',
  teacher: 'Profesor',
  student: 'Estudiante',
  personal: 'Cuenta personal',
  parent: 'Padre o madre'
};

// Manda a la página de error explicando qué pasó, en vez de rebotar en
// silencio a otra pantalla: quien se equivocó de dirección tiene que verlo.
function rrShowError(motivo) {
  const ruta = encodeURIComponent(window.location.pathname);
  window.location.replace(`/404.html?motivo=${motivo}&ruta=${ruta}`);
}

// Se usa al inicio de cada panel protegido.
async function rrRequireSession(allowedRoles, { allowLittle = false } = {}) {
  try {
    const { user } = await rrApi('/api/me');
    // Tu foto no viene del servidor: está aquí. Ver rrFotoPropia() arriba.
    user.profilePic = rrFotoPropia(user.id);
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      rrShowError('permiso'); // este panel es de otro rol
      return null;
    }
    // Un peque que cae en el panel normal (o al revés) se manda al suyo: no es
    // un error, es que su pantalla es otra.
    if (user.role === 'student' && Boolean(user.isLittle) !== allowLittle) {
      window.location.replace(rrDashboardFor(user.role, user));
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
    window.location.href = rrDashboardFor(user.role, user);
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

// Precios: sin decimales cuando el numero es redondo, con dos cuando no.
function rrMoney(amount) {
  const n = Number(amount) || 0;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
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
      rrToast('Copiado al portapapeles.', 'success');
    }
  } catch {
    rrToast(`Código: ${text}`, 'info');
  }
}

// ---- Confirmar en dos tiempos ----------------------------------------------
// Para las acciones que no se deshacen: el primer clic no hace nada, solo
// cambia el botón y pide que se vuelva a pulsar. Es menos brusco que una
// ventana del navegador y, sobre todo, deja ver qué hay detrás del botón —
// que es justo lo que se está a punto de cambiar.
//
//   rrConfirmButton(boton, 'Pulsa otra vez para invitar', async () => { ... })

function rrConfirmButton(button, confirmLabel, action) {
  const original = button.textContent;
  let armado = false;
  let temporizador = null;

  const desarmar = () => {
    armado = false;
    clearTimeout(temporizador);
    button.textContent = original;
    button.classList.remove('rr-confirming');
  };

  button.addEventListener('click', async (e) => {
    e.preventDefault();

    if (!armado) {
      armado = true;
      button.textContent = confirmLabel;
      button.classList.add('rr-confirming');
      // Si no se vuelve a pulsar, el botón se rinde solo: nadie se queda con
      // un botón armado esperando un clic que ya no va a llegar.
      temporizador = setTimeout(desarmar, 4000);
      return;
    }

    desarmar();
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  });

  return { desarmar };
}
