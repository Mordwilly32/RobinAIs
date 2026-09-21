// public/js/attendance.js
// El pase de lista, dentro del panel.
//
// Antes esto era /herramientas/asistencia wapp.html: una página suelta que se
// abría en otra pestaña, no sabía quién eras y guardaba en el navegador. Aquí
// la lista sale de la base de datos de verdad y la marca se guarda con el día,
// así que la familia la ve desde su propia cuenta.
//
// El orden de la pantalla es el orden del trabajo, y no es casual:
//
//   1. el día     se detecta solo y se escribe entero. Se puede cambiar, para
//                 arreglar el lunes un martes.
//   2. la lista   quién es quién, con su número y su foto. Esto se hace UNA
//                 vez, al principio del año.
//   3. la cámara  con la lista ya montada, reconoce y marca.
//
// La cara nunca sale de esta computadora, y ahora tampoco la foto. face-api
// trabaja entero en el navegador, y la foto y su huella se guardan en
// IndexedDB —ver public/js/face-vault.js—, no en la base de datos. Al servidor
// solo sube el id de a quién se reconoció. Los fotogramas del vídeo no se
// guardan ni se mandan a ningún lado.
//
// Eso hace que la lista de caras sea de este aparato: si mañana se pasa lista
// desde otra tablet, hay que volver a tomarlas ahí o llevarse el archivo con
// el botón de copia. Es el precio de no tener las caras de unos menores
// guardadas en el servidor de nadie.
//
// Solo de primaria en adelante: en parvularia el pase de lista lo hace la
// maestra mirando, no una cámara (ver ATTENDANCE_LEVELS en src/db.js).

const RR_FACE_LIB = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const RR_FACE_MODELS = 'https://justadudewhohacks.github.io/face-api.js/models';

// Cuánto se puede parecer una cara a otra para darla por la misma. 0.55 está
// deliberadamente por debajo del 0.6 que trae de serie: en un pase de lista,
// marcar a quien no era es peor que no marcar a nadie — el error silencioso
// termina en una falta injusta que nadie revisa.
const RR_FACE_UMBRAL = 0.55;

let rrFaceListo = null;   // la promesa de cargar la librería y los modelos

function rrCargarScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('No pude descargar el reconocimiento facial. ¿Hay internet?'));
    document.head.appendChild(el);
  });
}

// La librería y sus modelos pesan y vienen de internet, así que se traen la
// primera vez que hacen falta —no al abrir el panel— y se quedan cargados.
function rrPrepararCaras(avisar) {
  if (rrFaceListo) return rrFaceListo;
  rrFaceListo = (async () => {
    if (typeof faceapi === 'undefined') {
      if (avisar) avisar('Descargando el reconocimiento facial');
      await rrCargarScript(RR_FACE_LIB);
    }
    if (avisar) avisar('Cargando los modelos');
    await faceapi.nets.tinyFaceDetector.loadFromUri(RR_FACE_MODELS);
    await faceapi.nets.faceLandmark68Net.loadFromUri(RR_FACE_MODELS);
    await faceapi.nets.faceRecognitionNet.loadFromUri(RR_FACE_MODELS);
  })().catch(err => {
    // Si falla, que el siguiente intento vuelva a probar en vez de quedarse
    // con la promesa rota para siempre.
    rrFaceListo = null;
    throw err;
  });
  return rrFaceListo;
}

function rrMountAttendance(container) {
  let dia = null;          // { date, label, weekday, weekend }
  let lista = [];          // los estudiantes de la pantalla
  let clases = [];
  let fecha = rrTodayISO();
  let claseId = '';
  let nivel = '';
  let camara = null;       // { stream, video, canvas, timer }
  let marcadosPorCamara = new Set();

  const ETIQUETA = { present: 'Presente', late: 'Tarde', absent: 'Ausente' };

  // ---- Armazón -------------------------------------------------------------

  container.innerHTML = `
    <div class="rr-day-strip" id="attDay"></div>

    <div class="rr-toolbar">
      <select id="attClass"><option value="">Todas mis clases</option></select>
      <select id="attLevel"><option value="">Todos los niveles</option></select>
      <input type="date" id="attDate" class="rr-day-date" />

      <!-- La cámara es una opción que se deja puesta, no un botón que se
           pulsa cada vez. Hay días que se pasa lista con ella y días que se
           pasa a mano —falta la luz, se cayó internet, son cinco personas—, y
           un interruptor dice en qué modo estás sin tener que adivinarlo por
           si hay vídeo en pantalla o no. -->
      <label class="rr-switch" for="attCamOn">
        <input type="checkbox" id="attCamOn" />
        <span class="rr-switch-track"><i></i></span>
        <span class="rr-switch-text">📷 Pasar lista con la cámara</span>
      </label>
    </div>

    <div class="rr-att-tally" id="attTally"></div>
    <div id="attCam"></div>
    <div id="attBody">${rrLoadingHtml('Trayendo tu lista')}</div>

    <div class="rr-att-actions">
      <span class="rr-att-note" id="attNote"></span>
      <button class="btn btn-sm btn-soft" id="attReload" type="button">Actualizar</button>
      <button class="btn btn-sm btn-outline" id="attClose" type="button">Cerrar el pase: los que falten, ausentes</button>
    </div>

    <!-- Un solo campo de archivo para toda la lista: se le cuelga a quien
         toque en cada momento en vez de pintar treinta y cinco. -->
    <input type="file" id="attFaceFile" accept="image/*" hidden />`;

  const elDay = container.querySelector('#attDay');
  const elTally = container.querySelector('#attTally');
  const elBody = container.querySelector('#attBody');
  const elCam = container.querySelector('#attCam');
  const elNote = container.querySelector('#attNote');
  const elFile = container.querySelector('#attFaceFile');
  const selClass = container.querySelector('#attClass');
  const selLevel = container.querySelector('#attLevel');
  const inpDate = container.querySelector('#attDate');

  inpDate.value = fecha;

  // ---- El día ---------------------------------------------------------------

  function pintarDia() {
    if (!dia) return;
    const hoy = dia.date === rrTodayISO();
    elDay.className = `rr-day-strip ${dia.weekend ? 'weekend' : ''}`;
    elDay.innerHTML = `
      <span class="rr-day-ic">${dia.weekend ? '🌤️' : '🗓️'}</span>
      <div>
        <strong>${rrEscapeHtml(dia.label.charAt(0).toUpperCase() + dia.label.slice(1))}</strong>
        <small>${dia.weekend
          ? 'Es fin de semana. Puedes pasar lista igual, pero revisa que sea el día que querías.'
          : hoy
            ? 'Hoy. La marca se guarda con esta fecha.'
            : 'Estás pasando lista de un día que no es hoy.'}</small>
      </div>`;
  }

  function pintarTally(t) {
    elTally.innerHTML = `
      <div class="t-ok"><strong>${t.present}</strong><span>presentes</span></div>
      <div class="t-warn"><strong>${t.late}</strong><span>tarde</span></div>
      <div class="t-bad"><strong>${t.absent}</strong><span>ausentes</span></div>
      <div class="t-wait"><strong>${t.pending}</strong><span>sin marcar</span></div>`;

    elNote.textContent = t.total
      ? `${t.here} de ${t.total} en clase.` + (t.pending ? ` Faltan ${t.pending} por marcar.` : ' Pase completo.')
      : '';
  }

  // ---- La lista -------------------------------------------------------------

  // Cada persona es una ficha con dos pisos: la fila de siempre y, plegado
  // debajo, lo que solo se toca de vez en cuando (la foto y el teléfono de la
  // casa). Van separados porque se usan en momentos distintos: la fila, cada
  // mañana; el piso de abajo, una vez al año.
  function itemDe(s) {
    return `
      <div class="rr-att-item" data-item="${s.id}">
        ${rowDe(s)}
        ${editorDe(s)}
      </div>`;
  }

  function rowDe(s) {
    return `
      <div class="rr-att-row ${s.status ? `is-${s.status}` : ''}" data-row="${s.id}">
        <input class="rr-att-num" type="number" min="1" max="99" inputmode="numeric"
               value="${s.listNumber || ''}" placeholder="—" data-num="${s.id}"
               aria-label="Número de lista de ${rrEscapeHtml(s.fullName)}" />

        <button type="button" class="rr-att-face ${s.faceDescriptor ? 'has-face' : ''}" data-edit-open="${s.id}"
                title="${s.faceDescriptor ? 'Ya se le puede reconocer. Pulsa para cambiar su ficha.' : 'Todavía no tiene foto. Pulsa para ponérsela.'}">
          ${s.facePhoto
            ? `<img src="${rrEscapeHtml(s.facePhoto)}" alt="" />`
            : '<span class="rr-att-face-empty">👤</span>'}
        </button>

        <div class="rr-att-who">
          <strong>${rrEscapeHtml(s.fullName)}</strong>
          <small>
            ${rrEscapeHtml(s.studentCode || '—')}${s.grade ? ` · ${rrEscapeHtml(s.grade)}` : ''}
            ${s.status && s.at
              ? ` · <span class="rr-att-when">${rrEscapeHtml(ETIQUETA[s.status])} a las ${rrEscapeHtml(hora(s.at))}${s.method === 'face' ? ' (cámara)' : ''}</span>`
              : ''}
            ${s.parentPhone
              ? ` · <span class="rr-att-tel">📞 +${rrEscapeHtml(s.parentPhoneCode || '')} ${rrEscapeHtml(telBonito(s.parentPhone))}</span>`
              : ''}
            ${!s.faceDescriptor ? ' · <em>sin foto: solo a mano</em>' : ''}
          </small>
        </div>

        <div class="rr-att-marks">
          ${['present', 'late', 'absent'].map(m => `
            <button type="button" class="rr-att-mark ${s.status === m ? 'on' : ''}" data-mark="${m}" data-student="${s.id}">
              ${ETIQUETA[m]}
            </button>`).join('')}
          <button type="button" class="rr-att-pencil" data-edit-open="${s.id}"
                  title="Poner su foto y el número de su casa"
                  aria-label="Editar la ficha de ${rrEscapeHtml(s.fullName)}">✏️</button>
        </div>
      </div>`;
  }

  // El piso de abajo. Lo que hay que rellenar una vez y ya: la foto con la que
  // se le reconoce y a qué teléfono llamar si un día no llega.
  function editorDe(s) {
    return `
      <div class="rr-att-edit" data-edit="${s.id}" hidden>
        <div class="rr-att-edit-grid">
          <div class="rr-att-edit-photo">
            <button type="button" class="rr-att-face big ${s.faceDescriptor ? 'has-face' : ''}" data-face="${s.id}">
              ${s.facePhoto
                ? `<img src="${rrEscapeHtml(s.facePhoto)}" alt="" />`
                : '<span class="rr-att-face-empty">👤</span>'}
              <span class="rr-att-face-edit">${s.facePhoto ? 'Cambiar' : 'Subir foto'}</span>
            </button>
            <small>${s.faceDescriptor
              ? 'La cámara ya lo reconoce.'
              : 'De frente y con buena luz. Sin foto solo se le puede marcar a mano.'}</small>
          </div>

          <div class="rr-att-edit-tel">
            <label for="tel-${s.id}">Poner número del padre o la madre</label>
            <div class="rr-phone">
              <span class="rr-phone-plus">+</span>
              <input class="rr-phone-code" type="text" inputmode="numeric" maxlength="4"
                     value="${rrEscapeHtml(s.parentPhoneCode || '503')}" data-code="${s.id}"
                     aria-label="Código de país" />
              <input class="rr-phone-num" type="tel" inputmode="tel" id="tel-${s.id}"
                     value="${rrEscapeHtml(s.parentPhone || '')}" placeholder="7777 7777"
                     data-phone="${s.id}" />
            </div>
            <small>El código viene puesto en 503; cámbialo si la familia es de otro país. Es a quien se llama el día que no llega.</small>
            <div class="rr-att-edit-actions">
              <button type="button" class="btn btn-sm btn-primary" data-save-contact="${s.id}">Guardar</button>
              <button type="button" class="btn btn-sm btn-ghost" data-edit-close="${s.id}">Cerrar</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // El número se guarda solo con dígitos, pero se enseña separado: un teléfono
  // de ocho cifras seguidas no se lee, se descifra — y este se lee justo
  // cuando hay prisa por llamar.
  function telBonito(num) {
    const d = String(num || '');
    if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
    if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    return d;
  }

  function hora(iso) {
    try { return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }

  function pintarLista() {
    if (!lista.length) {
      elBody.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'ghost',
        title: 'Aquí no hay a quién pasar lista',
        text: 'Aparecen los estudiantes de tus clases de primaria en adelante. En parvularia no se lleva pase de lista. Si falta alguien, revisa el filtro de clase o emite su código desde «Mis clases».'
      })}</div>`;
      return;
    }
    elBody.innerHTML = `<div class="rr-att-list">${lista.map(itemDe).join('')}</div>`;
  }

  // Refrescar una sola fila, sin volver a pintar la lista entera: con la
  // cámara encendida, repintar treinta filas cada vez que reconoce a alguien
  // da tirones y borra el número que se estaba escribiendo.
  //
  // Se cambia SOLO la fila de arriba y no la ficha entera: si alguien tiene el
  // editor abierto escribiendo un teléfono, repintar la ficha se lo cerraría
  // y le borraría lo escrito a medias.
  function refrescarFila(id) {
    const s = lista.find(x => x.id === id);
    const fila = elBody.querySelector(`[data-row="${id}"]`);
    if (!s || !fila) return;
    const nuevo = document.createElement('div');
    nuevo.innerHTML = rowDe(s).trim();
    fila.replaceWith(nuevo.firstElementChild);
  }

  // La ficha de abajo, cuando cambia lo que enseña (una foto nueva).
  function refrescarEditor(id) {
    const s = lista.find(x => x.id === id);
    const caja = elBody.querySelector(`[data-edit="${id}"]`);
    if (!s || !caja) return;
    const abierto = !caja.hidden;
    const nuevo = document.createElement('div');
    nuevo.innerHTML = editorDe(s).trim();
    const reemplazo = nuevo.firstElementChild;
    reemplazo.hidden = !abierto;
    caja.replaceWith(reemplazo);
  }

  function recontar() {
    const t = {
      total: lista.length,
      present: lista.filter(s => s.status === 'present').length,
      late: lista.filter(s => s.status === 'late').length,
      absent: lista.filter(s => s.status === 'absent').length,
      pending: lista.filter(s => !s.status).length
    };
    t.here = t.present + t.late;
    pintarTally(t);
  }

  // ---- Traer ----------------------------------------------------------------

  async function cargar({ silencioso = false } = {}) {
    if (!silencioso) rrLoadingIn(elBody, 'Trayendo tu lista');
    const params = new URLSearchParams({ date: fecha });
    if (claseId) params.set('classId', claseId);
    if (nivel) params.set('level', nivel);

    try {
      const data = await rrApi(`/api/attendance/roster?${params}`);
      dia = data.day;
      lista = data.students;
      clases = data.classes;

      // La lista viene del servidor sin fotos ni huellas: esas están aquí.
      await RRCaras.mezclar(lista);

      llenarSelectores(data.levels);
      pintarDia();
      pintarLista();
      pintarTally(data.tally);
    } catch (err) {
      elBody.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'sad', title: 'No pude traer la lista', text: rrEscapeHtml(err.message)
      })}</div>`;
    }
  }

  function llenarSelectores(niveles) {
    if (selClass.options.length <= 1) {
      clases.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        selClass.appendChild(opt);
      });
    }
    if (selLevel.options.length <= 1) {
      (niveles || []).forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        selLevel.appendChild(opt);
      });
    }
  }

  // ---- Marcar ---------------------------------------------------------------

  async function marcar(studentId, status, metodo = 'manual') {
    const s = lista.find(x => x.id === Number(studentId));
    if (!s) return;

    // Se pinta antes de que conteste el servidor: con treinta personas
    // esperando, un botón que tarda medio segundo en reaccionar hace que se
    // pulse dos veces.
    const previo = { status: s.status, at: s.at, method: s.method };
    s.status = status;
    s.at = new Date().toISOString();
    s.method = metodo;
    refrescarFila(s.id);
    recontar();

    try {
      await rrApi('/api/attendance/mark', {
        method: 'POST',
        body: { studentId: s.id, classId: claseId || null, status, date: fecha, method: metodo }
      });
    } catch (err) {
      Object.assign(s, previo);
      refrescarFila(s.id);
      recontar();
      rrToast(err.message, 'error');
    }
  }

  // ---- La foto de cada quien ------------------------------------------------

  let esperandoFoto = null;   // a quién le estamos poniendo foto

  container.addEventListener('click', (e) => {
    const marca = e.target.closest('[data-mark]');
    if (marca) return marcar(marca.dataset.student, marca.dataset.mark);

    // El lápiz (y la miniatura de la foto, que lleva al mismo sitio).
    const abrir = e.target.closest('[data-edit-open]');
    if (abrir) return alternarEditor(Number(abrir.dataset.editOpen));

    const cerrar = e.target.closest('[data-edit-close]');
    if (cerrar) return alternarEditor(Number(cerrar.dataset.editClose), false);

    const guardar = e.target.closest('[data-save-contact]');
    if (guardar) return guardarTelefono(Number(guardar.dataset.saveContact), guardar);

    const foto = e.target.closest('[data-face]');
    if (foto) {
      esperandoFoto = Number(foto.dataset.face);
      elFile.value = '';
      elFile.click();
    }
  });

  // Solo una ficha abierta a la vez: con tres abiertas la lista se vuelve una
  // columna de formularios y se pierde de vista quién falta por marcar.
  function alternarEditor(id, forzar) {
    const caja = elBody.querySelector(`[data-edit="${id}"]`);
    if (!caja) return;
    const abrir = forzar === undefined ? caja.hidden : forzar;

    elBody.querySelectorAll('.rr-att-edit').forEach(c => { c.hidden = true; });
    elBody.querySelectorAll('.rr-att-item').forEach(i => i.classList.remove('editing'));

    caja.hidden = !abrir;
    const ficha = elBody.querySelector(`[data-item="${id}"]`);
    if (ficha) ficha.classList.toggle('editing', abrir);
    if (abrir) {
      caja.querySelector('.rr-phone-num').focus();
      ficha.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function guardarTelefono(id, boton) {
    const caja = elBody.querySelector(`[data-edit="${id}"]`);
    if (!caja) return;
    const code = caja.querySelector(`[data-code="${id}"]`).value.trim();
    const phone = caja.querySelector(`[data-phone="${id}"]`).value.trim();

    boton.disabled = true;
    const antes = boton.textContent;
    boton.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });
    try {
      const data = await rrApi(`/api/attendance/student/${id}/contact`, {
        method: 'PUT', body: { parentPhoneCode: code, parentPhone: phone }
      });
      const s = lista.find(x => x.id === id);
      if (s) { s.parentPhoneCode = data.parentPhoneCode; s.parentPhone = data.parentPhone; }
      refrescarFila(id);
      rrToast(data.parentPhone ? 'Número guardado.' : 'Número quitado.', 'success');
      alternarEditor(id, false);
    } catch (err) {
      rrToast(err.message, 'error');
    } finally {
      boton.disabled = false;
      boton.textContent = antes;
    }
  }

  // El número: se guarda al salir del campo, no en cada tecla.
  container.addEventListener('change', async (e) => {
    const campo = e.target.closest('[data-num]');
    if (!campo) return;
    const id = Number(campo.dataset.num);
    try {
      const { listNumber } = await rrApi(`/api/attendance/student/${id}/number`, {
        method: 'PUT', body: { listNumber: campo.value }
      });
      const s = lista.find(x => x.id === id);
      if (s) s.listNumber = listNumber;
      rrToast(listNumber ? `Número ${listNumber} guardado.` : 'Número quitado.', 'success');
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  elFile.addEventListener('change', async () => {
    const file = elFile.files[0];
    if (!file || !esperandoFoto) return;
    const id = esperandoFoto;
    esperandoFoto = null;

    if (file.size > 6 * 1024 * 1024) {
      return rrToast('Esa foto pesa demasiado. Menos de 6 MB.', 'error');
    }

    const espera = rrLoading('Leyendo la foto', {
      sub: 'Se busca la cara y se guarda su huella. Todo se queda en este navegador.'
    });

    try {
      const dataUrl = await leerArchivo(file);
      const recorte = await encoger(dataUrl, 400);

      espera.say('Cargando el reconocimiento facial');
      await rrPrepararCaras(t => espera.say(t));

      espera.say('Buscando la cara');
      const img = await cargarImagen(recorte);
      const det = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: .4 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!det) {
        // La foto se guarda igual: sirve para reconocer a la persona en la
        // lista aunque la cámara no la pueda identificar. Lo que no se puede
        // es callarse que el reconocimiento no va a funcionar con ella.
        await RRCaras.guardar(id, { facePhoto: recorte, faceDescriptor: null });
        const s = lista.find(x => x.id === id);
        if (s) { s.facePhoto = recorte; s.faceDescriptor = null; }
        refrescarFila(id);
        refrescarEditor(id);
        return rrToast('Guardé la foto, pero no encontré una cara en ella. Prueba con una de frente y bien iluminada.', 'error');
      }

      espera.say('Guardando en este navegador');
      const descriptor = Array.from(det.descriptor);
      await RRCaras.guardar(id, { facePhoto: recorte, faceDescriptor: descriptor });

      const s = lista.find(x => x.id === id);
      if (s) { s.facePhoto = recorte; s.faceDescriptor = descriptor; }
      refrescarFila(id);
      refrescarEditor(id);
      rrToast('Listo: la cámara ya lo puede reconocer desde este aparato.', 'success');
    } catch (err) {
      rrToast(err.message, 'error');
    } finally {
      espera.close();
    }
  });

  function leerArchivo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      reader.readAsDataURL(file);
    });
  }

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Esa imagen no se pudo abrir.'));
      img.src = src;
    });
  }

  // Una foto de teléfono son varios megas y aquí sobra: para reconocer una
  // cara basta con 400 px de lado. Encogerla antes de guardarla mantiene
  // data/db.json a un tamaño razonable.
  async function encoger(dataUrl, lado) {
    const img = await cargarImagen(dataUrl);
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  // ---- La cámara ------------------------------------------------------------

  function conHuella() {
    return lista.filter(s => Array.isArray(s.faceDescriptor) && s.faceDescriptor.length === 128);
  }

  async function abrirCamara() {
    const gente = conHuella();
    if (!gente.length) {
      rrToast('Todavía nadie tiene foto guardada. Ponle una a alguien con el lápiz y vuelve a intentarlo.', 'error');
      return false;
    }

    elCam.innerHTML = `
      <div class="rr-cam">
        <div class="rr-cam-stage">
          <video id="attVideo" autoplay muted playsinline></video>
          <canvas id="attCanvas"></canvas>
          <div class="rr-cam-veil" id="attVeil">
            ${rrLoadingHtml('Encendiendo la cámara')}
            <p>Tu navegador te va a pedir permiso. Las imágenes no se guardan ni salen de esta computadora.</p>
          </div>
        </div>
        <div class="rr-cam-bar">
          <span class="rr-cam-live"><i></i> En vivo</span>
          <span class="rr-cam-msg" id="attCamMsg">Preparando…</span>
          <button class="btn btn-sm btn-ghost" id="attCamStop" type="button">Apagar la cámara</button>
        </div>
      </div>`;

    const video = elCam.querySelector('#attVideo');
    const canvas = elCam.querySelector('#attCanvas');
    const veil = elCam.querySelector('#attVeil');
    const msg = elCam.querySelector('#attCamMsg');
    elCam.querySelector('#attCamStop').addEventListener('click', cerrarCamara);

    const decir = t => { msg.textContent = t; };
    const esperando = t => {
      const rotulo = veil.querySelector('.rr-wait-text');
      if (rotulo) rotulo.textContent = t;
    };

    try {
      await rrPrepararCaras(esperando);
      esperando('Pidiendo la cámara');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      veil.remove();

      camara = { stream, video, canvas, timer: null };
      marcadosPorCamara = new Set();

      // Las huellas guardadas, en el formato que compara face-api.
      const fichero = gente.map(s => new faceapi.LabeledFaceDescriptors(
        String(s.id), [new Float32Array(s.faceDescriptor)]
      ));
      const juez = new faceapi.FaceMatcher(fichero, RR_FACE_UMBRAL);

      decir(`Buscando entre ${gente.length} ${gente.length === 1 ? 'cara guardada' : 'caras guardadas'}. Que se pongan de frente, de uno en uno o en grupo.`);

      // Cada 900 ms, no en cada fotograma: reconocer es caro y a treinta veces
      // por segundo la pantalla se arrastra sin reconocer a nadie mejor.
      camara.timer = setInterval(() => mirar(juez, decir), 900);
      mirar(juez, decir);
      return true;
    } catch (err) {
      const suyo = err && err.name === 'NotAllowedError'
        ? 'No diste permiso para la cámara. Se pide en el candado de la barra de direcciones.'
        : err && err.name === 'NotFoundError'
          ? 'No encontré ninguna cámara conectada.'
          : err.message;
      elCam.innerHTML = `<div class="card">${rrEmptyState({
        pose: 'sad', title: 'No pude encender la cámara', text: rrEscapeHtml(suyo)
      })}</div>`;
      camara = null;
      return false;
    }
  }

  let mirando = false;

  async function mirar(juez, decir) {
    if (!camara || mirando) return;
    mirando = true;
    try {
      const caras = await faceapi
        .detectAllFaces(camara.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: .45 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      const ctx = camara.canvas.getContext('2d');
      ctx.clearRect(0, 0, camara.canvas.width, camara.canvas.height);
      if (!caras.length) { decir('No veo a nadie. Acércate a la cámara.'); return; }

      const escalaX = camara.canvas.width / (camara.video.videoWidth || camara.canvas.width);
      const escalaY = camara.canvas.height / (camara.video.videoHeight || camara.canvas.height);

      caras.forEach(cara => {
        const veredicto = juez.findBestMatch(cara.descriptor);
        const id = veredicto.label === 'unknown' ? null : Number(veredicto.label);
        const s = id ? lista.find(x => x.id === id) : null;
        const caja = cara.detection.box;

        // El recuadro alrededor de la cara: verde si es alguien de la lista,
        // gris si no se sabe quién es. El nombre va dentro del recuadro, en la
        // propia cara: buscarlo en una lista aparte mientras hay gente delante
        // no lo hace nadie.
        ctx.lineWidth = 3;
        ctx.strokeStyle = s ? '#2E8B57' : 'rgba(255,255,255,.55)';
        ctx.strokeRect(caja.x * escalaX, caja.y * escalaY, caja.width * escalaX, caja.height * escalaY);

        const etiqueta = s ? s.fullName.split(' ')[0] : 'no está en la lista';
        ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
        const ancho = ctx.measureText(etiqueta).width + 16;
        const y = Math.max(0, caja.y * escalaY - 28);
        ctx.fillStyle = s ? '#2E8B57' : 'rgba(20,16,14,.72)';
        ctx.fillRect(caja.x * escalaX, y, ancho, 26);
        ctx.fillStyle = '#fff';
        // El texto se desespeja: el canvas entero va en espejo para que el
        // vídeo se vea como un espejo, y sin esto el nombre saldría al revés.
        ctx.save();
        ctx.translate(caja.x * escalaX + ancho, y);
        ctx.scale(-1, 1);
        ctx.fillText(etiqueta, 8, 19);
        ctx.restore();

        if (s && !marcadosPorCamara.has(s.id)) {
          marcadosPorCamara.add(s.id);
          // Después de la hora de entrada, quien llega se marca tarde. La
          // cámara no decide quién es puntual: eso lo decide el reloj.
          marcar(s.id, horaDeEntradaPasada() ? 'late' : 'present', 'face');
          celebrar(s);
          decir(`${s.fullName} marcado. Que pase el siguiente.`);
        }
      });
    } catch (err) {
      decir(`Se me trabó el reconocimiento: ${err.message}`);
    } finally {
      mirando = false;
    }
  }

  // Un pase de lista que empieza después de esta hora ya es "tarde". No se
  // pregunta: es la hora normal de entrada y se puede corregir a mano en la
  // fila de cualquiera.
  function horaDeEntradaPasada() {
    const ahora = new Date();
    return ahora.getHours() > 8 || (ahora.getHours() === 8 && ahora.getMinutes() > 15);
  }

  function celebrar(s) {
    const caja = elCam.querySelector('.rr-cam-stage');
    if (!caja) return;
    const viejo = caja.querySelector('.rr-cam-hit');
    if (viejo) viejo.remove();

    const hit = document.createElement('div');
    hit.className = 'rr-cam-hit';
    hit.innerHTML = `
      ${s.facePhoto
        ? `<img src="${rrEscapeHtml(s.facePhoto)}" alt="" />`
        : '<span class="rr-avatar rr-avatar-placeholder">🎓</span>'}
      <div>
        <strong>${rrEscapeHtml(s.fullName)}</strong>
        <small>✓ Asistencia marcada</small>
      </div>`;
    caja.appendChild(hit);
    setTimeout(() => hit.remove(), 2600);

    const fila = elBody.querySelector(`[data-row="${s.id}"]`);
    if (fila) {
      fila.classList.add('flash');
      fila.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function cerrarCamara() {
    const interruptor = container.querySelector('#attCamOn');
    if (interruptor) interruptor.checked = false;
    if (!camara) { elCam.innerHTML = ''; return; }
    clearInterval(camara.timer);
    camara.stream.getTracks().forEach(t => t.stop());
    camara = null;
    elCam.innerHTML = '';
  }

  // ---- Los botones de arriba y de abajo -------------------------------------

  // El interruptor de la cámara. Encenderlo la abre; apagarlo la cierra. Si
  // no se puede abrir (nadie tiene foto todavía, o no hay permiso), vuelve
  // solo a su sitio: un interruptor encendido con la cámara apagada sería
  // mentira.
  const camOn = container.querySelector('#attCamOn');
  camOn.addEventListener('change', async () => {
    if (!camOn.checked) return cerrarCamara();
    const abierta = await abrirCamara();
    if (!abierta) camOn.checked = false;
  });

  container.querySelector('#attReload').addEventListener('click', () => cargar());

  rrConfirmButton(container.querySelector('#attClose'), 'Pulsa otra vez para cerrar el pase', async () => {
    try {
      const { marked } = await rrApi('/api/attendance/close', {
        method: 'POST', body: { date: fecha, classId: claseId || null }
      });
      rrToast(marked ? `${marked} marcados como ausentes.` : 'No quedaba nadie sin marcar.', 'success');
      cargar({ silencioso: true });
    } catch (err) {
      rrToast(err.message, 'error');
    }
  });

  selClass.addEventListener('change', () => { claseId = selClass.value; cargar(); });
  selLevel.addEventListener('change', () => { nivel = selLevel.value; cargar(); });
  inpDate.addEventListener('change', () => {
    fecha = inpDate.value || rrTodayISO();
    // Cambiar de día con la cámara encendida marcaría al día equivocado.
    if (camara) cerrarCamara();
    cargar();
  });

  cargar();

  return {
    reload: () => cargar({ silencioso: true }),
    cerrarCamara
  };
}
