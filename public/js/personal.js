// public/js/personal.js
// El espacio de una cuenta personal.
//
// La pantalla de arranque es el chat con Robin, como en cualquier asistente:
// se entra y ya se puede preguntar. Todo lo demás —pendientes, minijuegos,
// planes— está a un clic en el menú, y las conversaciones viejas viven en la
// lista lateral para poder volver a cualquiera.

let currentUser = null;
let taskPanel = null;
let gamesPanel = null;
let aiPanel = null;      // la conexión con Claude
let plansPanel = null;
let chat = null;

// El saludo del chat vacío. Se vuelve a poner cada vez que se empieza una
// conversación nueva.
function helloHtml() {
  const nombre = currentUser.fullName.split(' ')[0];
  return `
    <div class="rr-chat-hello" id="chatHello">
      <span class="rr-hello-robin" data-rr-galeria data-bob></span>
      <h3>¿En qué te ayudo, ${rrEscapeHtml(nombre)}?</h3>
      <p>Puedo organizar tu día, apuntar lo que no quieres olvidar y explicarte lo que estés estudiando.</p>
      <div class="rr-chips" id="chatChips">
        <button class="rr-chip" type="button">Recuérdame llamar al banco mañana</button>
        <button class="rr-chip" type="button">¿Qué tengo hoy?</button>
        <button class="rr-chip" type="button">Ayúdame a organizar mi semana</button>
        <button class="rr-chip" type="button">Explícame las fracciones</button>
      </div>
    </div>`;
}

function wireChips() {
  document.querySelectorAll('#chatChips .rr-chip').forEach(chip => {
    chip.addEventListener('click', () => chat.ask(chip.textContent));
  });
}

function nuevaConversacion() {
  chat.reset(helloHtml());
  wireChips();
  if (typeof rrSetActiveChat === 'function') rrSetActiveChat(null);
  rrShowSection('chat');
  document.getElementById('chatInput').focus();
}

// ---- Cabecera --------------------------------------------------------------

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
  rrSetBadge('tasks', forToday.length);
  renderTasksSide(tasks);
}

// Al lado de la lista de pendientes, lo que conviene saber de un vistazo.
function renderTasksSide(tasks) {
  const box = document.getElementById('tasksSide');
  if (!box) return;
  const hoy = rrTodayISO();
  const pendientes = tasks.filter(t => !t.done);
  const atrasadas = pendientes.filter(t => t.due && t.due < hoy);
  const deHoy = pendientes.filter(t => t.due === hoy);
  const hechasHoy = tasks.filter(t => t.done && t.completedAt && t.completedAt.slice(0, 10) === hoy);

  box.innerHTML = `
    <h3>Tu día</h3>
    <div class="rr-mini-stats">
      <div><strong>${deHoy.length}</strong><span>para hoy</span></div>
      <div class="${atrasadas.length ? 'alert' : ''}"><strong>${atrasadas.length}</strong><span>atrasadas</span></div>
      <div><strong>${hechasHoy.length}</strong><span>hechas hoy</span></div>
    </div>
    ${atrasadas.length
      ? rrRobinSays({ pose: 'talking', text: `Tienes <strong>${atrasadas.length}</strong> con la fecha pasada. ¿Las movemos a hoy o ya no hacen falta?` })
      : rrRobinSays({ pose: 'happy', text: 'Vas al día con las fechas. Si se te ocurre algo nuevo, dímelo y lo apunto.' })}`;
}

// ---- Perfil ----------------------------------------------------------------

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

function pintarFoto(src) {
  const box = document.getElementById('photoPreview');
  if (src) {
    box.className = '';
    box.innerHTML = `<img src="${rrEscapeHtml(src)}" alt="Tu foto de perfil" />`;
  } else {
    box.className = 'rr-photo-empty';
    box.textContent = '👤';
  }
}

async function loadSummary() {
  const box = document.getElementById('profileSummary');
  try {
    const data = await rrApi('/api/profile/summary');
    const desde = new Date(data.user.createdAt).toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const uso = data.usage.aiMessages;

    box.innerHTML = `
      <h3>Tu resumen</h3>
      <div class="rr-summary-rows">
        <div><span>Plan</span><strong>${rrEscapeHtml(data.plan.name)}</strong></div>
        <div><span>Robin hoy</span><strong>${uso.unlimited ? 'sin límite' : `${uso.used} de ${uso.limit}`}</strong></div>
        <div><span>Pendientes</span><strong>${data.tasks.pending} sin terminar</strong></div>
        <div><span>Ya terminados</span><strong>${data.tasks.done}</strong></div>
        <div><span>Conversaciones</span><strong>${data.chats}</strong></div>
        <div><span>Minijuegos</span><strong>${data.games.correct} aciertos</strong></div>
        ${data.games.bestStreak ? `<div><span>Mejor racha</span><strong>🔥 ${data.games.bestStreak}</strong></div>` : ''}
        <div><span>Contigo desde</span><strong>${rrEscapeHtml(desde)}</strong></div>
      </div>`;

    // La configuración lee de lo mismo.
    const plan = document.getElementById('setPlan');
    if (plan) {
      plan.textContent = data.plan.id === 'free'
        ? 'Estás en el plan Gratis: el margen diario de partida con Robin, todos los minijuegos y el organizador completo.'
        : `Tienes el plan ${data.plan.name}${data.plan.renewsAt ? `, hasta el ${new Date(data.plan.renewsAt).toLocaleDateString('es')}` : ''}.`;
    }
    const hist = document.getElementById('setHistory');
    if (hist) {
      const dias = data.plan.limits.historyDays;
      hist.textContent = `Tienes ${data.chats} conversación${data.chats === 1 ? '' : 'es'} guardada${data.chats === 1 ? '' : 's'}. ` +
        (dias < 0 ? 'Con tu plan se guardan para siempre.' : `Con tu plan se guardan ${dias} días y luego se borran solas.`);
    }
  } catch (err) {
    box.innerHTML = rrEmptyState({ pose: 'sad', title: 'No pude traer tu resumen', text: rrEscapeHtml(err.message) });
  }
}

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['personal']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'chat');

  const firstName = currentUser.fullName.split(' ')[0];
  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${firstName} 👋`;
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';
  document.getElementById('profileName').textContent = currentUser.fullName;
  document.getElementById('profileSince').textContent =
    `Con roboRobin desde ${new Date(currentUser.createdAt).toLocaleDateString('es', { month: 'long', year: 'numeric' })}`;
  pintarFoto(currentUser.profilePic);

  // Chat
  chat = rrCreateChat({
    body: document.getElementById('chatBody'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    hello: null,
    mode: document.getElementById('chatMode'),
    onAction: (action) => {
      // Robin tocó la lista: la recargamos para que coincida.
      if (action && action.type && action.type.startsWith('task.') && taskPanel) taskPanel.reload();
    }
  });
  nuevaConversacion();

  // Pendientes
  taskPanel = rrMountTaskPanel(document.getElementById('taskPanel'), {
    title: 'Mis pendientes',
    onChange: updateSubtitle
  });
  window.rrTaskPanel = taskPanel;

  // Abrir una conversación vieja desde el menú lateral.
  document.addEventListener('rr:open-chat', async (e) => {
    try {
      const { messages } = await rrApi(`/api/chats/${e.detail}`);
      chat.load(e.detail, messages);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });
  document.addEventListener('rr:new-chat', nuevaConversacion);

  // Al salir de los minijuegos se vuelve al chat, que es la pantalla de
  // arranque: dejar el panel en la sección de juegos vacía no lleva a ningún
  // lado.
  document.addEventListener('rr:games-closed', () => rrShowSection('chat'));

  // Las secciones pesadas se montan la primera vez que se abren.
  document.addEventListener('rr:section', (e) => {
    // Los minijuegos se abren en su propia pantalla, encima de todo: sin el
    // menú, sin el saludo y sin la cabecera. Ver games-ui.js.
    if (e.detail === 'games') {
      if (!gamesPanel) {
        gamesPanel = rrMountGames(document.getElementById('gamesPanel'), { standalone: true });
      }
      gamesPanel.abrirGaleria();
    }
    if (e.detail === 'plans' && !plansPanel) {
      plansPanel = rrMountPlans(document.getElementById('plansPanel'), {
        user: currentUser,
        onChange: (user) => { currentUser = user; loadSummary(); }
      });
    }
    if (e.detail === 'profile' || e.detail === 'settings') loadSummary();
    // La conexión con Claude se monta la primera vez que se abre la pantalla.
    if (e.detail === 'settings' && !aiPanel) {
      aiPanel = rrMountAiSettings(document.getElementById('aiSettings'));
    }
  });

  // Foto: se ve al instante, antes de guardar.
  document.getElementById('pPhoto').addEventListener('change', async () => {
    try {
      const data = await photoData();
      if (data) pintarFoto(data);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  document.querySelectorAll('[data-go]').forEach(btn => {
    btn.addEventListener('click', () => rrShowSection(btn.dataset.go));
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirm('¿Borrar todo el historial de conversaciones? No se puede deshacer.')) return;
    try {
      await rrApi('/api/chats?all=1', { method: 'DELETE' });
      rrToast('Historial borrado.', 'success');
      nuevaConversacion();
      loadSummary();
      if (typeof rrLoadChatRail === 'function') rrLoadChatRail();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

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
      document.getElementById('profileName').textContent = user.fullName;
      pintarFoto(user.profilePic);
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
