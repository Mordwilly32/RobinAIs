// public/js/chat.js
// Lógica compartida del chat con Robin: la usa el espacio personal (pantalla
// completa) y la burbuja flotante de los paneles de escuela.

function rrCreateChat({ body, form, input, send, hello, mode, onAction }) {
  let busy = false;

  function scrollDown() {
    body.scrollTop = body.scrollHeight;
  }

  function addBubble(text, who) {
    if (hello && hello.parentNode) hello.remove();
    const el = document.createElement('div');
    el.className = `rr-bubble ${who}`;
    // Robin contesta con su propia cara; la persona, con una inicial neutra.
    const av = who === 'user'
      ? '<span class="av">tú</span>'
      : '<span class="av bird"><img src="/images/robin.png" alt="Robin" /></span>';
    el.innerHTML = `${av}<div class="txt"></div>`;
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
    el.innerHTML = `
      ${rrRobin('talking', 'rr-typing-bird')}
      <div class="rr-typing"><span></span><span></span><span></span></div>`;
    body.appendChild(el);
    scrollDown();
    return el;
  }

  async function ask(message) {
    if (busy || !message.trim()) return;
    busy = true;
    if (send) send.disabled = true;

    addBubble(message, 'user');
    const typing = showTyping();

    try {
      const data = await rrApi('/api/ai/chat', { method: 'POST', body: { message } });
      typing.remove();
      addBubble(data.reply, 'bot');

      if (mode) {
        const live = data.mode === 'live';
        mode.textContent = live ? 'con Claude' : 'modo local';
        mode.classList.toggle('live', live);
      }
      if (data.action && onAction) onAction(data.action);
    } catch (err) {
      typing.remove();
      addBubble(`No pude responder ahora mismo: ${err.message}`, 'bot');
    } finally {
      busy = false;
      if (send) send.disabled = false;
      input.focus();
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

  return { ask, addBubble };
}
