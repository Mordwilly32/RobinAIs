// Envuelto por tools/build-pages.js: esta pantalla se vuelve a ejecutar
// entera cada vez que se regresa a ella, sin recargar el documento.
RRPagina.pantalla(new URL(document.currentScript.src).pathname, function () {
// public/js/peques.js
// ---------------------------------------------------------------------------
// La pantalla de los más peques.
//
// Tres pantallas y ni una más: el inicio (Robin y dos botones grandes), los
// juegos, y el de hablar con Robin. No hay menú, no hay secciones, no hay
// nada que leer para saber dónde pulsar.
//
// Quién ve qué:
//   Parvularia        solo juegos. A esa edad escribir todavía estorba.
//   1.º a 3.º grado   juegos y, además, hablar con Robin.
//
// Robin lee en voz alta lo que contesta, si el navegador sabe hacerlo. Para
// quien aún no lee de corrido, esa es la diferencia entre poder usarlo y no.
// ---------------------------------------------------------------------------

let kid = null;
let puedeChatear = false;
let juegos = [];
let jugando = null;
let reto = null;

const stage = () => document.getElementById('kidStage');

// ---- Voz -------------------------------------------------------------------
// Las dos cosas son del navegador, no de roboRobin: si no están, todo lo demás
// sigue funcionando igual, solo que escribiendo y leyendo.

function hablar(texto) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = 'es-ES';
    voz.rate = 0.95;   // un poco más lento: se entiende mejor
    voz.pitch = 1.15;  // un poco más agudo: suena a Robin, no a locutor
    window.speechSynthesis.speak(voz);
  } catch { /* si el navegador no quiere, no pasa nada */ }
}

function hayMicrofono() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function escuchar(onTexto, onFin) {
  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocimiento) return null;

  const rec = new Reconocimiento();
  rec.lang = 'es-ES';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => onTexto(e.results[0][0].transcript);
  rec.onerror = () => onFin();
  rec.onend = () => onFin();
  rec.start();
  return rec;
}

// ---- Piezas de pantalla ----------------------------------------------------

function burbuja(texto) {
  return `
    ${rrRobin('talking', 'rr-kids-robin')}
    <div class="rr-kids-bubble">${rrEscapeHtml(texto)}</div>`;
}

function volverBtn() {
  return '<button class="btn btn-soft" id="kidBack" style="margin-top:26px">← Volver</button>';
}

function wireVolver() {
  const b = document.getElementById('kidBack');
  if (b) b.addEventListener('click', inicio);
}

// ---- Pantalla 1: el inicio -------------------------------------------------

function inicio() {
  jugando = null;
  reto = null;
  const nombre = kid.fullName.split(' ')[0];
  const saludo = `¡Hola, ${nombre}! ¿Qué quieres hacer?`;

  stage().innerHTML = `
    ${burbuja(saludo)}
    <div class="rr-kids-actions">
      <button class="rr-kids-btn" id="kidGames">
        <span class="ic">🎮</span>
        Jugar
      </button>
      ${puedeChatear ? `
        <button class="rr-kids-btn" id="kidTalk">
          <span class="ic">💬</span>
          Hablar con Robin
        </button>` : ''}
    </div>`;

  rrWireMascotLife();
  hablar(saludo);

  document.getElementById('kidGames').addEventListener('click', pantallaJuegos);
  const talk = document.getElementById('kidTalk');
  if (talk) talk.addEventListener('click', pantallaHablar);
}

// ---- Pantalla 2: los juegos ------------------------------------------------

async function pantallaJuegos() {
  stage().innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';
  try {
    const data = await rrApi('/api/games');
    juegos = data.games;
  } catch {
    stage().innerHTML = burbuja('Ahora no puedo abrir los juegos. ¡Prueba en un ratito!') + volverBtn();
    wireVolver();
    return;
  }

  const texto = '¡Escoge un juego!';
  stage().innerHTML = `
    ${burbuja(texto)}
    <div class="rr-kids-games">
      ${juegos.map(g => `
        <button class="rr-kids-game" data-game="${g.id}" ${g.enabled ? '' : 'disabled'}>
          <span class="ic">${g.icon}</span>
          <strong>${rrEscapeHtml(g.name)}</strong>
          <small>${g.enabled ? rrEscapeHtml(g.subject) : 'Ahora no'}</small>
        </button>`).join('')}
    </div>
    ${volverBtn()}`;

  rrWireMascotLife();
  hablar(texto);
  wireVolver();

  stage().querySelectorAll('[data-game]').forEach(btn => {
    btn.addEventListener('click', () => empezarJuego(btn.dataset.game));
  });
}

async function empezarJuego(gameId) {
  jugando = juegos.find(g => g.id === gameId);
  stage().innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';
  try {
    const data = await rrApi(`/api/games/${gameId}/round`, { method: 'POST' });
    reto = data.round;
    pintarReto();
  } catch (err) {
    stage().innerHTML = burbuja('Este juego no se puede abrir ahora.') + volverBtn();
    wireVolver();
  }
}

function pintarReto() {
  // A esta edad nada se escribe con el teclado: todo se toca. Hay dos formas
  // de reto y las dos se resuelven con el dedo.
  //
  //   elegir   cuatro botones grandes
  //   armar    piezas que se van tocando en orden — formar la palabra, armar
  //            la suma, ordenar los pasos. Aquí NO se arrastra: arrastrar con
  //            un dedo pequeño es el verdadero reto y no es el que queremos.
  stage().innerHTML = `
    ${burbuja(reto.prompt)}
    <div id="kidRound" style="margin-top:22px;width:min(760px,94vw)"></div>
    <div class="rr-kids-actions" style="margin-top:18px">
      <button class="rr-kids-btn" id="kidHint"><span class="ic">💡</span>Ayúdame</button>
      <button class="rr-kids-btn" id="kidOther"><span class="ic">🔄</span>Otro</button>
    </div>
    ${volverBtn()}`;

  if (reto.kind === 'build') pintarArmadoPeque(document.getElementById('kidRound'));
  else pintarOpcionesPeque(document.getElementById('kidRound'));

  rrWireMascotLife();
  hablar(reto.prompt);
  wireVolver();

  document.getElementById('kidHint').addEventListener('click', pedirPista);
  document.getElementById('kidOther').addEventListener('click', () => empezarJuego(jugando.id));
}

function pintarOpcionesPeque(caja) {
  const opciones = reto.options || [];
  caja.innerHTML = `
    <div class="rr-kids-games">
      ${opciones.map(o => `
        <button class="rr-option rr-kids-option" data-answer="${rrEscapeHtml(o)}">${rrEscapeHtml(o)}</button>`).join('')}
    </div>`;
  caja.querySelectorAll('[data-answer]').forEach(btn => {
    btn.addEventListener('click', () => responder(btn.dataset.answer, btn));
  });
}

function pintarArmadoPeque(caja) {
  const total = reto.slots;
  const puestas = new Array(total).fill(null);

  caja.innerHTML = `
    <div class="rr-kids-build ${reto.join === '' ? 'tight' : ''}">
      <div class="rr-kids-slots" id="kidSlots">
        ${Array.from({ length: total }, (_, i) => `<span class="rr-kids-slot" data-slot="${i}"></span>`).join('')}
      </div>
      <div class="rr-kids-bank" id="kidBank">
        ${reto.pieces.map((pieza, i) =>
          `<button type="button" class="rr-kids-piece" data-piece="${i}">${rrEscapeHtml(pieza)}</button>`).join('')}
      </div>
      <button class="rr-kids-btn" id="kidCheck" disabled><span class="ic">✅</span>¡Listo!</button>
    </div>`;

  const slots = [...caja.querySelectorAll('.rr-kids-slot')];
  const check = caja.querySelector('#kidCheck');

  function refrescar() {
    slots.forEach((slot, i) => {
      const idx = puestas[i];
      slot.classList.toggle('filled', idx != null);
      slot.textContent = idx == null ? '' : reto.pieces[idx];
    });
    reto.pieces.forEach((_, i) => {
      const el = caja.querySelector(`[data-piece="${i}"]`);
      if (el) el.classList.toggle('used', puestas.includes(i));
    });
    check.disabled = puestas.some(x => x == null);
  }

  caja.querySelector('#kidBank').addEventListener('click', (e) => {
    const pieza = e.target.closest('[data-piece]');
    if (!pieza) return;
    const idx = Number(pieza.dataset.piece);
    if (puestas.includes(idx)) return;
    const hueco = puestas.indexOf(null);
    if (hueco < 0) return;
    puestas[hueco] = idx;
    refrescar();
  });

  // Tocar una pieza ya colocada la devuelve al montón: equivocarse de sitio no
  // puede costar empezar de cero.
  slots.forEach((slot, i) => {
    slot.addEventListener('click', () => {
      if (puestas[i] == null) return;
      puestas[i] = null;
      refrescar();
    });
  });

  check.addEventListener('click', () => {
    responder(puestas.map(i => reto.pieces[i]), caja.querySelector('#kidSlots'));
  });

  refrescar();
}

async function responder(answer, btn) {
  stage().querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const data = await rrApi(`/api/games/${jugando.id}/answer`, { method: 'POST', body: { answer } });

    if (data.correct) {
      btn.classList.add('right');
      rrConfetti(btn);
      const texto = '¡Muy bien! ¡Lo lograste!';
      hablar(texto);
      // El festejo dura un momento y solo: lo que quiere un niño es el
      // siguiente reto, no leer un cartel.
      setTimeout(() => {
        stage().innerHTML = `
          ${rrRobin('happy', 'rr-kids-robin')}
          <div class="rr-kids-bubble">${texto}</div>
          <div class="rr-kids-actions">
            <button class="rr-kids-btn" id="kidNext"><span class="ic">👉</span>Otro más</button>
            <button class="rr-kids-btn" id="kidBack"><span class="ic">🏠</span>Inicio</button>
          </div>`;
        rrWireMascotLife();
        wireVolver();
        document.getElementById('kidNext').addEventListener('click', () => empezarJuego(jugando.id));
      }, 900);
    } else {
      btn.classList.add('wrong');
      const texto = 'Casi. ¡Prueba otra vez!';
      hablar(texto);
      stage().querySelectorAll('button').forEach(b => { if (b !== btn) b.disabled = false; });
      const burbujaEl = stage().querySelector('.rr-kids-bubble');
      if (burbujaEl) burbujaEl.textContent = texto;
    }
  } catch (err) {
    rrToast(err.message, 'error');
    stage().querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

async function pedirPista() {
  try {
    const data = await rrApi(`/api/games/${jugando.id}/help`, { method: 'POST', body: { level: 'hint' } });
    const burbujaEl = stage().querySelector('.rr-kids-bubble');
    if (burbujaEl) burbujaEl.textContent = data.hint;
    hablar(data.hint);
  } catch (err) {
    const p = err.payload || {};
    const texto = p.error ? 'Ya usamos todas las ayudas de hoy. ¡Mañana hay más!' : 'Ahora no puedo ayudarte.';
    const burbujaEl = stage().querySelector('.rr-kids-bubble');
    if (burbujaEl) burbujaEl.textContent = texto;
    hablar(texto);
  }
}

// ---- Pantalla 3: hablar con Robin ------------------------------------------

function pantallaHablar() {
  const texto = '¿Qué me quieres preguntar?';
  stage().innerHTML = `
    ${burbuja(texto)}
    <form class="rr-kids-say" id="kidForm">
      <input type="text" id="kidInput" placeholder="Escribe aquí…" autocomplete="off" />
      <button type="submit" aria-label="Enviar">➤</button>
    </form>
    ${hayMicrofono() ? `
      <div class="rr-kids-actions" style="margin-top:18px">
        <button class="rr-kids-btn mic" id="kidMic"><span class="ic">🎤</span>Hablarle</button>
      </div>` : ''}
    ${volverBtn()}`;

  rrWireMascotLife();
  hablar(texto);
  wireVolver();
  document.getElementById('kidInput').focus();

  document.getElementById('kidForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const valor = document.getElementById('kidInput').value.trim();
    if (valor) preguntar(valor);
  });

  const mic = document.getElementById('kidMic');
  if (mic) {
    mic.addEventListener('click', () => {
      mic.classList.add('on');
      const burbujaEl = stage().querySelector('.rr-kids-bubble');
      if (burbujaEl) burbujaEl.textContent = 'Te escucho…';
      escuchar(
        (dicho) => { document.getElementById('kidInput').value = dicho; preguntar(dicho); },
        () => mic.classList.remove('on')
      );
    });
  }
}

async function preguntar(mensaje) {
  const burbujaEl = stage().querySelector('.rr-kids-bubble');
  const input = document.getElementById('kidInput');
  if (burbujaEl) burbujaEl.textContent = 'Déjame pensar…';
  if (input) { input.value = ''; input.disabled = true; }

  try {
    const data = await rrApi('/api/ai/chat', { method: 'POST', body: { message: mensaje } });
    if (burbujaEl) burbujaEl.textContent = data.reply;
    hablar(data.reply);
  } catch (err) {
    const p = err.payload || {};
    const texto = p.hint ? 'Ya hablamos mucho hoy. ¡Mañana seguimos!' : 'Ahora no te puedo contestar.';
    if (burbujaEl) burbujaEl.textContent = texto;
    hablar(texto);
  } finally {
    if (input) { input.disabled = false; input.focus(); }
  }
}

// ---------------------------------------------------------------------------

(async () => {
  kid = await rrRequireSession(['student'], { allowLittle: true });
  if (!kid) return;

  // Parvularia solo juega. De primero a tercero, además, puede preguntar.
  puedeChatear = kid.level !== 'Parvularia';

  document.getElementById('kidName').textContent = kid.fullName.split(' ')[0];
  document.getElementById('kidSchool').textContent =
    `${kid.schoolName || ''}${kid.grade ? ' · ' + kid.grade : ''}`;
  document.getElementById('kidAvatar').innerHTML = kid.profilePic
    ? `<img class="rr-avatar" src="${rrEscapeHtml(kid.profilePic)}" alt="" />`
    : '<span class="rr-avatar rr-avatar-placeholder">🐣</span>';

  document.getElementById('kidLogout').addEventListener('click', async () => {
    try { await rrApi('/api/logout', { method: 'POST' }); } catch {}
    rrIr('index.html');
  });

  inicio();
})();

});
