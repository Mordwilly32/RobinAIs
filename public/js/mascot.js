// public/js/mascot.js
// ---------------------------------------------------------------------------
// Robin, la mascota.
//
// Robin de siempre es el dibujo original a color en /images/robin.png: es el
// logo, el héroe y la cara del chat. No se redibuja ni se sustituye nunca.
//
// Alrededor de él vive el resto del elenco: los bocetos a lápiz de
// /images/robin/*.png, recortados a línea sobre fondo transparente. Cada uno
// tiene su momento y no se usa fuera de él:
//
//   ghost    no hay nada que dar — listas vacías, sin avisos, sin resultados
//   mailman  algo llegó o está por llegar — avisos, notificaciones, invitaciones
//   talking  Robin está explicando — chat, burbujas, pistas
//   happy    salió bien — tarea terminada, cuenta creada, todo al día
//   sad      salió mal — errores y formularios que no pasaron
//   idle     esperando — cargando, sin escribir todavía
//   error    la pantalla se rompió — solo la página 404/500
//
// La vida se la da el CSS: respira, flota, se inclina al pasar el mouse y
// brinca con chispas al hacer clic. El tamaño lo controla SIEMPRE el CSS; aquí
// no se ponen anchos en línea porque un estilo en línea le gana al CSS externo
// y volvería imposible que Robin se vea bien a la vez en la barra, el héroe y
// la burbuja del chat.
// ---------------------------------------------------------------------------

const RR_MASCOT_SRC = '/images/robin.png';

const RR_POSES = {
  idle:    { src: '/images/robin/idle.png',    alt: 'Robin esperando tranquilo' },
  talking: { src: '/images/robin/talking.png', alt: 'Robin explicando algo' },
  happy:   { src: '/images/robin/happy.png',   alt: 'Robin contento' },
  sad:     { src: '/images/robin/sad.png',     alt: 'Robin triste' },
  ghost:   { src: '/images/robin/ghost.png',   alt: 'Robin disfrazado de fantasma: por aquí no hay nada' },
  mailman: { src: '/images/robin/mailman.png', alt: 'Robin de mensajero, con su bolso de correo' },
  error:   { src: '/images/robin/error.png',   alt: 'Robin estrellado contra la pantalla' }
};

// Devuelve el <img> de Robin. Sin pose es el original a color; con pose, el
// boceto que corresponda.
function rrMascotSVG({ bob = false, small = false, pose = '', id = '' } = {}) {
  const art = RR_POSES[pose];
  const classes = ['rr-mascot'];
  if (small) classes.push('rr-mascot-sm');
  if (bob) classes.push('rr-mascot-bob');
  if (art) classes.push('rr-pose', `rr-pose-${pose}`);
  const idAttr = id ? ` id="${id}"` : '';

  const src = art ? art.src : RR_MASCOT_SRC;
  const alt = art ? art.alt : 'Robin, la mascota de roboRobin';

  return `<img${idAttr} class="${classes.join(' ')}" src="${src}" alt="${alt}" draggable="false" />`;
}

// Atajo para armar HTML desde otros archivos: rrRobin('ghost')
function rrRobin(pose, extraClass = '') {
  const art = RR_POSES[pose];
  if (!art) return '';
  const cls = ['rr-mascot', 'rr-pose', `rr-pose-${pose}`, extraClass].filter(Boolean).join(' ');
  return `<img class="${cls}" src="${art.src}" alt="${art.alt}" draggable="false" />`;
}

// Estado vacío completo: Robin, un título, una explicación y (si se pide) un
// botón para salir del vacío. Reemplaza a los emojis sueltos que había antes.
function rrEmptyState({ pose = 'ghost', title = '', text = '', action = '' } = {}) {
  return `
    <div class="rr-empty">
      <div class="rr-empty-art">${rrRobin(pose)}</div>
      ${title ? `<h4>${title}</h4>` : ''}
      ${text ? `<p>${text}</p>` : ''}
      ${action || ''}
    </div>`;
}

// Banda de "Robin dice": el pajarito a un lado y un globo con lo que quiere
// contarte. Sirve para dar la bienvenida, avisar que llegó correo o soltar una
// pista, sin robarle el espacio al contenido real de la pantalla.
function rrRobinSays({ pose = 'talking', text = '', action = '' } = {}) {
  return `
    <div class="rr-says">
      <div class="rr-says-art">${rrRobin(pose)}</div>
      <div class="rr-says-bubble">
        <p>${text}</p>
        ${action || ''}
      </div>
    </div>`;
}

// Monta la mascota en cada elemento con [data-rr-mascot].
function rrMountMascots() {
  document.querySelectorAll('[data-rr-mascot]').forEach(el => {
    if (el.dataset.rrMounted === 'true') return;
    el.dataset.rrMounted = 'true';
    el.innerHTML = rrMascotSVG({
      bob: el.hasAttribute('data-bob'),
      small: el.hasAttribute('data-small'),
      pose: el.dataset.pose || ''
    });
  });
  rrWireMascotLife();
}

// Cambia la pose de un [data-rr-mascot] que ya está en pantalla. Con pose vacía
// vuelve al Robin original a color.
function rrSetPose(target, pose) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.dataset.pose = pose || '';
  el.dataset.rrMounted = '';
  el.innerHTML = '';
  rrMountMascots();
}

// Al hacer clic (o tocar), Robin brinca y suelta unas chispas. La clase se
// quita al terminar la animación para poder repetirla las veces que sea.
function rrWireMascotLife() {
  document.querySelectorAll('img.rr-mascot').forEach(img => {
    if (img.dataset.rrWired === 'true') return;
    img.dataset.rrWired = 'true';
    img.style.cursor = 'pointer';

    img.addEventListener('click', () => {
      img.classList.remove('rr-mascot-cheer');
      void img.offsetWidth; // fuerza el reflow para poder repetir la animación
      img.classList.add('rr-mascot-cheer');
      rrMascotSparkles(img);
    });

    img.addEventListener('animationend', e => {
      if (e.animationName === 'rr-cheer') img.classList.remove('rr-mascot-cheer');
    });
  });
}

function rrMascotSparkles(el) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = el.getBoundingClientRect();
  const colors = ['#F7A81B', '#DE3E22', '#4FA9B8'];
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement('span');
    dot.className = 'rr-sparkle';
    dot.style.left = `${rect.left + rect.width / 2}px`;
    dot.style.top = `${rect.top + rect.height / 2}px`;
    dot.style.background = colors[i % colors.length];
    dot.style.setProperty('--dx', `${(Math.random() - 0.5) * rect.width * 1.4}px`);
    dot.style.setProperty('--dy', `${-Math.random() * rect.height * 0.9 - 10}px`);
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 750);
  }
}

// Lluvia corta de confeti para los momentos que hay que celebrar: terminar la
// última tarea del día, crear la cuenta, inscribir la escuela.
function rrConfetti(originEl) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = originEl
    ? originEl.getBoundingClientRect()
    : { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const colors = ['#F2A81B', '#E23A1B', '#2F8FA3', '#2E8B57'];

  for (let i = 0; i < 22; i++) {
    const bit = document.createElement('span');
    bit.className = 'rr-confetti';
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 320}px`);
    bit.style.setProperty('--dy', `${-Math.random() * 200 - 60}px`);
    bit.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    bit.style.animationDelay = `${Math.random() * 90}ms`;
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 1500);
  }
}

document.addEventListener('DOMContentLoaded', rrMountMascots);
