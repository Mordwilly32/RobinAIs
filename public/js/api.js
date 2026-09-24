// public/js/api.js
// Envoltorio de fetch (agrega cabeceras JSON y lanza errores legibles),
// avisos flotantes y utilidades compartidas por todas las páginas.

// La foto de perfil SÍ viaja al servidor: se guarda en Supabase Storage y en
// la ficha queda su dirección. Ver src/fotos.js.
//
// Antes se quedaba aquí, en este navegador, y eso costaba más de lo que
// protegía: solo tú veías tu foto, y solo en este aparato. En la lista del
// profesor y en la de la dirección todo el mundo salía con el muñequito gris.
//
// Las caras del pase de lista son otra cosa y no se movieron: siguen sin salir
// del aparato. Ver public/js/face-vault.js.
//
// De localStorage solo queda lo justo para no perder las fotos que la gente ya
// tenía puestas antes de este cambio: se suben solas la próxima vez que entren
// y la copia de aquí se borra. Ver rrSubirFotoVieja().
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

// Las fotos que ya estaban puestas antes de que existiera Storage.
//
// Se corre una vez por cuenta y en silencio: si el servidor ya tiene foto, no
// hay nada que hacer; si no la tiene y aquí quedaba una, se manda y se borra
// la copia local. Si falla —sin red, o el servidor dice que no— la copia se
// queda donde está y se vuelve a intentar la próxima vez. Perderla sin avisar
// sería lo único imperdonable aquí.
async function rrSubirFotoVieja(user) {
  if (!user || user.profilePic) return user;

  const vieja = rrFotoPropia(user.id);
  if (!vieja) return user;

  try {
    const { user: actualizado } = await rrApi('/api/profile', {
      method: 'PUT',
      body: { fullName: user.fullName, profilePic: vieja }
    });
    if (actualizado && actualizado.profilePic) {
      user.profilePic = actualizado.profilePic;
      rrGuardarFotoPropia(user.id, null);
    }
  } catch {
    // Se queda para el próximo intento.
  }
  return user;
}

async function rrApi(path, { method = 'GET', body } = {}) {
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

  return data;
}

// ---- Avisos flotantes ------------------------------------------------------

// El tipo del aviso ('success', 'error', 'aviso', 'info') decide tres cosas a
// la vez: el color del borde, la pose de Robin y cuánto se queda en pantalla.
//
// La pose sale de rrPosePara() y no de un if aquí: la tabla de qué dibujo va
// con qué tono vive en mascot.js, junto a los dibujos, y este es uno de los
// muchos sitios que la consultan. Antes en todos los avisos salía el mismo
// Robin de la marca, dijeran lo que dijeran; ahora el de terminar algo brinca
// contento y el del error viene con la cara larga, que es la mitad del mensaje.
function rrToast(message, type = 'info') {
  let stack = document.querySelector('.rr-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'rr-toast-stack';
    document.body.appendChild(stack);
  }

  const el = document.createElement('div');
  el.className = `rr-toast ${type}`;
  el.innerHTML = `${rrRobin(rrPosePara(type), 'rr-mini-robin')}<span></span>`;
  el.querySelector('span').textContent = message;
  stack.appendChild(el);

  // Un error se lee dos veces y un "guardado" se lee de reojo: el malo se
  // queda más rato.
  const duracion = type === 'error' ? 5200 : 3400;

  setTimeout(() => {
    el.style.transition = 'opacity .3s ease, transform .3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(() => el.remove(), 320);
  }, duracion);
}

// Atajo para lo que llega de fuera: una invitación, un aviso de la escuela, un
// mensaje nuevo. Es un rrToast con el mensajero puesto.
function rrAviso(message) {
  rrToast(message, 'aviso');
}

// ---- Sesión ----------------------------------------------------------------

// A dónde va cada quien al entrar. Subdirección y secretaría comparten el
// panel de dirección (con menos botones), y los más peques tienen el suyo.
// El archivo que le toca a cada rol. Tiene que decir lo mismo que panelDe()
// en routes/paginas.js: si no coinciden, el servidor manda una pantalla y el
// JavaScript de esa pantalla rebota a otra, y se ve el parpadeo.
function rrArchivoDelPanel(role, user) {
  if (['admin', 'subdirector', 'secretary'].includes(role)) return '/dashboard-admin.html';
  if (role === 'teacher') return '/dashboard-teacher.html';
  if (role === 'parent') return '/dashboard-parent.html';
  if (role === 'student') {
    return user && user.isLittle ? '/dashboard-peques.html' : '/dashboard-student.html';
  }
  return '/dashboard-personal.html';
}

// A dónde ir después de entrar. Normalmente /dashboard/<id>, que es lo que se
// ve en la barra de direcciones y lo que se puede guardar en favoritos.
//
// La versión de GitHub Pages no pasa por aquí: allá no hay servidor que sepa
// qué es /dashboard/7, y cada panel vuelve a ser su archivo. La bandera la
// pone web/js/rr-runtime.js, que solo existe en esa versión.
function rrDashboardFor(role, user) {
  if (window.RR_PAGINAS_ESTATICAS) return rrArchivoDelPanel(role, user);
  if (user && user.id != null) return '/dashboard/' + user.id;
  return '/dashboard';
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
    // La foto viene del servidor. Si además hay una guardada aquí de antes del
    // cambio, se sube ahora y esta copia desaparece.
    await rrSubirFotoVieja(user);
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
