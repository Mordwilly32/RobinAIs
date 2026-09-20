// public/js/consola.js
// ---------------------------------------------------------------------------
// La consola de demostración.
//
// Sirve para enseñar roboRobin delante de gente: entrar a cualquier cuenta con
// un botón y fabricar clases de mentira para que ninguna pantalla se vea
// vacía. No es una función del producto y por eso no tiene ni un botón que la
// abra: se llama con
//
//     Ctrl + Alt + Shift + R
//
// desde cualquier pantalla. Tres modificadores a la vez no se pulsan sin
// querer, que es justamente lo que se busca.
//
// El servidor la puede apagar entera ("devConsole": false en config.json). Si
// está apagada, la primera petición falla y aquí no se dibuja nada: el atajo
// simplemente no hace nada, sin pistas de que alguna vez existió.
// ---------------------------------------------------------------------------

(function () {
  const TECLA = 'r'; // con Ctrl + Alt + Shift

  let caja = null;
  let cuentas = [];
  let filtro = '';

  // ---- El atajo ------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && (e.key || '').toLowerCase() === TECLA) {
      e.preventDefault();
      alternar();
    }
    if (e.key === 'Escape' && caja) cerrar();
  });

  function alternar() {
    if (caja) return cerrar();
    abrir();
  }

  function cerrar() {
    if (!caja) return;
    caja.remove();
    caja = null;
  }

  // ---- La ventana ----------------------------------------------------------

  function abrir() {
    caja = document.createElement('div');
    caja.className = 'rr-consola-fondo';
    caja.innerHTML = `
      <div class="rr-consola" role="dialog" aria-label="Consola de demostración">
        <header class="rr-consola-head">
          <div>
            <strong>Consola de demostración</strong>
            <small>Solo para enseñar el proyecto. No es parte de la aplicación.</small>
          </div>
          <button type="button" class="rr-consola-x" data-cerrar aria-label="Cerrar">&times;</button>
        </header>

        <div class="rr-consola-body">
          <section class="rr-consola-bloque">
            <h4>Entrar a una cuenta</h4>
            <p>Un clic y se abre la sesión de esa persona. Sin contraseña.</p>
            <input type="search" class="rr-consola-buscar" id="rrConsolaBuscar"
                   placeholder="Buscar por nombre, correo, ID, rol o escuela…" autocomplete="off" />
            <div class="rr-consola-lista" id="rrConsolaLista">
              <div class="rr-consola-vacio">Cargando cuentas…</div>
            </div>
          </section>

          <section class="rr-consola-bloque">
            <h4>Fabricar datos de demostración</h4>
            <p>Clases al azar con su profesor, su gente dentro y un par de asignaciones — una vencida y otra por venir.</p>

            <button type="button" class="rr-consola-btn rr-consola-btn-grande" id="rrConsolaEscuela">
              <strong>Llenar una escuela entera</strong>
              <small>9 clases · de 25 a 30 estudiantes cada una · un profesor por clase</small>
            </button>

            <details class="rr-consola-detalle">
              <summary>Prefiero elegir cuántas</summary>
              <div class="rr-consola-campos">
                <label>Clases <input type="number" id="rrConsolaClases" value="3" min="1" max="15" /></label>
                <label>Estudiantes por clase <input type="number" id="rrConsolaAlumnos" value="5" min="0" max="40" /></label>
              </div>
              <button type="button" class="rr-consola-btn" id="rrConsolaCrear">Crear clases al azar</button>
            </details>

            <div class="rr-consola-salida" id="rrConsolaSalida"></div>
          </section>
        </div>

        <footer class="rr-consola-pie">
          <span>Ctrl + Alt + Shift + R para abrirla y cerrarla · Esc para salir</span>
        </footer>
      </div>`;

    document.body.appendChild(caja);

    caja.addEventListener('click', (e) => {
      if (e.target === caja || e.target.closest('[data-cerrar]')) cerrar();
    });

    const buscar = caja.querySelector('#rrConsolaBuscar');
    buscar.addEventListener('input', () => { filtro = buscar.value.trim().toLowerCase(); pintarLista(); });
    setTimeout(() => buscar.focus(), 40);

    caja.querySelector('#rrConsolaCrear').addEventListener('click', () => crearDemo());
    caja.querySelector('#rrConsolaEscuela').addEventListener('click', () => crearDemo({
      classes: 9,
      students: { min: 25, max: 30 }
    }));

    cargarCuentas();
  }

  // ---- Las cuentas ---------------------------------------------------------

  async function cargarCuentas() {
    try {
      const data = await peticion('/api/dev/accounts');
      cuentas = data.accounts || [];
      pintarLista();
    } catch (err) {
      // Consola apagada en el servidor, o algo peor: se dice y se cierra la
      // puerta, sin dejar una ventana a medias en pantalla.
      if (caja) caja.querySelector('#rrConsolaLista').innerHTML =
        `<div class="rr-consola-vacio">La consola está apagada en el servidor.<br><small>${escapar(err.message)}</small></div>`;
    }
  }

  function pintarLista() {
    if (!caja) return;
    const lista = caja.querySelector('#rrConsolaLista');

    const visibles = cuentas.filter(c => {
      if (!filtro) return true;
      return [c.fullName, c.email, c.studentCode, c.roleLabel, c.schoolName, c.level, c.grade]
        .filter(Boolean).join(' ').toLowerCase().includes(filtro);
    });

    if (!visibles.length) {
      lista.innerHTML = `<div class="rr-consola-vacio">${cuentas.length ? 'Ninguna cuenta coincide.' : 'Todavía no hay cuentas.'}</div>`;
      return;
    }

    lista.innerHTML = visibles.map(c => `
      <button type="button" class="rr-consola-cuenta" data-entrar="${c.id}">
        <span class="rr-consola-rol rol-${escapar(c.role)}">${escapar(c.roleLabel)}</span>
        <span class="rr-consola-quien">
          <strong>${escapar(c.fullName)}</strong>
          <small>${escapar([c.email || c.studentCode, c.schoolName, c.grade].filter(Boolean).join(' · ') || 'sin escuela')}</small>
        </span>
        <span class="rr-consola-ir">Entrar →</span>
      </button>`).join('');

    lista.querySelectorAll('[data-entrar]').forEach(btn => {
      btn.addEventListener('click', () => entrar(Number(btn.dataset.entrar), btn));
    });
  }

  async function entrar(userId, btn) {
    btn.disabled = true;
    btn.querySelector('.rr-consola-ir').textContent = 'Entrando…';
    try {
      const { user } = await peticion('/api/dev/login', { method: 'POST', body: { userId } });
      // rrDashboardFor vive en api.js, que no está en todas las páginas: si no
      // está, se resuelve aquí mismo con las mismas reglas.
      const destino = typeof rrDashboardFor === 'function'
        ? rrDashboardFor(user.role, user)
        : destinoDe(user);
      window.location.href = destino;
    } catch (err) {
      btn.disabled = false;
      btn.querySelector('.rr-consola-ir').textContent = 'Entrar →';
      avisar(err.message);
    }
  }

  function destinoDe(user) {
    if (['admin', 'subdirector', 'secretary'].includes(user.role)) return '/dashboard-admin.html';
    if (user.role === 'teacher') return '/dashboard-teacher.html';
    if (user.role === 'student') return user.isLittle ? '/dashboard-peques.html' : '/dashboard-student.html';
    return '/dashboard-personal.html';
  }

  // ---- Los datos de mentira ------------------------------------------------

  // Sin argumentos usa lo que digan las casillas; con ellos, la tanda que pidió
  // el botón grande. Una escuela entera son cientos de cuentas y el servidor
  // las escribe en disco, así que el botón se bloquea mientras tanto y dice
  // que puede tardar — quedarse mirando un botón mudo parece que se colgó.
  async function crearDemo(receta) {
    const grande = Boolean(receta);
    const btn = caja.querySelector(grande ? '#rrConsolaEscuela' : '#rrConsolaCrear');
    const salida = caja.querySelector('#rrConsolaSalida');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = grande
      ? '<strong>Llenando la escuela…</strong><small>Son cientos de cuentas, dale unos segundos</small>'
      : 'Creando…';
    salida.innerHTML = '';

    const cuerpo = receta || {
      classes: Number(caja.querySelector('#rrConsolaClases').value) || 3,
      students: Number(caja.querySelector('#rrConsolaAlumnos').value)
    };

    try {
      const data = await peticion('/api/dev/demo', { method: 'POST', body: cuerpo });

      salida.innerHTML = `
        <div class="rr-consola-ok">
          <strong>${data.classes.length} clase${data.classes.length === 1 ? '' : 's'} en ${escapar(data.school.name)}</strong>
          <small>${data.students} estudiante${data.students === 1 ? '' : 's'} · ${data.sharedTeacher
            ? `las da ${escapar(data.teacher.fullName)}`
            : 'un profesor distinto en cada clase'}</small>
          <ul>
            ${data.classes.map(c => `
              <li>${escapar(c.name)} <em>${escapar(c.level || 'sin nivel')} · ${escapar(c.teacherName || '')} · código ${escapar(c.joinCode)} · ${c.students} estudiantes</em></li>`).join('')}
          </ul>
        </div>`;
      cargarCuentas(); // los estudiantes nuevos ya se pueden usar para entrar
    } catch (err) {
      avisar(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ---- Utilidades ----------------------------------------------------------

  // Una petición propia y mínima: la consola tiene que funcionar también en
  // páginas que no cargan api.js (la portada, los términos, la guía).
  async function peticion(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function avisar(mensaje) {
    if (typeof rrToast === 'function') return rrToast(mensaje, 'error');
    const salida = caja && caja.querySelector('#rrConsolaSalida');
    if (salida) salida.innerHTML = `<div class="rr-consola-error">${escapar(mensaje)}</div>`;
  }

  function escapar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
