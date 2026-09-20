// public/js/chat.js
// Lógica compartida del chat con Robin: la usan el espacio personal (pantalla
// completa), el panel del estudiante y la burbuja flotante de los paneles de
// escuela.
//
// El chat sabe en qué conversación está. Al abrir una vieja desde el menú se
// le pasa su id y sus mensajes; al pulsar «conversación nueva» se le quita, y
// la siguiente pregunta abre una en el servidor.

// El chat ocupa exactamente lo que queda de pantalla por debajo del saludo.
//
// Antes tenía un alto fijo —100vh menos un número puesto a ojo— y bastaba con
// que la cabecera creciera un poco para que la barra de escribir se fuera por
// debajo del borde y hubiera que hacer scroll para contestar. Se mide dónde
// empieza el chat de verdad y se le da el resto.
function rrFitChat() {
  document.querySelectorAll('.rr-section-full .rr-chat').forEach(chat => {
    // Una sección escondida no se puede medir: su altura sería cero.
    if (!chat.offsetParent) return;
    const arriba = chat.getBoundingClientRect().top + window.scrollY;
    // El panel deja un buen hueco abajo (y distinto según el ancho de la
    // pantalla). Sin descontarlo, ese hueco sobra por debajo del borde y la
    // página se queda con una barra de scroll de un par de centímetros.
    const main = chat.closest('.rr-main');
    const hueco = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    chat.style.height = `${Math.max(420, window.innerHeight - arriba - hueco - 4)}px`;
  });
}

document.addEventListener('DOMContentLoaded', rrFitChat);
window.addEventListener('resize', rrFitChat);
// Al cambiar de sección el chat pasa de oculto a visible: hasta ese momento no
// se podía medir. El segundo pase es para cuando el saludo cambia de alto al
// llegar el nombre de la persona.
document.addEventListener('rr:section', () => {
  setTimeout(rrFitChat, 0);
  setTimeout(rrFitChat, 250);
});

function rrCreateChat({ body, form, input, send, hello, mode, onAction, onChat, context }) {
  let busy = false;
  let chatId = null;

  function scrollDown() {
    body.scrollTop = body.scrollHeight;
  }

  function addBubble(text, who, extra) {
    // El saludo de bienvenida se va en cuanto hay conversación de verdad. Puede
    // haber llegado de dos formas —como elemento aparte o pintado dentro del
    // cuerpo por reset()— así que se busca de las dos.
    if (hello && hello.parentNode) hello.remove();
    const saludo = body.querySelector('.rr-chat-hello');
    if (saludo) saludo.remove();
    const el = document.createElement('div');
    el.className = `rr-bubble ${who}${extra && extra.tutor ? ' tutor' : ''}`;
    // Sin retrato en cada línea: quién habla se ve por el lado y el color, y
    // repetir la cara de Robin veinte veces en una conversación la gasta.
    el.innerHTML = '<div class="txt"></div>';
    // Los saltos de línea importan: Robin contesta con listas de pasos.
    el.querySelector('.txt').textContent = text;
    body.appendChild(el);
    scrollDown();
    return el;
  }

  // Mientras piensa, Robin aparece con el pico abierto al lado de los puntitos:
  // así se nota que está armando la respuesta y no que se quedó colgado.
  function showTyping() {
    const el = document.createElement('div');
    el.className = 'rr-typing-row';
    el.dataset.typing = 'true';
    el.innerHTML = '<div class="rr-typing"><span></span><span></span><span></span></div>';
    body.appendChild(el);
    scrollDown();
    return el;
  }

  // Cuando se acaba la cuota del día no se suelta un error rojo: se explica qué
  // pasó, cuándo vuelve y qué se puede hacer mientras tanto.
  function addLimitNotice(data) {
    const el = document.createElement('div');
    el.className = 'rr-limit-note';
    el.innerHTML = `
      ${rrRobin('sad', 'rr-limit-bird')}
      <div>
        <strong>${rrEscapeHtml(data.error)}</strong>
        <p>${rrEscapeHtml(data.hint || '')}</p>
        ${data.upgrade ? '<button class="btn btn-sm btn-primary" data-go-plans>Ver los planes</button>' : ''}
      </div>`;
    body.appendChild(el);
    const btn = el.querySelector('[data-go-plans]');
    if (btn) btn.addEventListener('click', () => rrShowSection('plans'));
    scrollDown();
  }

  async function ask(message, opciones = {}) {
    if (busy || !message.trim()) return;
    busy = true;
    if (send) send.disabled = true;

    addBubble(message, 'user');
    const typing = showTyping();

    try {
      const data = await rrApi('/api/ai/chat', {
        method: 'POST',
        body: Object.assign({
          message,
          chatId,
          context: opciones.context || context || 'general'
        }, opciones.extra || {})
      });
      typing.remove();
      addBubble(data.reply, 'bot', { tutor: data.mode === 'tutor' });

      chatId = data.chatId || chatId;
      if (data.chat && typeof rrTouchChat === 'function') rrTouchChat(data.chat);
      if (data.usage && typeof rrUpdateUsage === 'function') rrUpdateUsage(data.usage);
      if (onChat) onChat(data.chat);

      // El cartelito de "modo Robin / con Claude" se quitó de la cabecera: era
      // un detalle de fontanería que no le dice nada a quien está escribiendo.
      // Con qué está conectado se ve en Configuración, que es donde se cambia.
      if (mode) {
        const live = data.mode === 'live';
        mode.textContent = live ? 'con Claude' : data.mode === 'tutor' ? 'modo tutor' : 'modo Robin';
        mode.classList.toggle('live', live);
      }
      if (data.action && onAction) onAction(data.action);
    } catch (err) {
      typing.remove();
      // El 429 del límite diario llega con su propia explicación.
      if (err.payload && err.payload.hint) addLimitNotice(err.payload);
      else addBubble(`No pude responder ahora mismo: ${err.message}`, 'bot');
    } finally {
      busy = false;
      if (send) send.disabled = false;
      input.focus();
    }
  }

  // Pinta una conversación guardada, tal cual quedó.
  function load(id, messages) {
    chatId = id;
    body.innerHTML = '';
    (messages || []).forEach(m => addBubble(m.text, m.role === 'user' ? 'user' : 'bot', { tutor: m.mode === 'tutor' }));
    scrollDown();
  }

  // Empieza de cero: la siguiente pregunta abrirá una conversación nueva.
  function reset(helloHtml) {
    chatId = null;
    body.innerHTML = '';
    if (helloHtml) {
      body.innerHTML = helloHtml;
      rrMountMascots();
      // El saludo trae el Robin que reacciona al clic, y ese se monta aparte:
      // sin esto el hueco se quedaba vacío.
      if (typeof rrMountGalerias === 'function') rrMountGalerias();
    }
  }

  // Enter envía, Shift+Enter hace salto de línea, y el campo crece solo.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  input.addEventListener('input', () => {
    if (input.tagName !== 'TEXTAREA') return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    if (input.tagName === 'TEXTAREA') input.style.height = 'auto';
    ask(message);
  });

  return {
    ask, addBubble, load, reset,
    get chatId() { return chatId; },
    set chatId(v) { chatId = v; }
  };
}
