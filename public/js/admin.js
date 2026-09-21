// public/js/admin.js
// El panel que comparten dirección, subdirección y secretaría.
//
// El rol no se mira a mano en ninguna parte: se mira `currentUser.permissions`,
// que viene del servidor (src/permissions.js). Así, el día que aparezca un
// cargo nuevo, esta pantalla se adapta sola.
//
// Lo que un cargo no puede hacer, no se le dibuja. Y lo que se le dibuja, el
// servidor se lo vuelve a comprobar: esconder un botón no protege nada.

let currentUser = null;
let miEscuela = null;
let chat = null;
let chatTools = null;   // el selector de modo del compositor

function puedo(permiso) {
  return (currentUser.permissions || []).includes(permiso);
}

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

async function loadSchoolCodes() {
  const box = document.getElementById('schoolCodes');
  try {
    const data = await rrApi('/api/schools/mine');
    miEscuela = data.school;

    if (!miEscuela) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Todavía no hay escuela inscrita',
        text: 'Esta cuenta no pertenece a ninguna escuela. Inscribe una desde la pantalla de crear cuenta.'
      })}</div>`;
      return;
    }

    const input = document.getElementById('schoolNameInput');
    if (input) input.value = miEscuela.name;

    box.innerHTML = `
      <div class="card rr-code-card">
        <h3>Código permanente de estudiantes</h3>
        <p>Para dar de alta a muchos de golpe. No caduca: sirve hasta que lo cambies.</p>
        <span class="rr-code-value">${rrEscapeHtml(miEscuela.studentCode)}</span>
        <button class="btn btn-sm btn-ghost" data-copy-perm="student">Copiar</button>
        ${puedo('codes.revoke') ? '<button class="btn btn-sm btn-danger" data-regen="student">Cambiarlo</button>' : ''}
      </div>

      <div class="card rr-code-card">
        <h3>Código permanente de profesores</h3>
        ${miEscuela.teacherCode ? `
          <p>El que abre una cuenta de profesor. Si se filtra, cámbialo: el anterior deja de servir al instante.</p>
          <span class="rr-code-value">${rrEscapeHtml(miEscuela.teacherCode)}</span>
          <button class="btn btn-sm btn-ghost" data-copy-perm="teacher">Copiar</button>
          ${puedo('codes.revoke') ? '<button class="btn btn-sm btn-danger" data-regen="teacher">Cambiarlo</button>' : ''}
        ` : `
          <p>Este código solo lo ven dirección y subdirección.</p>
          <span class="rr-code-value hidden-code">🔒 Secretaría no reparte códigos de profesor</span>
        `}
      </div>`;

    box.querySelectorAll('[data-copy-perm]').forEach(b => {
      b.addEventListener('click', () => {
        rrCopy(b.dataset.copyPerm === 'student' ? miEscuela.studentCode : miEscuela.teacherCode, b);
      });
    });

    // Cambiar un código permanente deja fuera a quien todavía no lo usó: dos
    // clics, y con el aviso delante.
    box.querySelectorAll('[data-regen]').forEach(b => {
      rrConfirmButton(b, 'Pulsa otra vez: el actual dejará de servir', async () => {
        try {
          const data = await rrApi('/api/schools/mine/regenerate', {
            method: 'POST', body: { which: b.dataset.regen }
          });
          miEscuela = data.school;
          rrToast('Código nuevo listo. El anterior ya no sirve.', 'success');
          loadSchoolCodes();
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer los códigos', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

async function loadNominalCodes() {
  const box = document.getElementById('codeList');
  try {
    const { codes } = await rrApi('/api/codes');
    const profesores = codes.filter(c => c.type === 'teacher');

    if (!profesores.length) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Ningún código personal emitido',
        text: 'Cuando emitas uno aparece aquí, y podrás ver si ya se usó o anularlo antes de que alguien lo use.'
      })}</div>`;
      return;
    }

    box.innerHTML = `
      <div class="rr-table-wrap">
        <table class="rr-table">
          <thead><tr><th>Código</th><th>Para</th><th>Lo emitió</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${profesores.map(c => `
              <tr>
                <td class="rr-code-mono">${rrEscapeHtml(c.code)}</td>
                <td>${rrEscapeHtml(c.forName || '—')}
                  ${c.note ? `<br><small class="text-muted">${rrEscapeHtml(c.note)}</small>` : ''}
                  ${c.usedByName ? `<br><small class="text-muted">lo usó ${rrEscapeHtml(c.usedByName)}</small>` : ''}</td>
                <td><small>${rrEscapeHtml(c.createdByName || '—')}<br>${rrFormatDate(c.createdAt)}</small></td>
                <td><span class="rr-code-state ${c.state}">${c.state}</span></td>
                <td>
                  ${c.state === 'listo'
                    ? `<button class="btn btn-sm btn-ghost" data-copy-code="${rrEscapeHtml(c.code)}">Copiar</button>
                       <button class="btn btn-sm btn-danger" data-revoke="${c.id}">Anular</button>`
                    : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    box.querySelectorAll('[data-copy-code]').forEach(b => {
      b.addEventListener('click', () => rrCopy(b.dataset.copyCode, b));
    });
    box.querySelectorAll('[data-revoke]').forEach(b => {
      rrConfirmButton(b, 'Pulsa otra vez para anularlo', async () => {
        try {
          await rrApi(`/api/codes/${b.dataset.revoke}`, { method: 'DELETE' });
          rrToast('Código anulado. Ya no sirve.', 'success');
          loadNominalCodes();
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer los códigos', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

async function loadUsers() {
  const body = document.getElementById('usersBody');
  body.innerHTML = '<tr><td colspan="7"><div class="rr-loader"><div class="spinner"></div></div></td></tr>';

  const params = new URLSearchParams();
  ['searchQ:q', 'filterRole:role', 'filterLevel:level', 'filterStatus:status'].forEach(par => {
    const [id, key] = par.split(':');
    const value = document.getElementById(id).value.trim();
    if (value) params.set(key, value);
  });

  try {
    const { users } = await rrApi(`/api/admin/users?${params}`);
    if (!users.length) {
      body.innerHTML = `<tr><td colspan="7">${rrEmptyState({
        pose: 'ghost', title: 'Ninguna cuenta con ese filtro',
        text: 'Prueba con otro filtro, o crea una cuenta nueva.'
      })}</td></tr>`;
      return;
    }

    body.innerHTML = users.map(u => `
      <tr>
        <td>
          <strong>${rrEscapeHtml(u.fullName)}</strong>
          ${u.grade ? `<br><small class="text-muted">${rrEscapeHtml(u.grade)}</small>` : ''}
        </td>
        <td>
          ${rrEscapeHtml(u.email || '—')}
          ${u.studentCode ? `<br><small class="rr-code-mono">${rrEscapeHtml(u.studentCode)}</small>` : ''}
        </td>
        <td><span class="pill pill-${u.role}">${rrEscapeHtml(u.roleLabel || u.role)}</span></td>
        <td>${rrEscapeHtml(u.level || '—')}</td>
        <td><small>${(u.classes || []).map(c => rrEscapeHtml(c.name)).join(', ') || '—'}</small></td>
        <td><span class="pill pill-${u.status}">${u.status === 'active' ? 'Activa' : 'Inactiva'}</span></td>
        <td class="rr-row-actions">
          ${puedo('accounts.edit') ? `<button class="btn btn-sm btn-outline" data-edit="${u.id}">Editar</button>` : ''}
          ${puedo('accounts.delete') && u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Borrar</button>` : ''}
        </td>
      </tr>`).join('');

    window.rrUsers = users;

    body.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => abrirModalUsuario(users.find(u => u.id === Number(b.dataset.edit))));
    });
    body.querySelectorAll('[data-del]').forEach(b => {
      rrConfirmButton(b, 'Pulsa otra vez para borrarla', async () => {
        try {
          await rrApi(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' });
          rrToast('Cuenta borrada.', 'success');
          loadUsers();
          loadStats();
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7">${rrEscapeHtml(err.message)}</td></tr>`;
  }
}

function abrirModalUsuario(user, rolPorDefecto) {
  const modal = document.getElementById('userModalBackdrop');
  document.getElementById('userError').classList.remove('visible');
  document.getElementById('userForm').reset();

  document.getElementById('uId').value = user ? user.id : '';
  document.getElementById('userModalTitle').textContent = user ? `Editar a ${user.fullName}` : 'Nueva cuenta';
  document.getElementById('uPasswordLabel').innerHTML = user
    ? 'Contraseña nueva <span class="text-muted">(déjala vacía para no cambiarla)</span>'
    : 'Contraseña';
  document.getElementById('uPassword').required = !user;

  if (user) {
    document.getElementById('uFullName').value = user.fullName;
    document.getElementById('uEmail').value = user.email || '';
    document.getElementById('uRole').value = user.role;
    document.getElementById('uStatus').value = user.status;
    document.getElementById('uLevel').value = user.level || '';
    document.getElementById('uGrade').value = user.grade || '';
  } else if (rolPorDefecto) {
    document.getElementById('uRole').value = rolPorDefecto;
  }

  // Quien no reparte cargos no ve los cargos en la lista.
  const select = document.getElementById('uRole');
  Array.from(select.options).forEach(opt => {
    const esCargo = ['admin', 'subdirector', 'secretary'].includes(opt.value);
    opt.hidden = esCargo && !puedo('staff.manage');
  });

  pintarPistaDeRol();
  modal.classList.add('open');
}

const PISTA_DE_ROL = {
  student: 'No podrá cambiar su propia contraseña: se la restableces tú o su profesor.',
  teacher: 'Podrá crear clases, dejar tareas, emitir códigos de estudiante y apagar minijuegos en sus clases.',
  secretary: 'Verá todas las cuentas y todas las clases, y podrá emitir códigos de ESTUDIANTE. No podrá emitir códigos de profesor.',
  subdirector: 'Como la dirección, pero sin poder crear más cargos de dirección.',
  admin: 'Lo ve y lo puede todo dentro de esta escuela, incluido repartir cargos.'
};

function pintarPistaDeRol() {
  const rol = document.getElementById('uRole').value;
  document.getElementById('uRoleHint').textContent = PISTA_DE_ROL[rol] || '';
}

// ---------------------------------------------------------------------------
// Clases de toda la escuela
// ---------------------------------------------------------------------------

async function loadAllClasses() {
  const box = document.getElementById('allClasses');
  box.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  try {
    const { classes } = await rrApi('/api/schools/mine/classes');
    if (!classes.length) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost', title: 'Todavía no hay clases',
        text: 'Las crea el profesorado desde su propio panel. En cuanto creen la primera, aparece aquí.'
      })}</div>`;
      return;
    }

    box.innerHTML = classes.map(item => `
      <div class="card rr-class-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <h3>${rrEscapeHtml(item.name)}</h3>
            <p>${rrEscapeHtml(item.description || 'Sin descripción')}</p>
            <span class="pill pill-teacher">${rrEscapeHtml(item.teacherName)}</span>
            ${item.level ? `<span class="pill">${rrEscapeHtml(item.level)}</span>` : ''}
            ${item.subject ? `<span class="pill">${rrEscapeHtml(item.subject)}</span>` : ''}
            <span class="pill">${item.visibility === 'private' ? 'Privada' : 'Pública'}</span>
          </div>
          <div style="text-align:right">
            <div class="rr-mini-stats" style="grid-template-columns:repeat(2,1fr);min-width:180px;margin:0">
              <div><strong>${item.studentCount}</strong><span>estudiantes</span></div>
              <div><strong>${item.activityCount}</strong><span>tareas</span></div>
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer las clases', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Personal de dirección
// ---------------------------------------------------------------------------

async function loadStaff() {
  const box = document.getElementById('staffList');
  box.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  try {
    const { staff } = await rrApi('/api/admin/staff');
    box.innerHTML = staff.map(u => `
      <div class="rr-person">
        ${u.profilePic
          ? `<img class="rr-avatar" src="${rrEscapeHtml(u.profilePic)}" alt="" />`
          : '<span class="rr-avatar rr-avatar-placeholder">🗝️</span>'}
        <div class="rr-person-main">
          <strong>${rrEscapeHtml(u.fullName)}</strong>
          <div class="mail">${rrEscapeHtml(u.email || '—')}</div>
          <div class="rr-person-tags">
            <span class="pill pill-${u.role}">${rrEscapeHtml(u.roleLabel)}</span>
            <span class="pill ${u.canIssueTeacherCodes ? 'pill-active' : 'pill-inactive'}">
              ${u.canIssueTeacherCodes ? 'emite códigos de profesor' : 'no emite códigos de profesor'}
            </span>
          </div>
          ${puedo('staff.manage') && u.id !== currentUser.id ? `
            <div class="rr-person-actions">
              <button class="btn btn-sm btn-outline" data-edit-staff="${u.id}">Editar</button>
            </div>` : ''}
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-edit-staff]').forEach(b => {
      b.addEventListener('click', () => {
        const u = staff.find(s => s.id === Number(b.dataset.editStaff));
        abrirModalUsuario(u);
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer el personal', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

// La tabla de quién puede qué, para no tener que acordarse.
function renderPermTable() {
  const filas = [
    ['Ver todas las cuentas y todas las clases', ['Dirección', 'Subdirección', 'Secretaría']],
    ['Crear y editar cuentas de estudiante y profesor', ['Dirección', 'Subdirección', 'Secretaría']],
    ['Restablecer contraseñas', ['Dirección', 'Subdirección', 'Secretaría', 'Profesorado (los suyos)']],
    ['Emitir códigos de estudiante', ['Dirección', 'Subdirección', 'Secretaría', 'Profesorado']],
    ['Emitir códigos de profesor', ['Dirección', 'Subdirección']],
    ['Crear cargos de dirección', ['Dirección']],
    ['Borrar cuentas', ['Dirección']],
    ['Apagar minijuegos en toda la escuela', ['Dirección', 'Subdirección']],
    ['Apagar minijuegos en una clase', ['Profesorado']],
    ['Publicar avisos', ['Dirección', 'Subdirección', 'Secretaría', 'Profesorado']]
  ];

  document.getElementById('permTable').innerHTML = filas.map(([que, quienes]) => `
    <div class="rr-perm-row">
      <span>${rrEscapeHtml(que)}</span>
      <span>${quienes.map(q => `<em>${rrEscapeHtml(q)}</em>`).join('')}</span>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

async function loadAnnouncements() {
  const box = document.getElementById('allAnnouncements');
  try {
    const { announcements } = await rrApi('/api/announcements');
    box.innerHTML = announcements.length
      ? announcements.map(a => `
          <div class="card rr-announce">
            <h3>${rrEscapeHtml(a.title)}</h3>
            <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
            <p>${rrEscapeHtml(a.content)}</p>
            <button class="btn btn-sm btn-danger" data-del-ann="${a.id}">Borrar</button>
          </div>`).join('')
      : `<div class="card">${rrEmptyState({
          pose: 'ghost', title: 'El tablero está vacío',
          text: 'Publica el primer aviso con el botón de arriba.'
        })}</div>`;

    box.querySelectorAll('[data-del-ann]').forEach(b => {
      rrConfirmButton(b, 'Pulsa otra vez para borrarlo', async () => {
        try {
          await rrApi(`/api/announcements/${b.dataset.delAnn}`, { method: 'DELETE' });
          rrToast('Aviso borrado.', 'success');
          loadAnnouncements();
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer los avisos', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Resumen (vive dentro de la cuenta)
// ---------------------------------------------------------------------------

async function loadStats() {
  try {
    const stats = await rrApi('/api/admin/stats');

    document.getElementById('profileSummary').innerHTML = `
      <h3>Tu escuela</h3>
      <div class="rr-summary-rows">
        <div><span>Cuentas en total</span><strong>${stats.totalUsers}</strong></div>
        <div><span>Estudiantes</span><strong>${stats.totalStudents}</strong></div>
        <div><span>Profesorado</span><strong>${stats.totalTeachers}</strong></div>
        <div><span>Subdirección</span><strong>${stats.totalSubdirectors}</strong></div>
        <div><span>Secretaría</span><strong>${stats.totalSecretaries}</strong></div>
        <div><span>Clases</span><strong>${stats.totalClasses}</strong></div>
        <div><span>Cuentas activas</span><strong>${stats.activeUsers}</strong></div>
        ${stats.inactiveUsers ? `<div><span>Inactivas</span><strong>${stats.inactiveUsers}</strong></div>` : ''}
      </div>`;

    const total = stats.byLevel.reduce((n, l) => n + l.count, 0) || 1;
    document.getElementById('levelBreakdown').innerHTML = `
      <h3>Estudiantes por nivel</h3>
      ${stats.byLevel.map(l => `
        <div class="rr-level-row">
          <span>${rrEscapeHtml(l.level)}</span>
          <div class="rr-level-bar"><i style="width:${Math.round((l.count / total) * 100)}%"></i></div>
          <strong>${l.count}</strong>
        </div>`).join('')}`;

    return stats;
  } catch (err) {
    document.getElementById('profileSummary').innerHTML = rrEmptyState({
      pose: 'sad', title: 'No pude traer los números', text: rrEscapeHtml(err.message)
    });
  }
}

function renderRobinSays(stats) {
  const box = document.getElementById('robinSays');
  if (!box || !stats) return;

  if (!stats.totalTeachers) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: 'Todavía no hay profesorado. Emite un <strong>código personal de profesor</strong> aquí abajo y dáselo a la primera persona: sirve una sola vez y se quema al usarlo.'
    });
  } else if (!stats.totalStudents) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: 'Ya hay profesorado pero ningún estudiante. Reparte el <strong>código permanente de estudiantes</strong>, o deja que cada profesor emita los suyos con nivel y grado ya puestos.'
    });
  } else {
    box.innerHTML = rrRobinSays({
      pose: 'happy',
      text: `Tu escuela lleva <strong>${stats.totalStudents}</strong> ${stats.totalStudents === 1 ? 'estudiante' : 'estudiantes'} y <strong>${stats.totalTeachers}</strong> del profesorado, repartidos en <strong>${stats.totalClasses}</strong> ${stats.totalClasses === 1 ? 'clase' : 'clases'}.`
    });
  }
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function helloHtml() {
  return `
    <div class="rr-chat-hello" id="chatHello">
      <span class="rr-hello-robin" data-rr-galeria data-bob></span>
      <h3>¿En qué te ayudo?</h3>
      <p>Redacto comunicados, ordeno una semana complicada y te ayudo a decidir cómo repartir grupos. Pregúntame concreto y te contesto concreto.</p>
      <div class="rr-chips" id="chatChips">
        <button class="rr-chip" type="button">Redacta un aviso sobre la reunión de padres</button>
        <button class="rr-chip" type="button">¿Cómo organizo el calendario de exámenes?</button>
        <button class="rr-chip" type="button">Recuérdame revisar las matrículas el lunes</button>
      </div>
    </div>`;
}

function wireChips() {
  document.querySelectorAll('#chatChips .rr-chip').forEach(chip => {
    chip.addEventListener('click', () => chat.ask(chip.textContent));
  });
}

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['admin', 'subdirector', 'secretary']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'accounts');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 👋`;
  document.getElementById('welcomeSub').textContent =
    `${currentUser.roleLabel}${currentUser.schoolName ? ' · ' + currentUser.schoolName : ''}`;
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';
  document.getElementById('profileName').textContent = currentUser.fullName;
  document.getElementById('profileRole').textContent = currentUser.roleLabel;
  document.getElementById('profileRole').className = `pill pill-${currentUser.role}`;
  document.getElementById('profileSchool').textContent = currentUser.schoolName || '';
  pintarFoto(currentUser.profilePic);

  // Secretaría no emite códigos de profesor: su formulario ni aparece.
  if (!puedo('codes.teacher')) {
    document.getElementById('teacherCodeCard').hidden = true;
    document.getElementById('teacherCodeLead').textContent =
      'Los códigos de profesor solo los emiten dirección y subdirección. Aquí puedes ver los que ya se emitieron, pero no crear nuevos.';
  }
  // Renombrar la escuela tampoco es de cualquiera.
  if (!puedo('school.rename')) {
    document.getElementById('schoolNameCard').hidden = true;
  }

  chat = rrCreateChat({
    body: document.getElementById('chatBody'),
    form: document.getElementById('chatForm'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    hello: null,
    mode: document.getElementById('chatMode')
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

  document.addEventListener('rr:open-chat', async (e) => {
    try {
      const { messages } = await rrApi(`/api/chats/${e.detail}`);
      chat.load(e.detail, messages);
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });
  document.addEventListener('rr:new-chat', () => {
    chat.reset(helloHtml());
    wireChips();
    rrSetActiveChat(null);
    rrShowSection('chat');
  });

  // ---- Secciones bajo demanda ----
  const cargado = {};
  document.addEventListener('rr:section', (e) => {
    const id = e.detail;
    // La conexión con Claude se monta la primera vez que se abre la
    // configuración, no al cargar el panel.
    if (id === 'settings' && !cargado.ai) {
      cargado.ai = true;
      rrMountAiSettings(document.getElementById('aiSettings'));
    }
    // "Cuentas" es ahora una sola pantalla con los códigos, el listado, el
    // personal de dirección y el margen de Robin. Cada bloque se trae sus
    // datos la primera vez que se abre, no antes.
    if (id === 'accounts' && !cargado.accounts) { cargado.accounts = true; loadUsers(); }
    if (id === 'accounts' && !cargado.staff && puedo('staff.manage')) { cargado.staff = true; loadStaff(); }
    if (id === 'classes' && !cargado.classes) { cargado.classes = true; loadAllClasses(); }
    if (id === 'announcements' && !cargado.ann) { cargado.ann = true; loadAnnouncements(); }
    if (id === 'profile') loadStats();
    if (id === 'settings') renderPermTable();
  });

  // ---- El margen de Robin de toda la escuela ----
  // Tres deslizadores, uno por grupo, en porcentaje sobre el punto de partida.
  // Solo se dibujan para quien puede moverlos: al resto no le sirve de nada
  // ver un control que no puede tocar.
  const limitsBlock = document.getElementById('limitsBlock');
  if (limitsBlock && puedo('school.limits')) {
    const campos = {
      student: ['limStudent', 'limStudentOut'],
      teacher: ['limTeacher', 'limTeacherOut'],
      staff: ['limStaff', 'limStaffOut']
    };

    // El número de al lado sigue al deslizador mientras se arrastra.
    Object.values(campos).forEach(([input, out]) => {
      const campo = document.getElementById(input);
      const eco = document.getElementById(out);
      const pintar = () => {
        eco.textContent = `${campo.value} %`;
        eco.classList.toggle('subido', Number(campo.value) > 100);
      };
      campo.addEventListener('input', pintar);
      pintar();
    });

    // Lo que hay guardado viene con la ficha de la escuela.
    rrApi('/api/schools/mine').then(({ aiLimits }) => {
      if (!aiLimits) return;
      limitsBlock.hidden = false;
      Object.entries(campos).forEach(([grupo, [input, out]]) => {
        const campo = document.getElementById(input);
        campo.value = aiLimits[grupo] || 100;
        campo.dispatchEvent(new Event('input'));
      });
    }).catch(() => {});

    document.getElementById('limitsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('limitsBtn');
      const error = document.getElementById('limitsError');
      error.classList.remove('show');
      btn.disabled = true;
      btn.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });
      try {
        const { aiLimits } = await rrApi('/api/schools/mine/limits', {
          method: 'PUT',
          body: {
            student: Number(document.getElementById('limStudent').value),
            teacher: Number(document.getElementById('limTeacher').value),
            staff: Number(document.getElementById('limStaff').value)
          }
        });
        Object.entries(campos).forEach(([grupo, [input]]) => {
          const campo = document.getElementById(input);
          campo.value = aiLimits[grupo];
          campo.dispatchEvent(new Event('input'));
        });
        rrToast('Listo: el margen nuevo cuenta desde hoy.', 'success');
      } catch (err) {
        error.textContent = err.message;
        error.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar el margen';
      }
    });
  }

  // ---- Código personal de profesor ----
  const tcForm = document.getElementById('teacherCodeForm');
  if (tcForm) {
    tcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('tcBtn');
      btn.disabled = true;
      btn.innerHTML = rrLoadingHtml('Generando', { size: 'inline' });
      try {
        const { code } = await rrApi('/api/codes', {
          method: 'POST',
          body: {
            type: 'teacher',
            forName: document.getElementById('tcName').value.trim(),
            note: document.getElementById('tcNote').value.trim() || undefined
          }
        });

        document.getElementById('codeFresh').innerHTML = `
          <div class="card rr-code-card" style="max-width:420px;margin:18px 0">
            <h3>Para ${rrEscapeHtml(code.forName)}</h3>
            <p>Un solo uso. En cuanto lo escriba al crear su cuenta, se quema.</p>
            <span class="rr-code-value">${rrEscapeHtml(code.code)}</span>
            <button class="btn btn-sm btn-primary" id="copyFresh">Copiar código</button>
          </div>`;
        document.getElementById('copyFresh').addEventListener('click', (ev) => rrCopy(code.code, ev.target));
        rrConfetti(document.getElementById('codeFresh'));
        e.target.reset();
        loadNominalCodes();
      } catch (err) {
        rrToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generar código de profesor';
      }
    });
  }

  // ---- Cuentas ----
  const userModal = document.getElementById('userModalBackdrop');
  document.getElementById('newUserBtn').addEventListener('click', () => abrirModalUsuario(null));
  document.getElementById('cancelUser').addEventListener('click', () => userModal.classList.remove('open'));
  userModal.addEventListener('click', e => { if (e.target === userModal) userModal.classList.remove('open'); });
  document.getElementById('uRole').addEventListener('change', pintarPistaDeRol);

  const staffBlock = document.getElementById('staffBlock');
  if (staffBlock && puedo('staff.manage')) staffBlock.hidden = false;

  const staffBtn = document.getElementById('newStaffBtn');
  if (staffBtn) {
    if (!puedo('staff.manage')) staffBtn.hidden = true;
    staffBtn.addEventListener('click', () => abrirModalUsuario(null, 'subdirector'));
  }

  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('userError');
    errBox.classList.remove('visible');
    const btn = document.getElementById('userBtn');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });

    const id = document.getElementById('uId').value;
    const payload = {
      fullName: document.getElementById('uFullName').value.trim(),
      email: document.getElementById('uEmail').value.trim() || undefined,
      role: document.getElementById('uRole').value,
      status: document.getElementById('uStatus').value,
      level: document.getElementById('uLevel').value || undefined,
      grade: document.getElementById('uGrade').value.trim() || undefined
    };
    const password = document.getElementById('uPassword').value;
    if (password) payload.password = password;
    // Nadie se cambia el rol a sí mismo: el servidor lo rechaza, así que aquí
    // ni se manda.
    if (id && Number(id) === currentUser.id) delete payload.role;

    try {
      await rrApi(id ? `/api/admin/users/${id}` : '/api/admin/users', {
        method: id ? 'PUT' : 'POST',
        body: payload
      });
      rrToast(id ? 'Cuenta actualizada.' : 'Cuenta creada.', 'success');
      userModal.classList.remove('open');
      loadUsers();
      loadStaff();
      loadStats();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cuenta';
    }
  });

  let buscando = null;
  document.getElementById('searchQ').addEventListener('input', () => {
    clearTimeout(buscando);
    buscando = setTimeout(loadUsers, 260);
  });
  ['filterRole', 'filterLevel', 'filterStatus'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadUsers);
  });

  // ---- Avisos ----
  const annModal = document.getElementById('announceModalBackdrop');
  document.getElementById('newAnnouncementBtn').addEventListener('click', () => annModal.classList.add('open'));
  document.getElementById('cancelAnnounce').addEventListener('click', () => annModal.classList.remove('open'));
  annModal.addEventListener('click', e => { if (e.target === annModal) annModal.classList.remove('open'); });

  document.getElementById('announceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('announceBtn');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Publicando', { size: 'inline' });
    try {
      await rrApi('/api/announcements', {
        method: 'POST',
        body: {
          title: document.getElementById('aTitle').value.trim(),
          content: document.getElementById('aContent').value.trim(),
          level: document.getElementById('aLevel').value
        }
      });
      rrToast('Aviso publicado.', 'success');
      annModal.classList.remove('open');
      e.target.reset();
      loadAnnouncements();
    } catch (err) {
      const box = document.getElementById('announceError');
      box.textContent = err.message;
      box.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar aviso';
    }
  });

  // ---- Nombre de la escuela ----
  const nameForm = document.getElementById('schoolNameForm');
  if (nameForm) {
    nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { school } = await rrApi('/api/schools/mine', {
          method: 'PUT', body: { name: document.getElementById('schoolNameInput').value.trim() }
        });
        miEscuela = school;
        rrToast('Nombre actualizado.', 'success');
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  }

  // ---- Perfil ----
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

  await loadSchoolCodes();
  await loadNominalCodes();
  cargado.accounts = true;
  loadUsers();
  if (puedo('staff.manage')) { cargado.staff = true; loadStaff(); }
  const stats = await loadStats();
  renderRobinSays(stats);
})();
