// public/js/games-ui.js
// La galería de minijuegos y la pantalla de jugar.
//
// Jugar pasa en su propia ventana: una capa que tapa el panel entero —menú,
// cabecera, saludo y todo lo demás— y deja solo el reto.
//
//   izquierda  el reto, y nada más que el reto
//   derecha     Robin, que se lleva media pantalla, con lo que dice justo
//               debajo de él
//
// Robin ocupa la mitad a propósito: es el que acompaña, y a tamaño de icono no
// acompañaba nada. Lo que dice va DEBAJO, que es donde se mira después de
// mirarlo a él, y solo aparece cuando tiene algo que decir.
//
// Hay tres formas de contestar y las tres se califican en el servidor:
//
//   choice   cuatro botones
//   input    escribir la respuesta
//   build    armar con piezas — arrastrándolas o tocándolas. Es la de armar
//            la ecuación, formar la palabra, juntar los dos ingredientes de
//            una poción u ordenar las líneas de un programa.
//
// La respuesta correcta NO baja al navegador en ningún caso. En los retos de
// armar bajan las piezas, pero vienen revueltas y con sobrantes: tenerlas no
// dice en qué orden van.

function rrMountGames(container, { onUsage, standalone = false } = {}) {
  let catalogo = [];
  let dificultad = 2;
  let jugando = null;   // el minijuego abierto
  let reto = null;      // el reto en pantalla
  let arcade = null;    // la ventana de jugar, mientras está abierta
  // Se puede pedir abrir la galería antes de que el catálogo haya llegado
  // (basta con pulsar "Minijuegos" apenas carga el panel). Se anota y se abre
  // en cuanto llega, en vez de no hacer nada.
  let galeriaPendiente = false;
  let cargado = false;      // ya contestó /api/games al menos una vez

  container.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  const DIFICULTAD_LABEL = {
    1: 'Para empezar',
    2: 'Nivel primaria',
    3: 'Nivel secundaria',
    4: 'Nivel bachillerato'
  };

  // ---- La ventana de jugar -------------------------------------------------
  // Vive colgada del <body>, no del panel: así no hereda el ancho, el relleno
  // ni el scroll de la página que hay debajo.

  function abrirVentana() {
    if (arcade) return arcade;

    arcade = document.createElement('div');
    arcade.className = 'rr-arcade';
    arcade.innerHTML = `
      <header class="rr-arcade-top">
        <button class="rr-arcade-x" type="button" data-salir>← Salir</button>
        <div class="rr-arcade-title" id="rrArcadeTitle"></div>
        <div class="rr-arcade-streak" id="rrStreak"></div>
      </header>
      <div class="rr-arcade-body" id="rrArcadeBody"></div>`;

    document.body.appendChild(arcade);
    // Sin esto, la página de atrás sigue haciendo scroll debajo de la ventana.
    document.body.classList.add('rr-arcade-open');

    // Al cambiar el tamaño de la ventana vuelve a decidirse dónde cabe la
    // caja de preguntar: lo que entraba debajo del reto deja de entrar en
    // cuanto se baja la ventana a media pantalla.
    window.addEventListener('resize', colocarChatDelReto);

    arcade.addEventListener('click', (e) => {
      if (e.target.closest('[data-salir]')) cerrarVentana();
    });
    document.addEventListener('keydown', alPulsarEscape);

    return arcade;
  }

  function alPulsarEscape(e) {
    if (e.key !== 'Escape' || !arcade) return;
    // Dentro de un reto, Escape vuelve a la galería; en la galería, cierra.
    if (jugando) { jugando = null; reto = null; renderGalleryArcade(); }
    else cerrarVentana();
  }

  function cerrarVentana() {
    if (!arcade) return;
    document.removeEventListener('keydown', alPulsarEscape);
    window.removeEventListener('resize', colocarChatDelReto);
    arcade.remove();
    arcade = null;
    jugando = null;
    reto = null;
    chatReto = null;
    document.body.classList.remove('rr-arcade-open');
    if (standalone) document.dispatchEvent(new CustomEvent('rr:games-closed'));
    else renderGallery();
  }

  // ---- Galería -------------------------------------------------------------

  function galeriaHtml() {
    // En universidad el catálogo llega vacío a propósito (ver
    // availableGamesFor en src/db.js). Se dice por qué, en vez de enseñar una
    // rejilla vacía que parece un error.
    if (!catalogo.length) {
      return `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Aquí no hay minijuegos',
        text: 'En el nivel universitario los minijuegos no vienen al caso, así que no se muestran. Todo lo demás funciona igual: tus clases, tus pendientes y Robin.'
      })}</div>`;
    }

    const activos = catalogo.filter(g => g.enabled).length;
    return `
      <div class="rr-games-head">
        <div>
          <h2>Minijuegos</h2>
          <p>Uno por materia. La dificultad se ajusta sola a tu nivel: <strong>${rrEscapeHtml(DIFICULTAD_LABEL[dificultad] || '')}</strong>.</p>
        </div>
        <span class="rr-games-count">${activos} de ${catalogo.length} disponibles</span>
      </div>
      <div class="rr-game-grid">
        ${catalogo.map((g, i) => gameCard(g, i)).join('')}
      </div>`;
  }

  function wireGaleria(raiz) {
    raiz.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', () => abrir(btn.dataset.play));
    });
  }

  // La galería dentro de la página (el panel del estudiantado la lleva así,
  // debajo de sus clases).
  function renderGallery() {
    if (!catalogo.length) {
      container.innerHTML = galeriaHtml();
      return;
    }
    if (standalone) {
      container.innerHTML = `
        <div class="card rr-games-away">
          ${rrRobin('talking', 'rr-games-away-bird')}
          <div>
            <h3>Los minijuegos se abren en su propia pantalla</h3>
            <p>Para jugar sin el menú ni el resto del panel encima.</p>
            <button class="btn btn-primary" type="button" data-open-arcade>Abrir los minijuegos</button>
          </div>
        </div>`;
      const btn = container.querySelector('[data-open-arcade]');
      if (btn) btn.addEventListener('click', abrirGaleria);
      return;
    }
    container.innerHTML = galeriaHtml();
    wireGaleria(container);
  }

  // La galería dentro de la ventana de jugar.
  function renderGalleryArcade() {
    const caja = abrirVentana();
    caja.querySelector('#rrArcadeTitle').innerHTML = `
      <span class="ic">🎮</span>
      <div><strong>Minijuegos</strong><small>${rrEscapeHtml(DIFICULTAD_LABEL[dificultad] || '')}</small></div>`;
    caja.querySelector('#rrStreak').innerHTML = '';
    const cuerpo = caja.querySelector('#rrArcadeBody');
    cuerpo.className = 'rr-arcade-body gallery';
    cuerpo.innerHTML = `<div class="rr-arcade-gallery">${galeriaHtml()}</div>`;
    wireGaleria(cuerpo);
  }

  function abrirGaleria() {
    // Ya cargado y vacío (universidad): no hay ventana que abrir, se queda la
    // explicación en la propia página.
    if (cargado && !catalogo.length) { renderGallery(); return; }
    if (!catalogo.length) { galeriaPendiente = true; return; }
    galeriaPendiente = false;
    jugando = null;
    reto = null;
    renderGalleryArcade();
  }

  function gameCard(g, i) {
    const marca = g.score || {};
    const aciertos = marca.plays ? Math.round((marca.correct / marca.plays) * 100) : null;
    return `
      <article class="rr-game-card accent-${g.color} ${g.enabled ? '' : 'off'}" style="animation-delay:${i * 55}ms">
        <div class="rr-game-ic">${g.icon}</div>
        <span class="rr-game-subject">${rrEscapeHtml(g.subject)}</span>
        <h3>${rrEscapeHtml(g.name)}</h3>
        <p>${rrEscapeHtml(g.blurb)}</p>
        ${g.enabled ? `
          <div class="rr-game-stats">
            ${marca.plays ? `<span>${marca.correct}/${marca.plays} aciertos</span>` : '<span>Sin jugar todavía</span>'}
            ${marca.bestStreak ? `<span class="hot">🔥 récord ${marca.bestStreak}</span>` : ''}
            ${aciertos != null ? `<span>${aciertos}%</span>` : ''}
          </div>
          <button class="btn btn-sm btn-primary" data-play="${g.id}">Jugar</button>`
        : `
          <div class="rr-game-locked">
            🔒 Apagado por ${rrEscapeHtml(g.disabledBy || 'tu escuela')}
          </div>`}
      </article>`;
  }

  // ---- Jugar ---------------------------------------------------------------

  async function abrir(gameId) {
    jugando = catalogo.find(g => g.id === gameId);
    if (!jugando) return;
    renderBoard();
    await siguienteReto();
  }

  function renderBoard() {
    const caja = abrirVentana();
    const marca = jugando.score || {};

    caja.querySelector('#rrArcadeTitle').innerHTML = `
      <span class="ic">${jugando.icon}</span>
      <div>
        <strong>${rrEscapeHtml(jugando.name)}</strong>
        <small>${rrEscapeHtml(jugando.subject)} · ${rrEscapeHtml(DIFICULTAD_LABEL[dificultad] || '')}</small>
      </div>`;
    caja.querySelector('#rrStreak').innerHTML =
      `<strong>${marca.streak || 0}</strong><small>seguidas</small>`;

    const cuerpo = caja.querySelector('#rrArcadeBody');
    cuerpo.className = `rr-arcade-body playing accent-${jugando.color}`;
    cuerpo.innerHTML = `
      <section class="rr-arcade-play">
        <div class="rr-board-stage" id="rrStage">
          <div class="rr-loader"><div class="spinner"></div></div>
        </div>
        <div class="rr-board-actions">
          <button class="btn btn-sm btn-soft" id="rrHint">💡 Dame una pista</button>
          <button class="btn btn-sm btn-soft" id="rrSteps">🪜 Explícamelo paso a paso</button>
          <button class="btn btn-sm btn-ghost" id="rrSkip">Otro reto →</button>
          <button class="btn btn-sm btn-ghost" id="rrToGallery">Cambiar de juego</button>
        </div>
      </section>

      <!-- Robin se lleva media pantalla, y lo que dice va justo debajo de él:
           primero se le mira a él y después se lee. El globo solo aparece
           cuando tiene algo que decir. -->
      <div class="rr-buddy" id="rrBuddy">
        <span class="rr-buddy-bird" data-rr-galeria data-bob></span>
        <div class="rr-buddy-bubble" id="rrSay" hidden></div>
      </div>`;

    rrMountGalerias();
    montarChatDelReto();
    decir('Si te trabas, pídeme una pista y lo miramos juntos.');

    document.getElementById('rrHint').addEventListener('click', () => pedirAyuda('hint'));
    document.getElementById('rrSteps').addEventListener('click', () => pedirAyuda('steps'));
    document.getElementById('rrSkip').addEventListener('click', siguienteReto);
    document.getElementById('rrToGallery').addEventListener('click', abrirGaleria);
  }

  // ---- Preguntar sobre el reto ----------------------------------------------
  //
  // Debajo del reto sobraba media columna en blanco. Ahí va ahora una caja
  // para preguntar, y no es relleno: las pistas vienen escritas de antemano y
  // valen para el reto entero, pero la duda de quien está atascado casi nunca
  // es «dame una pista» — es «¿por qué el % da 1 y no 3.5?». Eso solo lo
  // contesta alguien a quien se le pueda preguntar.
  //
  // Dónde se pone depende de lo que ocupe el reto, que es lo que pidió tener
  // en cuenta quien lo usa:
  //
  //   si el reto deja sitio    debajo de él, donde están las preguntas
  //   si no lo deja (armar     al lado, debajo de Robin, que ahí siempre
  //   un programa, por ej.)    queda hueco bajo el pájaro
  //
  // Se decide midiendo después de pintar cada reto, no por el nombre del
  // juego: el mismo juego tiene retos cortos y retos largos.

  let chatReto = null;   // el elemento, se mueve de columna pero no se recrea
  let chatOcupado = false;

  function montarChatDelReto() {
    chatReto = document.createElement('div');
    chatReto.className = 'rr-arcade-chat';
    chatReto.innerHTML = `
      <div class="rr-ac-head">
        <span class="rr-ac-title">💬 Pregúntame sobre este reto</span>
        <button type="button" class="rr-ac-fold" data-fold aria-label="Plegar">−</button>
      </div>
      <div class="rr-ac-body" id="rrAcBody">
        <p class="rr-ac-empty">¿Por qué es así? ¿Y si fuera al revés? Lo que no entiendas del reto que tienes delante.</p>
      </div>
      <form class="rr-ac-form" id="rrAcForm">
        <input type="text" id="rrAcInput" autocomplete="off" placeholder="Escribe tu duda…" />
        <button type="submit" aria-label="Preguntar">➤</button>
      </form>`;

    chatReto.querySelector('[data-fold]').addEventListener('click', (e) => {
      chatReto.classList.toggle('folded');
      e.currentTarget.textContent = chatReto.classList.contains('folded') ? '+' : '−';
    });
    chatReto.querySelector('#rrAcForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const campo = document.getElementById('rrAcInput');
      const texto = campo.value.trim();
      if (!texto) return;
      campo.value = '';
      preguntarDelReto(texto);
    });

    colocarChatDelReto();
  }

  // Cuánto sitio le queda al reto por debajo. Si no llega para la caja, se va
  // al lado de Robin en vez de empujar los botones de ayuda fuera de la
  // pantalla — que es lo que pasaba con los retos de ordenar líneas de código.
  function colocarChatDelReto() {
    if (!chatReto) return;
    const play = document.querySelector('.rr-arcade-play');
    const buddy = document.getElementById('rrBuddy');
    const stage = document.getElementById('rrStage');
    const acciones = play && play.querySelector('.rr-board-actions');
    if (!play || !buddy || !stage) return;

    // En pantalla angosta no hay dos columnas: ahí siempre va debajo del reto,
    // que es la única que existe.
    const partida = window.matchMedia('(min-width: 901px)').matches;

    // Ojo con la medida: el propio .rr-board-stage lleva flex:1, así que su
    // altura es SIEMPRE la de la columna entera y no dice nada de lo que
    // ocupa el reto. Lo que hay que sumar es lo que hay dentro — el
    // enunciado, el código y las opciones — descontando la caja si ya está
    // puesta ahí, o se mediría a sí misma y acabaría rebotando de columna en
    // cada repintado.
    const dentro = [...stage.children]
      .filter(el => el !== chatReto)
      .reduce((alto, el) => alto + el.offsetHeight, 0);
    const reservado = acciones ? acciones.offsetHeight : 120;
    const sobra = play.clientHeight - dentro - reservado - 40;

    const alLado = partida && sobra < 230;
    const destino = alLado ? buddy : play;

    chatReto.classList.toggle('beside', alLado);
    // Con la caja al lado, Robin deja de llevarse todo el alto: si no, la
    // empuja fuera de su columna y se le monta encima.
    buddy.classList.toggle('with-chat', alLado);

    if (alLado) destino.appendChild(chatReto);
    else if (acciones) play.insertBefore(chatReto, acciones);
    else play.appendChild(chatReto);
  }

  async function preguntarDelReto(texto) {
    if (chatOcupado) return;
    chatOcupado = true;

    const cuerpo = document.getElementById('rrAcBody');
    const vacio = cuerpo.querySelector('.rr-ac-empty');
    if (vacio) vacio.remove();

    const mio = document.createElement('div');
    mio.className = 'rr-ac-msg user';
    mio.textContent = texto;
    cuerpo.appendChild(mio);

    const esperando = document.createElement('div');
    esperando.className = 'rr-ac-msg bot';
    esperando.innerHTML = rrLoadingHtml('Robin lo está mirando', { size: 'inline' });
    cuerpo.appendChild(esperando);
    cuerpo.scrollTop = cuerpo.scrollHeight;

    try {
      // El enunciado del reto va pegado a la pregunta: sin él, «¿por qué da
      // 1?» no significa nada, y Robin contestaría cualquier cosa.
      const data = await rrApi('/api/ai/chat', {
        method: 'POST',
        body: {
          message: reto
            ? `Estoy jugando a "${jugando.name}" (${jugando.subject}). El reto dice: «${reto.prompt}». Mi duda: ${texto}`
            : texto,
          context: 'game',
          gameId: jugando.id
        }
      });
      esperando.textContent = data.reply;
      if (data.usage && typeof rrUpdateUsage === 'function') rrUpdateUsage(data.usage);
      if (onUsage) onUsage(data.usage);
    } catch (err) {
      const p = err.payload || {};
      esperando.textContent = p.hint ? `${err.message} ${p.hint}` : `No pude contestarte: ${err.message}`;
      esperando.classList.add('limit');
    } finally {
      chatOcupado = false;
      cuerpo.scrollTop = cuerpo.scrollHeight;
    }
  }

  // Lo que Robin dice, en el globo de su esquina. Al hablar cambia también al
  // dibujo de estar hablando y da un saltito: si solo cambiara el texto, no se
  // notaría que reaccionó a lo que acabas de hacer.
  function decirHtml(html, tono = '') {
    const globo = document.getElementById('rrSay');
    if (!globo) return;
    globo.className = `rr-buddy-bubble ${tono}`;
    globo.innerHTML = html;
    globo.hidden = false;

    // Se reinicia la animación de entrada para que el globo se note también
    // cuando ya estaba abierto y solo cambia lo que pone.
    globo.classList.remove('rr-buddy-pop');
    void globo.offsetWidth;
    globo.classList.add('rr-buddy-pop');

    const esquina = globo.closest('.rr-buddy');
    if (esquina && typeof rrRobinHabla === 'function') rrRobinHabla(esquina);
  }

  function decir(texto, tono = '') {
    decirHtml(`<p>${rrEscapeHtml(texto)}</p>`, tono);
  }

  // Sin nada que decir, el globo se va y queda Robin solo en la esquina.
  function callar() {
    const globo = document.getElementById('rrSay');
    if (globo) globo.hidden = true;
  }

  // ---- Robin reacciona -----------------------------------------------------
  //
  // El globo ya decía «bien hecho» o «esta no era», pero el dibujo se quedaba
  // igual: Robin seguía parpadeando tan tranquilo mientras el texto de al lado
  // decía que habías fallado. Ahora la cara cambia con el resultado, que es lo
  // primero que se mira.
  //
  //   acierto  la pose de contento, un brinco y confeti saliendo de él
  //   fallo    la pose de triste, y el dibujo se sacude — la misma sacudida
  //            (rr-shake) que ya daba el botón equivocado, para que sea
  //            evidente que las dos cosas dicen lo mismo
  //
  // Es prestado, no permanente: a los pocos segundos vuelve a ser el Robin de
  // siempre, el que alterna entre estar tranquilo y estar hablando. Si se
  // quedara con la cara larga hasta el siguiente reto, el reproche duraría más
  // que el error.

  const RR_REACCION_MS = 3000;
  let reaccionVolver = null;

  function robinDeLaEsquina() {
    return document.querySelector('#rrBuddy .rr-buddy-bird');
  }

  // Devuelve a Robin a su estado normal: el de tranquilo, que vuelve a
  // reaccionar al clic. Se llama sola al rato, y también al pedir otro reto.
  function robinVuelveAlNido() {
    clearTimeout(reaccionVolver);
    reaccionVolver = null;
    const nido = robinDeLaEsquina();
    if (nido && typeof rrSetPose === 'function') rrSetPose(nido, '');
  }

  function robinReacciona(pose, { sacudir = false, festejar = false } = {}) {
    const nido = robinDeLaEsquina();
    if (!nido || typeof rrSetPose !== 'function') return;

    clearTimeout(reaccionVolver);
    rrSetPose(nido, pose);

    const img = nido.querySelector('img');
    if (img) {
      if (sacudir) {
        // Se quita y se vuelve a poner con un reflow en medio: si no, dos
        // fallos seguidos solo sacuden la primera vez.
        img.classList.remove('rr-robin-falla');
        void img.offsetWidth;
        img.classList.add('rr-robin-falla');
        // Al terminar la sacudida se quita la clase, y así Robin vuelve al
        // suspiro de la pose de triste en vez de quedarse tieso.
        img.addEventListener('animationend', function fin(e) {
          if (e.animationName !== 'rr-shake') return;
          img.classList.remove('rr-robin-falla');
          img.removeEventListener('animationend', fin);
        });
      }
      // El confeti sale del propio Robin y no del botón: es él quien celebra.
      if (festejar && typeof rrConfetti === 'function') rrConfetti(img);
    }

    reaccionVolver = setTimeout(robinVuelveAlNido, RR_REACCION_MS);
  }

  async function siguienteReto() {
    const stage = document.getElementById('rrStage');
    if (!stage) return;
    stage.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';
    callar();
    // Empezar un reto con la cara del reto anterior sería arrastrar el
    // resultado pasado a una pregunta que todavía no se ha leído.
    robinVuelveAlNido();

    try {
      const data = await rrApi(`/api/games/${jugando.id}/round`, { method: 'POST' });
      reto = data.round;
      pintarReto();
    } catch (err) {
      stage.innerHTML = rrEmptyState({ pose: 'sad', title: 'No pude traer el reto', text: rrEscapeHtml(err.message) });
    }
  }

  function pintarReto() {
    const stage = document.getElementById('rrStage');
    const { texto, codigo } = partirEnunciado(reto.prompt);

    stage.innerHTML = `
      <p class="rr-round-prompt">${rrEscapeHtml(texto)}</p>
      ${codigo ? `<pre class="rr-round-code">${resaltarHueco(codigo)}</pre>` : ''}
      ${reto.lead ? `<p class="rr-round-lead">${rrEscapeHtml(reto.lead)}</p>` : ''}
      <div id="rrRoundBody"></div>`;

    const cuerpo = document.getElementById('rrRoundBody');
    if (reto.kind === 'build') pintarArmado(cuerpo);
    else if (reto.kind === 'choice') pintarOpciones(cuerpo);
    else pintarEscribir(cuerpo);

    // El reto ya está pintado: ahora sí se puede medir cuánto ocupa y decidir
    // dónde cabe la caja de preguntar. En el mismo hilo la medida sale de
    // antes, así que se espera al siguiente repintado.
    requestAnimationFrame(colocarChatDelReto);
  }

  // Los retos de programación traen el enunciado y, tras una línea en blanco,
  // el programa. Iban los dos dentro del mismo <p>, y ahí los saltos de línea
  // no existen: un programa de cinco líneas salía como un renglón corrido e
  // ilegible, justo donde la sangría ES el ejercicio. Se separan y el código
  // va a su propio bloque, en monoespaciada y respetando los espacios.
  function partirEnunciado(prompt) {
    const corte = String(prompt || '').indexOf('\n\n');
    if (corte < 0) return { texto: prompt, codigo: '' };
    return {
      texto: prompt.slice(0, corte).trim(),
      codigo: prompt.slice(corte + 2).replace(/\s+$/, '')
    };
  }

  // El hueco de los retos de completar, marcado para que se vea. Se escapa
  // primero y se marca después: al revés, el propio código podría inyectar
  // etiquetas.
  function resaltarHueco(codigo) {
    return rrEscapeHtml(codigo).replace(/_{3,}/g, m => `<mark class="rr-blank">${m}</mark>`);
  }

  function pintarOpciones(cuerpo) {
    cuerpo.innerHTML = `
      <div class="rr-round-options">
        ${reto.options.map((o, i) => `
          <button class="rr-option" data-answer="${rrEscapeHtml(o)}" style="animation-delay:${i * 60}ms">
            <span class="k">${'ABCD'[i]}</span> ${rrEscapeHtml(o)}
          </button>`).join('')}
      </div>`;
    cuerpo.querySelectorAll('[data-answer]').forEach(btn => {
      btn.addEventListener('click', () => responder(btn.dataset.answer, btn));
    });
  }

  function pintarEscribir(cuerpo) {
    cuerpo.innerHTML = `
      <form class="rr-round-input" id="rrAnswerForm">
        <input type="text" id="rrAnswerInput" autocomplete="off" placeholder="Escribe tu respuesta…" />
        <button type="submit" class="btn btn-primary">Comprobar</button>
      </form>`;
    const form = document.getElementById('rrAnswerForm');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('rrAnswerInput');
      if (input.value.trim()) responder(input.value, input);
    });
    document.getElementById('rrAnswerInput').focus();
  }

  // ---- Los retos de armar con piezas ---------------------------------------
  // Hay una fila de huecos arriba y un montón de piezas abajo. Una pieza se
  // coloca arrastrándola a un hueco o, si no, tocándola — en una tableta o un
  // teléfono arrastrar es incómodo, y no puede ser que el reto sea la mano en
  // vez de la materia.
  //
  // Nada se comprueba hasta que están todos los huecos llenos, y siempre se
  // puede sacar una pieza y volver a intentarlo: equivocarse de sitio no
  // cuesta el turno.

  function pintarArmado(cuerpo) {
    const total = reto.slots;
    const pegadas = reto.join === '';
    // Una línea de programa o un paso de un algoritmo no cabe en una ficha del
    // ancho de un número: cuando las piezas son largas, se apilan a lo alto y
    // cada una ocupa su propia fila, respetando su sangría.
    const largas = reto.pieces.some(p => String(p).length > 16 || /^\s/.test(String(p)));

    cuerpo.innerHTML = `
      <div class="rr-build ${pegadas ? 'tight' : ''} ${largas ? 'lines' : ''} ${reto.unordered ? 'unordered' : ''}">
        <div class="rr-build-slots" id="rrSlots">
          ${Array.from({ length: total }, (_, i) =>
            `<span class="rr-build-slot" data-slot="${i}"></span>`).join('')}
        </div>
        <div class="rr-build-bank" id="rrBank">
          ${reto.pieces.map((p, i) =>
            `<button type="button" class="rr-build-piece" draggable="true"
                     data-piece="${i}" style="animation-delay:${i * 40}ms">${rrEscapeHtml(p)}</button>`).join('')}
        </div>
        <div class="rr-build-actions">
          <button type="button" class="btn btn-sm btn-ghost" id="rrBuildClear">Vaciar</button>
          <button type="button" class="btn btn-primary" id="rrBuildCheck" disabled>Comprobar</button>
        </div>
      </div>`;

    const slots = [...cuerpo.querySelectorAll('.rr-build-slot')];
    const bank = cuerpo.querySelector('#rrBank');
    const check = cuerpo.querySelector('#rrBuildCheck');
    // Qué pieza (por su índice en el montón) está en cada hueco.
    const puestas = new Array(total).fill(null);

    const piezaDe = i => cuerpo.querySelector(`[data-piece="${i}"]`);

    function refrescar() {
      slots.forEach((slot, i) => {
        const idx = puestas[i];
        slot.classList.toggle('filled', idx != null);
        slot.textContent = idx == null ? '' : reto.pieces[idx];
        slot.dataset.piece = idx == null ? '' : String(idx);
      });
      reto.pieces.forEach((_, i) => {
        const el = piezaDe(i);
        if (el) el.classList.toggle('used', puestas.includes(i));
      });
      check.disabled = puestas.some(p => p == null);
    }

    function colocar(indicePieza, enSlot) {
      if (puestas.includes(indicePieza)) return;
      const hueco = enSlot != null && puestas[enSlot] == null
        ? enSlot
        : puestas.indexOf(null);
      if (hueco < 0) return;
      puestas[hueco] = indicePieza;
      refrescar();
    }

    function sacar(slot) {
      if (puestas[slot] == null) return;
      puestas[slot] = null;
      refrescar();
    }

    // Tocar: la pieza va al primer hueco libre; tocar un hueco lleno la devuelve.
    bank.addEventListener('click', (e) => {
      const pieza = e.target.closest('[data-piece]');
      if (pieza) colocar(Number(pieza.dataset.piece), null);
    });
    slots.forEach((slot, i) => {
      slot.addEventListener('click', () => sacar(i));
    });

    // Arrastrar: el mismo resultado, para quien prefiera la mano.
    cuerpo.querySelectorAll('.rr-build-piece').forEach(pieza => {
      pieza.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', pieza.dataset.piece);
        e.dataTransfer.effectAllowed = 'move';
        pieza.classList.add('dragging');
      });
      pieza.addEventListener('dragend', () => pieza.classList.remove('dragging'));
    });
    slots.forEach((slot, i) => {
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('over');
        const idx = Number(e.dataTransfer.getData('text/plain'));
        if (Number.isInteger(idx)) colocar(idx, i);
      });
    });

    cuerpo.querySelector('#rrBuildClear').addEventListener('click', () => {
      puestas.fill(null);
      refrescar();
    });

    check.addEventListener('click', () => {
      const respuesta = puestas.map(i => reto.pieces[i]);
      responder(respuesta, cuerpo.querySelector('.rr-build-slots'));
    });

    refrescar();
  }

  // ---- Contestar -----------------------------------------------------------

  async function responder(answer, el) {
    const stage = document.getElementById('rrStage');
    stage.querySelectorAll('button, input').forEach(b => { b.disabled = true; });

    try {
      const data = await rrApi(`/api/games/${jugando.id}/answer`, { method: 'POST', body: { answer } });
      jugando.score = data.score;
      const streak = document.getElementById('rrStreak');
      if (streak) streak.innerHTML = `<strong>${data.score.streak}</strong><small>seguidas</small>`;

      if (data.correct) {
        el.classList.add('right');
        rrConfetti(el);
        robinReacciona('happy', { festejar: true });
        decirHtml(`
          <p><strong>${rrEscapeHtml(data.message)}</strong></p>
          <button class="btn btn-sm btn-primary" id="rrNext">Siguiente reto →</button>`, 'ok');
        const next = document.getElementById('rrNext');
        if (next) next.addEventListener('click', siguienteReto);
      } else if (dificultad >= 4) {
        // Bachillerato: un fallo y se pasa al siguiente. A esa edad reintentar
        // el mismo reto hasta acertar se convierte en probar opciones, no en
        // resolverlo; y el que se equivoca ya sabe que se equivocó.
        el.classList.add('wrong');
        robinReacciona('sad', { sacudir: true });
        // El mensaje del servidor ("vuelve a mirarlo con calma") invita a
        // reintentar, y aquí no se va a poder: se dice otra cosa, o el aviso
        // se contradice con el botón que hay debajo.
        decirHtml(`
          <p><strong>Esta no era.</strong></p>
          <p class="rr-buddy-small">En bachillerato cada reto es uno solo: si falla, se pasa al siguiente. Si quieres entenderlo antes de seguir, pídeme el paso a paso.</p>
          <button class="btn btn-sm btn-primary" id="rrNext">Siguiente reto →</button>`, 'no');
        const next = document.getElementById('rrNext');
        if (next) next.addEventListener('click', siguienteReto);
      } else {
        el.classList.add('wrong');
        robinReacciona('sad', { sacudir: true });
        setTimeout(() => el.classList.remove('wrong'), 500);
        // Hasta secundaria el reto sigue abierto: se vuelve a habilitar todo
        // menos lo que ya se probó, y no se pierde el turno por equivocarse.
        stage.querySelectorAll('button, input').forEach(b => {
          if (b !== el) b.disabled = false;
        });
        if (el.tagName === 'INPUT') { el.disabled = false; el.select(); }
        decir(data.message, 'no');
      }
    } catch (err) {
      rrToast(err.message, 'error');
      stage.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    }
  }

  async function pedirAyuda(nivel) {
    const boton = document.getElementById(nivel === 'hint' ? 'rrHint' : 'rrSteps');
    boton.disabled = true;

    try {
      const data = await rrApi(`/api/games/${jugando.id}/help`, { method: 'POST', body: { level: nivel } });
      if (data.usage && typeof rrUpdateUsage === 'function') rrUpdateUsage(data.usage);
      if (onUsage) onUsage(data.usage);

      decirHtml(`
        <em>${rrEscapeHtml(data.intro)}</em>
        ${data.hint ? `<p>${rrEscapeHtml(data.hint)}</p>` : ''}
        ${data.steps ? `<ol>${data.steps.map(s => `<li>${rrEscapeHtml(s)}</li>`).join('')}</ol>` : ''}
        <small>Te quedan ${data.usage.gameHints.unlimited ? 'pistas sin límite' : `${data.usage.gameHints.left} pista${data.usage.gameHints.left === 1 ? '' : 's'}`} hoy.</small>`, 'help');
    } catch (err) {
      // Quedarse sin pistas no es un error: es el límite del plan, y se explica.
      const p = err.payload || {};
      decirHtml(`
        <strong>${rrEscapeHtml(p.error || err.message)}</strong>
        <p>${rrEscapeHtml(p.hint || '')}</p>
        ${p.upgrade ? '<button class="btn btn-sm btn-primary" id="rrGoPlans">Ver los planes</button>' : ''}`, 'limit');
      const go = document.getElementById('rrGoPlans');
      if (go) go.addEventListener('click', () => { cerrarVentana(); rrShowSection('plans'); });
    } finally {
      boton.disabled = false;
    }
  }

  // ---- Arranque ------------------------------------------------------------

  async function reload() {
    try {
      const data = await rrApi('/api/games');
      catalogo = data.games;
      dificultad = data.difficulty;
      cargado = true;
      if (galeriaPendiente) {
        abrirGaleria();
      } else if (jugando) {
        jugando = catalogo.find(g => g.id === jugando.id) || null;
        if (!jugando) abrirGaleria();
      } else if (arcade) {
        renderGalleryArcade();
      } else {
        renderGallery();
      }
    } catch (err) {
      container.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'sad', title: 'No pude traer los minijuegos', text: rrEscapeHtml(err.message)
      })}</div>`;
    }
  }

  reload();
  return { reload, abrir, abrirGaleria, cerrar: cerrarVentana };
}

// ---------------------------------------------------------------------------
// El panel de quien decide qué minijuegos quedan encendidos.
// Lo usa el profesorado (por clase) y la dirección (para toda la escuela).
// ---------------------------------------------------------------------------

function rrMountGameSettings(container, { scope, scopeId, title, lead }) {
  container.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  async function render() {
    try {
      const { games } = await rrApi(`/api/games/settings/${scope}/${scopeId}`);
      container.innerHTML = `
        <div class="rr-section-title"><h3>${rrEscapeHtml(title)}</h3></div>
        <p class="rr-section-lead">${rrEscapeHtml(lead)}</p>
        <div class="rr-toggle-list">
          ${games.map(g => `
            <label class="rr-toggle-row ${g.enabled ? '' : 'off'}">
              <span class="ic">${g.icon}</span>
              <span class="txt">
                <strong>${rrEscapeHtml(g.name)}</strong>
                <small>${rrEscapeHtml(g.subject)}</small>
              </span>
              <input type="checkbox" data-game="${g.id}" ${g.enabled ? 'checked' : ''} />
              <span class="rr-switch"></span>
            </label>`).join('')}
        </div>`;

      container.querySelectorAll('[data-game]').forEach(input => {
        input.addEventListener('change', async () => {
          input.disabled = true;
          try {
            await rrApi(`/api/games/settings/${scope}/${scopeId}`, {
              method: 'PUT',
              body: { gameId: input.dataset.game, enabled: input.checked }
            });
            input.closest('.rr-toggle-row').classList.toggle('off', !input.checked);
            rrToast(input.checked ? 'Minijuego encendido.' : 'Minijuego apagado.', 'success');
          } catch (err) {
            input.checked = !input.checked;
            rrToast(err.message, 'error');
          } finally {
            input.disabled = false;
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'sad', title: 'No pude cargar la configuración', text: rrEscapeHtml(err.message)
      })}</div>`;
    }
  }

  render();
  return { reload: render };
}
