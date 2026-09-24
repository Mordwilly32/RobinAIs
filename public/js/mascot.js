// public/js/mascot.js
// ---------------------------------------------------------------------------
// Robin, la mascota.
//
// Robin de siempre es el dibujo a color de /images/robin.png: es el logo, el
// héroe y la cara del chat. No se redibuja ni se sustituye nunca.
//
// Alrededor de él vive el resto del elenco, en /images/robin/*.png: el mismo
// pajarito a color, dibujado en la situación que toca. Cada pose tiene su
// momento y no se usa fuera de él:
//
//   idle     lo neutral — esperando, cargando, sin nada que celebrar ni lamentar
//   mailman  algo llegó o está por llegar — avisos, notificaciones, invitaciones
//   talking  Robin está explicando — chat, burbujas, pistas
//   happy    salió bien — tarea terminada, cuenta creada, y el clic de saludo
//   sad      salió mal — errores y formularios que no pasaron
//   ghost    no hay nada que dar — listas vacías, sin avisos, sin resultados
//   error    la pantalla se rompió — solo la página 404/500
//
// Esa tabla no es decorativa: rrPosePara() la usa para elegir sola, y de ahí
// salen los avisos flotantes, las esperas y los estados vacíos. Si una pantalla
// pone una pose a mano, que sea porque dice algo que la tabla no sabe.
//
// Los originales a tamaño completo están en images/ y no se sirven: lo que ve
// el navegador lo saca scripts/robin-para-web.py, que los recorta y los baja a
// tamaño de pantalla.
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

// El tono de un mensaje, traducido a pose. Es la tabla de arriba escrita una
// sola vez para que no haya que repetirla en cada pantalla: quien tiene un
// 'success' o un 'error' entre manos no debería tener que acordarse de cuál
// de los siete dibujos le toca.
const RR_POSE_POR_TONO = {
  success: 'happy',    // salió bien
  error:   'sad',      // salió mal
  aviso:   'mailman',  // llegó algo
  info:    'talking',  // Robin está contando algo
  espera:  'idle',     // todavía no pasa nada
  vacio:   'ghost'     // no hay nada que mostrar
};

function rrPosePara(tono) {
  return RR_POSE_POR_TONO[tono] || 'talking';
}

// Devuelve el <img> de Robin. Sin pose es el original a color; con pose, el
// dibujo de la pose que corresponda.
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

  // Si es una galería rotatoria, la pose manda: se para el reloj y se deja el
  // dibujo fijo. Con pose vacía vuelve a rotar desde cero.
  if (el.hasAttribute('data-rr-galeria')) {
    if (el.rrGaleriaParar) el.rrGaleriaParar();
    el.dataset.rrGaleria = '';
    el.innerHTML = '';
    if (pose) {
      const extra = el.hasAttribute('data-bob') ? 'rr-mascot-bob' : '';
      el.innerHTML = rrRobin(pose, extra);
      rrWireMascotLife();
    } else {
      rrMontarGaleria(el);
    }
    return;
  }

  el.dataset.pose = pose || '';
  el.dataset.rrMounted = '';
  el.innerHTML = '';
  rrMountMascots();
}

// El movimiento con el que Robin acusa recibo de algo: el brinco de alegría
// cuando sale bien, la sacudida cuando sale mal. Son las dos animaciones que
// ya existían sueltas —el brinco lo daba el clic, la sacudida la daban el
// botón equivocado y los formularios que no pasan— puestas en un solo sitio
// para que el clic y los avisos flotantes se muevan igual.
//
// La clase se quita al terminar: si se quedara puesta, Robin no volvería a la
// animación de su pose (el contento sigue brincando solito, el triste sigue
// suspirando) y, sobre todo, no se podría repetir el movimiento.
const RR_MOVIMIENTO = {
  bien: { clase: 'rr-mascot-cheer', anim: 'rr-cheer' },
  mal:  { clase: 'rr-robin-falla',  anim: 'rr-shake' }
};

// Cuánto tarda el más largo de los dos movimientos (la sacudida son dos
// vueltas de medio segundo), más un respiro. Es la red de abajo, no el reloj
// normal: lo normal es que 'animationend' llegue antes.
const RR_MOVIMIENTO_MS = 1200;

function rrMascotMueve(img, tono = 'bien') {
  const mov = RR_MOVIMIENTO[tono];
  if (!img || !mov) return;

  // Se quitan las DOS, no solo la que toca: un acierto justo después de un
  // fallo dejaba a Robin con las dos clases puestas a la vez, y entonces
  // mandaba la que estuviera más abajo en el CSS y no la del momento.
  img.classList.remove(RR_MOVIMIENTO.bien.clase, RR_MOVIMIENTO.mal.clase);
  // Forzar el reflow: sin esto, dos aciertos (o dos errores) seguidos solo se
  // mueven la primera vez, porque para el navegador la clase nunca llegó a irse.
  void img.offsetWidth;
  img.classList.add(mov.clase);

  // La clase se quita sola al terminar (el 'animationend' de
  // rrWireMascotLife), pero ese aviso no llega siempre: con el movimiento
  // reducido del sistema la animación es 'none', no empieza, y por lo tanto
  // tampoco termina. Sin este reloj la clase se quedaba puesta para siempre.
  clearTimeout(img.rrMovimientoReloj);
  img.rrMovimientoReloj = setTimeout(() => {
    img.classList.remove(mov.clase);
  }, RR_MOVIMIENTO_MS);
}

// Al hacer clic (o tocar), Robin brinca y suelta unas chispas.
function rrWireMascotLife() {
  document.querySelectorAll('img.rr-mascot').forEach(img => {
    if (img.dataset.rrWired === 'true') return;
    img.dataset.rrWired = 'true';
    img.style.cursor = 'pointer';

    img.addEventListener('click', () => {
      rrMascotMueve(img, 'bien');
      rrMascotSparkles(img);
    });

    img.addEventListener('animationend', e => {
      if (e.animationName === 'rr-cheer') img.classList.remove('rr-mascot-cheer');
      if (e.animationName === 'rr-shake') img.classList.remove('rr-robin-falla');
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

// ---------------------------------------------------------------------------
// Robin que escucha y Robin que habla
// ---------------------------------------------------------------------------
// Un elemento con [data-rr-galeria] tiene TRES dibujos: el de estar tranquilo
// (idle), el de estar explicando algo (talking) y el de estar contento
// (happy). Empieza tranquilo y al rato vuelve solo a la calma, venga de donde
// venga el cambio.
//
// Quién pide cada pose importa, porque no son lo mismo:
//
//   clic       -> happy    alguien saludó al pajarito, y el pajarito se alegra
//   rrHablar() -> talking  Robin está contestando algo: una pista, el chat
//
// El clic daba talking y estaba mal contado: Robin abría la boca sin tener
// nada que decir, y cuando de verdad contestaba una pista ponía la misma cara
// que si lo hubieran saludado. Hablar es lo que hace cuando tiene palabras;
// alegrarse es lo que hace cuando lo tocan.
//
// Antes esto rotaba entre diez dibujos cada pocos segundos y Robin cambiaba de
// cara sin que nadie lo tocara: parecía un carrusel, no una reacción. Ahora el
// único motivo para que cambie es que alguien lo toque o que tenga algo que
// decir, que es lo que hace que se sienta vivo en vez de inquieto.
//
// Si el archivo de una pose no existe, se usa el de otra y ya: la página nunca
// se ve rota por eso.

const RR_DUO = {
  idle: '/images/robin/idle.png',
  talking: '/images/robin/talking.png',
  happy: '/images/robin/happy.png'
};

// Cuánto se queda alegre o hablando antes de volver a la calma.
const RR_HABLA_MS = 3800;

// Qué poses cargaron de verdad. Se resuelve una sola vez por página.
let rrDuoListo = null;

function rrDuoCargar() {
  if (rrDuoListo) return rrDuoListo;

  const probar = src => new Promise(listo => {
    const img = new Image();
    img.onload = () => listo(src);
    img.onerror = () => listo(null);
    img.src = src;
  });

  rrDuoListo = Promise.all([probar(RR_DUO.idle), probar(RR_DUO.talking), probar(RR_DUO.happy)])
    .then(([idle, talking, happy]) => ({
      idle: idle || talking || happy,
      talking: talking || idle || happy,
      // Si el contento faltara, mejor que el clic deje a Robin hablando que
      // dejarlo sin ninguna reacción: algo tiene que pasar cuando lo tocan.
      happy: happy || talking || idle
    }));

  return rrDuoListo;
}

function rrMontarGaleria(el) {
  if (el.dataset.rrGaleria === 'lista') return;
  el.dataset.rrGaleria = 'lista';

  const clases = ['rr-mascot', 'rr-galeria-img'];
  if (el.hasAttribute('data-small')) clases.push('rr-mascot-sm');
  if (el.hasAttribute('data-bob')) clases.push('rr-mascot-bob');

  const img = document.createElement('img');
  img.className = clases.join(' ');
  img.alt = el.dataset.alt || 'Robin, la mascota de roboRobin';
  img.draggable = false;
  img.src = RR_DUO.idle;
  el.innerHTML = '';
  el.appendChild(img);

  rrDuoCargar().then(poses => {
    if (!poses.idle) return;
    let volver = null;

    // El cambio con un parpadeo corto, para que no se note el corte seco.
    const poner = src => {
      if (!src || img.getAttribute('src') === src) return;
      img.classList.add('rr-galeria-fade');
      setTimeout(() => {
        img.src = src;
        img.classList.remove('rr-galeria-fade');
      }, 180);
    };

    poner(poses.idle);

    // Las dos son el mismo gesto con distinta cara: se pone la pose y se
    // programa la vuelta a la calma, pisando la vuelta que hubiera pendiente
    // (si no, un segundo clic heredaría el reloj del primero y Robin se
    // calmaría antes de tiempo).
    const reaccionar = pose => {
      poner(pose);
      clearTimeout(volver);
      volver = setTimeout(() => poner(poses.idle), RR_HABLA_MS);
    };

    const hablar = () => reaccionar(poses.talking);
    const alegrarse = () => reaccionar(poses.happy);

    // Al tocarlo se alegra. El brinco y las chispas ya se los pone
    // rrWireMascotLife(), que le tiene puesto su propio clic a esta misma
    // imagen: aquí solo se cambia el dibujo.
    img.addEventListener('click', alegrarse);

    // Para que otras pantallas puedan hacerlo reaccionar sin simular un clic:
    // rrHablar() cuando Robin contesta una pista en un minijuego, rrFestejar()
    // cuando algo salió bien.
    el.rrHablar = hablar;
    el.rrFestejar = alegrarse;
    el.rrGaleriaParar = () => clearTimeout(volver);
  });
}

function rrMountGalerias() {
  document.querySelectorAll('[data-rr-galeria]').forEach(rrMontarGaleria);
  rrWireMascotLife();
}

// Pone a hablar a todos los Robin de la pantalla que sepan hacerlo. La usan
// los minijuegos cuando se pide una pista y el chat cuando Robin contesta.
//
// Además del dibujo, el brinco: contestar es algo que Robin HACE, y hasta
// ahora la única señal de que había contestado era que aparecía texto. Cambiar
// de cara no se nota cuando estás leyendo la respuesta y no mirándolo a él; el
// movimiento sí se ve por el rabillo del ojo. Es el mismo brinco del clic, y
// por eso se pide 'bien' sin que haya nada que celebrar: no es una nota, es
// acusar recibo.
function rrRobinHabla(scope) {
  const raiz = scope || document;
  raiz.querySelectorAll('[data-rr-galeria]').forEach(el => {
    if (typeof el.rrHablar === 'function') el.rrHablar();
    rrMascotMueve(el.querySelector('img'), 'bien');
  });
}

// Algo salió bien o salió mal, y Robin se entera: el de la pantalla se mueve
// igual que cuando le hacen clic. Lo llama rrToast() en api.js, así que vale
// para toda la app sin que cada pantalla tenga que acordarse.
//
// El acierto cambia la cara además de moverse —es la misma alegría del clic, y
// la pose existe—; el fallo solo se sacude. No es un descuido: la galería
// carga tres dibujos (idle, talking, happy) y ninguno es el triste. Traerlo
// solo para esto sería una cuarta descarga en la portada, y el Robin grande de
// una pantalla es decoración: quien ya está leyendo "no se pudo guardar" no
// necesita que además le pongan cara larga. La cara de disgusto sí sale, pero
// en el aviso flotante, que es donde se está contando la mala noticia.
function rrRobinReacciona(tono, scope) {
  const raiz = scope || document;
  raiz.querySelectorAll('[data-rr-galeria]').forEach(el => {
    if (tono === 'bien' && typeof el.rrFestejar === 'function') el.rrFestejar();
    rrMascotMueve(el.querySelector('img'), tono);
  });
}

document.addEventListener('DOMContentLoaded', rrMountGalerias);
