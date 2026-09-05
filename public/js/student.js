// public/js/student.js
// Panel del estudiante: avisos de su nivel, clases, notificaciones y su
// propia lista de pendientes.

let currentUser = null;

function announcementCard(a) {
  return `
    <div class="card rr-announce">
      <h3>${rrEscapeHtml(a.title)}</h3>
      <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
      <p>${rrEscapeHtml(a.content)}</p>
    </div>`;
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
    const joined = item.studentIds && item.studentIds.includes(currentUser.id);
    return `
      <div class="card rr-class-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <h3>${rrEscapeHtml(item.name)}</h3>
            <p>${rrEscapeHtml(item.description || 'Sin descripción')}</p>
            <span class="pill">${item.visibility === 'private' ? 'Privada' : 'Pública'}</span>
            ${item.level ? `<span class="pill">${rrEscapeHtml(item.level)}</span>` : ''}
            <span class="pill">Profesor: ${rrEscapeHtml(item.teacherName)}</span>
          </div>
          ${joined
            ? '<span class="pill pill-active">Ya estás dentro</span>'
            : `<button class="btn btn-sm btn-outline" data-join-class="${item.id}">Unirme</button>`}
        </div>
        ${joined ? `
          <div style="border-top:1px solid var(--rr-line);padding-top:16px;margin-top:16px">
            <h4 style="margin-bottom:8px;font-size:14px">Actividades</h4>
            <div id="student-activities-${item.id}" style="font-size:13.5px;color:var(--rr-text-muted);margin-bottom:16px">Cargando…</div>
            <h4 style="margin-bottom:8px;font-size:14px">Compañeros</h4>
            <div id="student-members-${item.id}" style="font-size:13.5px;color:var(--rr-text-muted)">Cargando…</div>
          </div>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-join-class]').forEach(button => {
    button.addEventListener('click', async () => {
      const code = prompt('Si la clase es privada, escribe su código (si es pública, deja esto vacío):') || '';
      try {
        await rrApi(`/api/classes/${button.dataset.joinClass}/join`, { method: 'POST', body: { code } });
        rrToast('¡Te uniste a la clase!', 'success');
        await loadStudentClasses();
        await loadNotifications();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  classes.forEach(item => {
    if (item.studentIds && item.studentIds.includes(currentUser.id)) {
      loadStudentActivities(item.id);
      loadStudentMembers(item.id);
    }
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

async function loadStudentActivities(classId) {
  const box = document.getElementById(`student-activities-${classId}`);
  if (!box) return;
  try {
    const { activities } = await rrApi(`/api/activities/class/${classId}`);
    box.innerHTML = activities.length
      ? activities.map(a => `
          <div style="padding:7px 0;border-bottom:1px solid var(--rr-line)">
            <strong style="color:var(--rr-text)">${rrEscapeHtml(a.title)}</strong>
            <span style="font-size:12px"> · ${rrFormatDate(a.createdAt)}</span>
          </div>`).join('')
      : 'Sin actividades por ahora. Robin te avisa cuando llegue la primera.';
  } catch {
    box.textContent = 'No se pudieron cargar las actividades.';
  }
}

async function loadStudentClasses() {
  const { classes } = await rrApi('/api/classes');
  renderStudentClasses(classes);
}

// ---- Notificaciones --------------------------------------------------------

async function loadNotifications() {
  const { notifications } = await rrApi('/api/notifications');
  rrSetBadge('notifications', notifications.filter(n => !n.read).length);

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
        text: 'Aquí llegan las invitaciones a clases y los mensajes de tus profesores.'
      })}</div>`;

  document.querySelectorAll('[data-accept-invite]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await rrApi(`/api/classes/${button.dataset.acceptInvite}/join`, { method: 'POST', body: {} });
        rrToast('¡Te uniste a la clase!', 'success');
        await loadNotifications();
        await loadStudentClasses();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-read-note]').forEach(button => {
    button.addEventListener('click', async () => {
      await rrApi(`/api/notifications/${button.dataset.readNote}/read`, { method: 'PUT' });
      await loadNotifications();
      renderRobinSays(window.rrLastAnnouncements, window.rrLastNotifications);
    });
  });

  window.rrLastNotifications = notifications;
  return { notifications };
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

// Robin recibe al estudiante contando lo que hay de nuevo: si trajo correo se
// asoma de mensajero, y si no, saluda y recuerda que está para preguntarle.
function renderRobinSays(announcements, notifications) {
  const box = document.getElementById('robinSays');
  if (!box) return;

  const sinLeer = (notifications || []).filter(n => !n.read).length;
  const avisos = (announcements || []).length;

  if (sinLeer) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: `Te traje <strong>${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}</strong>. Están esperándote en tus notificaciones.`,
      action: '<button class="btn btn-sm btn-primary" data-go="notifications">Ver mis mensajes</button>'
    });
  } else if (avisos) {
    box.innerHTML = rrRobinSays({
      pose: 'mailman',
      text: `El tablero de la escuela tiene <strong>${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}</strong> para tu nivel. Te dejo lo más reciente aquí abajo.`
    });
  } else {
    box.innerHTML = rrRobinSays({
      pose: 'talking',
      text: 'Todo tranquilo por ahora. Si tienes dudas de cualquier materia, ábreme con el botón de abajo a la derecha y pregúntame.'
    });
  }

  const btn = box.querySelector('[data-go]');
  if (btn) btn.addEventListener('click', () => rrShowSection(btn.dataset.go));
}

// ---------------------------------------------------------------------------

(async () => {
  currentUser = await rrRequireSession(['student']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'overview');

  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 👋`;
  document.getElementById('welcomeSub').textContent = currentUser.schoolName
    ? `${currentUser.schoolName}${currentUser.level ? ' · ' + currentUser.level : ''}`
    : (currentUser.level || 'Panel del estudiante');
  document.getElementById('statLevel').textContent = currentUser.level || '—';
  document.getElementById('statGrade').textContent = currentUser.grade || '—';
  document.getElementById('statStudentCode').textContent = currentUser.studentCode || '—';
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';

  window.rrTaskPanel = rrMountTaskPanel(document.getElementById('taskPanel'), {
    onChange: (tasks) => {
      document.getElementById('statTasks').textContent = tasks.filter(t => !t.done).length;
    }
  });

  document.getElementById('goToAnnouncements').addEventListener('click', () => rrShowSection('announcements'));

  try {
    const { announcements } = await rrApi('/api/announcements');
    document.getElementById('overviewAnnouncements').innerHTML = announcements.length
      ? announcements.slice(0, 3).map(announcementCard).join('')
      : `<div class="card">${rrEmptyState({
          pose: 'ghost',
          title: 'Nada para tu nivel todavía',
          text: 'Robin buscó en el tablero de la escuela y no encontró avisos para ti. Vuelve más tarde.'
        })}</div>`;
    document.getElementById('fullAnnouncements').innerHTML = announcements.length
      ? announcements.map(announcementCard).join('')
      : `<div class="card">${rrEmptyState({
          pose: 'ghost',
          title: 'El tablero está vacío',
          text: 'Cuando la dirección o tus profesores publiquen algo, aparecerá aquí.'
        })}</div>`;

    window.rrLastAnnouncements = announcements;
    const { notifications } = await loadNotifications();
    await loadStudentClasses();
    renderRobinSays(announcements, notifications);
  } catch (err) {
    rrToast(err.message, 'error');
  }

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
