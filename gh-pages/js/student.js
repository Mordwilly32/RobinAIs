// Envuelto por tools/build-pages.js: esta pantalla se vuelve a ejecutar
// entera cada vez que se regresa a ella, sin recargar el documento.
RRPagina.pantalla(new URL(document.currentScript.src).pathname, function () {
// public/js/student.js
// El panel del estudiante.
//
// La forma es la misma que la de una cuenta personal —menú a la izquierda con
// RobinAI y sus conversaciones abajo— porque quien usa las dos no debería tener
// que aprender dos programas. Lo que cambia es el contenido: arriba está la
// escuela, en solo dos pantallas.
//
//   Avisos   los de la escuela y los que te llegan a ti (las notificaciones,
//            que antes vivían aparte y contestaban a la misma pregunta).
//   Clases   tus clases, lo que te han dejado, tus pendientes y los minijuegos.
//
// Cada bloque conserva su título dentro de la pantalla: se juntan las
// funciones, no los nombres.
//
// El resumen de la cuenta ya no ocupa una pantalla propia: vive dentro del
// perfil, que es donde se busca cuando se busca.

let currentUser = null;

// Lo que cuenta cada contador rojo, por separado, para poder sumarlos sin que
// una carga pise a la otra.
const pendientesPorBadge = { asignaciones: 0, tareas: 0 };

function refrescarBadgeClases(clave, cuantos) {
  pendientesPorBadge[clave] = cuantos;
  rrSetBadge('classes', pendientesPorBadge.asignaciones + pendientesPorBadge.tareas);
}
let taskPanel = null;
let gamesPanel = null;
let aiPanel = null;      // la conexión con Claude
let juegosContados = false;   // el recuento de la pantalla de configuración
let chat = null;
let chatTools = null;   // el selector de modo del compositor
let misClases = [];

// ---- Avisos ----------------------------------------------------------------

function announcementCard(a) {
  return `
    <div class="card rr-announce">
      <h3>${rrEscapeHtml(a.title)}</h3>
      <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
      <p>${rrEscapeHtml(a.content)}</p>
    </div>`;
}

// Robin recibe al estudiante contando lo que hay de nuevo: si trajo correo se
// asoma de mensajero, y si no, saluda y recuerda que está para preguntarle.
function renderRobinSays(announcements, notifications, asignaciones) {
  const box = document.getElementById('robinSays');
  if (!box) return;

  const sinLeer = (notifications || []).filter(n => !n.read).length;
  const pendientes = (asignaciones || []).filter(a => a.state === 'pendiente' || a.state === 'atrasada');
  const atrasadas = pendientes.filter(a => a.state === 'atrasada').length;

  if (atrasadas) {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: `Tienes <strong>${atrasadas} ${atrasadas === 1 ? 'asignación atrasada' : 'asignaciones atrasadas'}</strong>. Vamos a por la primera: te la desarmo en pasos si quieres.`,
      action: '<button class="btn btn-sm btn-primary" data-go="classes">Ver mis asignaciones</button>'
    });
  } else if (sinLeer) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: `Te traje <strong>${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}</strong>. Están esperándote en tus notificaciones.`,
      action: '<button class="btn btn-sm btn-primary" data-go="announcements">Ver mis mensajes</button>'
    });
  } else if (pendientes.length) {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: `Te quedan <strong>${pendientes.length}</strong> ${pendientes.length === 1 ? 'asignación' : 'asignaciones'} por entregar. Ninguna vencida todavía: vas bien de tiempo.`,
      action: '<button class="btn btn-sm btn-primary" data-go="classes">Ver mis clases</button>'
    });
  } else if (currentUser && currentUser.level === 'Universidad') {
    // En universidad no hay minijuegos, así que no se ofrecen: mandar a una
    // pantalla que no existe es peor que no decir nada.
    box.innerHTML = rrRobinSays({
      pose: 'happy',
      text: 'Estás al día con todo. Si quieres adelantar, pregúntame por cualquier tema de tus clases.',
      action: '<button class="btn btn-sm btn-soft" data-go="chat">Preguntarle a Robin</button>'
    });
  } else {
    box.innerHTML = rrRobinSays({
      pose: 'happy',
      text: 'Estás al día con todo. Si quieres aprovechar el rato, los minijuegos siguen ahí.',
      action: '<button class="btn btn-sm btn-soft" data-go="games">Jugar un rato</button>'
    });
  }

  box.querySelectorAll('[data-go]').forEach(btn => {
    btn.addEventListener('click', () => rrShowSection(btn.dataset.go));
  });
}

// Al lado de la lista de pendientes, lo que conviene saber de un vistazo. Es
// la misma tarjeta que en una cuenta personal: no hay motivo para que a un
// estudiante se le enseñe peor su propio día.
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

// ---- Asignaciones ----------------------------------------------------------

const ESTADO_TEXTO = {
  pendiente: 'Por entregar',
  atrasada: 'Atrasada',
  entregada: 'Entregada',
  calificada: 'Calificada'
};

async function loadAssignments() {
  const box = document.getElementById('assignments');
  try {
    const { assignments } = await rrApi('/api/activities/mine');
    window.rrAssignments = assignments;

    const porHacer = assignments.filter(a => a.state === 'pendiente' || a.state === 'atrasada').length;
    refrescarBadgeClases('asignaciones', porHacer);

    if (!assignments.length) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Nada que entregar por ahora',
        text: 'Cuando alguno de tus profesores deje una tarea, aparece aquí con su fecha y con el botón para que te ayude Robin.'
      })}</div>`;
      return assignments;
    }

    box.innerHTML = assignments.map(a => assignmentCard(a)).join('');
    wireAssignments();
    return assignments;
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'sad', title: 'No pude traer tus asignaciones', text: rrEscapeHtml(err.message)
    })}</div>`;
    return [];
  }
}

function assignmentCard(a) {
  const entregada = a.state === 'entregada' || a.state === 'calificada';
  return `
    <article class="rr-assign ${a.state}" data-assign="${a.id}">
      <div class="rr-assign-top">
        <div>
          <h3>${rrEscapeHtml(a.title)}</h3>
          <div class="meta">
            ${rrEscapeHtml(a.className)}${a.subject ? ` · ${rrEscapeHtml(a.subject)}` : ''} ·
            ${rrEscapeHtml(a.teacherName)}
            ${a.dueDate ? ` · entrega ${rrEscapeHtml(rrDayLabel(a.dueDate))}` : ''}
          </div>
        </div>
        <span class="rr-assign-state ${a.state}">${ESTADO_TEXTO[a.state]}</span>
      </div>

      ${a.description ? `<p>${rrEscapeHtml(a.description)}</p>` : ''}

      ${a.submission && a.submission.grade != null ? `
        <div class="rr-assign-grade">${a.submission.grade}<small>de ${a.points || 10}</small></div>
        ${a.submission.feedback ? `<p style="margin-top:10px"><strong>Tu profesor dice:</strong> ${rrEscapeHtml(a.submission.feedback)}</p>` : ''}
      ` : ''}

      <div class="rr-assign-actions">
        <button class="btn btn-sm btn-soft" data-help="${a.id}">🪜 Que Robin me ayude</button>
        <button class="btn btn-sm ${entregada ? 'btn-ghost' : 'btn-primary'}" data-work="${a.id}">
          ${entregada ? 'Ver o cambiar mi entrega' : 'Escribir mi entrega'}
        </button>
      </div>

      <div class="rr-assign-work" data-work-box="${a.id}" hidden>
        <div class="field">
          <label for="sub-${a.id}">Tu respuesta</label>
          <textarea id="sub-${a.id}" placeholder="Escribe aquí tu trabajo…">${rrEscapeHtml(a.submission ? a.submission.text : '')}</textarea>
        </div>
        <button class="btn btn-sm btn-primary" data-submit="${a.id}">${entregada ? 'Guardar cambios' : 'Entregar'}</button>
      </div>
    </article>`;
}

function wireAssignments() {
  document.querySelectorAll('[data-work]').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = document.querySelector(`[data-work-box="${btn.dataset.work}"]`);
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('textarea').focus();
    });
  });

  document.querySelectorAll('[data-submit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.submit;
      const texto = document.getElementById(`sub-${id}`).value.trim();
      if (!texto) return rrToast('Escribe algo antes de entregar.', 'error');

      btn.disabled = true;
      btn.innerHTML = rrLoadingHtml('Entregando', { size: 'inline' });
      try {
        const data = await rrApi(`/api/activities/${id}/submit`, { method: 'POST', body: { text: texto } });
        rrToast(data.message, 'success');
        rrConfetti(btn);
        await refrescar();
      } catch (err) {
        rrToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Entregar';
      }
    });
  });

  // «Que Robin me ayude»: pide el plan de la tarea y lo abre en el chat, en su
  // propia conversación, para poder seguir preguntando desde ahí.
  document.querySelectorAll('[data-help]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.help;
      const card = document.querySelector(`[data-assign="${id}"]`);
      btn.disabled = true;
      btn.innerHTML = rrLoadingHtml('Robin lo está mirando', { size: 'inline' });

      try {
        const data = await rrApi('/api/ai/homework', { method: 'POST', body: { activityId: Number(id) } });
        if (data.usage) rrUpdateUsage(data.usage);

        let plan = card.querySelector('.rr-assign-plan');
        if (!plan) {
          plan = document.createElement('div');
          plan.className = 'rr-assign-plan';
          card.appendChild(plan);
        }
        plan.textContent = data.plan;

        const seguir = document.createElement('button');
        seguir.className = 'btn btn-sm btn-soft';
        seguir.style.marginTop = '12px';
        seguir.textContent = '💬 Seguir preguntándole a Robin';
        seguir.addEventListener('click', async () => {
          const { messages } = await rrApi(`/api/chats/${data.chatId}`);
          chat.load(data.chatId, messages);
          rrSetActiveChat(data.chatId);
          rrShowSection('chat');
        });
        plan.appendChild(document.createElement('br'));
        plan.appendChild(seguir);

        rrLoadChatRail();
      } catch (err) {
        const p = err.payload || {};
        rrToast(p.hint ? `${p.error} ${p.hint}` : err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🪜 Que Robin me ayude';
      }
    });
  });
}

// ---- Clases ----------------------------------------------------------------

function renderStudentClasses(classes) {
  const container = document.getElementById('studentClasses');
  if (!classes.length) {
    container.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'ghost',
      title: 'Todavía no hay clases',
      text: 'Cuando un profesor de tu escuela cree una clase, aparecerá aquí y podrás unirte.'
    })}</div>`;
    return;
  }

  container.innerHTML = classes.map(item => {
    const dentro = (item.studentIds || []).includes(currentUser.id);
    return `
      <div class="card rr-class-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <h3>${rrEscapeHtml(item.name)}</h3>
            <p>${rrEscapeHtml(item.description || 'Sin descripción')}</p>
            <span class="pill">${item.visibility === 'private' ? 'Privada' : 'Pública'}</span>
            ${item.level ? `<span class="pill">${rrEscapeHtml(item.level)}</span>` : ''}
            ${item.subject ? `<span class="pill">${rrEscapeHtml(item.subject)}</span>` : ''}
            <span class="pill">Profesor: ${rrEscapeHtml(item.teacherName)}</span>
          </div>
          ${dentro
            ? '<span class="pill pill-active">Ya estás dentro</span>'
            : `<button class="btn btn-sm btn-outline" data-open-join="${item.id}">Unirme</button>`}
        </div>

        ${dentro ? '' : `
          <div class="rr-inline-form" data-join-box="${item.id}" hidden>
            <div class="rr-inline-row">
              <input type="text" id="cls-${item.id}" placeholder="${item.visibility === 'private' ? 'Código de la clase' : 'No hace falta código'}" autocomplete="off" ${item.visibility === 'private' ? '' : 'disabled'} />
              <button class="btn btn-sm btn-primary" data-join-class="${item.id}">Entrar</button>
            </div>
            <small>${item.visibility === 'private' ? 'Esta clase es privada: pídele el código a tu profesor.' : 'Esta clase es pública: puedes entrar directamente.'}</small>
          </div>`}
        ${dentro ? `
          <div style="border-top:1px solid var(--rr-line);padding-top:16px;margin-top:16px">
            <h4 style="margin-bottom:8px;font-size:14px">Compañeros</h4>
            <div id="student-members-${item.id}" style="font-size:13.5px;color:var(--rr-text-muted)">Cargando…</div>
          </div>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-open-join]').forEach(button => {
    button.addEventListener('click', () => {
      const box = container.querySelector(`[data-join-box="${button.dataset.openJoin}"]`);
      box.hidden = !box.hidden;
      const campo = box.querySelector('input');
      if (!box.hidden && !campo.disabled) campo.focus();
    });
  });

  container.querySelectorAll('[data-join-class]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.joinClass;
      const campo = document.getElementById(`cls-${id}`);
      button.disabled = true;
      try {
        await rrApi(`/api/classes/${id}/join`, {
          method: 'POST',
          body: { code: campo.disabled ? '' : campo.value.trim() }
        });
        rrToast('¡Te uniste a la clase!', 'success');
        rrConfetti(button);
        await refrescar();
      } catch (err) {
        rrToast(err.message, 'error');
        button.disabled = false;
      }
    });
  });

  classes.forEach(item => {
    if ((item.studentIds || []).includes(currentUser.id)) loadStudentMembers(item.id);
  });
}

async function loadStudentMembers(classId) {
  const box = document.getElementById(`student-members-${classId}`);
  if (!box) return;
  try {
    const { members } = await rrApi(`/api/classes/${classId}/members`);
    box.innerHTML = members.length
      ? members.map(m => `<div style="padding:4px 0">${m.role === 'teacher' ? '🍎' : '🎓'} ${rrEscapeHtml(m.fullName)}</div>`).join('')
      : 'Todavía no hay nadie en esta clase.';
  } catch {
    box.textContent = 'No se pudo cargar la lista.';
  }
}

// ---- Notificaciones --------------------------------------------------------

async function loadNotifications() {
  const { notifications } = await rrApi('/api/notifications');
  rrSetBadge('announcements', notifications.filter(n => !n.read).length);

  document.getElementById('notificationsList').innerHTML = notifications.length
    ? notifications.map(note => `
        <div class="card rr-notification ${note.read ? '' : 'unread'}">
          <strong>${rrEscapeHtml(note.title || 'Notificación')}</strong>
          <p>${rrEscapeHtml(note.message)}</p>
          <small>${rrFormatDate(note.createdAt)}</small>
          <div class="rr-row-actions">
            ${note.type === 'class-invite' ? `<button class="btn btn-sm btn-primary" data-accept-invite="${note.classId}">Aceptar invitación</button>` : ''}
            ${note.read ? '' : `<button class="btn btn-sm btn-outline" data-read-note="${note.id}">Marcar leída</button>`}
          </div>
        </div>`).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Bandeja vacía',
        text: 'Aquí llegan las invitaciones a clases, las tareas nuevas y las calificaciones.'
      })}</div>`;

  // Aceptar entra a la clase: es una acción que cambia dónde estás, así que se
  // confirma con un segundo clic en vez de con una ventana del navegador.
  document.querySelectorAll('[data-accept-invite]').forEach(button => {
    rrConfirmButton(button, 'Pulsa otra vez para entrar', async () => {
      try {
        await rrApi(`/api/classes/${button.dataset.acceptInvite}/join`, { method: 'POST', body: {} });
        rrToast('¡Te uniste a la clase!', 'success');
        await refrescar();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-read-note]').forEach(button => {
    button.addEventListener('click', async () => {
      await rrApi(`/api/notifications/${button.dataset.readNote}/read`, { method: 'PUT' });
      await loadNotifications();
    });
  });

  window.rrLastNotifications = notifications;
  return notifications;
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
    const esc = data.school || {};

    box.innerHTML = `
      <h3>Tu resumen</h3>
      <div class="rr-summary-rows">
        <div><span>Escuela</span><strong>${rrEscapeHtml(esc.name || '—')}</strong></div>
        <div><span>Nivel</span><strong>${rrEscapeHtml(esc.level || '—')}</strong></div>
        <div><span>Grado</span><strong>${rrEscapeHtml(esc.grade || '—')}</strong></div>
        <div><span>Tu ID</span><strong class="rr-code-mono">${rrEscapeHtml(esc.studentCode || '—')}</strong></div>
        <div><span>Clases</span><strong>${esc.classes || 0}</strong></div>
        <div><span>Por entregar</span><strong>${esc.pendingAssignments || 0}</strong></div>
        <div><span>Pendientes propios</span><strong>${data.tasks.pending}</strong></div>
        <div><span>Minijuegos</span><strong>${data.games.correct} aciertos</strong></div>
        ${data.games.bestStreak ? `<div><span>Mejor racha</span><strong>🔥 ${data.games.bestStreak}</strong></div>` : ''}
      </div>
      <p class="hint" style="margin-top:14px">Tu ID de estudiante también sirve para entrar, en lugar del correo.</p>`;

    const hist = document.getElementById('setHistory');
    if (hist) hist.textContent = `Tienes ${data.chats} conversación${data.chats === 1 ? '' : 'es'} guardada${data.chats === 1 ? '' : 's'} con Robin. Solo tú las ves.`;
  } catch (err) {
    box.innerHTML = rrEmptyState({ pose: 'sad', title: 'No pude traer tu resumen', text: rrEscapeHtml(err.message) });
  }
}

// ---- Chat ------------------------------------------------------------------

function helloHtml() {
  const nombre = currentUser.fullName.split(' ')[0];
  return `
    <div class="rr-chat-hello" id="chatHello">
      <span class="rr-hello-robin" data-rr-galeria data-bob></span>
      <h3>Hola, ${rrEscapeHtml(nombre)}</h3>
      <p>Pregúntame de cualquier materia. Te explico cómo se hace y te acompaño, pero la respuesta la escribes tú: así sí te sirve en el examen.</p>
      <div class="rr-chips" id="chatChips">
        <button class="rr-chip" type="button">Explícame las fracciones</button>
        <button class="rr-chip" type="button">¿Cómo estudio para un examen?</button>
        <button class="rr-chip" type="button">No entiendo mi tarea, ¿por dónde empiezo?</button>
        <button class="rr-chip" type="button">Recuérdame estudiar mañana</button>
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
  rrSetActiveChat(null);
  rrShowSection('chat');
}

// ---- Recarga general -------------------------------------------------------

async function refrescar() {
  const [{ announcements }, { classes }] = await Promise.all([
    rrApi('/api/announcements'),
    rrApi('/api/classes')
  ]);
  misClases = classes;

  document.getElementById('fullAnnouncements').innerHTML = announcements.length
    ? announcements.map(announcementCard).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'El tablero está vacío',
        text: 'Cuando la dirección o tus profesores publiquen algo para tu nivel, aparecerá aquí.'
      })}</div>`;

  renderStudentClasses(classes);
  const asignaciones = await loadAssignments();
  const notificaciones = await loadNotifications();
  renderRobinSays(announcements, notificaciones, asignaciones);
}

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['student'], { allowLittle: false });
  if (!currentUser) return;

  rrRenderShell(currentUser, 'announcements');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 👋`;
  document.getElementById('welcomeSub').textContent = currentUser.schoolName
    ? `${currentUser.schoolName}${currentUser.level ? ' · ' + currentUser.level : ''}${currentUser.grade ? ' · ' + currentUser.grade : ''}`
    : (currentUser.level || 'Panel del estudiante');

  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '(sin correo — entras con tu ID)';
  document.getElementById('profileName').textContent = currentUser.fullName;
  document.getElementById('profileSchool').textContent =
    `${currentUser.schoolName || ''}${currentUser.grade ? ' · ' + currentUser.grade : ''}`;
  pintarFoto(currentUser.profilePic);

  chat = rrCreateChat({
    body: document.getElementById('chatBody'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    hello: null,
    mode: document.getElementById('chatMode'),
    onAction: (action) => {
      if (action && action.type && action.type.startsWith('task.') && taskPanel) taskPanel.reload();
    }
  });
  chat.reset(helloHtml());
  wireChips();

  // Los modos del chat: traducir un documento y generar una actividad. Antes
  // eran dos páginas sueltas en /herramientas; ahora se eligen aquí, como
  // quien elige con qué modelo hablar. Ver public/js/chat-tools.js.
  chatTools = rrMountChatTools(chat, {
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    body: document.getElementById('chatBody'),
    user: currentUser
  });

  taskPanel = rrMountTaskPanel(document.getElementById('taskPanel'), {
    title: 'Mis pendientes',
    onChange: (tasks) => {
      refrescarBadgeClases('tareas', tasks.filter(t => !t.done && t.due && t.due <= rrTodayISO()).length);
      rrSetBadge('tasks', tasks.filter(t => !t.done && t.due && t.due <= rrTodayISO()).length);
      renderTasksSide(tasks);
    }
  });
  window.rrTaskPanel = taskPanel;

  document.addEventListener('rr:open-chat', async (e) => {
    try {
      const { messages } = await rrApi(`/api/chats/${e.detail}`);
      chat.load(e.detail, messages);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });
  document.addEventListener('rr:new-chat', nuevaConversacion);

  // Al cerrar la ventana de minijuegos se vuelve a los avisos, que es la
  // pantalla de entrada del estudiantado.
  document.addEventListener('rr:games-closed', () => rrShowSection('announcements'));

  document.addEventListener('rr:section', (e) => {
    if (e.detail === 'games') {
      if (!gamesPanel) {
        gamesPanel = rrMountGames(document.getElementById('gamesPanel'), { standalone: true });
      }
      gamesPanel.abrirGaleria();
    }
    if (e.detail === 'settings' && !juegosContados) {
      juegosContados = true;
      rrApi('/api/games').then(({ games }) => {
        const apagados = games.filter(g => !g.enabled);
        const set = document.getElementById('setGames');
        if (set) {
          set.textContent = !games.length
            ? 'En el nivel universitario no hay minijuegos: a esta altura no vienen al caso. Todo lo demás funciona igual.'
            : apagados.length
              ? `Tienes ${games.length - apagados.length} de ${games.length} minijuegos disponibles. Los demás los apagó ${apagados[0].disabledBy}.`
              : `Tienes los ${games.length} minijuegos disponibles. Tu profesor puede apagar alguno si hace falta.`;
        }
      }).catch(() => {});
    }
    if (e.detail === 'profile' || e.detail === 'settings') loadSummary();
    // La conexión con Claude se monta la primera vez que se abre la pantalla.
    if (e.detail === 'settings' && !aiPanel) {
      aiPanel = rrMountAiSettings(document.getElementById('aiSettings'));
    }
  });

  // Entrar con el código de una clase. La caja se abre en la propia pantalla,
  // no en una ventana del navegador: así se sigue viendo dónde estás.
  const joinBox = document.getElementById('joinByCodeBox');
  document.getElementById('joinByCode').addEventListener('click', () => {
    joinBox.hidden = !joinBox.hidden;
    if (!joinBox.hidden) document.getElementById('joinCodeInput').focus();
  });

  document.getElementById('joinCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const campo = document.getElementById('joinCodeInput');
    const code = campo.value.trim();
    if (!code) return;
    try {
      const data = await rrApi('/api/classes/join-by-code', { method: 'POST', body: { code } });
      rrToast(`¡Entraste a ${data.className}!`, 'success');
      campo.value = '';
      joinBox.hidden = true;
      await refrescar();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  document.getElementById('pPhoto').addEventListener('change', async () => {
    try {
      const data = await photoData();
      if (data) pintarFoto(data);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  document.getElementById('clearHistory').addEventListener('click', async () => {
    if (!confirm('¿Borrar todas tus conversaciones con Robin?')) return;
    try {
      await rrApi('/api/chats?all=1', { method: 'DELETE' });
      rrToast('Historial borrado.', 'success');
      nuevaConversacion();
      rrLoadChatRail();
      loadSummary();
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
    btn.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });

    try {
      const profilePic = await photoData();
      const { user } = await rrApi('/api/profile', {
        method: 'PUT',
        body: { fullName: document.getElementById('pFullName').value.trim(), profilePic }
      });
      currentUser = user;
      document.getElementById('profileName').textContent = user.fullName;
      pintarFoto(user.profilePic);
      rrToast('Perfil actualizado.', 'success');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  });

  try {
    await refrescar();
  } catch (err) {
    rrToast(err.message, 'error');
  }
})();

});
