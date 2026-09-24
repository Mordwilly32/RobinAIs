// public/js/loading.js
// La espera, en un solo sitio.
//
// La animación es la de /loading/style.css — el aro de asistencia wapp.html,
// copiado tal cual. Aquí NO se dibuja ninguna otra: lo único que hace este
// archivo es montar y quitar el marcado que esa hoja de estilo espera, que es
// exactamente este:
//
//   <div class="loading">
//     <div class="spinner"></div>
//     <div id="loadingText">…</div>
//   </div>
//
// Tres formas de usarla, de menos a más intrusiva:
//
//   rrLoadingHtml('Guardando')          el aro pequeño con su texto al lado,
//                                       para meterlo dentro de un botón o una
//                                       tarjeta que se está llenando.
//   rrLoadingIn(elemento, 'Buscando')   lo mismo, ya puesto, con mando para
//                                       cambiarle el texto.
//   rrLoading('Probando tu clave')      el velo de pantalla completa, tal como
//                                       está en tu archivo, con Robin esperando
//                                       encima del aro.
//
// El texto NO es opcional a propósito: una espera sin rótulo es la que se
// siente eterna.

// El aro solo, sin velo. Los tamaños (sm, xs) cambian nada más que el ancho,
// el alto y el grosor — ver el final de /loading/style.css.
function rrSpinnerHtml(size = 'sm') {
  return `<div class="spinner ${size}"></div>`;
}

// La espera en línea: aro pequeño + texto. Sirve para un botón, una fila o
// una tarjeta a medio llenar.
function rrLoadingHtml(text = 'Un momento…', { size = 'sm' } = {}) {
  // 'inline' era el nombre del tamaño en la versión anterior; se acepta para
  // que nada de lo que ya estaba escrito se quede sin aro.
  const aro = size === 'inline' || size === 'xs' ? 'xs' : 'sm';
  return `
    <span class="rr-wait" role="status" aria-live="polite">
      ${rrSpinnerHtml(aro)}
      <span class="rr-wait-text">${rrEscapeHtml(text)}</span>
    </span>`;
}

// La espera dentro de un elemento concreto. Devuelve con qué cambiarle el
// texto sin volver a pintarla: repintarla reiniciaría el giro y el aro daría
// un salto en cada paso.
function rrLoadingIn(el, text = 'Un momento…', opciones = {}) {
  if (!el) return { say() {}, close() {} };
  el.innerHTML = `<div class="rr-wait-box">${rrLoadingHtml(text, opciones)}</div>`;
  const rotulo = el.querySelector('.rr-wait-text');
  return {
    say(nuevo) { if (rotulo) rotulo.textContent = nuevo; },
    close() { el.innerHTML = ''; }
  };
}

// El botón que está guardando algo. Devuelve la función que lo deja como
// estaba, texto incluido — que es justo lo que se olvida escribir en la rama
// del error.
function rrBusyButton(btn, text = 'Guardando') {
  if (!btn) return () => {};
  const antes = btn.innerHTML;
  const ancho = btn.offsetWidth;

  // Se le fija el ancho que tenía: si no, el botón encoge o crece al cambiar
  // el texto y la fila de al lado da un salto.
  if (ancho) btn.style.minWidth = `${ancho}px`;
  btn.disabled = true;
  btn.innerHTML = rrLoadingHtml(text);

  return () => {
    btn.disabled = false;
    btn.innerHTML = antes;
    btn.style.minWidth = '';
  };
}

// ---- El velo de pantalla completa ------------------------------------------
// Este es tu bloque tal cual: .loading con el .spinner dentro y el
// #loadingText debajo. Para lo que no se puede dejar a medias — probar una
// clave de la API, traducir un documento, guardar la foto de alguien.

let rrVeilAbierto = null;

function rrLoading(text = 'Un momento…', { sub = '' } = {}) {
  // Dos esperas encima de la otra no tienen sentido: la segunda se queda con
  // el cartel y la primera deja de mandar.
  if (rrVeilAbierto) rrVeilAbierto.close(true);

  const veil = document.createElement('div');
  veil.className = 'loading';
  // Robin esperando, encima del aro. Es la pose neutra a propósito: el velo
  // tapa la pantalla entera y todavía no se sabe si esto va a salir bien o
  // mal, así que el pajarito no celebra ni se lamenta — solo acompaña.
  // Si mascot.js no está cargado (el velo también lo usan páginas sueltas),
  // se queda el aro solo y ya.
  const robin = typeof rrRobin === 'function' ? rrRobin('idle', 'rr-wait-robin') : '';
  veil.innerHTML = `
    ${robin}
    <div class="spinner"></div>
    <div id="loadingText">${rrEscapeHtml(text)}</div>
    <div class="rr-wait-sub"${sub ? '' : ' hidden'}>${rrEscapeHtml(sub)}</div>`;
  document.body.appendChild(veil);

  const rotulo = veil.querySelector('#loadingText');
  const subtitulo = veil.querySelector('.rr-wait-sub');
  let cerrado = false;

  const mando = {
    say(nuevo, nuevoSub) {
      if (rotulo) rotulo.textContent = nuevo;
      if (nuevoSub !== undefined && subtitulo) {
        subtitulo.textContent = nuevoSub;
        subtitulo.hidden = !nuevoSub;
      }
      return mando;
    },
    // Se conserva por compatibilidad con quien la llamaba con pasos; la
    // animación de tu archivo no lleva barra de progreso y no se le añade
    // ninguna.
    step() { return mando; },
    close() {
      if (cerrado) return;
      cerrado = true;
      if (rrVeilAbierto === mando) rrVeilAbierto = null;
      veil.remove();
    }
  };

  rrVeilAbierto = mando;
  return mando;
}

// Envuelve una promesa con el velo puesto: se cierra sola pase lo que pase,
// también si la promesa revienta. Sin esto, un error a mitad deja la pantalla
// bloqueada para siempre — el peor final posible para una espera.
async function rrWithLoading(text, trabajo, opciones = {}) {
  const espera = rrLoading(text, opciones);
  try {
    return await trabajo(espera);
  } finally {
    espera.close();
  }
}
