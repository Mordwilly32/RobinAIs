// Envuelto por tools/build-pages.js: esta pantalla se vuelve a ejecutar
// entera cada vez que se regresa a ella, sin recargar el documento.
RRPagina.pantalla(new URL(document.currentScript.src).pathname, function () {
// public/js/parent.js
// El panel de una cuenta de familia.
//
// Una sola pregunta, y la pantalla entera está hecha para contestarla de un
// vistazo desde la puerta de la casa: ¿llegó hoy?
//
// Por eso hay CUATRO respuestas y no dos. «Sin pasar lista» no es «faltó»:
// significa que el profesor todavía no ha pasado lista, y confundir las dos
// cosas es lo que haría que alguien saliera corriendo a la escuela sin
// motivo. Cada estado tiene su color, su palabra y su explicación.

let currentUser = null;
let chat = null;
let familia = [];

const ESTADOS = {
  present: { label: 'Llegó', ic: '✅', tono: 'ok', frase: 'Está en clase.' },
  late: { label: 'Llegó tarde', ic: '🕒', tono: 'warn', frase: 'Llegó, pero después de la hora.' },
  absent: { label: 'No llegó', ic: '❌', tono: 'bad', frase: 'El profesor lo marcó ausente.' },
  null: { label: 'Sin pasar lista', ic: '⏳', tono: 'wait', frase: 'Todavía no han pasado lista hoy. No quiere decir que haya faltado.' }
};

function estadoDe(status) { return ESTADOS[status] || ESTADOS.null; }

function horaDe(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ---- La tira del día -------------------------------------------------------

function renderDay(day) {
  const box = document.getElementById('dayStrip');
  if (!box || !day) return;
  box.innerHTML = `
    <span class="rr-day-ic">🗓️</span>
    <div>
      <strong>${rrEscapeHtml(day.label.charAt(0).toUpperCase() + day.label.slice(1))}</strong>
      <small>${day.weekend
        ? 'Fin de semana: lo normal es que hoy no haya pase de lista.'
        : 'Lo que ves es de hoy. Se actualiza en cuanto el profesor pasa lista.'}</small>
    </div>
    <button class="btn btn-sm btn-soft" id="refreshChildren" type="button">Actualizar</button>`;

  document.getElementById('refreshChildren').addEventListener('click', () => loadChildren({ manual: true }));
}

// ---- Los hijos -------------------------------------------------------------

function tarjetaDe(child) {
  const hoy = child.today;
  const estado = estadoDe(hoy && hoy.status);

  // Los últimos días, como una fila de puntos. Es lo que de verdad se mira
  // después del "hoy": si esto viene pasando seguido o fue un día suelto.
  const racha = child.history.slice(0, 10).reverse().map(r => {
    const e = estadoDe(r.status);
    return `<i class="rr-dot ${e.tono}" title="${rrEscapeHtml(r.day.label)}: ${e.label}"></i>`;
  }).join('');

  const faltas = child.history.filter(r => r.status === 'absent').length;
  const tardes = child.history.filter(r => r.status === 'late').length;

  return `
    <article class="card rr-child ${estado.tono}">
      <div class="rr-child-top">
        ${child.photo
          ? `<img class="rr-avatar rr-child-face" src="${rrEscapeHtml(child.photo)}" alt="" />`
          : '<span class="rr-avatar rr-avatar-placeholder rr-child-face">🎓</span>'}
        <div class="rr-child-id">
          <h3>${rrEscapeHtml(child.fullName)}</h3>
          <p>${rrEscapeHtml([child.schoolName, child.level, child.grade].filter(Boolean).join(' · ') || 'Sin escuela')}</p>
          <div class="rr-child-tags">
            <span class="pill">${rrEscapeHtml(child.studentCode || '—')}</span>
            ${child.listNumber ? `<span class="pill">N.º ${child.listNumber}</span>` : ''}
            ${(child.classes || []).map(c => `<span class="pill pill-teacher">${rrEscapeHtml(c.name)}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn-sm btn-ghost rr-child-x" data-unlink="${child.id}" type="button" title="Dejar de seguir">✕</button>
      </div>

      <div class="rr-child-state">
        <span class="rr-child-ic">${estado.ic}</span>
        <div>
          <strong>${estado.label}${hoy && hoy.at ? ` · ${rrEscapeHtml(horaDe(hoy.at))}` : ''}</strong>
          <small>${rrEscapeHtml(estado.frase)}${hoy && hoy.byName ? ` Lo marcó ${rrEscapeHtml(hoy.byName)}.` : ''}</small>
        </div>
      </div>

      ${child.history.length ? `
        <div class="rr-child-run">
          <div class="rr-dots">${racha}</div>
          <small>
            Últimos ${child.history.length} día${child.history.length === 1 ? '' : 's'} con registro:
            ${faltas} falta${faltas === 1 ? '' : 's'}${tardes ? `, ${tardes} tarde${tardes === 1 ? '' : 's'}` : ''}.
          </small>
        </div>` : '<p class="hint">Todavía no hay ningún día registrado.</p>'}
    </article>`;
}

function renderChildren() {
  const box = document.getElementById('childrenList');

  if (!familia.length) {
    box.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'ghost',
      title: 'Todavía no sigues a nadie',
      text: 'Agrega a tu hijo o hija con su ID de estudiante (se parece a STU-00007) en el formulario de abajo.'
    })}</div>`;
    return;
  }

  box.innerHTML = `<div class="rr-child-grid">${familia.map(tarjetaDe).join('')}</div>`;

  box.querySelectorAll('[data-unlink]').forEach(btn => {
    rrConfirmButton(btn, '¿Seguro? Pulsa otra vez', async () => {
      try {
        await rrApi(`/api/family/children/${btn.dataset.unlink}`, { method: 'DELETE' });
        familia = familia.filter(c => String(c.id) !== btn.dataset.unlink);
        renderChildren();
        renderRobin();
        rrToast('Ya no sigues su asistencia.', 'success');
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });
}

// Robin resume la situación antes de que nadie tenga que leer tarjeta por
// tarjeta. Con un solo hijo esto es casi todo lo que hace falta.
function renderRobin() {
  const box = document.getElementById('familyRobin');
  if (!box) return;

  if (!familia.length) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: 'Agrega a tu hijo o hija con su ID de estudiante y te digo aquí mismo, cada día, si llegó a clase.'
    });
    return;
  }

  const sinMarcar = familia.filter(c => !c.today);
  const ausentes = familia.filter(c => c.today && c.today.status === 'absent');
  const tarde = familia.filter(c => c.today && c.today.status === 'late');

  if (ausentes.length) {
    const nombres = ausentes.map(c => c.fullName.split(' ')[0]).join(' y ');
    box.innerHTML = rrRobinSays({
      pose: 'sad',
      text: `Hoy <strong>${rrEscapeHtml(nombres)}</strong> ${ausentes.length === 1 ? 'aparece' : 'aparecen'} como ausente${ausentes.length === 1 ? '' : 's'}. Si crees que es un error, habla con su profesor: él es quien lo puede corregir.`
    });
  } else if (tarde.length) {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: `${rrEscapeHtml(tarde.map(c => c.fullName.split(' ')[0]).join(' y '))} llegó tarde hoy, pero llegó.`
    });
  } else if (sinMarcar.length === familia.length) {
    box.innerHTML = rrRobinSays({
      pose: 'idle',
      text: 'Todavía no han pasado lista hoy. En cuanto lo hagan, aquí lo verás sin tener que preguntar.'
    });
  } else {
    box.innerHTML = rrRobinSays({
      pose: 'happy',
      text: familia.length === 1
        ? `${rrEscapeHtml(familia[0].fullName.split(' ')[0])} llegó a clase hoy. Todo en orden.`
        : 'Todos llegaron a clase hoy. Todo en orden.'
    });
  }
}

async function loadChildren({ manual = false } = {}) {
  const box = document.getElementById('childrenList');
  if (manual) rrLoadingIn(box, 'Preguntando por los tuyos');

  try {
    const data = await rrApi('/api/family/children');
    familia = data.children;
    renderDay(data.day);
    renderChildren();
    renderRobin();

    const pendientes = familia.filter(c => !c.today).length;
    const ausentes = familia.filter(c => c.today && c.today.status === 'absent').length;
    document.getElementById('welcomeSub').textContent = !familia.length
      ? 'Agrega a tu hijo o hija con su ID de estudiante.'
      : ausentes
        ? `${ausentes} sin llegar hoy`
        : pendientes
          ? 'Todavía no han pasado lista hoy'
          : 'Todos llegaron hoy';
    rrSetBadge('children', ausentes);
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'sad', title: 'No pude traer la información', text: rrEscapeHtml(err.message)
    })}</div>`;
  }
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
        <div><span>Sigues a</span><strong>${familia.length} ${familia.length === 1 ? 'estudiante' : 'estudiantes'}</strong></div>
        <div><span>Robin hoy</span><strong>${uso.unlimited ? 'sin límite' : `${uso.used} de ${uso.limit}`}</strong></div>
        <div><span>Conversaciones</span><strong>${data.chats}</strong></div>
        <div><span>Contigo desde</span><strong>${rrEscapeHtml(desde)}</strong></div>
      </div>`;
  } catch (err) {
    box.innerHTML = rrEmptyState({ pose: 'sad', title: 'No pude traer tu resumen', text: rrEscapeHtml(err.message) });
  }
}

// ---- Chat ------------------------------------------------------------------

function helloHtml() {
  return `
    <div class="rr-chat-hello" id="chatHello">
      <span class="rr-hello-robin" data-rr-galeria data-bob></span>
      <h3>¿Cómo va en casa?</h3>
      <p>Aquí puedo ayudarte con lo de acompañar: qué preguntarle al volver de clase, cómo ayudarle a estudiar sin hacerle la tarea, cómo hablar con su profesor.</p>
      <div class="rr-chips" id="chatChips">
        <button class="rr-chip" type="button">¿Cómo le ayudo a estudiar sin hacerle la tarea?</button>
        <button class="rr-chip" type="button">Falta seguido a clase, ¿qué hago?</button>
        <button class="rr-chip" type="button">¿Qué le pregunto cuando vuelve de la escuela?</button>
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
}

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['parent']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'children');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 👋`;
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';
  document.getElementById('profileName').textContent = currentUser.fullName;
  document.getElementById('profileSince').textContent =
    `Con roboRobin desde ${new Date(currentUser.createdAt).toLocaleDateString('es', { month: 'long', year: 'numeric' })}`;
  pintarFoto(currentUser.profilePic);

  chat = rrCreateChat({
    body: document.getElementById('chatBody'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    hello: null
  });
  chat.reset(helloHtml());
  wireChips();

  await loadChildren();

  // Mientras la pestaña está abierta, se vuelve a preguntar cada pocos
  // minutos: quien deja esto abierto en el teléfono quiere enterarse cuando
  // pasen lista, no cuando se acuerde de recargar.
  setInterval(() => {
    if (!document.hidden) loadChildren();
  }, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadChildren(); });

  document.addEventListener('rr:open-chat', async (e) => {
    try {
      const { messages } = await rrApi(`/api/chats/${e.detail}`);
      chat.load(e.detail, messages);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });
  document.addEventListener('rr:new-chat', nuevaConversacion);

  let cargado = {};
  document.addEventListener('rr:section', (e) => {
    if (e.detail === 'children') loadChildren();
    if (e.detail === 'profile') loadSummary();
    if (e.detail === 'settings' && !cargado.ai) {
      cargado.ai = true;
      rrMountAiSettings(document.getElementById('aiSettings'));
    }
  });

  // ---- Agregar otro hijo ----
  document.getElementById('addChildForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const campo = document.getElementById('newChildCode');
    const code = campo.value.trim().toUpperCase();
    if (!code) return campo.focus();

    const btn = document.getElementById('addChildBtn');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Buscando', { size: 'inline' });
    try {
      const { child } = await rrApi('/api/family/children', { method: 'POST', body: { studentCode: code } });
      familia.push(child);
      renderChildren();
      renderRobin();
      campo.value = '';
      rrToast(`${child.fullName} agregado.`, 'success');
    } catch (err) {
      rrToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Agregar';
    }
  });

  // ---- Foto y datos ----
  document.getElementById('pPhoto').addEventListener('change', async () => {
    try {
      const data = await photoData();
      if (data) pintarFoto(data);
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
    const original = btn.textContent;
    btn.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });

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
      document.getElementById('pCurrentPassword').value = '';
      document.getElementById('pNewPassword').value = '';
      rrToast('Cambios guardados.', 'success');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();

});
