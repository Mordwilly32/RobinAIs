// public/js/personal.js
// El espacio de una cuenta personal: Robin a la izquierda, pendientes a la
// derecha. Cuando Robin crea o termina una tarea desde el chat, el panel de
// la derecha se actualiza solo.

let currentUser = null;
let taskPanel = null;

function updateSubtitle(tasks) {
  const today = rrTodayISO();
  const pending = tasks.filter(t => !t.done);
  const forToday = pending.filter(t => t.due && t.due <= today);

  let text;
  if (!tasks.length) text = 'Aún no tienes pendientes. Pídele a Robin que apunte el primero.';
  else if (forToday.length) text = `${forToday.length} pendiente${forToday.length === 1 ? '' : 's'} para hoy · ${pending.length} en total`;
  else if (pending.length) text = `Nada urgente hoy · ${pending.length} pendiente${pending.length === 1 ? '' : 's'} más adelante`;
  else text = '¡Todo al día! 🎉';

  document.getElementById('welcomeSub').textContent = text;
}

async function loadHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="rr-loader"><div class="rr-spinner"></div></div>';
  try {
    const { history } = await rrApi('/api/ai/history');
    if (!history.length) {
      list.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'talking',
        title: 'Todavía no has hablado con Robin',
        text: 'Pregúntale de cualquier materia, o pídele que apunte un pendiente. Lo que hablen se guarda aquí.'
      })}</div>`;
      return;
    }
    list.innerHTML = history.slice().reverse().map(item => `
      <div class="card rr-announce" style="border-left-color:var(--rr-blue)">
        <div class="meta">${rrFormatDate(item.createdAt)}</div>
        <p><strong>Tú:</strong> ${rrEscapeHtml(item.message)}</p>
        <p style="color:var(--rr-text-muted)"><strong>Robin:</strong> ${rrEscapeHtml(item.response)}</p>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'sad',
      title: 'No pude traer tu historial',
      text: rrEscapeHtml(err.message)
    })}</div>`;
  }
}

function photoData() {
  const file = document.getElementById('pPhoto').files[0];
  if (!file) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    if (file.size > 1024 * 1024) return reject(new Error('La foto debe pesar menos de 1 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

(async () => {
  currentUser = await rrRequireSession(['personal']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'work');

  const firstName = currentUser.fullName.split(' ')[0];
  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${firstName} 👋`;
  document.getElementById('helloTitle').textContent = `¿En qué te ayudo, ${firstName}?`;
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';

  // Panel de pendientes
  taskPanel = rrMountTaskPanel(document.getElementById('taskPanel'), {
    title: 'Mis pendientes',
    onChange: updateSubtitle
  });

  // Chat
  const chat = rrCreateChat({
    body: document.getElementById('chatBody'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    hello: document.getElementById('chatHello'),
    mode: document.getElementById('chatMode'),
    onAction: (action) => {
      // Robin tocó la lista: la recargamos para que coincida.
      if (action && action.type && action.type.startsWith('task.')) taskPanel.reload();
    }
  });

  document.querySelectorAll('#chatChips .rr-chip').forEach(chip => {
    chip.addEventListener('click', () => chat.ask(chip.textContent));
  });

  // Historial
  document.addEventListener('rr:section', (e) => {
    if (e.detail === 'history') loadHistory();
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirm('¿Borrar todo el historial de conversaciones? No se puede deshacer.')) return;
    try {
      await rrApi('/api/ai/history', { method: 'DELETE' });
      rrToast('Historial borrado.', 'success');
      loadHistory();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  // Perfil
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('profileError');
    errorBox.classList.remove('visible');
    const btn = document.getElementById('profileBtn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      const profilePic = await photoData();
      const { user } = await rrApi('/api/profile', {
        method: 'PUT',
        body: {
          fullName: document.getElementById('pFullName').value.trim(),
          currentPassword: document.getElementById('pCurrentPassword').value,
          password: document.getElementById('pNewPassword').value,
          profilePic
        }
      });
      currentUser = user;
      rrToast('Perfil actualizado.', 'success');
      document.getElementById('pCurrentPassword').value = '';
      document.getElementById('pNewPassword').value = '';
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  });
})();
