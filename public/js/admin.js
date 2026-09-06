// public/js/admin.js
// Panel del director: resumen de la escuela, los dos códigos de ingreso,
// administración de cuentas y avisos.

let currentUser = null;
let currentSchool = null;
let allUsersCache = [];

// ---- Resumen ---------------------------------------------------------------

async function loadStats() {
  const stats = await rrApi('/api/admin/stats');
  document.getElementById('statTotal').textContent = stats.totalUsers;
  document.getElementById('statStudents').textContent = stats.totalStudents;
  document.getElementById('statTeachers').textContent = stats.totalTeachers;
  document.getElementById('statActive').textContent = stats.activeUsers;

  const max = Math.max(1, ...stats.byLevel.map(l => l.count));
  document.getElementById('levelBreakdown').innerHTML = stats.byLevel.map(level => `
    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:6px">
        <span>${rrEscapeHtml(level.level)}</span><span class="text-muted">${level.count}</span>
      </div>
      <div class="rr-progress"><i style="width:${(level.count / max) * 100}%"></i></div>
    </div>`).join('');
}

// ---- Códigos de ingreso ----------------------------------------------------

function renderNoSchool() {
  document.getElementById('schoolCodes').innerHTML = `
    <div class="card" style="max-width:520px">
      <h3 style="font-size:18px">Todavía no has inscrito tu escuela</h3>
      <p class="text-muted" style="font-size:14px">
        Inscríbela para generar los dos códigos de ingreso: uno para estudiantes y otro para profesores.
      </p>
      <form id="createSchoolForm">
        <div class="field">
          <label for="newSchoolName">Nombre de la escuela</label>
          <input type="text" id="newSchoolName" required placeholder="Centro Escolar San Rafael" />
        </div>
        <button type="submit" class="btn btn-primary" id="createSchoolBtn">Inscribir escuela</button>
      </form>
    </div>`;

  document.getElementById('createSchoolForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createSchoolBtn');
    btn.disabled = true;
    btn.textContent = 'Inscribiendo…';
    try {
      const { school } = await rrApi('/api/schools/mine', {
        method: 'POST',
        body: { name: document.getElementById('newSchoolName').value.trim() }
      });
      currentSchool = school;
      rrToast('¡Escuela inscrita! Ya tienes tus códigos.', 'success');
      renderSchoolCodes();
      loadStats();
    } catch (err) {
      rrToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Inscribir escuela';
    }
  });
}

function renderSchoolCodes() {
  if (!currentSchool) return renderNoSchool();

  document.getElementById('schoolCodes').innerHTML = `
    <div class="rr-code-cards">
      <div class="rr-code-card">
        <div class="who">🎓 Estudiantes</div>
        <div class="code" id="codeStudent">${rrEscapeHtml(currentSchool.studentCode)}</div>
        <p class="note">Quien cree su cuenta con este código entrará como <strong>estudiante</strong> de tu escuela.</p>
        <div class="acts">
          <button class="btn btn-sm btn-outline" data-copy="student">Copiar</button>
          <button class="btn btn-sm btn-ghost" data-regen="student">Generar otro</button>
        </div>
      </div>
      <div class="rr-code-card teacher">
        <div class="who">🍎 Profesores</div>
        <div class="code" id="codeTeacher">${rrEscapeHtml(currentSchool.teacherCode)}</div>
        <p class="note">Quien cree su cuenta con este código entrará como <strong>profesor</strong> de tu escuela.</p>
        <div class="acts">
          <button class="btn btn-sm btn-outline" data-copy="teacher">Copiar</button>
          <button class="btn btn-sm btn-ghost" data-regen="teacher">Generar otro</button>
        </div>
      </div>
    </div>

    <div class="card" style="max-width:560px">
      <h3 style="font-size:16px">Nombre de la escuela</h3>
      <form id="renameForm" style="display:flex;gap:10px;align-items:flex-start;margin-top:10px">
        <input type="text" id="schoolNameInput" value="${rrEscapeHtml(currentSchool.name)}" required />
        <button class="btn btn-primary btn-sm" type="submit" style="padding:12px 20px">Guardar</button>
      </form>
      <p class="hint">Es el nombre que ven quienes verifican un código al registrarse.</p>
    </div>`;

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      rrCopy(btn.dataset.copy === 'student' ? currentSchool.studentCode : currentSchool.teacherCode, btn);
    });
  });

  document.querySelectorAll('[data-regen]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.regen;
      const label = which === 'student' ? 'de estudiantes' : 'de profesores';
      if (!confirm(`¿Generar un código ${label} nuevo? El anterior dejará de funcionar de inmediato.`)) return;
      try {
        const { school } = await rrApi('/api/schools/mine/regenerate', { method: 'POST', body: { which } });
        currentSchool = school;
        renderSchoolCodes();
        const el = document.getElementById(which === 'student' ? 'codeStudent' : 'codeTeacher');
        if (el) el.classList.add('rr-code-flash');
        rrToast('Código nuevo generado.', 'success');
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });

  document.getElementById('renameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { school } = await rrApi('/api/schools/mine', {
        method: 'PUT',
        body: { name: document.getElementById('schoolNameInput').value.trim() }
      });
      currentSchool = school;
      document.getElementById('welcomeSub').textContent = school.name;
      rrToast('Nombre actualizado.', 'success');
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });
}

async function loadSchool() {
  const data = await rrApi('/api/schools/mine');
  currentSchool = data.school;
  if (currentSchool) document.getElementById('welcomeSub').textContent = currentSchool.name;
  renderSchoolCodes();
}

// ---- Cuentas ---------------------------------------------------------------

function buildQuery() {
  const params = new URLSearchParams();
  const map = { q: 'searchQ', role: 'filterRole', level: 'filterLevel', status: 'filterStatus' };
  Object.entries(map).forEach(([key, id]) => {
    const value = document.getElementById(id).value.trim();
    if (value) params.set(key, value);
  });
  return params.toString();
}

async function loadUsers() {
  const { users } = await rrApi('/api/admin/users?' + buildQuery());
  allUsersCache = users;

  document.getElementById('usersBody').innerHTML = users.length ? users.map((u, i) => `
    <tr style="animation-delay:${Math.min(i, 12) * 20}ms">
      <td><strong>${rrEscapeHtml(u.fullName)}</strong>${u.studentCode ? `<div class="text-muted" style="font-size:12px">${rrEscapeHtml(u.studentCode)}</div>` : ''}</td>
      <td>${u.email ? rrEscapeHtml(u.email) : '<span class="text-muted">—</span>'}</td>
      <td><span class="pill pill-${u.role}">${rrEscapeHtml(RR_ROLE_LABEL[u.role] || u.role)}</span></td>
      <td>${u.level ? rrEscapeHtml(u.level) : '<span class="text-muted">—</span>'}</td>
      <td><span class="pill pill-${u.status}">${u.status === 'active' ? 'Activa' : 'Inactiva'}</span></td>
      <td class="text-muted">${rrFormatDate(u.createdAt)}</td>
      <td>
        <div class="rr-row-actions">
          <button class="btn btn-sm btn-outline" data-edit="${u.id}">Editar</button>
          ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" data-delete="${u.id}">Borrar</button>` : ''}
        </div>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="7">${rrEmptyState({
        pose: 'ghost',
        title: 'Ninguna cuenta coincide',
        text: 'Robin revisó toda la escuela con esos filtros y no encontró a nadie. Prueba con otra búsqueda.'
      })}</td></tr>`;

  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(allUsersCache.find(u => u.id === Number(btn.dataset.edit))));
  });
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(Number(btn.dataset.delete)));
  });
}

async function deleteUser(id) {
  const user = allUsersCache.find(u => u.id === id);
  if (!confirm(`¿Borrar la cuenta de ${user.fullName}? No se puede deshacer.`)) return;
  try {
    await rrApi(`/api/admin/users/${id}`, { method: 'DELETE' });
    rrToast('Cuenta borrada.', 'success');
    loadUsers();
    loadStats();
  } catch (err) {
    rrToast(err.message, 'error');
  }
}

function openUserModal(user) {
  const backdrop = document.getElementById('userModalBackdrop');
  document.getElementById('userError').classList.remove('visible');
  document.getElementById('userForm').reset();

  if (user) {
    document.getElementById('userModalTitle').textContent = 'Editar cuenta';
    document.getElementById('uId').value = user.id;
    document.getElementById('uFullName').value = user.fullName;
    document.getElementById('uEmail').value = user.email || '';
    document.getElementById('uRole').value = user.role;
    document.getElementById('uStatus').value = user.status;
    document.getElementById('uLevel').value = user.level || '';
    document.getElementById('uGrade').value = user.grade || '';
    document.getElementById('uPasswordLabel').textContent = 'Nueva contraseña (opcional)';
    document.getElementById('uPassword').placeholder = 'Déjala vacía para no cambiarla';
  } else {
    document.getElementById('userModalTitle').textContent = 'Nueva cuenta';
    document.getElementById('uId').value = '';
    document.getElementById('uStatus').value = 'active';
    document.getElementById('uPasswordLabel').textContent = 'Contraseña';
    document.getElementById('uPassword').placeholder = 'Al menos 6 caracteres';
  }
  backdrop.classList.add('open');
  setTimeout(() => document.getElementById('uFullName').focus(), 80);
}

// ---- Avisos ----------------------------------------------------------------

async function loadAnnouncements() {
  const { announcements } = await rrApi('/api/announcements');
  document.getElementById('allAnnouncements').innerHTML = announcements.length
    ? announcements.map(a => `
      <div class="card rr-announce">
        <h3>${rrEscapeHtml(a.title)}</h3>
        <div class="meta">${rrEscapeHtml(a.authorName)} · ${rrEscapeHtml(a.level)} · ${rrFormatDate(a.createdAt)}</div>
        <p>${rrEscapeHtml(a.content)}</p>
        <button class="btn btn-sm btn-danger" style="margin-top:10px" data-delete-announcement="${a.id}">Borrar</button>
      </div>`).join('')
    : `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Todavía no hay avisos',
        text: 'Publica el primero y toda la escuela lo verá en su tablero.'
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

// ---------------------------------------------------------------------------

// Robin le resume la escuela al director y le recuerda dónde están los códigos,
// que es lo que más se busca el día de la inscripción.
function renderRobinSays() {
  const box = document.getElementById('robinSays');
  if (!box) return;

  const cuentas = Number(document.getElementById('statTotal').textContent) || 0;

  box.innerHTML = cuentas > 1
    ? rrRobinSays({
        pose: 'mailman',
        text: `Tu escuela va en <strong>${cuentas} cuentas</strong>. Los dos códigos de ingreso están en la sección de códigos: el de estudiantes y el de profesores.`,
        action: '<button class="btn btn-sm btn-primary" data-go="codes">Ver los códigos</button>'
      })
    : rrRobinSays({
        pose: 'talking',
        text: 'Todavía estás solo aquí. Reparte los códigos de ingreso de tu escuela y las cuentas van a ir apareciendo en esta lista.',
        action: '<button class="btn btn-sm btn-primary" data-go="codes">Ver los códigos</button>'
      });

  const btn = box.querySelector('[data-go]');
  if (btn) btn.addEventListener('click', () => rrShowSection(btn.dataset.go));
}

(async () => {
  currentUser = await rrRequireSession(['admin']);
  if (!currentUser) return;

  rrRenderShell(currentUser, 'overview');
  document.getElementById('welcomeTitle').textContent = `${rrGreeting()}, ${currentUser.fullName.split(' ')[0]} 🔑`;
  document.getElementById('pFullName').value = currentUser.fullName;
  document.getElementById('pEmail').value = currentUser.email || '';

  try {
    await Promise.all([loadSchool(), loadStats(), loadUsers(), loadAnnouncements()]);
    renderRobinSays();
  } catch (err) {
    rrToast(err.message, 'error');
  }

  document.getElementById('goToCodes').addEventListener('click', () => rrShowSection('codes'));

  ['searchQ', 'filterRole', 'filterLevel', 'filterStatus'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => loadUsers());
  });

  // Modal de cuentas
  const userBackdrop = document.getElementById('userModalBackdrop');
  document.getElementById('newUserBtn').addEventListener('click', () => openUserModal(null));
  document.getElementById('cancelUser').addEventListener('click', () => userBackdrop.classList.remove('open'));
  userBackdrop.addEventListener('click', e => { if (e.target === userBackdrop) userBackdrop.classList.remove('open'); });

  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('userError');
    errorBox.classList.remove('visible');
    const btn = document.getElementById('userBtn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const id = document.getElementById('uId').value;
    const payload = {
      fullName: document.getElementById('uFullName').value.trim(),
      email: document.getElementById('uEmail').value.trim(),
      role: document.getElementById('uRole').value,
      status: document.getElementById('uStatus').value,
      level: document.getElementById('uLevel').value || null,
      grade: document.getElementById('uGrade').value.trim() || null
    };
    const password = document.getElementById('uPassword').value;
    if (password) payload.password = password;

    try {
      if (id) {
        await rrApi(`/api/admin/users/${id}`, { method: 'PUT', body: payload });
        rrToast('Cuenta actualizada.', 'success');
      } else {
        if (!password) throw new Error('Las cuentas nuevas necesitan una contraseña.');
        await rrApi('/api/admin/users', { method: 'POST', body: payload });
        rrToast('Cuenta creada.', 'success');
      }
      userBackdrop.classList.remove('open');
      loadUsers();
      loadStats();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cuenta';
    }
  });

  // Modal de avisos
  const announceBackdrop = document.getElementById('announceModalBackdrop');
  document.getElementById('newAnnouncementBtn').addEventListener('click', () => {
    document.getElementById('announceForm').reset();
    document.getElementById('announceError').classList.remove('visible');
    announceBackdrop.classList.add('open');
  });
  document.getElementById('cancelAnnounce').addEventListener('click', () => announceBackdrop.classList.remove('open'));
  announceBackdrop.addEventListener('click', e => { if (e.target === announceBackdrop) announceBackdrop.classList.remove('open'); });

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
      announceBackdrop.classList.remove('open');
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
      await rrApi('/api/profile', {
        method: 'PUT',
        body: {
          fullName: document.getElementById('pFullName').value.trim(),
          currentPassword: document.getElementById('pCurrentPassword').value,
          password: document.getElementById('pNewPassword').value
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
