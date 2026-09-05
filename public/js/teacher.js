// public/js/teacher.js
// Panel del profesor: avisos, clases con actividades, lista de estudiantes y
// su propia lista de pendientes.

let currentUser = null;

function announcementCard(a, canDelete) {
  return `
    <div class="card rr-announce">
      <h3>${rrEscapeHtml(a.title)}</h3>
      <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
      <p>${rrEscapeHtml(a.content)}</p>
      ${canDelete ? `<button class="btn btn-sm btn-danger" style="margin-top:10px" data-delete-announcement="${a.id}">Borrar</button>` : ''}
    </div>`;
}

// ---- Clases ----------------------------------------------------------------

function renderTeacherClasses(classes) {
  document.getElementById('statClasses').textContent = classes.length;
  document.getElementById('teacherClasses').innerHTML = classes.length ? classes.map(item => `
    <div class="card rr-class-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="min-width:220px">
          <h3>${rrEscapeHtml(item.name)}</h3>
          <p>${rrEscapeHtml(item.description || 'Sin descripción')}</p>
          <span class="pill">${item.visibility === 'private' ? 'Privada' : 'Pública'}</span>
          ${item.level ? `<span class="pill">${rrEscapeHtml(item.level)}</span>` : ''}
          ${item.visibility === 'private' ? `<span class="pill">código <span class="class-code">${rrEscapeHtml(item.joinCode)}</span></span>` : ''}
          <div class="text-muted" style="font-size:13px;margin-top:8px">
            ${item.studentIds.length} estudiante${item.studentIds.length === 1 ? '' : 's'}
          </div>
        </div>
        <form class="invite-form" data-class-id="${item.id}">
          <label>Invitar por ID de estudiante</label>
          <div>
            <input name="studentCode" placeholder="STU-00002" required />
            <button class="btn btn-sm btn-dark" type="submit">Invitar</button>
          </div>
        </form>
      </div>

      <div style="border-top:1px solid var(--rr-line);padding-top:16px;margin-top:16px">
        <h4 style="margin-bottom:10px;font-size:14px">Actividades</h4>
        <div id="activities-${item.id}" style="margin-bottom:12px;font-size:13.5px;color:var(--rr-text-muted)">Cargando…</div>
        <form class="activity-form" data-class-id="${item.id}" style="display:flex;gap:8px">
          <input name="title" placeholder="Nueva actividad…" required style="flex:1" />
          <button class="btn btn-sm btn-outline" type="submit">Añadir</button>
        </form>
      </div>
    </div>`).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Aún no tienes clases',
        text: 'Crea la primera clase y podrás invitar estudiantes, publicar actividades y llevar su avance.'
      })}</div>`;

  document.querySelectorAll('.invite-form').forEach(form => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await rrApi(`/api/classes/${form.dataset.classId}/invite`, {
          method: 'POST',
          body: { studentCode: form.studentCode.value }
        });
        rrToast('Invitación enviada.', 'success');
        form.reset();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  document.querySelectorAll('.activity-form').forEach(form => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await rrApi(`/api/activities/class/${form.dataset.classId}`, {
          method: 'POST',
          body: { title: form.title.value }
        });
        rrToast('Actividad publicada. Ya se avisó al grupo.', 'success');
        form.reset();
        loadActivities(form.dataset.classId);
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  classes.forEach(item => loadActivities(item.id));
}

async function loadActivities(classId) {
  const box = document.getElementById(`activities-${classId}`);
  if (!box) return;
  try {
    const { activities } = await rrApi(`/api/activities/class/${classId}`);
    box.innerHTML = activities.length
      ? activities.map(a => `
          <div style="padding:7px 0;border-bottom:1px solid var(--rr-line)">
            <strong style="color:var(--rr-text)">${rrEscapeHtml(a.title)}</strong>
            <span style="font-size:12px"> · ${rrFormatDate(a.createdAt)}</span>
          </div>`).join('')
      : 'Todavía no hay actividades en esta clase.';
  } catch (err) {
    box.textContent = 'No se pudieron cargar las actividades.';
  }
}

async function loadTeacherClasses() {
  const { classes } = await rrApi('/api/classes');
  renderTeacherClasses(classes);
}

// ---- Avisos y lista de estudiantes ----------------------------------------

async function loadAnnouncements() {
  const { announcements } = await rrApi('/api/announcements');
  const mine = announcements.filter(a => a.authorId === currentUser.id);
  document.getElementById('statAnnouncements').textContent = mine.length;

  document.getElementById('overviewAnnouncements').innerHTML = mine.length
    ? mine.slice(0, 3).map(a => announcementCard(a, false)).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Todavía no has publicado nada',
        text: 'Escribe un aviso arriba y llegará al tablero de tus estudiantes.'
      })}</div>`;

  document.getElementById('fullAnnouncements').innerHTML = announcements.length
    ? announcements.map(a => announcementCard(a, a.authorId === currentUser.id)).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'El tablero de la escuela está vacío',
        text: 'Ni la dirección ni los demás profesores han publicado avisos todavía.'
      })}</div>`;

  document.querySelectorAll('[data-delete-announcement]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este aviso?')) return;
      try {
        await rrApi(`/api/announcements/${btn.dataset.deleteAnnouncement}`, { method: 'DELETE' });
        rrToast('Aviso borrado.', 'success');
        loadAnnouncements();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });
}

async function loadRoster(level) {
  const { students } = await rrApi(`/api/roster${level ? '?level=' + encodeURIComponent(level) : ''}`);
  document.getElementById('statRoster').textContent = students.length;
  document.getElementById('rosterBody').innerHTML = students.length
    ? students.map(s => `
        <tr>
          <td><strong>${rrEscapeHtml(s.fullName)}</strong></td>
          <td class="text-muted" style="font-family:var(--rr-mono);font-size:12.5px">${rrEscapeHtml(s.studentCode || '—')}</td>
          <td>${s.email ? rrEscapeHtml(s.email) : '<span class="text-muted">—</span>'}</td>
          <td><span class="pill pill-student">${rrEscapeHtml(s.level || '—')}</span></td>
          <td>${rrEscapeHtml(s.grade || '—')}</td>
        </tr>`).join('')
    : `<tr><td colspan="5">${rrEmptyState({
        pose: 'ghost',
        title: 'Nadie en este nivel',
        text: 'Comparte el código de estudiantes de la escuela para que se registren.'
      })}</td></tr>`;
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

// ---------------------------------------------------------------------------

// Robin recibe al profesor con lo que tiene entre manos hoy.
function renderRobinSays(clases, estudiantes) {
  const box = document.getElementById('robinSays');
  if (!box) return;

  if (!clases) {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: 'Crea tu primera clase, invita a tus estudiantes con su código y publica una actividad. Yo te aviso cuando alguien se una.'
    });
  } else {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: `Llevas <strong>${clases} ${clases === 1 ? 'clase' : 'clases'}</strong> y <strong>${estudiantes} ${estudiantes === 1 ? 'estudiante' : 'estudiantes'}</strong> en tu nivel. Si publicas un aviso, les llega al tablero de una vez.`
    });
  }
}

(async () => {
  currentUser = await rrRequireSession(['teacher']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'overview');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 🍎`;
  document.getElementById('welcomeSub').textContent = currentUser.schoolName
    ? `${currentUser.schoolName}${currentUser.level ? ' · ' + currentUser.level : ''}`
    : 'Panel del profesor';
  document.getElementById('statLevel').textContent = currentUser.level || '—';
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';
  document.getElementById('rosterLevel').value = currentUser.level || '';

  window.rrTaskPanel = rrMountTaskPanel(document.getElementById('taskPanel'));

  try {
    await Promise.all([
      loadAnnouncements(),
      loadRoster(currentUser.level || ''),
      loadTeacherClasses()
    ]);
    renderRobinSays(
      Number(document.getElementById('statClasses').textContent) || 0,
      Number(document.getElementById('statRoster').textContent) || 0
    );
  } catch (err) {
    rrToast(err.message, 'error');
  }

  document.getElementById('rosterLevel').addEventListener('change', e => loadRoster(e.target.value));

  document.getElementById('classForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await rrApi('/api/classes', {
        method: 'POST',
        body: {
          name: document.getElementById('className').value.trim(),
          description: document.getElementById('classDescription').value.trim(),
          visibility: document.getElementById('classVisibility').value,
          level: document.getElementById('classLevel').value
        }
      });
      e.target.reset();
      await loadTeacherClasses();
      rrToast('Clase creada.', 'success');
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  // Modal de avisos
  const backdrop = document.getElementById('announceModalBackdrop');
  document.getElementById('newAnnouncementBtn').addEventListener('click', () => {
    document.getElementById('aLevel').value = currentUser.level || '';
    backdrop.classList.add('open');
  });
  document.getElementById('cancelAnnounce').addEventListener('click', () => backdrop.classList.remove('open'));
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('open'); });

  document.getElementById('announceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('announceError');
    errorBox.classList.remove('visible');
    const btn = document.getElementById('announceBtn');
    btn.disabled = true;
    btn.textContent = 'Publicando…';

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
      backdrop.classList.remove('open');
      document.getElementById('announceForm').reset();
      loadAnnouncements();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar aviso';
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
      await rrApi('/api/profile', {
        method: 'PUT',
        body: {
          fullName: document.getElementById('pFullName').value.trim(),
          currentPassword: document.getElementById('pCurrentPassword').value,
          password: document.getElementById('pNewPassword').value,
          profilePic
        }
      });
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
