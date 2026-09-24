// public/js/teacher.js
// El panel del profesor.
//
// Todo gira alrededor de las clases: dentro de cada una están sus asignaciones,
// su gente y su código para compartir. Lo demás son herramientas alrededor —
// emitir códigos, restablecer contraseñas, apagar minijuegos, publicar avisos.
//
// Dos cosas que se repiten y conviene saber leer:
//   · Invitar y anular usan confirmación en dos clics (ver rrConfirmButton).
//   · Las contraseñas NO se muestran nunca, porque no se guardan en claro.
//     Lo que sí se puede es ponerle una nueva a un estudiante y dictársela.

let currentUser = null;
let taskPanel = null;
let chat = null;
let chatTools = null;   // el selector de modo del compositor
let misClases = [];
let claseActiva = null;   // la clase para la que se está creando una asignación
let attendancePanel = null;  // el pase de lista (ver public/js/attendance.js)

// ---------------------------------------------------------------------------
// Clases
// ---------------------------------------------------------------------------

async function loadClasses() {
  const { classes } = await rrApi('/api/classes');
  misClases = classes;
  renderClasses();
  llenarSelectoresDeClase();
  return classes;
}

function llenarSelectoresDeClase() {
  const opciones = misClases.map(c => `<option value="${c.id}">${rrEscapeHtml(c.name)}</option>`).join('');

  const roster = document.getElementById('rosterClass');
  roster.innerHTML = '<option value="">Todas mis clases</option>' + opciones;

  const codeClass = document.getElementById('codeClass');
  codeClass.innerHTML = '<option value="">Ninguna por ahora</option>' + opciones;

}

function renderClasses() {
  const box = document.getElementById('teacherClasses');

  if (!misClases.length) {
    box.innerHTML = `<div class="card">${rrEmptyState({
      pose: 'ghost',
      title: 'Todavía no tienes clases',
      text: 'Crea la primera con el botón de arriba. Al crearla recibes su código para compartir, y con él tus estudiantes entran solos.'
    })}</div>`;
    return;
  }

  box.innerHTML = misClases.map(item => `
    <div class="card rr-class-card" data-class="${item.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <h3>${rrEscapeHtml(item.name)}</h3>
          <p>${rrEscapeHtml(item.description || 'Sin descripción')}</p>
          <span class="pill">${item.visibility === 'private' ? 'Privada' : 'Pública'}</span>
          ${item.level ? `<span class="pill">${rrEscapeHtml(item.level)}</span>` : ''}
          ${item.subject ? `<span class="pill">${rrEscapeHtml(item.subject)}</span>` : ''}
          <span class="pill">${item.studentCount} ${item.studentCount === 1 ? 'estudiante' : 'estudiantes'}</span>
        </div>
        <div style="text-align:right">
          <div class="rr-class-code">
            <small>Código para compartir</small>
            <strong class="rr-code-mono">${rrEscapeHtml(item.joinCode || '—')}</strong>
          </div>
          <button class="btn btn-sm btn-ghost" data-copy-class="${item.joinCode}">Copiar</button>
        </div>
      </div>

      <div class="rr-row-actions" style="margin-top:14px">
        <button class="btn btn-sm btn-primary" data-new-activity="${item.id}">+ Dejar tarea</button>
        <button class="btn btn-sm btn-soft" data-open-invite="${item.id}">Invitar a alguien</button>
        <button class="btn btn-sm btn-outline" data-members="${item.id}">Ver quién está dentro</button>
      </div>

      <div class="rr-inline-form" data-invite-box="${item.id}" hidden>
        <label for="inv-${item.id}">ID de estudiante o correo de la persona</label>
        <div class="rr-inline-row">
          <input type="text" id="inv-${item.id}" placeholder="STU-00007  o  persona@correo.com" autocomplete="off" />
          <button class="btn btn-sm btn-primary" data-invite="${item.id}">Invitar</button>
        </div>
        <small>Si ya tiene cuenta personal, al aceptar pasará a ser estudiante de tu escuela y conservará sus pendientes, sus conversaciones y su plan.</small>
      </div>

      <div style="border-top:1px solid var(--rr-line);padding-top:16px;margin-top:16px">
        <h4 style="margin-bottom:10px;font-size:14px">Asignaciones</h4>
        <div id="acts-${item.id}" class="rr-assign-list">Cargando…</div>
      </div>

      <div id="members-${item.id}" hidden style="border-top:1px solid var(--rr-line);padding-top:16px;margin-top:16px"></div>
    </div>`).join('');

  wireClasses();
  misClases.forEach(item => loadActivities(item.id));
}

function wireClasses() {
  document.querySelectorAll('[data-copy-class]').forEach(btn => {
    btn.addEventListener('click', () => rrCopy(btn.dataset.copyClass, btn));
  });

  document.querySelectorAll('[data-new-activity]').forEach(btn => {
    btn.addEventListener('click', () => abrirModalActividad(Number(btn.dataset.newActivity)));
  });

  document.querySelectorAll('[data-members]').forEach(btn => {
    btn.addEventListener('click', () => toggleMembers(Number(btn.dataset.members), btn));
  });

  // Abrir y cerrar la caja de invitar.
  document.querySelectorAll('[data-open-invite]').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = document.querySelector(`[data-invite-box="${btn.dataset.openInvite}"]`);
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('input').focus();
    });
  });

  // Invitar a alguien que ya tiene cuenta.
  //
  // Son dos clics a propósito. El primero no manda nada: el botón cambia y
  // muestra a quién va la invitación; el segundo es el que la envía. Importa
  // sobre todo cuando es una cuenta personal, porque al aceptar esa cuenta
  // pasa a ser de estudiante de la escuela — y eso no se hace por un clic de más.
  document.querySelectorAll('[data-invite]').forEach(btn => {
    const original = btn.textContent;
    let pendiente = null;
    let temporizador = null;

    const desarmar = () => {
      pendiente = null;
      clearTimeout(temporizador);
      btn.textContent = original;
      btn.classList.remove('rr-confirming');
    };

    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.invite);
      const input = document.getElementById(`inv-${id}`);
      const quien = input.value.trim();
      if (!quien) return input.focus();

      if (pendiente !== quien) {
        pendiente = quien;
        btn.textContent = `Pulsa otra vez para invitar a ${quien}`;
        btn.classList.add('rr-confirming');
        temporizador = setTimeout(desarmar, 6000);
        return;
      }

      desarmar();
      btn.disabled = true;
      try {
        const body = quien.toUpperCase().startsWith('STU-')
          ? { studentCode: quien }
          : { email: quien };
        const data = await rrApi(`/api/classes/${id}/invite`, { method: 'POST', body });
        rrToast(data.message, 'success');
        input.value = '';
        document.querySelector(`[data-invite-box="${id}"]`).hidden = true;
      } catch (err) {
        rrToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function toggleMembers(classId, btn) {
  const box = document.getElementById(`members-${classId}`);
  if (!box.hidden) {
    box.hidden = true;
    btn.textContent = 'Ver quién está dentro';
    return;
  }

  box.hidden = false;
  btn.textContent = 'Ocultar la lista';
  box.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  try {
    const { members } = await rrApi(`/api/classes/${classId}/members`);
    const estudiantes = members.filter(m => m.role === 'student');

    box.innerHTML = `
      <h4 style="margin-bottom:10px;font-size:14px">Quién está dentro (${estudiantes.length})</h4>
      ${estudiantes.length ? `
        <div class="rr-people-grid">
          ${estudiantes.map(m => `
            <div class="rr-person">
              ${m.profilePic
                ? `<img class="rr-avatar" src="${rrEscapeHtml(m.profilePic)}" alt="" />`
                : '<span class="rr-avatar rr-avatar-placeholder">🎓</span>'}
              <div class="rr-person-main">
                <strong>${rrEscapeHtml(m.fullName)}</strong>
                <div class="id">${rrEscapeHtml(m.studentCode || '—')}</div>
                ${m.email ? `<div class="mail">${rrEscapeHtml(m.email)}</div>` : ''}
                <div class="rr-person-actions">
                  <button class="btn btn-sm btn-danger" data-kick="${classId}:${m.id}">Sacar de la clase</button>
                </div>
              </div>
            </div>`).join('')}
        </div>`
        : '<p class="text-muted" style="font-size:13.5px">Todavía no ha entrado nadie. Comparte el código de la clase o invítalos uno a uno.</p>'}`;

    box.querySelectorAll('[data-kick]').forEach(b => {
      const [cid, sid] = b.dataset.kick.split(':');
      rrConfirmButton(b, 'Pulsa otra vez para sacarlo', async () => {
        try {
          await rrApi(`/api/classes/${cid}/students/${sid}`, { method: 'DELETE' });
          rrToast('Ya no está en la clase. Su cuenta sigue existiendo.', 'success');
          await loadClasses();
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<p class="text-muted">${rrEscapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

async function loadActivities(classId) {
  const box = document.getElementById(`acts-${classId}`);
  if (!box) return;

  try {
    const { activities } = await rrApi(`/api/activities/class/${classId}`);
    if (!activities.length) {
      box.innerHTML = '<p class="text-muted" style="font-size:13.5px;margin:0">Todavía no has dejado ninguna tarea en esta clase.</p>';
      return;
    }

    box.innerHTML = activities.map(a => `
      <div class="rr-assign ${a.submissionCount === a.studentCount && a.studentCount ? 'entregada' : 'pendiente'}">
        <div class="rr-assign-top">
          <div>
            <h3>${rrEscapeHtml(a.title)}</h3>
            <div class="meta">
              ${a.dueDate ? `Entrega ${rrEscapeHtml(rrDayLabel(a.dueDate))} · ` : ''}${a.points || 10} puntos
            </div>
          </div>
          <span class="rr-assign-state ${a.submissionCount ? 'entregada' : 'pendiente'}">
            ${a.submissionCount} de ${a.studentCount} entregaron
          </span>
        </div>
        ${a.description ? `<p>${rrEscapeHtml(a.description)}</p>` : ''}
        <div class="rr-assign-actions">
          <button class="btn btn-sm btn-soft" data-subs="${a.id}">Revisar entregas${a.gradedCount ? ` (${a.gradedCount} calificadas)` : ''}</button>
          <button class="btn btn-sm btn-danger" data-del-act="${a.id}">Borrar</button>
        </div>
        <div class="rr-assign-work" data-subs-box="${a.id}" hidden></div>
      </div>`).join('');

    box.querySelectorAll('[data-subs]').forEach(btn => {
      btn.addEventListener('click', () => toggleSubmissions(Number(btn.dataset.subs), btn));
    });
    box.querySelectorAll('[data-del-act]').forEach(btn => {
      rrConfirmButton(btn, 'Pulsa otra vez para borrarla', async () => {
        try {
          await rrApi(`/api/activities/${btn.dataset.delAct}`, { method: 'DELETE' });
          rrToast('Asignación borrada.', 'success');
          loadActivities(classId);
        } catch (err) {
          rrToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<p class="text-muted" style="font-size:13.5px">${rrEscapeHtml(err.message)}</p>`;
  }
}

async function toggleSubmissions(activityId, btn) {
  const box = document.querySelector(`[data-subs-box="${activityId}"]`);
  if (!box.hidden) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  try {
    const { activity, submissions, missing } = await rrApi(`/api/activities/${activityId}/submissions`);

    box.innerHTML = `
      ${submissions.map(s => `
        <div class="card" style="margin-bottom:10px;padding:16px">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
            <strong>${rrEscapeHtml(s.studentName)}</strong>
            <small class="text-muted">${rrFormatDate(s.updatedAt)}</small>
          </div>
          <p style="white-space:pre-wrap;font-size:14px;margin:10px 0">${rrEscapeHtml(s.text)}</p>
          <div class="form-row">
            <div class="field" style="margin:0">
              <label for="g-${s.id}">Nota (de ${activity.points || 10})</label>
              <input type="number" id="g-${s.id}" value="${s.grade == null ? '' : s.grade}" min="0" max="${activity.points || 10}" />
            </div>
            <div class="field" style="margin:0">
              <label for="f-${s.id}">Comentario</label>
              <input type="text" id="f-${s.id}" value="${rrEscapeHtml(s.feedback || '')}" placeholder="Opcional" />
            </div>
          </div>
          <button class="btn btn-sm btn-primary" data-grade="${s.id}" style="margin-top:10px">Guardar nota</button>
        </div>`).join('')}

      ${missing.length ? `
        <div class="card" style="padding:16px">
          <strong style="font-size:14px">Todavía no entregaron (${missing.length})</strong>
          <p style="font-size:13.5px;color:var(--rr-text-muted);margin:8px 0 0">
            ${missing.map(m => rrEscapeHtml(m.fullName)).join(' · ')}
          </p>
        </div>` : ''}

      ${!submissions.length && !missing.length ? '<p class="text-muted" style="font-size:13.5px">No hay nadie en la clase todavía.</p>' : ''}`;

    box.querySelectorAll('[data-grade]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.grade;
        b.disabled = true;
        try {
          await rrApi(`/api/activities/submissions/${id}`, {
            method: 'PUT',
            body: {
              grade: document.getElementById(`g-${id}`).value,
              feedback: document.getElementById(`f-${id}`).value
            }
          });
          rrAviso('Nota guardada. Ya le llegó el aviso.');
        } catch (err) {
          rrToast(err.message, 'error');
        } finally {
          b.disabled = false;
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<p class="text-muted">${rrEscapeHtml(err.message)}</p>`;
  }
}

function abrirModalActividad(classId) {
  claseActiva = classId;
  const clase = misClases.find(c => c.id === classId);
  document.getElementById('activityModalTitle').textContent = `Nueva tarea en ${clase ? clase.name : 'la clase'}`;
  document.getElementById('activityForm').reset();
  document.getElementById('actPoints').value = 10;
  document.getElementById('activityModalBackdrop').classList.add('open');
}

// ---------------------------------------------------------------------------
// Estudiantes
// ---------------------------------------------------------------------------

async function loadRoster() {
  const box = document.getElementById('rosterList');
  box.innerHTML = '<div class="rr-loader"><div class="spinner"></div></div>';

  const params = new URLSearchParams();
  const level = document.getElementById('rosterLevel').value;
  const classId = document.getElementById('rosterClass').value;
  if (level) params.set('level', level);
  if (classId) params.set('classId', classId);

  try {
    const { students } = await rrApi(`/api/roster?${params}`);
    if (!students.length) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Aquí no hay nadie todavía',
        text: 'Aparecen los estudiantes de tus clases. Emite un código o comparte el código de la clase para que entren.'
      })}</div>`;
      return;
    }

    box.innerHTML = students.map(s => `
      <div class="rr-person">
        ${s.profilePic
          ? `<img class="rr-avatar" src="${rrEscapeHtml(s.profilePic)}" alt="" />`
          : '<span class="rr-avatar rr-avatar-placeholder">🎓</span>'}
        <div class="rr-person-main">
          <strong>${rrEscapeHtml(s.fullName)}</strong>
          <div class="id">${rrEscapeHtml(s.studentCode || '—')}</div>
          <div class="mail">${rrEscapeHtml(s.email || 'sin correo — entra con su ID')}</div>
          <div class="rr-person-tags">
            ${s.level ? `<span class="pill">${rrEscapeHtml(s.level)}</span>` : ''}
            ${s.grade ? `<span class="pill">${rrEscapeHtml(s.grade)}</span>` : ''}
            ${(s.classes || []).map(c => `<span class="pill pill-teacher">${rrEscapeHtml(c.name)}</span>`).join('')}
          </div>
          <div class="rr-person-actions">
            <button class="btn btn-sm btn-soft" data-open-reset="${s.id}">Nueva contraseña</button>
            <button class="btn btn-sm btn-ghost" data-copy-id="${rrEscapeHtml(s.studentCode || '')}">Copiar su ID</button>
          </div>
          <div class="rr-inline-form" data-reset-box="${s.id}" hidden>
            <div class="rr-inline-row">
              <input type="text" id="pw-${s.id}" placeholder="Contraseña nueva" autocomplete="off" />
              <button class="btn btn-sm btn-primary" data-reset="${s.id}">Guardar</button>
            </div>
            <small>Anótala antes de guardar: no se puede volver a ver, solo cambiar. Después díctasela.</small>
          </div>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-open-reset]').forEach(b => {
      b.addEventListener('click', () => {
        const caja = box.querySelector(`[data-reset-box="${b.dataset.openReset}"]`);
        caja.hidden = !caja.hidden;
        if (!caja.hidden) caja.querySelector('input').focus();
      });
    });

    box.querySelectorAll('[data-copy-id]').forEach(b => {
      b.addEventListener('click', () => rrCopy(b.dataset.copyId, b));
    });

    box.querySelectorAll('[data-reset]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.reset;
        const campo = document.getElementById(`pw-${id}`);
        const nueva = campo.value.trim();
        if (!nueva) return campo.focus();
        b.disabled = true;
        try {
          const data = await rrApi(`/api/students/${id}/password`, {
            method: 'POST', body: { password: nueva }
          });
          rrToast(data.message, 'success');
          campo.value = '';
          box.querySelector(`[data-reset-box="${id}"]`).hidden = true;
        } catch (err) {
          rrToast(err.message, 'error');
        } finally {
          b.disabled = false;
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="card">${rrEmptyState({ pose: 'sad', title: 'No pude traer la lista', text: rrEscapeHtml(err.message) })}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

async function loadCodes() {
  const box = document.getElementById('codeList');
  try {
    const { codes } = await rrApi('/api/codes?type=student');
    if (!codes.length) {
      box.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Todavía no has emitido ninguno',
        text: 'Genera uno arriba y dáselo a la persona. En cuanto lo use, aquí se marca como usado y deja de servir.'
      })}</div>`;
      return;
    }

    box.innerHTML = `
      <div class="rr-table-wrap">
        <table class="rr-table">
          <thead><tr><th>Código</th><th>Para</th><th>Nivel</th><th>Clase</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${codes.map(c => `
              <tr>
                <td class="rr-code-mono">${rrEscapeHtml(c.code)}</td>
                <td>${rrEscapeHtml(c.forName || '—')}${c.usedByName ? `<br><small class="text-muted">lo usó ${rrEscapeHtml(c.usedByName)}</small>` : ''}</td>
                <td>${rrEscapeHtml(c.level || '—')}${c.grade ? `<br><small class="text-muted">${rrEscapeHtml(c.grade)}</small>` : ''}</td>
                <td>${rrEscapeHtml(c.className || '—')}</td>
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
          loadCodes();
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
// Avisos
// ---------------------------------------------------------------------------

async function loadAnnouncements() {
  const box = document.getElementById('fullAnnouncements');
  try {
    const { announcements } = await rrApi('/api/announcements');
    box.innerHTML = announcements.length
      ? announcements.map(a => `
          <div class="card rr-announce">
            <h3>${rrEscapeHtml(a.title)}</h3>
            <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
            <p>${rrEscapeHtml(a.content)}</p>
            ${a.authorId === currentUser.id ? `<button class="btn btn-sm btn-danger" data-del-ann="${a.id}">Borrar</button>` : ''}
          </div>`).join('')
      : `<div class="card">${rrEmptyState({
          pose: 'ghost', title: 'El tablero está vacío',
          text: 'Publica el primer aviso con el botón de arriba. Le llega a todo el nivel que elijas.'
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
// Perfil y resumen
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

async function loadSummary() {
  const box = document.getElementById('profileSummary');
  try {
    const data = await rrApi('/api/profile/summary');
    const esc = data.school || {};
    box.innerHTML = `
      <h3>Tu resumen</h3>
      <div class="rr-summary-rows">
        <div><span>Escuela</span><strong>${rrEscapeHtml(esc.name || '—')}</strong></div>
        <div><span>Clases</span><strong>${esc.classes || 0}</strong></div>
        <div><span>Estudiantes</span><strong>${esc.students || 0}</strong></div>
        <div><span>Asignaciones</span><strong>${esc.activities || 0}</strong></div>
        <div><span>Pendientes propios</span><strong>${data.tasks.pending}</strong></div>
        <div><span>Conversaciones</span><strong>${data.chats}</strong></div>
      </div>`;
  } catch (err) {
    box.innerHTML = rrEmptyState({ pose: 'sad', title: 'No pude traer tu resumen', text: rrEscapeHtml(err.message) });
  }
}

// Robin recibe contando lo que hay encima de la mesa.
function renderRobinSays() {
  const box = document.getElementById('robinSays');
  const sinGente = misClases.filter(c => !c.studentCount).length;

  if (!misClases.length) {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: 'Empieza creando tu primera clase. Al crearla te doy su código: con eso tus estudiantes entran solos, sin que tengas que darlos de alta uno a uno.'
    });
  } else if (sinGente) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: `Tienes <strong>${sinGente}</strong> ${sinGente === 1 ? 'clase vacía' : 'clases vacías'}. Comparte su código o emite códigos de estudiante para llenarlas.`
    });
  } else {
    const total = misClases.reduce((n, c) => n + c.studentCount, 0);
    box.innerHTML = rrRobinSays({
      pose: 'happy',
      text: `Llevas <strong>${misClases.length}</strong> ${misClases.length === 1 ? 'clase' : 'clases'} con <strong>${total}</strong> ${total === 1 ? 'estudiante' : 'estudiantes'}. Si quieres ideas para una actividad, pregúntame.`
    });
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function helloHtml() {
  return `
    <div class="rr-chat-hello" id="chatHello">
      <span class="rr-hello-robin" data-rr-galeria data-bob></span>
      <h3>¿Qué preparamos?</h3>
      <p>Contigo puedo desarrollar el tema completo, con ejemplos resueltos y todo: los necesitas para dar clase. Con tus estudiantes no hago eso — a ellos les explico el método.</p>
      <div class="rr-chips" id="chatChips">
        <button class="rr-chip" type="button">Dame 3 actividades para explicar fracciones</button>
        <button class="rr-chip" type="button">Arma una rúbrica para un ensayo corto</button>
        <button class="rr-chip" type="button">¿Cómo explico esto a quien se quedó atrás?</button>
        <button class="rr-chip" type="button">Recuérdame revisar los exámenes mañana</button>
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

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['teacher']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'classes');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 👋`;
  document.getElementById('welcomeSub').textContent = currentUser.schoolName || 'Panel del profesor';
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';
  document.getElementById('profileName').textContent = currentUser.fullName;
  document.getElementById('profileSchool').textContent = currentUser.schoolName || '';
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

  taskPanel = rrMountTaskPanel(document.getElementById('taskPanel'), {});
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

  // Cada sección se carga cuando se abre, no antes.
  let cargado = {};
  document.addEventListener('rr:section', (e) => {
    const id = e.detail;
    // La conexión con Claude se monta la primera vez que se abre la
    // configuración, no al cargar el panel.
    if (id === 'settings' && !cargado.ai) {
      cargado.ai = true;
      rrMountAiSettings(document.getElementById('aiSettings'));
    }
    // El listado de estudiantes y los códigos viven dentro de "Mis clases", así
    // que se cargan al abrir esa pantalla y no antes.
    if (id === 'classes' && !cargado.roster) { cargado.roster = true; loadRoster(); }
    if (id === 'classes' && !cargado.codes) { cargado.codes = true; loadCodes(); }
    if (id === 'announcements' && !cargado.ann) { cargado.ann = true; loadAnnouncements(); }
    if (id === 'profile') loadSummary();

    // El pase de lista se monta la primera vez que se abre y se vuelve a
    // traer cada vez después: el día pudo cambiar, o alguien pudo marcar
    // desde otra pantalla.
    if (id === 'attendance') {
      if (!attendancePanel) attendancePanel = rrMountAttendance(document.getElementById('attendancePanel'));
      else attendancePanel.reload();
    } else if (attendancePanel) {
      // Salir de la pantalla apaga la cámara. Dejarla encendida en segundo
      // plano es una luz verde encendida sin motivo y una cara grabándose
      // mientras nadie mira — las dos cosas están mal.
      attendancePanel.cerrarCamara();
    }
  });


  // ---- Crear clase ----
  const classCard = document.getElementById('classFormCard');
  document.getElementById('newClassBtn').addEventListener('click', () => {
    classCard.hidden = !classCard.hidden;
    if (!classCard.hidden) document.getElementById('className').focus();
  });
  document.getElementById('cancelClass').addEventListener('click', () => { classCard.hidden = true; });

  document.getElementById('classForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { classItem } = await rrApi('/api/classes', {
        method: 'POST',
        body: {
          name: document.getElementById('className').value.trim(),
          subject: document.getElementById('classSubject').value.trim() || undefined,
          description: document.getElementById('classDescription').value.trim(),
          visibility: document.getElementById('classVisibility').value,
          level: document.getElementById('classLevel').value || undefined
        }
      });
      rrToast(`Clase creada. Su código es ${classItem.joinCode}.`, 'success');
      rrConfetti(classCard);
      e.target.reset();
      classCard.hidden = true;
      await loadClasses();
      renderRobinSays();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  // ---- Nueva asignación ----
  const actBackdrop = document.getElementById('activityModalBackdrop');
  document.getElementById('cancelActivity').addEventListener('click', () => actBackdrop.classList.remove('open'));
  actBackdrop.addEventListener('click', e => { if (e.target === actBackdrop) actBackdrop.classList.remove('open'); });

  document.getElementById('activityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('activityBtn');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Publicando', { size: 'inline' });
    try {
      await rrApi(`/api/activities/class/${claseActiva}`, {
        method: 'POST',
        body: {
          title: document.getElementById('actTitle').value.trim(),
          description: document.getElementById('actDescription').value.trim(),
          dueDate: document.getElementById('actDue').value || undefined,
          points: Number(document.getElementById('actPoints').value) || 10
        }
      });
      rrAviso('Tarea publicada. Ya les llegó el aviso.');
      actBackdrop.classList.remove('open');
      loadActivities(claseActiva);
    } catch (err) {
      const box = document.getElementById('activityError');
      box.textContent = err.message;
      box.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar';
    }
  });

  // ---- Códigos ----
  document.getElementById('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('codeBtn');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Generando', { size: 'inline' });

    try {
      const { code } = await rrApi('/api/codes', {
        method: 'POST',
        body: {
          type: 'student',
          forName: document.getElementById('codeName').value.trim(),
          level: document.getElementById('codeLevel').value,
          grade: document.getElementById('codeGrade').value.trim() || undefined,
          classId: document.getElementById('codeClass').value || undefined
        }
      });

      document.getElementById('codeFresh').innerHTML = `
        <div class="card rr-code-card" style="max-width:420px;margin:18px 0">
          <h3>Para ${rrEscapeHtml(code.forName)}</h3>
          <p>Dáselo tal cual. Sirve una sola vez y ya lleva puesto su nivel.</p>
          <span class="rr-code-value">${rrEscapeHtml(code.code)}</span>
          <button class="btn btn-sm btn-primary" data-copy-fresh="${rrEscapeHtml(code.code)}">Copiar código</button>
        </div>`;
      document.querySelector('[data-copy-fresh]').addEventListener('click', (ev) => rrCopy(code.code, ev.target));

      rrConfetti(document.getElementById('codeFresh'));
      e.target.reset();
      loadCodes();
    } catch (err) {
      rrToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generar código';
    }
  });

  // ---- Filtros de la lista de estudiantes ----
  document.getElementById('rosterLevel').addEventListener('change', loadRoster);
  document.getElementById('rosterClass').addEventListener('change', loadRoster);

  // ---- Avisos ----
  const annBackdrop = document.getElementById('announceModalBackdrop');
  document.getElementById('newAnnouncementBtn').addEventListener('click', () => annBackdrop.classList.add('open'));
  document.getElementById('cancelAnnounce').addEventListener('click', () => annBackdrop.classList.remove('open'));
  annBackdrop.addEventListener('click', e => { if (e.target === annBackdrop) annBackdrop.classList.remove('open'); });

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
      rrAviso('Aviso publicado. Ya les llegó.');
      annBackdrop.classList.remove('open');
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

  // ---- Foto y perfil ----
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

  await loadClasses();
  cargado.roster = true;
  loadRoster();
  cargado.codes = true;
  loadCodes();
  renderRobinSays();
})();
