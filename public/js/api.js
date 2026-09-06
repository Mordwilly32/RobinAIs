// public/js/api.js
// Envoltorio de fetch (agrega cabeceras JSON y lanza errores legibles),
// avisos flotantes y utilidades compartidas por todas las páginas.

async function rrApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }

  if (!res.ok) {
    throw new Error((data && data.error) || `Algo salió mal (${res.status}).`);
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
      rrToast('Copiado al portapapeles.', 'success');
    }
  } catch {
    rrToast(`Código: ${text}`, 'info');
  }
}
