// public/js/ai-widget.js
// Burbuja flotante de Robin en los paneles de escuela. Usa la misma lógica de
// chat que el espacio personal (js/chat.js).

function rrMountAIWidget() {
  const launcher = document.createElement('button');
  launcher.className = 'rr-ai-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Abrir a Robin');
  launcher.innerHTML = '<span data-rr-mascot></span>';

  const panel = document.createElement('div');
  panel.className = 'rr-ai-panel';
  panel.innerHTML = `
    <div class="rr-chat">
      <div class="rr-chat-head">
        <span data-rr-mascot></span>
        <div>
          <strong>Robin</strong>
          <span>Pregúntame o pídeme que apunte algo</span>
        </div>
        <button class="rr-ai-close" type="button" aria-label="Cerrar">&times;</button>
      </div>
      <div class="rr-chat-body" id="rrAiBody">
        <div class="rr-chat-hello" id="rrAiHello" style="padding-top:10px">
          <span data-rr-mascot data-pose="talking"></span>
          <h3 style="font-size:17px">¡Hola! Soy Robin.</h3>
          <p style="font-size:13.5px">Pregúntame de cualquier materia, o dime «recuérdame entregar el informe mañana» y lo apunto en tus pendientes.</p>
        </div>
      </div>
      <form class="rr-composer" id="rrAiForm">
        <textarea id="rrAiInput" rows="1" placeholder="Escribe aquí…"></textarea>
        <button type="submit" id="rrAiSend" aria-label="Enviar">➤</button>
      </form>
    </div>`;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);
  rrMountMascots();

  const chat = rrCreateChat({
    body: panel.querySelector('#rrAiBody'),
    form: panel.querySelector('#rrAiForm'),
    input: panel.querySelector('#rrAiInput'),
    send: panel.querySelector('#rrAiSend'),
    hello: panel.querySelector('#rrAiHello'),
    mode: null,
    onAction: (action) => {
      // Si la página tiene panel de pendientes, se pone al día.
      if (action && action.type && action.type.startsWith('task.') && window.rrTaskPanel) {
        window.rrTaskPanel.reload();
      }
    }
  });

  function toggle(open) {
    panel.classList.toggle('open', open);
    if (open) setTimeout(() => panel.querySelector('#rrAiInput').focus(), 60);
  }

  launcher.addEventListener('click', () => toggle(!panel.classList.contains('open')));
  panel.querySelector('.rr-ai-close').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) toggle(false);
  });

  window.rrChat = chat;
}

document.addEventListener('DOMContentLoaded', rrMountAIWidget);
