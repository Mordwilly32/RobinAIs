// public/js/cine.js
// ---------------------------------------------------------------------------
// La demostración que se cuenta sola.
//
//     Ctrl + Alt + Shift + T
//
// Y la portada se recorre a sí misma: el logo baja, el héroe se arma, los
// cuatro pasos salen uno detrás de otro como un camino, las materias hacen pop
// una por una, la conversación con Robin se cuenta despacio, y al final se
// queda en «¿Listo para aprender con Robin?». Un minuto después vuelve arriba
// y empieza otra vez, sin parar, hasta que alguien pulse Esc.
//
// Para qué sirve: una exposición con la pantalla puesta de fondo, una
// grabación, o enseñar la portada entera sin ir tocando la rueda del ratón.
//
// Solo en la portada. En cualquier otra pantalla el atajo no existe: lo que se
// anima aquí son secciones que solo están aquí.
//
// Cómo está hecho
// ---------------
// No hay ni una animación nueva. Todo lo que se ve ya estaba en landing.css:
// las entradas de [data-anim], la línea que une los pasos, el pop de las
// tarjetas, el guion del chat. Lo único que hace este archivo es apagarlas
// todas, llevar la página a cada sitio, y volver a encenderlas en el orden y
// al ritmo que se quiere. Si mañana cambia una animación de la portada, la
// demostración la enseña ya cambiada.
// ---------------------------------------------------------------------------

(function () {
  const TECLA = 't'; // con Ctrl + Alt + Shift

  // La portada y nada más: se reconoce por el héroe, que no está en ninguna
  // otra pantalla. Se comprueba al pulsar el atajo y no al cargar el archivo,
  // porque en la versión sin servidor se cambia de pantalla sin recargar nada
  // (ver web/js/rr-shell.js) y este archivo se ejecuta una sola vez.
  const esLaPortada = () => Boolean(document.querySelector('.rb-hero'));

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Lo que dura una vuelta entera, más o menos. Solo lo usa la barra de abajo:
  // el guion no se mide con un reloj, se mide paso a paso.
  const DURA = 77000;

  // El cartel de arriba dice dos cosas —esto es una demostración, y se sale
  // por aquí— y las dos se leen de un vistazo. Pasados cinco segundos ya solo
  // tapa la página que se está enseñando, así que se aparta solo. Vuelve en
  // cuanto el ratón se acerca al borde de arriba, que es adonde va la mano de
  // quien quiere salir.
  const ESPERA_HUD = 5000; // lo que aguanta puesto sin que nadie lo pida
  const ZONA_HUD = 150;    // la franja de arriba que lo hace volver, en píxeles

  let corriendo = false;
  let vuelta = 0;          // sube en cada parada: mata el guion que iba a medias
  let hud = null;
  let barra = null;
  let telon = null;
  let relojHud = null;     // el que lo esconde
  let relojQuieto = null;  // el que le quita la animación de entrada

  // ---- El atajo ------------------------------------------------------------
  //
  // Se mira e.code además de e.key: con Ctrl + Alt el sistema puede estar
  // haciendo de AltGr, y entonces la letra que llega depende de la
  // distribución del teclado. e.code dice qué tecla se pulsó de verdad.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey &&
        (e.code === 'KeyT' || String(e.key || '').toLowerCase() === TECLA)) {
      if (!corriendo && !esLaPortada()) return;
      e.preventDefault();
      corriendo ? parar() : arrancar();
    }
    if (e.key === 'Escape' && corriendo) parar();
  });

  // ---- Esperas que se pueden cancelar --------------------------------------
  //
  // Cada paso del guion comprueba que sigue siendo el suyo antes de tocar la
  // pantalla. Sin esto, parar la demostración a la mitad dejaría media docena
  // de temporizadores sueltos animando cosas por su cuenta.

  const dormir = ms => new Promise(r => setTimeout(r, ms));

  function mia(n) { return corriendo && n === vuelta; }

  async function esperar(ms, n) {
    await dormir(ms);
    return mia(n);
  }

  // ---- Llevar la página de un sitio a otro ---------------------------------
  //
  // A mano y no con scrollTo({ behavior: 'smooth' }): el suave del navegador
  // dura lo que él decide, y aquí hace falta saber exactamente cuánto tarda
  // cada tramo para que lo que se enciende al llegar se encienda al llegar.
  function irA(y, ms) {
    return new Promise(resolve => {
      const desde = window.scrollY;
      const tope = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const hasta = Math.min(Math.max(0, y), tope);
      const recorrido = hasta - desde;
      if (Math.abs(recorrido) < 2 || ms <= 0) { window.scrollTo(0, hasta); return resolve(); }

      // Una pestaña de fondo congela los fotogramas: el recorrido se quedaría
      // a medias y el guion entero esperando a que termine. Sin nadie mirando
      // tampoco hay nada que animar, así que se salta al final y a otra cosa.
      if (document.hidden) { window.scrollTo(0, hasta); return resolve(); }

      const empezo = performance.now();
      // Sale despacio y llega despacio: un recorrido a velocidad constante se
      // ve como una máquina, no como alguien mirando la página.
      const suave = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

      const paso = (ahora) => {
        if (document.hidden) { window.scrollTo(0, hasta); return resolve(); }
        const t = Math.min((ahora - empezo) / ms, 1);
        window.scrollTo(0, desde + recorrido * suave(t));
        if (t < 1 && corriendo) requestAnimationFrame(paso);
        else resolve();
      };
      requestAnimationFrame(paso);
    });
  }

  // Dónde empieza una sección, con un poco de aire por encima.
  function altoDe(sel, aire = 70) {
    const el = document.querySelector(sel);
    if (!el) return window.scrollY;
    return el.getBoundingClientRect().top + window.scrollY - aire;
  }

  // Deja algo centrado en la pantalla. Es la posición por defecto de la
  // cámara: casi todo lo que enseña la demostración se mira de una pieza —la
  // conversación, los tres planes, la banda roja del final— y dejarlo pegado
  // arriba con media pantalla vacía debajo se ve como un scroll que se quedó
  // a medias, no como una cámara que se paró donde quería.
  //
  // Con dos selectores centra el bloque entero que va del primero al segundo:
  // así los cuatro pasos y la cinta de materias, que son dos cosas pero se
  // cuentan juntas, caben centradas sin tener que elegir una.
  function centro(sel, hasta) {
    const el = document.querySelector(sel);
    if (!el) return window.scrollY;

    const r = el.getBoundingClientRect();
    let arriba = r.top;
    let alto = r.height;

    if (hasta) {
      const fin = document.querySelector(hasta);
      if (fin) {
        const rf = fin.getBoundingClientRect();
        alto = Math.max(alto, rf.bottom - arriba);
      }
    }

    return arriba + window.scrollY - Math.max(0, (window.innerHeight - alto) / 2);
  }

  // ---- Apagar y encender la portada ---------------------------------------

  // Todo lo que entra al asomarse vuelve a estar sin asomar. Es lo que permite
  // que la segunda vuelta se vea igual que la primera.
  function apagarEntradas() {
    document.querySelectorAll('[data-anim]').forEach(el => el.classList.remove('in'));
    document.querySelectorAll('.rb-step').forEach(el => {
      el.classList.remove('in', 'rb-cine-ahora');
    });
    document.querySelectorAll('.rb-showcase .rb-feature').forEach(el => el.classList.remove('show'));
  }

  // Al salir, la portada se queda como si nunca hubiera pasado nada: todo
  // encendido, que es como la deja el scroll normal.
  function encenderTodo() {
    document.querySelectorAll('[data-anim], .rb-step').forEach(el => el.classList.add('in'));
    document.querySelectorAll('.rb-showcase .rb-feature').forEach(el => el.classList.add('show'));
  }

  function encender(sel, retraso = 0) {
    document.querySelectorAll(sel).forEach((el, i) => {
      setTimeout(() => el.classList.add('in'), i * retraso);
    });
  }

  // ---- El cartel y la barra de progreso ------------------------------------

  function ponerHud() {
    hud = document.createElement('div');
    hud.className = 'rb-cine-hud';
    hud.innerHTML = '<i></i><span>Demostración de roboRobin</span><button type="button">Salir</button>';
    hud.querySelector('button').addEventListener('click', parar);
    document.body.appendChild(hud);

    // Pasada la entrada se le quita la animación: con animation-fill-mode
    // puesto, el cartel se queda congelado en la opacidad y la posición que
    // dejó la animación, y eso gana siempre a la transición con la que se
    // esconde y vuelve. A partir de aquí el cartel es solo CSS que transita.
    relojQuieto = setTimeout(() => {
      relojQuieto = null;
      if (hud) hud.classList.add('rb-cine-quieto');
    }, 900);

    esconderHudLuego();

    barra = document.createElement('div');
    barra.className = 'rb-cine-barra';
    barra.innerHTML = '<i></i>';
    document.body.appendChild(barra);
  }

  // ---- El cartel se quita de en medio --------------------------------------
  //
  // La barra de abajo no se esconde nunca: son tres píxeles que no tapan nada
  // y son lo único que dice, a mitad de una vuelta, cuánto falta para que la
  // demostración vuelva a empezar.

  function mostrarHud() {
    if (!hud) return;
    clearTimeout(relojHud);
    relojHud = null;
    hud.classList.remove('rb-cine-escondido');
  }

  // Se arma una sola vez: si cada movimiento del ratón reiniciara la cuenta,
  // bastaría con dejar el cursor temblando en una esquina para que el cartel
  // no se fuera nunca.
  function esconderHudLuego() {
    if (!hud || relojHud) return;
    relojHud = setTimeout(() => {
      relojHud = null;
      if (hud) hud.classList.add('rb-cine-escondido');
    }, ESPERA_HUD);
  }

  // Cerca del borde de arriba, el cartel vuelve; lejos, se va otra vez. La
  // franja es generosa a propósito: nadie tiene que acertarle al cartel, basta
  // con subir el ratón.
  document.addEventListener('pointermove', (e) => {
    if (!corriendo || !hud) return;
    if (e.clientY <= ZONA_HUD) mostrarHud();
    else esconderHudLuego();
  });

  // En una pantalla táctil no hay ratón que acercar, y sin el cartel no queda
  // botón de salir ni tecla Esc que pulsar. Un toque en cualquier sitio lo
  // devuelve.
  document.addEventListener('pointerdown', (e) => {
    if (!corriendo || !hud || e.pointerType === 'mouse') return;
    mostrarHud();
    esconderHudLuego();
  });

  // Cuánto falta para volver a empezar. Se mueve sola con una transición, así
  // que no hace falta tocarla en cada paso.
  function progreso(pct, ms) {
    if (!barra) return;
    const i = barra.firstElementChild;
    i.style.transition = ms ? `width ${ms}ms linear` : 'none';
    i.style.width = pct + '%';
  }

  // ---- Encender y apagar ---------------------------------------------------

  function arrancar() {
    if (corriendo || !esLaPortada()) return;
    corriendo = true;
    vuelta += 1;

    // A partir de aquí manda el guion: el observador de landing.js deja de
    // encender secciones por su cuenta (ver encender() allí).
    window.RB_CINE_MANDO = true;
    document.body.classList.add('rb-cine');
    ponerHud();
    window.scrollTo(0, 0);
    apagarEntradas();

    guion(vuelta);
  }

  function parar() {
    if (!corriendo) return;
    corriendo = false;
    vuelta += 1;                       // lo que estuviera a medias deja de ser suyo

    window.RB_CINE_MANDO = false;
    document.body.classList.remove('rb-cine');
    clearTimeout(relojHud); relojHud = null;
    clearTimeout(relojQuieto); relojQuieto = null;
    if (hud) { hud.remove(); hud = null; }
    if (barra) { barra.remove(); barra = null; }
    if (telon) { telon.remove(); telon = null; }

    // La cinta de materias y la conversación vuelven a su ritmo.
    const cinta = document.querySelector('.rb-marquee');
    if (cinta) cinta.classList.remove('rb-cine-pop');
    document.querySelectorAll('.rb-cine-visible').forEach(el => el.classList.remove('rb-cine-visible'));
    document.querySelectorAll('.rb-cine-mira').forEach(el => el.classList.remove('rb-cine-mira'));
    window.RB_CINE_LENTO = 1;

    // Las conversaciones vuelven a contarse en orden. Se cambia el modo sin
    // cortar la que esté en marcha: cortarla aquí sería un tirón justo en el
    // momento en que alguien acaba de pedir que esto pare.
    document.querySelectorAll('.rb-chat-log').forEach(log => {
      if (log.__rrChat) log.__rrChat.azar = false;
    });

    encenderTodo();
  }

  // ---- El guion ------------------------------------------------------------
  //
  // Una vuelta entera dura poco más de un minuto y acaba donde acaba la
  // portada: en «¿Listo para aprender con Robin?». Ahí se queda un momento y
  // vuelve arriba, y otra vez, sin parar.
  //
  // Los tiempos son generosos a propósito. Esto no se mira de cerca con el
  // ratón en la mano: se mira desde el otro lado de un salón.

  async function guion(n) {
    while (mia(n)) {
      // Con la pestaña de fondo no hay a quién enseñarle nada, y además el
      // navegador congela los fotogramas. La vuelta espera aquí hasta que
      // alguien vuelva a mirar, y entonces empieza desde el principio.
      while (mia(n) && document.hidden) await dormir(500);
      if (!mia(n)) return;

      progreso(0, 0);
      await unaVuelta(n);
      if (!mia(n)) return;

      // Vuelta arriba, sin prisa, y otra vez desde el principio.
      await irA(0, 2200);
      if (!(await esperar(600, n))) return;
      apagarEntradas();
      if (!(await esperar(400, n))) return;
    }
  }

  async function unaVuelta(n) {
    // ---- 1. El logo baja ---------------------------------------------------
    telon = document.createElement('div');
    telon.className = 'rb-cine-telon';
    telon.innerHTML = '<div class="rb-cine-logo">Robo<b>Robin</b></div>';
    document.body.appendChild(telon);
    progreso(100, DURA);

    if (!(await esperar(1700, n))) return;
    telon.firstElementChild.classList.add('baja');
    if (!(await esperar(700, n))) return;
    telon.classList.add('fuera');

    // ---- 2. El héroe se arma ----------------------------------------------
    // Las mismas entradas de siempre, en cascada: la pastilla, el título, el
    // texto, los botones, y Robin con sus tarjetas.
    encender('.rb-hero [data-anim]', 260);
    if (!(await esperar(900, n))) return;
    if (telon) { telon.remove(); telon = null; }
    if (!(await esperar(4200, n))) return;

    // ---- 3. Las funciones --------------------------------------------------
    if (!(await funciones(n))) return;

    // ---- 4. El camino de los pasos, con las materias ya puestas -----------
    if (!(await camino(n))) return;

    // ---- 5. La conversación, despacio -------------------------------------
    if (!(await conversacion(n))) return;

    // ---- 6. Los precios ----------------------------------------------------
    encender('.rb-prices .rb-section-head [data-anim]', 180);
    await irA(centro('.rb-price-grid'), 2400);
    encender('.rb-prices [data-anim]', 180);
    if (!(await esperar(4200, n))) return;

    // ---- 8. El final, y ahí se queda --------------------------------------
    const banda = document.querySelector('.rb-cta-band');
    await irA(centro('.rb-cta-band'), 2400);
    if (banda) { banda.classList.add('in', 'rb-cine-mira'); }
    if (!(await esperar(6500, n))) return;
    if (banda) banda.classList.remove('rb-cine-mira');
    return true;
  }

  // ---- Las funciones --------------------------------------------------------
  //
  // La zona de funciones se abre y suelta sus seis tarjetas a medida que el
  // carril alto pasa por la pantalla (ver initShowcase en landing.js). No hay
  // nada que encender a mano: lo único que hace falta es recorrer ese carril
  // entero, y cuánto mide se le pregunta a él — depende del alto de la
  // ventana, y con un número escrito a mano la mitad de las tarjetas se
  // quedarían sin salir en una pantalla alta.
  //
  // En una ventana angosta o baja el anclaje no existe (ver el @media de
  // landing.css): ahí las tarjetas se encienden una por una, porque el
  // observador que lo hacía normalmente ya gastó su único turno.
  async function funciones(n) {
    const carril = document.getElementById('rbShowcase');
    if (!carril) return true;

    const arriba = carril.getBoundingClientRect().top + window.scrollY;
    await irA(arriba, 2400);
    if (!(await esperar(600, n))) return false;

    const escenario = carril.querySelector('.rb-showcase-stage');
    const anclado = escenario && getComputedStyle(escenario).position === 'sticky';

    if (anclado) {
      const recorrido = Math.max(0, carril.getBoundingClientRect().height - window.innerHeight);
      await irA(arriba + recorrido, 7200);
      return await esperar(900, n);
    }

    const tarjetas = [...carril.querySelectorAll('.rb-feature')];
    for (const tarjeta of tarjetas) {
      if (!mia(n)) return false;
      tarjeta.classList.add('show');
      if (!(await esperar(520, n))) return false;
    }
    return await esperar(900, n);
  }

  // ---- El camino, con las materias ya puestas -------------------------------
  //
  // «01, 02, 03, 04» no salen juntos: sale uno, se dibuja la línea hasta el
  // siguiente, sale el siguiente. Cuatro tarjetas se convierten así en un
  // camino, que es lo que la sección dice con palabras.
  //
  // La cinta de materias se llena AL MISMO TIEMPO, no después. Antes tenía su
  // propia parada —la cámara bajaba otra vez y se quedaba esperando a que las
  // etiquetas fueran saliendo— y eso eran cinco segundos de pantalla quieta en
  // medio del recorrido. Ahora, cuando el camino llega al 04, las materias ya
  // están ahí: se vieron aparecer sin que nadie tuviera que esperarlas.
  //
  // Por eso la cámara se planta una sola vez, centrada en el bloque entero —el
  // título, los cuatro pasos y la cinta— y no se mueve hasta que termina lo de
  // aquí. Centrar solo los pasos dejaba el «¿Cómo funciona?» fuera de cuadro,
  // que es la frase que explica lo que se está viendo.
  async function camino(n) {
    await irA(centro('.rb-how .rb-section-head', '.rb-marquee'), 2200);
    if (!(await esperar(500, n))) return false;

    encender('.rb-how .rb-section-head [data-anim]', 140);
    if (!(await esperar(800, n))) return false;

    // Las materias van por su cuenta, sin esperar a nadie: se sueltan aquí y
    // se llenan mientras el camino se dibuja.
    materias(n);

    const pasos = [...document.querySelectorAll('.rb-how .rb-step')];
    for (const paso of pasos) {
      if (!mia(n)) return false;
      pasos.forEach(p => p.classList.remove('rb-cine-ahora'));
      paso.classList.add('in', 'rb-cine-ahora');
      if (!(await esperar(reduced ? 900 : 1250, n))) return false;
    }
    pasos.forEach(p => p.classList.remove('rb-cine-ahora'));
    return await esperar(1100, n);
  }

  // ---- Las materias ---------------------------------------------------------
  //
  // La cinta se para y se vacía; cada materia aparece de un saltito, una
  // detrás de otra; cuando terminan, la cinta arranca otra vez y sigue sola.
  //
  // Corre en paralelo al camino de los pasos (ver camino, arriba): nadie la
  // espera, y por eso aquí no se mueve la cámara ni se devuelve nada que le
  // sirva a nadie.
  //
  // Solo se encienden a mano las que caben en pantalla: el carril lleva el
  // contenido repetido varias veces (ver initMarquee en landing.js) y encender
  // doscientas etiquetas de una en una duraría más que la demostración entera.
  async function materias(n) {
    const cinta = document.querySelector('.rb-marquee');
    if (!cinta) return;

    cinta.classList.add('rb-cine-pop');
    cinta.classList.add('in');

    // Las dos filas se llenan a la vez, una materia de cada una por turno: si
    // se hiciera de corrido, la fila de arriba se llenaría entera mientras la
    // de abajo sigue vacía, y la cinta no parece una cinta hasta el final.
    //
    // Y de cada fila, solo las etiquetas que están dentro de la pantalla, en
    // el orden en que se leen. Dos razones: el carril lleva el contenido
    // repetido varias veces (ver initMarquee en landing.js) y encender
    // doscientas de una en una duraría más que la demostración entera; y la
    // fila de vuelta arranca desplazada —su animación va al revés— así que sus
    // primeras etiquetas del DOM están a mil píxeles a la izquierda. Yendo por
    // orden del DOM, la fila de abajo se quedaba vacía en pantalla.
    const filas = [...cinta.querySelectorAll('.rb-marquee-track')].map(carril =>
      [...carril.querySelectorAll('span')]
        .map(el => ({ el, x: el.getBoundingClientRect().left }))
        .filter(sitio => sitio.x > -90 && sitio.x < window.innerWidth)
        .sort((a, b) => a.x - b.x)
        .map(sitio => sitio.el));

    const porFila = Math.max(...filas.map(f => f.length), 0);

    const soltar = () => {
      cinta.classList.remove('rb-cine-pop');
      cinta.querySelectorAll('.rb-cine-visible').forEach(el => el.classList.remove('rb-cine-visible'));
    };

    for (let i = 0; i < porFila; i++) {
      // Si la demostración se apagó a mitad de la tanda, la cinta no se puede
      // quedar medio vacía: se suelta antes de irse.
      if (!mia(n)) return soltar();
      filas.forEach(fila => { if (fila[i]) fila[i].classList.add('rb-cine-visible'); });
      if (!(await esperar(reduced ? 240 : 190, n))) return soltar();
    }

    if (!(await esperar(700, n))) return soltar();
    soltar();   // vuelve a ser la cinta de siempre, corriendo sin parar
  }

  // ---- La conversación ------------------------------------------------------
  //
  // El guion del chat lo lleva landing.js y no se detiene nunca, así que al
  // llegar aquí la charla está por donde esté: a la mitad, o acabada y quieta
  // esperando el cambio de tema. Por eso lo primero que se hace al plantarse
  // delante es pedir una conversación NUEVA (rbChatDeNuevo), que además sale
  // al azar del guion: la demostración da vueltas, y con el orden de siempre
  // enseñaría una y otra vez la misma pregunta.
  //
  // Las dos pestañas se cuentan igual y las dos preguntan al azar. La de la
  // escuela no es una lista de funciones recitada: es alguien de dirección
  // preguntándole cosas a Robin, como en la personal.
  async function conversacion(n) {
    window.RB_CINE_LENTO = reduced ? 1.25 : 1.45;

    const marcar = () => {
      document.querySelectorAll('.rb-cine-mira').forEach(el => el.classList.remove('rb-cine-mira'));
      const chat = document.querySelector('.rb-panel.on .rb-chat');
      if (chat) chat.classList.add('rb-cine-mira');
    };

    // Una pestaña: plantarse delante, pedir charla nueva y dejar que se cuente.
    const contar = async (pestania, viaje) => {
      if (pestania) {
        // El botón es el mismo que se pulsa a mano, así que la píldora roja se
        // desliza como siempre.
        const boton = document.querySelector(`#rbTabs [data-tab="${pestania}"]`);
        if (boton) boton.click();
        if (!(await esperar(600, n))) return false;
      }

      await irA(centro('.rb-panel.on .rb-chat'), viaje);
      // El título y las pestañas se encienden al llegar, no antes: si no, la
      // cámara aterriza sobre una sección que ya terminó de entrar.
      encender('#escuelas [data-anim]', 160);
      marcar();

      const panel = document.querySelector('.rb-panel.on');
      if (typeof window.rbChatDeNuevo === 'function') window.rbChatDeNuevo(panel, { azar: true });

      return await esperar(14000, n);
    };

    if (!(await contar(null, 2400))) return false;
    if (!(await contar('escuelas', 1400))) return false;

    const botonPersonal = document.querySelector('#rbTabs [data-tab="personal"]');
    if (botonPersonal) botonPersonal.click();
    document.querySelectorAll('.rb-cine-mira').forEach(el => el.classList.remove('rb-cine-mira'));
    window.RB_CINE_LENTO = 1;
    return await esperar(700, n);
  }

})();
