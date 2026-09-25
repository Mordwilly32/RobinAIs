// public/js/enfoque.js
// ---------------------------------------------------------------------------
// El modo enfocado: una sola pantalla, y no se sale de ahí.
//
//   /-/robinAI       solo el chat con Robin
//   /-/minijuegos    solo los minijuegos
//
// Es el panel de siempre —el mismo archivo, la misma sesión, los mismos
// datos— pero sin menú lateral, sin las demás secciones y sin ningún botón,
// enlace ni atajo que lleve a otra parte. Quien esté delante puede usar esa
// cosa y nada más.
//
// Para qué sirve: dejar la pantalla puesta en una exposición, o la tablet del
// aula delante de alguien. Con el panel entero abierto, en dos clics se llega
// a la configuración de la cuenta y en tres se cierra la sesión.
//
// Qué se cierra, exactamente
// --------------------------
//   · la barra lateral no se dibuja               (ver rrRenderShell)
//   · cambiar de sección no hace nada             (ver rrShowSection)
//   · los enlaces que se van de la página no van  (el clic de aquí abajo)
//   · el botón de atrás vuelve donde estaba       (el popstate de aquí abajo)
//   · en los minijuegos no hay «Salir» ni Escape  (ver games-ui.js)
//
// Salir es cosa de quien puso la pantalla: se teclea otra dirección o se
// cierra la pestaña. Esa es la idea — no hay puerta desde dentro.
//
// Lo que NO es esto: un candado de seguridad. Quien sepa escribir en la barra
// de direcciones entra al panel entero, porque su sesión es la misma de
// siempre. Esto ordena una pantalla, no protege una cuenta; lo que protege
// cuentas está en el servidor y no se mueve de ahí.
// ---------------------------------------------------------------------------

// Las dos pantallas, y qué sección del panel es cada una. La clave es lo que
// viene después de /-/ en la dirección, en minúsculas: el servidor ya se
// encargó de que solo llegue escrita de una forma (ver routes/paginas.js).
const RR_ENFOQUES = {
  robinai: {
    seccion: 'chat',
    titulo: 'RobinAI',
    sub: 'Pregúntale lo que estés estudiando'
  },
  minijuegos: {
    seccion: 'games',
    titulo: 'Minijuegos',
    sub: 'Uno por materia, al nivel que te toca'
  }
};

// Cuál está abierto, o null si esto es el panel normal. Se calcula una vez: la
// dirección no cambia mientras la pestaña esté abierta, y todo el resto del
// código pregunta por esto muchas veces.
const RR_ENFOQUE = (() => {
  const partes = window.location.pathname.split('/').filter(Boolean);
  if (partes[0] !== '-') return null;
  const modo = RR_ENFOQUES[String(partes[1] || '').toLowerCase()];
  return modo ? Object.assign({ id: String(partes[1]).toLowerCase() }, modo) : null;
})();

function rrEnfocado() { return RR_ENFOQUE; }

// ¿Esta sección es la que toca? En el panel normal, todas.
function rrSeccionPermitida(target) {
  return !RR_ENFOQUE || target === RR_ENFOQUE.seccion;
}

// ---------------------------------------------------------------------------
// Cerrar las salidas
// ---------------------------------------------------------------------------

// Un enlace que se va de esta dirección no se sigue. Se mira en la fase de
// captura para llegar antes que cualquier manejador de la página, y se
// compara la dirección ya resuelta por el navegador: así «/guia», «../guia» y
// «https://…/guia» se tratan igual, que es lo que un href puede ser.
//
// Lo que sí se deja pasar:
//   · los anclas de la misma página (#algo), que no son irse
//   · lo que abre otra pestaña (target="_blank"), que no se lleva esta
//   · las descargas, que tampoco navegan
function rrCerrarEnlaces() {
  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('a[href]');
    if (!enlace) return;
    if (enlace.target === '_blank' || enlace.hasAttribute('download')) return;

    const destino = new URL(enlace.href, window.location.href);
    if (destino.origin === window.location.origin &&
        destino.pathname === window.location.pathname) return;  // un ancla

    e.preventDefault();
    e.stopPropagation();
    if (typeof rrToast === 'function') {
      rrToast('Esta pantalla es solo ' + RR_ENFOQUE.titulo + '.', 'info');
    }
  }, true);
}

// El botón de atrás. Se deja una entrada de sobra en el historial y, cuando
// alguien la gasta, se pone otra: el navegador se queda dando vueltas en esta
// dirección en vez de volver a donde estuviera antes.
//
// Es lo único que se puede hacer sin pedirle permiso a nadie — un navegador no
// deja quitar el botón de atrás, y con razón.
function rrCerrarElAtras() {
  history.pushState({ rrEnfoque: RR_ENFOQUE.id }, '', window.location.href);
  window.addEventListener('popstate', () => {
    history.pushState({ rrEnfoque: RR_ENFOQUE.id }, '', window.location.href);
  });
}

// La cabecera propia de la pantalla: un renglón que dice qué es esto, y el
// saludo del panel se esconde (lo hace el CSS, ver body.rr-enfocado).
//
// Se pone una cabecera nueva en vez de reescribir la del panel porque la del
// panel no es de nadie: personal.js le mete «Buenas noches, fulano» justo
// después de montar la barra, y updateSubtitle() le cambia el subtítulo cada
// vez que se recarga la lista de pendientes. Escribir ahí es escribir en la
// arena — al segundo siguiente lo pisa otro.
function rrCabeceraEnfocada() {
  const main = document.querySelector('.rr-main');
  if (!main || document.getElementById('rrEnfoqueTop')) return;

  const barra = document.createElement('div');
  barra.className = 'rr-enfoque-top';
  barra.id = 'rrEnfoqueTop';
  barra.innerHTML = `
    <strong>${RR_ENFOQUE.titulo}</strong>
    <small>${RR_ENFOQUE.sub}</small>`;
  main.insertBefore(barra, main.firstChild);
}

// Este panel, ¿tiene la sección que pide la dirección?
//
// /-/minijuegos en la cuenta de un profesor, por ejemplo: su panel no lleva
// minijuegos, así que no hay nada que enseñar. Se dice, en vez de dejar una
// pantalla en blanco que parece que se rompió.
function rrEnfoqueImposible() {
  if (!RR_ENFOQUE) return false;
  if (document.getElementById('section-' + RR_ENFOQUE.seccion)) return false;

  // Lo primero: apagar TODAS las secciones. Cada panel arranca con una puesta
  // desde el HTML —la de Cuentas en el de dirección— y como aquí no se va a
  // llamar a rrShowSection, esa se quedaba en pantalla. O sea: se pedía
  // /-/minijuegos y salía la pantalla de códigos de ingreso de la escuela,
  // que es justo lo contrario de para lo que existe el modo enfocado.
  document.querySelectorAll('.rr-section').forEach(s => { s.style.display = 'none'; });

  const main = document.querySelector('.rr-main');
  if (main) {
    const aviso = document.createElement('div');
    aviso.className = 'card';
    aviso.innerHTML = typeof rrEmptyState === 'function'
      ? rrEmptyState({
          pose: 'ghost',
          title: 'Aquí no hay ' + RR_ENFOQUE.titulo,
          text: 'Esta cuenta no tiene esa pantalla. Abre tu panel y verás lo que sí te toca.'
        })
      : '<p>Esta cuenta no tiene esa pantalla.</p>';
    main.appendChild(aviso);
  }
  return true;
}

// Lo que se llama una vez, desde rrRenderShell, cuando la pantalla está puesta.
function rrMontarEnfoque() {
  if (!RR_ENFOQUE) return;
  document.body.classList.add('rr-enfocado', 'rr-enfoque-' + RR_ENFOQUE.id);
  rrCabeceraEnfocada();
  rrCerrarEnlaces();
  rrCerrarElAtras();
}
