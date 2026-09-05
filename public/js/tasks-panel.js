// public/js/tasks-panel.js
// Panel de pendientes reutilizable: lo usa el espacio personal y también los
// paneles de estudiante y profesor. Cada quien ve solo sus propias tareas.
//
// Uso:  const panel = rrMountTaskPanel(contenedor); panel.reload();

const RR_WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3,
  jueves: 4, viernes: 5, sabado: 6, 'sábado': 6
};

// Entiende "comprar pan mañana" al escribir rápido. Las frases más complejas
// las resuelve Robin en el servidor.
function rrParseQuickTask(raw) {
  let text = raw.trim();
  let due = null;

  const asISO = date => {
    const y = date.getFullYear();
    return `${y}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const shift = days => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

  const rules = [
    [/\s+pasado\s+ma[ñn]ana\b/i, () => shift(2)],
    [/\s+ma[ñn]ana\b/i, () => shift(1)],
    [/\s+hoy\b/i, () => shift(0)],
    [/\s+(?:el\s+|este\s+|pr[oó]ximo\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i, m => {
      const target = RR_WEEKDAYS[m[1].toLowerCase()];
      let delta = (target - new Date().getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      return shift(delta);
    }]
  ];

  for (const [re, get] of rules) {
    const match = text.match(re);
    if (match) {
      due = asISO(get(match));
      text = text.replace(match[0], '').trim();
      break;
    }
  }

  const priority = /\b(urgente|important[ea])\b/i.test(text) ? 'alta' : 'normal';
  text = text.replace(/\b(urgente|important[ea])\b/i, '').replace(/\s{2,}/g, ' ').trim();

  return { title: text, due, priority };
}

function rrMountTaskPanel(container, { title = 'Mis pendientes', onChange } = {}) {
  container.innerHTML = `
    <div class="rr-tasks">
      <div class="rr-tasks-head">
        <h3>${rrEscapeHtml(title)}</h3>
        <p data-tp="summary">Cargando…</p>
        <div class="rr-progress"><i data-tp="bar" style="width:0%"></i></div>
      </div>
      <form class="rr-task-add" data-tp="form">
        <input type="text" data-tp="input" placeholder="Añadir pendiente… (ej. entregar informe mañana)" autocomplete="off" />
        <button type="submit" aria-label="Añadir">+</button>
      </form>
      <div class="rr-task-filters" data-tp="filters">
        <button type="button" class="on" data-filter="pending">Pendientes</button>
        <button type="button" data-filter="today">Hoy</button>
        <button type="button" data-filter="all">Todas</button>
        <button type="button" data-filter="done">Hechas</button>
      </div>
      <div class="rr-task-list" data-tp="list"></div>
    </div>`;

  const q = sel => container.querySelector(`[data-tp="${sel}"]`);
  const listEl = q('list');
  let tasks = [];
  let filter = 'pending';

  function visible() {
    const today = rrTodayISO();
    if (filter === 'pending') return tasks.filter(t => !t.done);
    if (filter === 'done') return tasks.filter(t => t.done);
    if (filter === 'today') return tasks.filter(t => !t.done && t.due && t.due <= today);
    return tasks;
  }

  function render() {
    const done = tasks.filter(t => t.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    q('summary').textContent = tasks.length
      ? `${done} de ${tasks.length} ${tasks.length === 1 ? 'lista' : 'listas'}`
      : 'Todavía no hay nada apuntado';
    q('bar').style.width = `${pct}%`;

    const items = visible();
    if (!items.length) {
      // El vacío no siempre significa lo mismo: si nunca apuntaste nada sale el
      // fantasmita, y si terminaste todo lo que tenías sale Robin celebrando.
      const limpio = tasks.length > 0;
      const estados = {
        pending: limpio
          ? { pose: 'happy', title: '¡No te queda nada pendiente!', text: 'Terminaste todo lo que tenías apuntado. Robin está orgulloso.' }
          : { pose: 'ghost', title: 'Aquí no hay nada', text: 'Escribe tu primer pendiente arriba, o pídeselo a Robin: «recuérdame entregar el informe mañana».' },
        today: limpio
          ? { pose: 'happy', title: 'Hoy lo tienes libre', text: 'Nada vence hoy. Buen momento para adelantar lo de mañana.' }
          : { pose: 'ghost', title: 'Nada para hoy', text: 'Cuando apuntes algo con fecha de hoy, aparecerá en esta lista.' },
        done: { pose: 'ghost', title: 'Todavía no has terminado nada', text: 'Las tareas que vayas marcando como hechas se guardan aquí.' },
        all: { pose: 'ghost', title: 'Tu lista está vacía', text: 'Escribe arriba tu primer pendiente, o pídeselo a Robin hablándole normal.' }
      };
      listEl.innerHTML = rrEmptyState(estados[filter]);
      return;
    }

    const today = rrTodayISO();
    listEl.innerHTML = items.map((task, i) => {
      const late = task.due && task.due < today && !task.done;
      const isToday = task.due === today;
      const dueClass = late ? 'late' : isToday ? 'today' : '';
      return `
        <div class="rr-task ${task.done ? 'done' : ''}" style="animation-delay:${Math.min(i, 10) * 25}ms">
          <button class="rr-task-check" data-toggle="${task.id}"
                  aria-label="${task.done ? 'Marcar como pendiente' : 'Marcar como hecha'}"></button>
          <div class="rr-task-main">
            <div class="rr-task-title">${rrEscapeHtml(task.title)}</div>
            <div class="rr-task-meta">
              ${task.due ? `<span class="rr-task-due ${dueClass}">${late ? '⚠ ' : ''}${rrEscapeHtml(rrDayLabel(task.due))}</span>` : ''}
              ${task.priority === 'alta' ? '<span class="rr-task-prio">urgente</span>' : ''}
              ${task.notes ? `<span>${rrEscapeHtml(task.notes)}</span>` : ''}
            </div>
          </div>
          <button class="rr-task-del" data-del="${task.id}" aria-label="Borrar">✕</button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => toggle(Number(btn.dataset.toggle)));
    });
    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => remove(Number(btn.dataset.del)));
    });
  }

  async function reload() {
    try {
      const data = await rrApi('/api/tasks');
      tasks = data.tasks;
      render();
      if (onChange) onChange(tasks);
    } catch (err) {
      listEl.innerHTML = rrEmptyState({
        pose: 'sad',
        title: 'No pude traer tus pendientes',
        text: rrEscapeHtml(err.message)
      });
    }
  }

  async function toggle(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.done = !task.done; // respuesta inmediata; el servidor confirma después

    // Si esa era la última que quedaba, se celebra: es el momento del día que
    // vale la pena marcar.
    const quedan = tasks.filter(t => !t.done).length;
    if (task.done && quedan === 0) {
      rrConfetti(listEl);
      rrToast('¡Terminaste todo lo que tenías apuntado!', 'success');
    }
    render();
    try {
      await rrApi(`/api/tasks/${id}`, { method: 'PUT', body: { done: task.done } });
      await reload();
    } catch (err) {
      rrToast(err.message, 'error');
      await reload();
    }
  }

  async function remove(id) {
    try {
      await rrApi(`/api/tasks/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  }

  q('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = q('input');
    const parsed = rrParseQuickTask(input.value);
    if (!parsed.title) return;
    input.value = '';
    try {
      await rrApi('/api/tasks', { method: 'POST', body: parsed });
      if (filter === 'done') setFilter('pending');
      await reload();
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  function setFilter(next) {
    filter = next;
    container.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b.dataset.filter === next));
    render();
  }

  container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });

  reload();
  return { reload, setFilter };
}
