// public/js/sidebar.js
// La barra lateral que comparten todos los paneles.
//
// Tiene tres pisos, y el orden no es casual:
//
//   arriba   la escuela (o el espacio propio): pocas entradas y bien gordas.
//            Cada una junta varias cosas que antes andaban sueltas — avisos y
//            notificaciones son la misma pantalla, y clases se lleva dentro
//            las asignaciones, los pendientes y los minijuegos. Menos saltos
//            de menú y menos pantallas medio vacías.
//   en medio RobinAI: el botón de conversación nueva y el historial, la más
//            reciente primero. Es la parte que crece, así que se lleva el
//            espacio sobrante y su propio scroll.
//   abajo    cuánto margen queda hoy, la cuenta y la configuración: se buscan
//            poco, pero se buscan siempre en la misma esquina.

const RR_NAV_BY_ROLE = {
  personal: [
    { group: 'Mi espacio' },
    { id: 'tasks', label: 'Mis pendientes', icon: '✅' },
    { id: 'games', label: 'Minijuegos', icon: '🎮' },
    { id: 'plans', label: 'Planes', icon: '⭐' }
  ],
  // Familia: una sola pantalla, porque una sola cosa hace. Si llegó hoy y los
  // días de atrás. Un menú de cuatro entradas para eso sería puro decorado.
  parent: [
    { group: 'Mi familia' },
    { id: 'children', label: 'Mis hijos', icon: '👪' }
  ],
  // Estudiantado: lo de la escuela arriba y lo suyo propio debajo, igual que
  // en una cuenta personal. Antes "Clases" se lo llevaba todo dentro —las
  // asignaciones, los pendientes y los minijuegos— y era una sola pantalla
  // larguísima por la que había que bajar mucho para encontrar cualquier cosa.
  student: [
    { group: 'Mi escuela' },
    { id: 'announcements', label: 'Avisos', icon: '📣' },
    { id: 'classes', label: 'Clases', icon: '🏫' },
    { group: 'Lo mío' },
    { id: 'tasks', label: 'Mis pendientes', icon: '✅' },
    { id: 'games', label: 'Minijuegos', icon: '🎮' }
  ],
  // Profesorado: "Mis clases" se lleva dentro el listado de estudiantes y los
  // códigos, que es el orden en el que se usan de verdad (creo la clase, veo
  // quién está, doy de alta a quien falta).
  // Donde estaba "Herramientas" ahora está "Asistencia". Las herramientas eran
  // tres enlaces que abrían tres páginas sueltas en otra pestaña; de esas
  // tres, dos (traducir un PDF y generar una actividad) se volvieron modos del
  // propio chat —se eligen como quien elige modelo— y la tercera, el pase de
  // lista, era lo bastante grande como para merecer su propia pantalla aquí
  // dentro en vez de una ventana aparte que no sabía quién eras.
  teacher: [
    { group: 'Mi trabajo' },
    { id: 'classes', label: 'Mis clases', icon: '🏫' },
    { id: 'attendance', label: 'Asistencia', icon: '🪪' },
    { id: 'announcements', label: 'Avisos', icon: '📣' },
    { id: 'tasks', label: 'Mis pendientes', icon: '✅' }
  ],
  // Dirección: "Cuentas" reúne los códigos de ingreso, el listado de cuentas y
  // el personal de dirección — todo lo que es dar o quitar acceso.
  admin: [
    { group: 'Mi escuela' },
    { id: 'accounts', label: 'Cuentas', icon: '👥' },
    { id: 'classes', label: 'Clases', icon: '🏫' },
    { id: 'announcements', label: 'Avisos', icon: '📣' }
  ]
};

// Subdirección y secretaría usan el mismo panel que dirección. Lo que no
// pueden tocar se les quita dentro de la pantalla de Cuentas y, sobre todo,
// se les vuelve a negar en el servidor: esconder un botón no protege nada
// por sí solo.
RR_NAV_BY_ROLE.subdirector = RR_NAV_BY_ROLE.admin;
RR_NAV_BY_ROLE.secretary = RR_NAV_BY_ROLE.admin;

// Qué secciones exige un permiso para siquiera aparecer.
const RR_NAV_PERMISSION = {};

// Todos los paneles llevan lista de conversaciones: poder hablar con Robin y
// no poder volver a lo que te contestó ayer es un callejón sin salida.
const RR_CHAT_RAIL_ROLES = ['personal', 'parent', 'student', 'teacher', 'admin', 'subdirector', 'secretary'];

let rrShellUser = null;
let rrShellChats = [];
let rrActiveChatId = null;

function rrRenderShell(user, activeId) {
  rrShellUser = user;
  const permisos = user.permissions || [];
  const items = (RR_NAV_BY_ROLE[user.role] || []).filter(item => {
    // En universidad no hay minijuegos, así que tampoco su entrada en el
    // menú: una pantalla que solo sirve para decir "aquí no hay nada" no
    // merece un sitio fijo en la barra.
    if (item.id === 'games' && user.level === 'Universidad') return false;
    const need = RR_NAV_PERMISSION[item.id];
    return !need || permisos.includes(need);
  });

  const itemsHtml = items.map((item, i) => {
    if (item.group) return `<div class="rr-side-label">${rrEscapeHtml(item.group)}</div>`;
    return `
      <div class="rr-side-link ${item.id === activeId ? 'active' : ''}" data-nav="${item.id}"
           role="button" tabindex="0" style="animation-delay:${i * 30}ms">
        <span class="ic">${item.icon}</span> ${rrEscapeHtml(item.label)}
        <span class="badge" data-badge="${item.id}" hidden></span>
      </div>`;
  }).join('');

  const conRail = RR_CHAT_RAIL_ROLES.includes(user.role);
  const subtitle = user.role === 'student' && user.studentCode
    ? user.studentCode
    : (user.roleLabel || RR_ROLE_LABEL[user.role] || user.role);

  document.getElementById('rrApp').insertAdjacentHTML('afterbegin', `
    <div class="rr-sidebar-scrim" id="rrScrim"></div>
    <aside class="rr-sidebar" id="rrSidebar">
      <div class="rr-side-head">
        <!-- Solo el nombre. El pájaro de aquí competía con el Robin del chat,
             que es el que de verdad reacciona; dos en la misma pantalla y el
             de la esquina no significaba nada. -->
        <a href="/" class="rr-brand">roboRobin</a>
        <button class="rr-side-close" id="rrSideClose" type="button" aria-label="Cerrar menú">&times;</button>
      </div>

      <nav class="rr-side-nav">${itemsHtml}</nav>

      ${conRail ? `
        <div class="rr-side-chats">
          <div class="rr-side-label rr-side-label-row rr-side-robin-label" data-nav="chat" role="button" tabindex="0">
            <span><span class="ic">✨</span> RobinAI</span>
            <button class="rr-side-mini" id="rrClearChats" type="button" title="Borrar todo el historial">🗑</button>
          </div>
          <button class="rr-new-chat" id="rrNewChat" type="button">
            <span class="ic">✚</span> Conversación nueva
          </button>
          <div class="rr-chat-rail" id="rrChatRail">
            <div class="rr-rail-empty">Todavía no has hablado con Robin.</div>
          </div>
        </div>` : '<div class="rr-side-spacer"></div>'}

      <div class="rr-side-foot">
        ${rrShellUsageHtml(user)}
        <div class="rr-side-link" data-nav="profile" role="button" tabindex="0">
          <span class="rr-side-user-mini">
            ${user.profilePic
              ? `<img class="rr-avatar" src="${rrEscapeHtml(user.profilePic)}" alt="" />`
              : '<span class="rr-avatar rr-avatar-placeholder">👤</span>'}
          </span>
          <span class="rr-side-user-text">
            <strong>${rrEscapeHtml(user.fullName)}</strong>
            <small>${rrEscapeHtml(user.schoolName ? `${subtitle} · ${user.schoolName}` : subtitle)}</small>
          </span>
        </div>
        <div class="rr-side-link" data-nav="settings" role="button" tabindex="0">
          <span class="ic">⚙️</span> Configuración
        </div>
        <div class="rr-side-link" id="rrLogout" role="button" tabindex="0"><span class="ic">🚪</span> Cerrar sesión</div>
      </div>
    </aside>
  `);

  const sidebar = document.getElementById('rrSidebar');
  const scrim = document.getElementById('rrScrim');
  const closeMenu = () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); };

  // Un solo manejador para todo el menú: así los enlaces que se dibujan
  // después (las conversaciones) no necesitan volver a engancharse.
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('#rrClearChats')) return;
    const nav = e.target.closest('[data-nav]');
    if (nav) return rrShowSection(nav.dataset.nav);
    const chat = e.target.closest('[data-chat-id]');
    if (chat && !e.target.closest('[data-chat-del]')) {
      return rrOpenChat(Number(chat.dataset.chatId));
    }
  });
  sidebar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const nav = e.target.closest('[data-nav], #rrLogout');
    if (nav) { e.preventDefault(); nav.click(); }
  });

  document.getElementById('rrLogout').addEventListener('click', async () => {
    try { await rrApi('/api/logout', { method: 'POST' }); } catch {}
    window.location.href = '/';
  });

  const menuBtn = document.getElementById('rrMenuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => { sidebar.classList.add('open'); scrim.classList.add('open'); });
  }
  scrim.addEventListener('click', closeMenu);
  const closeBtn = document.getElementById('rrSideClose');
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);

  if (conRail) {
    document.getElementById('rrNewChat').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('rr:new-chat'));
    });
    document.getElementById('rrClearChats').addEventListener('click', rrClearAllChats);
    rrLoadChatRail();
  }

  rrMountMascots();
}

// ---- Cuánto margen le queda hoy --------------------------------------------
// La barrita del pie. Se ve siempre, para que nadie se entere de que tenía un
// tope justo en el momento en que se le acaba.
//
// Se cuenta en PORCENTAJE, no en mensajes sueltos. "Te queda el 40 %" se
// entiende igual con 25 mensajes que con 400, y además deja de importar cuál
// es la cifra exacta detrás — que es justo lo que no queremos andar enseñando
// en cada pantalla. Los números de verdad están en /terminos#limites.

function rrShellUsageHtml(user) {
  const uso = user.usageToday && user.usageToday.aiMessages;
  if (!uso) return '';
  // El nombre del plan solo significa algo en una cuenta personal. A una de
  // escuela no se le cobra nada, asi que poner "GRATIS" ahi solo confunde.
  const plan = user.role === 'personal' ? (user.planInfo || {}).name || '' : '';
  if (uso.unlimited) {
    return `
      <div class="rr-usage rr-usage-max" id="rrUsage" data-nav="plans" role="button" tabindex="0">
        <span class="rr-usage-top"><strong>Robin sin límite</strong><em>${rrEscapeHtml(plan || 'Max')}</em></span>
      </div>`;
  }
  // Lo que queda, no lo gastado: es la pregunta que se hace quien mira.
  const queda = uso.limit ? Math.max(0, Math.round((uso.left / uso.limit) * 100)) : 0;
  const bajo = queda <= 15;
  return `
    <div class="rr-usage ${bajo ? 'low' : ''}" id="rrUsage" ${user.role === 'personal' ? 'data-nav="plans" role="button" tabindex="0"' : ''}
         title="Margen de conversación con Robin que te queda hoy">
      <span class="rr-usage-top">
        <strong>${queda} % de Robin hoy</strong>
        <em>${rrEscapeHtml(plan)}</em>
      </span>
      <span class="rr-usage-bar"><i style="width:${Math.min(100, queda)}%"></i></span>
    </div>`;
}

// Se vuelve a dibujar cada vez que Robin contesta, sin recargar la página.
function rrUpdateUsage(usage) {
  if (!usage || !rrShellUser) return;
  rrShellUser.usageToday = usage;
  const box = document.getElementById('rrUsage');
  if (!box) return;
  const nuevo = document.createElement('div');
  nuevo.innerHTML = rrShellUsageHtml(rrShellUser).trim();
  if (nuevo.firstElementChild) box.replaceWith(nuevo.firstElementChild);
}

// ---- La lista de conversaciones -------------------------------------------

async function rrLoadChatRail() {
  const rail = document.getElementById('rrChatRail');
  if (!rail) return;
  try {
    const { chats } = await rrApi('/api/chats');
    rrShellChats = chats;
    rrRenderChatRail();
  } catch {
    rail.innerHTML = '<div class="rr-rail-empty">No pude traer tus conversaciones.</div>';
  }
}

function rrRenderChatRail() {
  const rail = document.getElementById('rrChatRail');
  if (!rail) return;

  if (!rrShellChats.length) {
    rail.innerHTML = '<div class="rr-rail-empty">Todavía no has hablado con Robin.</div>';
    return;
  }

  // Agrupadas por cuándo fue: es como la gente busca una conversación vieja.
  const grupos = [
    { label: 'Hoy', test: d => d === 0 },
    { label: 'Ayer', test: d => d === 1 },
    { label: 'Esta semana', test: d => d > 1 && d <= 7 },
    { label: 'Antes', test: d => d > 7 }
  ];
  const hoy = new Date(rrTodayISO() + 'T00:00:00').getTime();

  rail.innerHTML = grupos.map(grupo => {
    const dentro = rrShellChats.filter(c => {
      const dia = new Date(c.updatedAt);
      const d = Math.round((hoy - new Date(`${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}T00:00:00`).getTime()) / 86400000);
      return grupo.test(Math.max(0, d));
    });
    if (!dentro.length) return '';
    return `
      <div class="rr-rail-group">${grupo.label}</div>
      ${dentro.map(c => `
        <div class="rr-rail-item ${c.id === rrActiveChatId ? 'active' : ''}" data-chat-id="${c.id}"
             role="button" tabindex="0" title="${rrEscapeHtml(c.preview || c.title)}">
          <span class="rr-rail-ic">${rrChatIcon(c.context)}</span>
          <span class="rr-rail-title">${rrEscapeHtml(c.title)}</span>
          <button class="rr-rail-del" data-chat-del="${c.id}" type="button" aria-label="Borrar conversación">✕</button>
        </div>`).join('')}`;
  }).join('');

  rail.querySelectorAll('[data-chat-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.chatDel);
      try {
        await rrApi(`/api/chats/${id}`, { method: 'DELETE' });
        rrShellChats = rrShellChats.filter(c => c.id !== id);
        if (rrActiveChatId === id) {
          rrActiveChatId = null;
          document.dispatchEvent(new CustomEvent('rr:new-chat'));
        }
        rrRenderChatRail();
      } catch (err) {
        rrToast(err.message, 'error');
      }
    });
  });
}

function rrChatIcon(context) {
  if (context === 'homework') return '📚';
  if (context === 'game') return '🎮';
  return '💬';
}

function rrOpenChat(chatId) {
  rrActiveChatId = chatId;
  rrRenderChatRail();
  rrShowSection('chat');
  document.dispatchEvent(new CustomEvent('rr:open-chat', { detail: chatId }));
}

// La llaman las páginas cuando Robin acaba de contestar: mete la conversación
// arriba del todo o actualiza su título.
function rrTouchChat(summary) {
  if (!summary) return;
  rrActiveChatId = summary.id;
  rrShellChats = [summary].concat(rrShellChats.filter(c => c.id !== summary.id));
  rrRenderChatRail();
}

function rrSetActiveChat(chatId) {
  rrActiveChatId = chatId;
  rrRenderChatRail();
}

async function rrClearAllChats() {
  if (!confirm('¿Borrar TODAS tus conversaciones con Robin? No se puede deshacer.')) return;
  try {
    await rrApi('/api/chats?all=1', { method: 'DELETE' });
    rrShellChats = [];
    rrActiveChatId = null;
    rrRenderChatRail();
    rrToast('Historial borrado.', 'success');
    document.dispatchEvent(new CustomEvent('rr:new-chat'));
  } catch (err) {
    rrToast(err.message, 'error');
  }
}

// ---- Secciones -------------------------------------------------------------

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
  // El título de RobinAI no es un enlace del menú, pero sí lleva a una
  // sección: se enciende igual cuando esa sección es la que está abierta.
  const robinLabel = document.querySelector('.rr-side-robin-label');
  if (robinLabel) robinLabel.classList.toggle('on', target === 'chat');
  const sidebar = document.getElementById('rrSidebar');
  const scrim = document.getElementById('rrScrim');
  if (sidebar) sidebar.classList.remove('open');
  if (scrim) scrim.classList.remove('open');
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
