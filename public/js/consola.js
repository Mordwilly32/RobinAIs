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
// Es de una sola persona. Al abrirla se le pregunta al servidor si esta sesión
// puede verla (ver routes/dev.js): si no, lo primero que aparece es un candado
// y no la lista de cuentas. Las dos llaves son estar dentro con la cuenta
// dueña, o escribir la contraseña de la consola.
//
// El servidor la puede apagar entera (RR_DEV_CONSOLE=0, o "devConsole": false
// en config.json). Apagada, la primera petición contesta 404 y aquí no se
// dibuja nada: el atajo simplemente no hace nada, sin pistas de que alguna vez
// existió.
// ---------------------------------------------------------------------------

(function () {
  const TECLA = 'r'; // con Ctrl + Alt + Shift

  let caja = null;
  let cuentas = [];
  let filtro = '';

  // ---- La lupa -------------------------------------------------------------
  //
  // Sube el tamaño del texto de Robin y el de los minijuegos, y nada más. Para
  // enseñar el proyecto desde el fondo de un salón: a 15,5 px la respuesta de
  // Robin no se lee ni desde la tercera fila.
  //
  // Por qué no vale el zoom del navegador: Ctrl + «+» agranda TODO, y entonces
  // la barra lateral se come media pantalla, los botones se salen de su fila y
  // lo que se enseña deja de parecerse a la aplicación. La lupa agranda solo lo
  // que hay que leer de lejos y deja la maqueta donde estaba. Ver la sección
  // «La lupa» al final de public/css/style.css.
  //
  // Vive en este navegador y en ningún otro sitio: es cómo se está mirando la
  // pantalla, no un dato de nadie. Por eso localStorage y no la cuenta — el
  // aparato del salón se deja puesto en 160 % toda la mañana, entre a quien
  // entre.

  const LUPA_LLAVE = 'roborobin.lupa';
  const LUPA_MIN = 100;
  const LUPA_MAX = 220;
  const LUPA_PASO = 10;

  function leerLupa() {
    try {
      const guardado = Number(localStorage.getItem(LUPA_LLAVE));
      if (!guardado) return 100;
      return Math.min(LUPA_MAX, Math.max(LUPA_MIN, Math.round(guardado)));
    } catch {
      // Ventana privada, o el navegador con el almacenamiento apagado. La lupa
      // es una comodidad: si no se puede guardar, se trabaja sin ella.
      return 100;
    }
  }

  function aplicarLupa(pct) {
    const valor = Math.min(LUPA_MAX, Math.max(LUPA_MIN, Math.round(pct)));
    document.documentElement.style.setProperty('--rr-lupa', (valor / 100).toFixed(2));
    try { localStorage.setItem(LUPA_LLAVE, String(valor)); } catch { /* sin guardar */ }
    return valor;
  }

  // Al cargar la página, antes que nada: si el aparato quedó con la lupa
  // puesta, se nota desde el primer dibujo y no después de un parpadeo.
  aplicarLupa(leerLupa());

  // Cuantas filas se dibujan como mucho en la lista de cuentas. Una escuela
  // entera son mas de mil, y dibujarlas todas deja la ventana pensando cada
  // vez que se refresca. Lo que se busca aqui es UNA cuenta, y para eso esta
  // el buscador.
  const TOPE_FILAS = 60;

  // ---- El atajo ------------------------------------------------------------

  // Se mira e.code además de e.key: con Ctrl + Alt el sistema puede estar
  // haciendo de AltGr, y entonces la tecla "R" llega con otro e.key según la
  // distribución del teclado. e.code dice qué tecla se pulsó de verdad, sin
  // importar qué letra pinta.
  function esElAtajo(e) {
    if (!(e.ctrlKey && e.altKey && e.shiftKey)) return false;
    return e.code === 'KeyR' || String(e.key || '').toLowerCase() === TECLA;
  }

  document.addEventListener('keydown', (e) => {
    if (esElAtajo(e)) {
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

  // ---- La puerta -----------------------------------------------------------
  //
  // Antes de dibujar la consola se pregunta si esta sesión puede verla. Tres
  // respuestas posibles:
  //
  //   404        apagada en el servidor: no se dibuja nada, como si el atajo
  //              no existiera.
  //   abierta    se dibuja la consola de siempre.
  //   cerrada    se dibuja el candado y nada más — ni la lista de cuentas ni
  //              el botón de fabricar datos llegan a existir en la pantalla.

  async function abrir() {
    let estado;
    try {
      estado = await peticion('/api/dev/estado');
    } catch {
      return; // apagada, o sin servidor: el atajo no hace nada
    }
    if (estado.abierta) return abrirConsola();
    abrirCandado(estado);
  }

  function marco(dentro) {
    caja = document.createElement('div');
    caja.className = 'rr-consola-fondo';
    caja.innerHTML = dentro;
    document.body.appendChild(caja);
    caja.addEventListener('click', (e) => {
      if (e.target === caja || e.target.closest('[data-cerrar]')) cerrar();
    });
    return caja;
  }

  function abrirCandado(estado) {
    marco(`
      <div class="rr-consola rr-consola-candado" role="dialog" aria-label="Consola de demostración">
        <header class="rr-consola-head">
          <div>
            <strong>Consola de demostración</strong>
            <small>Esta consola es de una sola cuenta.</small>
          </div>
          <button type="button" class="rr-consola-x" data-cerrar aria-label="Cerrar">&times;</button>
        </header>

        <div class="rr-consola-body rr-consola-body-solo">
          <section class="rr-consola-bloque">
            <div class="rr-consola-candado-ic" aria-hidden="true">🔒</div>
            ${estado.soloDueno
              ? `<p class="rr-consola-candado-txt">No hay contraseña puesta en este servidor.
                 La única manera de abrirla es entrar con la cuenta dueña.</p>`
              : `<p class="rr-consola-candado-txt">Escribe la contraseña de la consola, o entra
                 con la cuenta dueña y se abre sola.</p>
                 <form id="rrConsolaForm" autocomplete="off">
                   <input type="password" class="rr-consola-clave" id="rrConsolaClave"
                          placeholder="Contraseña de la consola" autocomplete="off" />
                   <button type="submit" class="rr-consola-btn" id="rrConsolaEntrar">Abrir la consola</button>
                 </form>`}
            <div class="rr-consola-salida" id="rrConsolaSalida"></div>
          </section>
        </div>

        <footer class="rr-consola-pie">
          <span>Esc para salir</span>
        </footer>
      </div>`);

    const form = caja.querySelector('#rrConsolaForm');
    if (!form) return;
    const campo = caja.querySelector('#rrConsolaClave');
    setTimeout(() => campo.focus(), 40);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = caja.querySelector('#rrConsolaEntrar');
      btn.disabled = true;
      btn.textContent = 'Abriendo…';
      try {
        await peticion('/api/dev/unlock', { method: 'POST', body: { clave: campo.value } });
        cerrar();
        abrirConsola();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Abrir la consola';
        campo.select();
        avisar(err.message);
      }
    });
  }

  // ---- La ventana ----------------------------------------------------------

  function abrirConsola() {
    marco(`
      <div class="rr-consola" role="dialog" aria-label="Consola de demostración">
        <header class="rr-consola-head">
          <div>
            <strong>Consola de demostración</strong>
            <small>Solo para enseñar el proyecto. No es parte de la aplicación.</small>
          </div>
          <button type="button" class="rr-consola-x" data-cerrar aria-label="Cerrar">&times;</button>
        </header>

        <div class="rr-consola-body">
          <section class="rr-consola-bloque rr-consola-bloque-ancho rr-consola-bloque-lupa">
            <h4>La lupa</h4>
            <p>Sube el tamaño de lo que dice Robin y del enunciado de los minijuegos,
               para que se lea desde el fondo del salón. No toca el menú ni el resto
               del panel, así que la pantalla sigue viéndose como es. Se queda puesta
               en este navegador.</p>
            <div class="rr-lupa">
              <button type="button" class="rr-lupa-btn" data-lupa="-1" aria-label="Más pequeño">&minus;</button>
              <div class="rr-lupa-medida">
                <strong id="rrLupaPct">100 %</strong>
                <span class="rr-lupa-barra"><i id="rrLupaBarra"></i></span>
              </div>
              <button type="button" class="rr-lupa-btn" data-lupa="1" aria-label="Más grande">+</button>
              <button type="button" class="rr-consola-btn rr-lupa-normal" data-lupa="0">Normal</button>
            </div>
            <p class="rr-lupa-muestra" id="rrLupaMuestra">Así se va a ver lo que conteste Robin.</p>
          </section>

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

          <section class="rr-consola-bloque rr-consola-bloque-ancho rr-consola-bloque-llave">
            <h4>La llave de Robin</h4>
            <p>Con una llave de Anthropic, Robin contesta con Claude. Sin ella sigue
               funcionando, pero en su modo local: entiende tus tareas y poco más.
               Se guarda en <code>config.json</code>, en esta computadora, y no sube
               a ningún lado.</p>
            <div id="rrConsolaLlave">
              <div class="rr-consola-vacio">Cargando…</div>
            </div>
          </section>

          <section class="rr-consola-bloque rr-consola-bloque-ancho">
            <h4>Montar una escuela entera</h4>
            <p>Con forma de escuela de verdad: parvularia, básica y bachillerato,
               cada grado con sus secciones, treinta por salón, un maestro por salón
               y los de materias especiales. Se borra entera de un botón.</p>
            <div id="rrConsolaEscuelas">
              <div class="rr-consola-vacio">Cargando…</div>
            </div>
          </section>
        </div>

        <footer class="rr-consola-pie">
          <span>Ctrl + Alt + Shift + R para abrirla y cerrarla · Esc para salir</span>
        </footer>
      </div>`);

    const buscar = caja.querySelector('#rrConsolaBuscar');
    buscar.addEventListener('input', () => { filtro = buscar.value.trim().toLowerCase(); pintarLista(); });
    setTimeout(() => buscar.focus(), 40);

    // La lupa. Un solo manejador para los tres botones: -1 baja un paso, +1 sube
    // uno y 0 vuelve al tamaño de siempre.
    caja.querySelectorAll('[data-lupa]').forEach(btn => {
      btn.addEventListener('click', () => {
        const paso = Number(btn.dataset.lupa);
        const ahora = leerLupa();
        pintarLupa(aplicarLupa(paso === 0 ? 100 : ahora + paso * LUPA_PASO));
      });
    });
    pintarLupa(leerLupa());

    caja.querySelector('#rrConsolaCrear').addEventListener('click', () => crearDemo());
    caja.querySelector('#rrConsolaEscuela').addEventListener('click', () => crearDemo({
      classes: 9,
      students: { min: 25, max: 30 }
    }));

    cargarCuentas();
    cargarLlave();
    cargarEscuelas();
  }

  // La cifra, la barrita y la frase de muestra.
  //
  // La muestra importa más de lo que parece: el texto que la lupa agranda está
  // detrás de la consola, tapado por ella justo mientras se ajusta. Sin una
  // frase de ejemplo aquí dentro habría que cerrar y abrir para ver si quedó
  // bien, y eso con gente esperando no se hace.
  function pintarLupa(pct) {
    if (!caja) return;
    const cifra = caja.querySelector('#rrLupaPct');
    const barra = caja.querySelector('#rrLupaBarra');
    const muestra = caja.querySelector('#rrLupaMuestra');
    if (cifra) cifra.textContent = pct + ' %';
    if (barra) barra.style.width = ((pct - LUPA_MIN) / (LUPA_MAX - LUPA_MIN) * 100) + '%';
    // La muestra se escribe con el mismo tamaño de partida que una respuesta de
    // Robin (15,5 px, ver .rr-bubble .txt) multiplicado por la lupa.
    if (muestra) muestra.style.fontSize = (15.5 * pct / 100).toFixed(1) + 'px';

    caja.querySelectorAll('[data-lupa]').forEach(btn => {
      const paso = Number(btn.dataset.lupa);
      btn.disabled = (paso === -1 && pct <= LUPA_MIN) ||
                     (paso === 1 && pct >= LUPA_MAX) ||
                     (paso === 0 && pct === 100);
    });
  }

  // ---- Las cuentas ---------------------------------------------------------

  async function cargarCuentas() {
    try {
      const data = await peticion('/api/dev/accounts');
      cuentas = data.accounts || [];
      pintarLista();
    } catch (err) {
      // La sesión se cerró mientras la ventana estaba abierta, o el servidor
      // apagó la consola: se dice lo que pasó, sin dejar una lista a medias.
      if (caja) caja.querySelector('#rrConsolaLista').innerHTML =
        `<div class="rr-consola-vacio">No se pudo leer la lista de cuentas.<br><small>${escapar(err.message)}</small></div>`;
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

    const quedan = visibles.length - TOPE_FILAS;
    lista.innerHTML = visibles.slice(0, TOPE_FILAS).map(c => `
      <button type="button" class="rr-consola-cuenta" data-entrar="${c.id}">
        <span class="rr-consola-rol rol-${escapar(c.role)}">${escapar(c.roleLabel)}</span>
        <span class="rr-consola-quien">
          <strong>${escapar(c.fullName)}</strong>
          <small>${escapar([c.email || c.studentCode, c.schoolName, c.grade].filter(Boolean).join(' · ') || 'sin escuela')}</small>
        </span>
        <span class="rr-consola-ir">Entrar →</span>
      </button>`).join('') + (quedan > 0
        ? `<div class="rr-consola-vacio">y ${quedan.toLocaleString('es')} cuentas más.<br>
           <small>Escribe arriba para encontrar la que buscas.</small></div>`
        : '');

    // Un solo listener para toda la lista, y no uno por fila: con una escuela
    // entera eran mil trescientos.
    if (lista.dataset.rrEnchufada !== 'si') {
      lista.dataset.rrEnchufada = 'si';
      lista.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-entrar]');
        if (btn) entrar(Number(btn.dataset.entrar), btn);
      });
    }
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
    if (!window.RR_PAGINAS_ESTATICAS) return '/dashboard/' + user.id;
    // Solo hace falta en la versión de GitHub Pages, que no tiene servidor
    // que resuelva /dashboard/<id>. Ver rrDashboardFor() en public/js/api.js.
    if (['admin', 'subdirector', 'secretary'].includes(user.role)) return '/dashboard-admin.html';
    if (user.role === 'teacher') return '/dashboard-teacher.html';
    if (user.role === 'parent') return '/dashboard-parent.html';
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

  // ---- La llave de Robin ---------------------------------------------------
  //
  // Pegar aquí la llave de Anthropic y Robin empieza a contestar con Claude
  // sin reiniciar el servidor. Está en la consola y no en Configuración a
  // propósito: es de quien administra el servidor, no de cada cuenta.
  //
  // La llave no vuelve nunca entera del servidor: solo su pista. Por eso el
  // campo aparece siempre vacío — lo que se lea ahí es lo que se acaba de
  // escribir, nunca lo que ya estaba guardado.

  let llave = null;

  async function cargarLlave() {
    try {
      llave = await peticion('/api/dev/llave');
      pintarLlave();
    } catch (err) {
      const hueco = caja && caja.querySelector('#rrConsolaLlave');
      if (hueco) hueco.innerHTML = `<div class="rr-consola-vacio">${escapar(err.message)}</div>`;
    }
  }

  function pintarLlave() {
    if (!caja || !llave) return;
    const hueco = caja.querySelector('#rrConsolaLlave');
    if (!hueco) return;

    const puesta = llave.puesta;
    const delEntorno = llave.origen === 'entorno';

    hueco.innerHTML = `
      <div class="rr-consola-llave-estado ${puesta ? 'esta-puesta' : ''}">
        <strong>${puesta ? 'Robin contesta con Claude' : 'Robin está en su modo local'}</strong>
        <small>${puesta
          ? `${escapar(llave.pista)} · ${delEntorno
              ? 'viene de la variable de entorno ANTHROPIC_API_KEY'
              : 'guardada en config.json'} · modelo ${escapar(llave.modelo)}`
          : 'No hay ninguna llave puesta. Pega una y Robin conversa de verdad.'}</small>
      </div>

      ${llave.local ? '' : `
        <div class="rr-consola-error">Esta consola no se está viendo desde la computadora
        del servidor. La llave solo se pone desde localhost.</div>`}

      <div class="rr-consola-llave-grid">
        <label class="rr-consola-esc-campo">
          <span>Llave de la API <em>(sale de console.anthropic.com)</em></span>
          <input type="password" id="rrLlaveCampo" placeholder="sk-ant-api03-…"
                 autocomplete="off" spellcheck="false" ${llave.local ? '' : 'disabled'} />
        </label>
        <label class="rr-consola-esc-campo">
          <span>Con qué modelo contesta</span>
          <select id="rrLlaveModelo" ${llave.local ? '' : 'disabled'}>
            ${(llave.modelos || []).map(m => `
              <option value="${escapar(m.id)}" ${m.id === llave.modelo ? 'selected' : ''}>${escapar(m.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="rr-consola-llave-botones">
        <button type="button" class="rr-consola-btn" id="rrLlaveGuardar" ${llave.local ? '' : 'disabled'}>Guardar</button>
        <button type="button" class="rr-consola-btn rr-consola-btn-suave" id="rrLlaveProbar">Probar la conexión</button>
        ${puesta && !delEntorno
          ? '<button type="button" class="rr-consola-esc-borrar" id="rrLlaveQuitar">Quitar la llave</button>'
          : ''}
      </div>

      <div class="rr-consola-salida" id="rrLlaveSalida"></div>`;

    const guardar = hueco.querySelector('#rrLlaveGuardar');
    if (guardar) guardar.addEventListener('click', guardarLlave);
    hueco.querySelector('#rrLlaveProbar').addEventListener('click', probarLlave);
    const quitar = hueco.querySelector('#rrLlaveQuitar');
    if (quitar) quitar.addEventListener('click', () => quitarLlave(quitar));

    // Enter en el campo guarda: es lo que hace cualquiera después de pegar.
    const campo = hueco.querySelector('#rrLlaveCampo');
    if (campo) campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); guardarLlave(); }
    });
  }

  async function guardarLlave() {
    const campo = caja.querySelector('#rrLlaveCampo');
    const modelo = caja.querySelector('#rrLlaveModelo');
    const btn = caja.querySelector('#rrLlaveGuardar');
    const escrita = campo.value.trim();

    // Sin llave escrita y sin cambio de modelo no hay nada que guardar: se
    // dice, en vez de mandar una petición vacía que conteste un 400.
    if (!escrita && modelo.value === llave.modelo) {
      return avisarLlave('Pega una llave, o elige otro modelo.', 'error');
    }

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const cuerpo = { model: modelo.value };
      if (escrita) cuerpo.key = escrita;
      llave = await peticion('/api/dev/llave', { method: 'PUT', body: cuerpo });
      campo.value = '';
      pintarLlave();
      avisarLlave(llave.mensaje || 'Guardada.', 'ok');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Guardar';
      avisarLlave(err.message, 'error');
    }
  }

  // Una petición de verdad a Anthropic. Si hay algo escrito en el campo se
  // prueba ESO, sin guardarlo: así se comprueba una llave antes de dejarla
  // puesta.
  async function probarLlave() {
    const campo = caja.querySelector('#rrLlaveCampo');
    const btn = caja.querySelector('#rrLlaveProbar');
    const escrita = campo ? campo.value.trim() : '';

    if (!escrita && !llave.puesta) {
      return avisarLlave('Todavía no hay ninguna llave que probar.', 'error');
    }

    btn.disabled = true;
    btn.textContent = 'Probando…';
    try {
      const r = await peticion('/api/dev/llave/probar', {
        method: 'POST',
        body: escrita ? { key: escrita } : {}
      });
      if (r.ok) {
        avisarLlave(`Contestó en ${r.ms} ms con ${r.model}${r.sinGuardar
          ? ' — y esa llave todavía no está guardada.'
          : '.'}`, 'ok');
      } else {
        avisarLlave(r.error, 'error');
      }
    } catch (err) {
      avisarLlave(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Probar la conexión';
    }
  }

  // Quitar pregunta una vez en el propio botón, igual que borrar una escuela:
  // sin llave Robin deja de conversar, y eso no se hace de un resbalón.
  async function quitarLlave(btn) {
    if (btn.dataset.seguro !== 'si') {
      btn.dataset.seguro = 'si';
      btn.classList.add('esta-seguro');
      btn.textContent = '¿Seguro? Robin vuelve a su modo local';
      setTimeout(() => {
        if (!btn.isConnected || btn.dataset.seguro !== 'si') return;
        btn.dataset.seguro = '';
        btn.classList.remove('esta-seguro');
        btn.textContent = 'Quitar la llave';
      }, 4000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Quitando…';
    try {
      llave = await peticion('/api/dev/llave', { method: 'DELETE' });
      pintarLlave();
      avisarLlave(llave.mensaje || 'Llave quitada.', 'ok');
    } catch (err) {
      btn.disabled = false;
      btn.dataset.seguro = '';
      btn.classList.remove('esta-seguro');
      btn.textContent = 'Quitar la llave';
      avisarLlave(err.message, 'error');
    }
  }

  // Este bloque tiene su propia salida y no usa la de fabricar datos: las dos
  // cosas se usan seguidas, y un mensaje que aparece en la otra punta de la
  // ventana no se ve.
  function avisarLlave(mensaje, tipo) {
    const salida = caja && caja.querySelector('#rrLlaveSalida');
    if (!salida) return avisar(mensaje);
    salida.innerHTML = tipo === 'ok'
      ? `<div class="rr-consola-ok"><strong>${escapar(mensaje)}</strong></div>`
      : `<div class="rr-consola-error">${escapar(mensaje)}</div>`;
  }

  // ---- El panel de escuelas ------------------------------------------------
  //
  // Lo de arriba fabrica clases sueltas para que una pantalla no se vea vacía.
  // Esto monta una escuela con forma —parvularia, básica y bachillerato, cada
  // grado con sus secciones, un maestro por salón, los de materias especiales—
  // y la deja borrar entera de un botón.
  //
  // El número de cuentas se dice ANTES de apretar y se recalcula con cada
  // cambio: son más de mil, tardan, y enterarse después no sirve de nada.

  let malla = [];       // lo que manda el servidor, ya marcado
  let especiales = [];  // [{ materia, puesto }]
  let escuelas = [];

  function pintarPanel() {
    if (!caja) return;
    const hueco = caja.querySelector('#rrConsolaEscuelas');
    if (!hueco) return;

    hueco.innerHTML = `
      <div class="rr-consola-esc-grid">
        <div>
          <label class="rr-consola-esc-campo">
            <span>Nombre de la escuela</span>
            <input type="text" id="rrEscNombre" placeholder="Centro Escolar Las Flores" autocomplete="off" />
          </label>
          <label class="rr-consola-esc-campo">
            <span>Quién la dirige <em>(si se deja en blanco, sale un nombre al azar)</em></span>
            <input type="text" id="rrEscDirector" placeholder="Nombre de la dirección" autocomplete="off" />
          </label>
          <div class="rr-consola-campos">
            <label>Secciones <input type="text" id="rrEscSecciones" value="A, B, C" autocomplete="off" /></label>
            <label>Por salón <input type="number" id="rrEscPorClase" value="30" min="0" max="40" /></label>
          </div>
        </div>

        <div>
          <p class="rr-consola-esc-tit">Qué grados se abren</p>
          <div class="rr-consola-esc-chips" id="rrEscTramos">
            ${malla.map((t, i) => `
              <label class="rr-consola-chip">
                <input type="checkbox" data-tramo="${i}" ${t.puesto ? 'checked' : ''} />
                <span>${escapar(t.level)} <em>${t.grades.length}</em></span>
              </label>`).join('')}
          </div>

          <p class="rr-consola-esc-tit">Maestros de materias especiales</p>
          <div class="rr-consola-esc-chips" id="rrEscEspeciales">
            ${especiales.map((e, i) => `
              <label class="rr-consola-chip">
                <input type="checkbox" data-esp="${i}" ${e.puesto ? 'checked' : ''} />
                <span>${escapar(e.materia)}</span>
              </label>`).join('')}
          </div>
        </div>
      </div>

      <div class="rr-consola-esc-cuenta" id="rrEscCuenta"></div>

      <button type="button" class="rr-consola-btn rr-consola-btn-grande" id="rrEscCrear">
        <strong>Montar la escuela</strong>
        <small id="rrEscResumen"></small>
      </button>

      <p class="rr-consola-esc-tit rr-consola-esc-tit-sep">Escuelas que ya existen</p>
      <div class="rr-consola-esc-lista" id="rrEscLista"></div>

      <div class="rr-consola-salida" id="rrConsolaSalidaEsc"></div>`;

    hueco.querySelectorAll('[data-tramo]').forEach(chk => {
      chk.addEventListener('change', () => {
        malla[Number(chk.dataset.tramo)].puesto = chk.checked;
        recalcular();
      });
    });
    hueco.querySelectorAll('[data-esp]').forEach(chk => {
      chk.addEventListener('change', () => {
        especiales[Number(chk.dataset.esp)].puesto = chk.checked;
        recalcular();
      });
    });
    hueco.querySelector('#rrEscSecciones').addEventListener('input', recalcular);
    hueco.querySelector('#rrEscPorClase').addEventListener('input', recalcular);
    hueco.querySelector('#rrEscCrear').addEventListener('click', montarEscuela);

    recalcular();
    pintarEscuelas();
  }

  // Lo que se va a fabricar, leído de las casillas. Una sola función para esto
  // y no dos: lo que se cuenta en pantalla y lo que se manda al servidor tienen
  // que ser exactamente lo mismo, o el aviso de "son 1.260 cuentas" miente.
  function receta() {
    const secciones = String(caja.querySelector('#rrEscSecciones').value || '')
      .split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    const porClase = Math.max(0, Math.min(40, Number(caja.querySelector('#rrEscPorClase').value) || 0));
    const tramos = malla.filter(t => t.puesto);
    const secs = secciones.length ? [...new Set(secciones)] : ['A'];

    const aulas = tramos.reduce((n, t) => n + t.grades.length, 0) * secs.length;
    const espPuestas = especiales.filter(e => e.puesto);

    return {
      name: String(caja.querySelector('#rrEscNombre').value || '').trim(),
      directorName: String(caja.querySelector('#rrEscDirector').value || '').trim(),
      secciones: secs,
      porClase,
      malla: tramos.map(t => ({ level: t.level, grades: t.grades })),
      especiales: espPuestas.map(e => e.materia),
      // Solo para la cuenta de aquí:
      _aulas: aulas,
      _alumnos: aulas * porClase,
      // Un maestro por salón, más uno por materia especial, más la dirección.
      _profes: aulas + espPuestas.length,
      _secs: secs
    };
  }

  function recalcular() {
    if (!caja) return;
    const r = receta();
    const total = r._alumnos + r._profes + 1;
    const cuenta = caja.querySelector('#rrEscCuenta');
    const resumen = caja.querySelector('#rrEscResumen');
    const btn = caja.querySelector('#rrEscCrear');
    if (!cuenta) return;

    if (!r._aulas) {
      cuenta.className = 'rr-consola-esc-cuenta rr-consola-esc-cuenta-mal';
      cuenta.textContent = 'Sin grados marcados no hay nada que montar.';
      if (btn) btn.disabled = true;
      if (resumen) resumen.textContent = '';
      return;
    }
    if (r._aulas > 60) {
      cuenta.className = 'rr-consola-esc-cuenta rr-consola-esc-cuenta-mal';
      cuenta.textContent = `Son ${r._aulas} salones y el tope son 60. Quita grados o secciones.`;
      if (btn) btn.disabled = true;
      if (resumen) resumen.textContent = '';
      return;
    }

    cuenta.className = 'rr-consola-esc-cuenta';
    cuenta.innerHTML = `
      <strong>${total.toLocaleString('es')} cuentas</strong>
      <span>${r._aulas} salones (${r._secs.join(', ')}) ·
      ${r._alumnos.toLocaleString('es')} estudiantes ·
      ${r._profes} maestros · 1 dirección</span>`;
    if (btn) btn.disabled = false;
    if (resumen) {
      resumen.textContent = total > 600
        ? `${total.toLocaleString('es')} cuentas — tarda un rato`
        : `${total.toLocaleString('es')} cuentas`;
    }
  }

  async function montarEscuela() {
    const r = receta();
    const btn = caja.querySelector('#rrEscCrear');
    const salida = caja.querySelector('#rrConsolaSalidaEsc');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<strong>Montando la escuela…</strong><small>No cierres esta ventana</small>';
    salida.innerHTML = '';

    try {
      const data = await peticion('/api/dev/escuela', {
        method: 'POST',
        body: {
          name: r.name,
          directorName: r.directorName,
          secciones: r.secciones,
          porClase: r.porClase,
          malla: r.malla,
          especiales: r.especiales
        }
      });

      salida.innerHTML = `
        <div class="rr-consola-ok">
          <strong>${escapar(data.school.name)}</strong>
          <small>${data.students.toLocaleString('es')} estudiantes ·
            ${data.teachers} maestros · ${data.classes} clases ·
            dirección: ${escapar(data.director.fullName)}</small>
          <ul>
            <li>Entrar a cualquiera de estas cuentas: búscala arriba y dale a «Entrar».</li>
            <li>Código de estudiantes <em>${escapar(data.school.studentCode)}</em> ·
                de profesorado <em>${escapar(data.school.teacherCode)}</em></li>
            <li>La contraseña de todas es <em>${escapar(data.clave)}</em></li>
            ${data.especiales.map(e => `
              <li>${escapar(e.materia)}: ${escapar(e.teacherName)}
                  <em>${e.clases.length} ${e.clases.length === 1 ? 'clase' : 'clases'}</em></li>`).join('')}
          </ul>
        </div>`;

      cargarEscuelas();
      cargarCuentas();
    } catch (err) {
      avisar(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
      recalcular();
    }
  }

  async function cargarEscuelas() {
    try {
      const data = await peticion('/api/dev/escuelas');
      escuelas = data.escuelas || [];
      // La malla y las materias llegan del servidor, que es quien manda: así
      // no hay dos listas de grados que se puedan desincronizar.
      if (!malla.length) {
        malla = (data.malla || []).map(t => ({ ...t, puesto: true }));
        especiales = (data.especiales || []).map(m => ({ materia: m, puesto: true }));
        pintarPanel();
        return;
      }
      pintarEscuelas();
    } catch (err) {
      const lista = caja && caja.querySelector('#rrEscLista');
      if (lista) lista.innerHTML = `<div class="rr-consola-vacio">${escapar(err.message)}</div>`;
    }
  }

  function pintarEscuelas() {
    if (!caja) return;
    const lista = caja.querySelector('#rrEscLista');
    if (!lista) return;

    if (!escuelas.length) {
      lista.innerHTML = '<div class="rr-consola-vacio">Todavía no hay ninguna escuela.</div>';
      return;
    }

    lista.innerHTML = escuelas.map(e => `
      <div class="rr-consola-esc-fila" data-escuela="${e.id}">
        <span class="rr-consola-esc-quien">
          <strong>${escapar(e.name)}</strong>
          <small>${e.students.toLocaleString('es')} estudiantes · ${e.teachers} maestros ·
            ${e.classes} clases${e.directorName ? ' · ' + escapar(e.directorName) : ''}</small>
        </span>
        <button type="button" class="rr-consola-esc-borrar" data-borrar="${e.id}">Borrar</button>
      </div>`).join('');

    lista.querySelectorAll('[data-borrar]').forEach(btn => {
      btn.addEventListener('click', () => borrarEscuela(Number(btn.dataset.borrar), btn));
    });
  }

  // Borrar una escuela se lleva por delante a toda su gente, así que se pide
  // confirmación en el propio botón: el primer clic pregunta y el segundo
  // borra. Sin confirm() del navegador, que bloquea la página entera.
  async function borrarEscuela(id, btn) {
    const escuela = escuelas.find(e => e.id === id);
    if (!escuela) return;

    if (btn.dataset.seguro !== 'si') {
      btn.dataset.seguro = 'si';
      btn.classList.add('esta-seguro');
      btn.textContent = `¿Borrar ${escuela.students + escuela.teachers + escuela.staff} cuentas?`;
      // Si se arrepiente y no vuelve a tocar, el botón se calma solo.
      setTimeout(() => {
        if (!btn.isConnected || btn.dataset.seguro !== 'si') return;
        btn.dataset.seguro = '';
        btn.classList.remove('esta-seguro');
        btn.textContent = 'Borrar';
      }, 4000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Borrando…';
    try {
      const data = await peticion(`/api/dev/escuela/${id}`, { method: 'DELETE' });
      if (typeof rrToast === 'function') {
        rrToast(`${data.school.name}: ${data.users} cuentas y ${data.classes} clases fuera.`, 'success');
      }
      cargarEscuelas();
      cargarCuentas();
    } catch (err) {
      btn.disabled = false;
      btn.dataset.seguro = '';
      btn.classList.remove('esta-seguro');
      btn.textContent = 'Borrar';
      avisar(err.message);
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
