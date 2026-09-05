// public/js/sidebar.js
// Dibuja la barra lateral que comparten todos los paneles y conecta el menú
// móvil, el cambio de sección y el botón de salir.

const RR_NAV_BY_ROLE = {
  personal: [
    { group: 'Mi espacio' },
    { id: 'work', label: 'Robin y mis tareas', icon: '✨' },
    { id: 'history', label: 'Historial', icon: '🕘' },
    { group: 'Cuenta' },
    { id: 'profile', label: 'Mi perfil', icon: '⚙️' }
  ],
  admin: [
    { group: 'Escuela' },
    { id: 'overview', label: 'Resumen', icon: '📊' },
    { id: 'codes', label: 'Códigos de ingreso', icon: '🔑' },
    { id: 'accounts', label: 'Cuentas', icon: '👥' },
    { id: 'announcements', label: 'Avisos', icon: '📣' },
    { group: 'Cuenta' },
    { id: 'profile', label: 'Mi perfil', icon: '⚙️' }
  ],
  teacher: [
    { group: 'Mi trabajo' },
    { id: 'overview', label: 'Resumen', icon: '📊' },
    { id: 'classes', label: 'Mis clases', icon: '🏫' },
    { id: 'roster', label: 'Mis estudiantes', icon: '🧑‍🎓' },
    { id: 'announcements', label: 'Avisos', icon: '📣' },
    { group: 'Cuenta' },
    { id: 'tasks', label: 'Mis pendientes', icon: '✅' },
    { id: 'profile', label: 'Mi perfil', icon: '⚙️' }
  ],
  student: [
    { group: 'Mi escuela' },
    { id: 'overview', label: 'Resumen', icon: '📊' },
    { id: 'announcements', label: 'Avisos', icon: '📣' },
    { id: 'classes', label: 'Clases', icon: '🏫' },
    { id: 'notifications', label: 'Notificaciones', icon: '🔔' },
    { group: 'Mi espacio' },
    { id: 'tasks', label: 'Mis pendientes', icon: '✅' },
    { id: 'profile', label: 'Mi perfil', icon: '⚙️' }
  ]
};

function rrRenderShell(user, activeId) {
  const items = RR_NAV_BY_ROLE[user.role] || [];
  const itemsHtml = items.map((item, i) => {
    if (item.group) return `<div class="rr-side-label">${rrEscapeHtml(item.group)}</div>`;
    return `
      <div class="rr-side-link ${item.id === activeId ? 'active' : ''}" data-nav="${item.id}"
           style="animation-delay:${i * 35}ms">
        <span class="ic">${item.icon}</span> ${rrEscapeHtml(item.label)}
        <span class="badge" data-badge="${item.id}" hidden></span>
      </div>`;
  }).join('');

  const subtitle = user.role === 'student' && user.studentCode
    ? user.studentCode
    : (RR_ROLE_LABEL[user.role] || user.role);

  document.getElementById('rrApp').insertAdjacentHTML('afterbegin', `
    <div class="rr-sidebar-scrim" id="rrScrim"></div>
    <aside class="rr-sidebar" id="rrSidebar">
      <a href="/index.html" class="rr-brand">
        <span class="rr-brand-mark" data-rr-mascot data-small></span> roboRobin
      </a>
      ${itemsHtml}
      <div class="rr-side-spacer"></div>
      <div class="rr-side-foot">
        <div class="rr-side-user">
          ${user.profilePic
            ? `<img class="rr-avatar" src="${rrEscapeHtml(user.profilePic)}" alt="" />`
            : '<span class="rr-avatar rr-avatar-placeholder">👤</span>'}
          <span>
            <strong>${rrEscapeHtml(user.fullName)}</strong>
            ${rrEscapeHtml(user.schoolName ? `${subtitle} · ${user.schoolName}` : subtitle)}
          </span>
        </div>
        <div class="rr-side-link" id="rrLogout"><span class="ic">🚪</span> Cerrar sesión</div>
      </div>
    </aside>
  `);

  const sidebar = document.getElementById('rrSidebar');
  const scrim = document.getElementById('rrScrim');
  const closeMenu = () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); };

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => rrShowSection(el.dataset.nav));
  });

  document.getElementById('rrLogout').addEventListener('click', async () => {
    try { await rrApi('/api/logout', { method: 'POST' }); } catch {}
    window.location.href = '/index.html';
  });

  const menuBtn = document.getElementById('rrMenuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => { sidebar.classList.add('open'); scrim.classList.add('open'); });
    scrim.addEventListener('click', closeMenu);
  }

  rrMountMascots();
}

// Cambia la sección visible. Las páginas también pueden llamarla directamente
// (por ejemplo, un botón "ver todos los avisos" dentro del resumen).
function rrShowSection(target) {
  document.querySelectorAll('.rr-section').forEach(s => { s.style.display = 'none'; });
  const section = document.getElementById('section-' + target);
  if (section) {
    section.style.display = 'block';
    // Reinicia la animación de entrada de la sección.
    section.style.animation = 'none';
    void section.offsetWidth;
    section.style.animation = '';
  }
  document.querySelectorAll('.rr-side-link[data-nav]').forEach(l => l.classList.toggle('active', l.dataset.nav === target));
  document.getElementById('rrSidebar').classList.remove('open');
  document.getElementById('rrScrim').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.dispatchEvent(new CustomEvent('rr:section', { detail: target }));
}

// Contador rojo junto a un enlace del menú (por ejemplo, avisos sin leer).
function rrSetBadge(navId, count) {
  const badge = document.querySelector(`[data-badge="${navId}"]`);
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
}
