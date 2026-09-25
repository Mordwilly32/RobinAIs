// public/js/chat-tools.js
// Los modos del chat.
//
// Robin contesta igual que siempre, pero ahora el chat tiene un selector al
// lado de la caja de escribir —como el que elige con qué modelo hablar— con
// tres posiciones:
//
//   Robin        la conversación de siempre
//   Traducir     sueltas un PDF (o pegas el texto) y baja traducido
//   Actividad    del mismo PDF sale una actividad con sus preguntas
//
// Son solo dos herramientas y no cinco a propósito: son las dos que existían
// como páginas sueltas en /herramientas y que la gente sí usaba. Generar
// imágenes y demás no está porque no había nada de eso que traer.
//
// El PDF entra y sale sin pasar por el servidor:
//
//   entra   pdf.js saca el texto aquí, en el navegador. Al servidor sube
//           texto plano, nunca el archivo.
//   sale    jsPDF arma el PDF aquí mismo con lo que contestó Robin. Si lo que
//           entró era un PDF, lo que sale es un PDF — que es justo lo que
//           hace falta para imprimirlo y repartirlo.
//
// Las dos librerías se descargan la primera vez que se usan, no al abrir el
// panel: quien nunca traduce nada no paga por ellas.

const RR_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const RR_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const RR_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

const RR_TOOLS = {
  chat: {
    id: 'chat', label: 'Robin', ic: '✨',
    placeholder: 'Escribe aquí…  (Enter para enviar)',
    note: 'La conversación de siempre.'
  },
  translate: {
    id: 'translate', label: 'Traducir', ic: '🌐',
    placeholder: 'Suelta un PDF aquí, o pega el texto que quieres traducir…',
    note: 'Sueltas un PDF y baja traducido, en PDF.'
  },
  activity: {
    id: 'activity', label: 'Actividad', ic: '📝',
    placeholder: 'Suelta el PDF del tema, o pega el texto del que sacar las preguntas…',
    note: 'Del texto salen las preguntas, con su hoja de respuestas.'
  }
};

function rrCargarLib(src, yaEsta) {
  if (yaEsta()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('No pude descargar lo que hace falta para trabajar con PDF. ¿Hay internet?'));
    document.head.appendChild(el);
  });
}

// ---- Leer un PDF -----------------------------------------------------------

async function rrTextoDePDF(file, avisar) {
  await rrCargarLib(RR_PDFJS, () => typeof pdfjsLib !== 'undefined');
  pdfjsLib.GlobalWorkerOptions.workerSrc = RR_PDFJS_WORKER;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];

  for (let i = 1; i <= doc.numPages; i++) {
    if (avisar) avisar(`Leyendo la página ${i} de ${doc.numPages}`);
    const pagina = await doc.getPage(i);
    const contenido = await pagina.getTextContent();

    // pdf.js devuelve trocitos sueltos con su posición. Se vuelven a juntar en
    // renglones mirando la altura: sin esto, un texto a dos columnas sale
    // mezclado palabra por palabra y no hay traducción que lo salve.
    let renglon = '';
    let alturaAnterior = null;
    const lineas = [];

    contenido.items.forEach(item => {
      const altura = Math.round(item.transform[5]);
      if (alturaAnterior !== null && Math.abs(altura - alturaAnterior) > 3) {
        if (renglon.trim()) lineas.push(renglon.trim());
        renglon = '';
      }
      renglon += item.str + (item.hasEOL ? '\n' : ' ');
      alturaAnterior = altura;
    });
    if (renglon.trim()) lineas.push(renglon.trim());

    paginas.push(lineas.join('\n'));
  }

  return paginas.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- Escribir un PDF -------------------------------------------------------

async function rrPDFDeTexto(texto, { titulo = 'roboRobin', nombre = 'documento.pdf' } = {}) {
  await rrCargarLib(RR_JSPDF, () => typeof window.jspdf !== 'undefined');
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margen = 56;
  const ancho = doc.internal.pageSize.getWidth() - margen * 2;
  const alto = doc.internal.pageSize.getHeight();
  let y = margen;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(titulo, margen, y);
  y += 12;
  doc.setDrawColor(226, 58, 27);
  doc.setLineWidth(1.4);
  doc.line(margen, y, margen + ancho, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  texto.split('\n').forEach(parrafo => {
    if (!parrafo.trim()) { y += 8; return; }

    // Un renglón que va solo, en mayúsculas o empezando por #, se trata como
    // título: es lo que hace que una actividad generada se vea como una hoja
    // de trabajo y no como un muro de texto.
    const esTitulo = /^#{1,3}\s/.test(parrafo) || /^-{3,}/.test(parrafo);
    const limpio = parrafo.replace(/^#{1,3}\s*/, '').replace(/\*\*/g, '');

    doc.setFont('helvetica', esTitulo ? 'bold' : 'normal');
    doc.setFontSize(esTitulo ? 12.5 : 11);

    doc.splitTextToSize(limpio, ancho).forEach(linea => {
      if (y > alto - margen) { doc.addPage(); y = margen; }
      doc.text(linea, margen, y);
      y += esTitulo ? 17 : 15;
    });
    if (esTitulo) y += 4;
  });

  doc.save(nombre);
}

// ---------------------------------------------------------------------------

// Le pone el selector de modo a un chat ya montado. `chat` es lo que devuelve
// rrCreateChat: se usa su addBubble para que el resultado caiga en la misma
// conversación, con el mismo aspecto que todo lo demás.
function rrMountChatTools(chat, { form, input, body, user }) {
  let tool = 'chat';
  let archivo = null;     // { name, text, esPDF }

  // Quien no enseña recibe la actividad sin hoja de respuestas (lo decide el
  // servidor, ver promptActividad en routes/ai.js). Aquí solo se dice.
  const conClave = ['teacher', 'admin', 'subdirector', 'secretary'].includes(user && user.role);

  // A un estudiante no se le ofrece traducir: un documento traducido entero es
  // la tarea de inglés hecha, y Robin no da respuestas. El servidor lo niega
  // igual (ver /api/ai/tool en routes/ai.js) — esto solo evita enseñar un
  // botón que va a decir que no.
  const modos = Object.values(RR_TOOLS).filter(t =>
    !(t.id === 'translate' && user && user.role === 'student'));

  // Montar dos veces sobre el mismo compositor dejaría dos selectores, dos
  // campos de archivo y dos manejadores de envío — y el mensaje saldría por
  // duplicado. Se limpia lo que hubiera antes de poner el nuevo.
  const anterior = form.querySelector('.rr-composer-bar');
  if (anterior) anterior.remove();

  const barra = document.createElement('div');
  barra.className = 'rr-composer-bar';
  barra.innerHTML = `
    <div class="rr-tool-pick">
      <button type="button" class="rr-tool-pick-btn" id="rrToolBtn" aria-haspopup="true" aria-expanded="false">
        <span class="ic">✨</span><span class="lab">Robin</span><span class="caret">▾</span>
      </button>
      <div class="rr-tool-menu" id="rrToolMenu" hidden>
        ${modos.map(t => `
          <button type="button" class="rr-tool-opt ${t.id === 'chat' ? 'on' : ''}" data-tool="${t.id}">
            <span class="ic">${t.ic}</span>
            <span><strong>${t.label}</strong><small>${rrEscapeHtml(t.note)}</small></span>
          </button>`).join('')}
      </div>
    </div>
    <button type="button" class="rr-attach" id="rrAttach" hidden title="Adjuntar un PDF o un .txt">📎 Adjuntar</button>
    <span class="rr-file-chip" id="rrFileChip" hidden></span>
    <input type="file" id="rrToolFile" accept=".pdf,.txt,.md,text/plain,application/pdf" hidden />`;

  form.insertBefore(barra, form.firstChild);
  form.classList.add('has-tools');

  const btn = barra.querySelector('#rrToolBtn');
  const menu = barra.querySelector('#rrToolMenu');
  const attach = barra.querySelector('#rrAttach');
  const chip = barra.querySelector('#rrFileChip');
  const file = barra.querySelector('#rrToolFile');

  // ---- El selector ---------------------------------------------------------

  function abrirMenu(abierto) {
    menu.hidden = !abierto;
    btn.setAttribute('aria-expanded', String(abierto));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirMenu(menu.hidden);
  });
  document.addEventListener('click', () => abrirMenu(false));
  menu.addEventListener('click', e => e.stopPropagation());

  function setTool(id) {
    const t = RR_TOOLS[id] || RR_TOOLS.chat;
    tool = t.id;
    btn.querySelector('.ic').textContent = t.ic;
    btn.querySelector('.lab').textContent = t.label;
    btn.classList.toggle('working', t.id !== 'chat');
    input.placeholder = t.placeholder;
    attach.hidden = t.id === 'chat';
    if (t.id === 'chat') quitarArchivo();
    menu.querySelectorAll('[data-tool]').forEach(o => o.classList.toggle('on', o.dataset.tool === t.id));
    abrirMenu(false);
    form.dataset.tool = t.id;
  }

  menu.querySelectorAll('[data-tool]').forEach(opt => {
    opt.addEventListener('click', () => setTool(opt.dataset.tool));
  });

  // ---- El archivo ----------------------------------------------------------

  attach.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => { if (file.files[0]) tomarArchivo(file.files[0]); });

  // Soltarlo encima del chat también vale: es lo primero que intenta la gente.
  ['dragover', 'dragenter'].forEach(ev => {
    form.addEventListener(ev, e => { e.preventDefault(); form.classList.add('dropping'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    form.addEventListener(ev, () => form.classList.remove('dropping'));
  });
  form.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (tool === 'chat') setTool('translate');   // soltar un PDF ya dice a qué vienes
    tomarArchivo(f);
  });

  async function tomarArchivo(f) {
    const esPDF = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    if (!esPDF && !/\.(txt|md)$/i.test(f.name) && !f.type.startsWith('text/')) {
      return rrToast('Puedo con PDF y con archivos de texto. Una imagen o un .docx no.', 'error');
    }
    if (f.size > 40 * 1024 * 1024) {
      return rrToast('Ese archivo pesa demasiado. Menos de 40 MB.', 'error');
    }

    const espera = rrLoading('Abriendo el documento', { sub: 'El archivo se lee aquí, en tu navegador. No se sube a ningún lado.' });
    try {
      const texto = esPDF
        ? await rrTextoDePDF(f, t => espera.say(t))
        : await f.text();

      if (!texto.trim()) {
        throw new Error('Ese PDF no tiene texto que leer: parece ser una foto escaneada. Hace falta uno con letras de verdad.');
      }

      archivo = { name: f.name, text: texto, esPDF };
      chip.hidden = false;
      chip.innerHTML = `
        <span class="ic">${esPDF ? '📄' : '📃'}</span>
        <span class="nm">${rrEscapeHtml(f.name)}</span>
        <small>${Math.round(texto.length / 1000)} mil caracteres</small>
        <button type="button" data-x aria-label="Quitar el archivo">✕</button>`;
      chip.querySelector('[data-x]').addEventListener('click', quitarArchivo);
    } catch (err) {
      rrToast(err.message, 'error');
    } finally {
      espera.close();
    }
  }

  function quitarArchivo() {
    archivo = null;
    chip.hidden = true;
    chip.innerHTML = '';
    file.value = '';
  }

  // ---- Enviar --------------------------------------------------------------
  // Se engancha en la fase de captura y ANTES que el que trae rrCreateChat:
  // en modo herramienta esto no es una pregunta al chat, es otra petición, y
  // no debe salir también por el camino normal.

  form.addEventListener('submit', async (e) => {
    if (tool === 'chat') return;   // que siga su curso normal
    e.preventDefault();
    e.stopImmediatePropagation();

    const escrito = input.value.trim();
    const texto = archivo ? archivo.text : escrito;
    if (!texto) {
      return rrToast('Adjunta un PDF o pega el texto primero.', 'error');
    }

    const t = RR_TOOLS[tool];
    const nombre = archivo ? archivo.name : 'texto pegado';
    const devolverPDF = Boolean(archivo && archivo.esPDF);

    // Lo que se pidió queda escrito en la conversación, como cualquier otra
    // pregunta: si no, el resultado aparece de la nada sin nada delante.
    chat.addBubble(
      `${t.ic} ${t.label}: ${nombre}${escrito && archivo ? `\n\n${escrito}` : ''}`,
      'user'
    );
    input.value = '';
    if (input.tagName === 'TEXTAREA') input.style.height = 'auto';

    const espera = rrLoading(
      tool === 'translate' ? 'Traduciendo tu documento' : 'Armando la actividad',
      {
        sub: tool === 'translate'
          ? 'Los documentos largos van por trozos para que nada se quede a medias. Cada trozo gasta un mensaje de tu margen de hoy.'
          : 'Las preguntas salen del texto que mandaste, no de lo que Robin se imagine.'
      }
    );

    try {
      const data = await rrApi('/api/ai/tool', {
        method: 'POST',
        body: {
          tool,
          text: texto,
          fileName: archivo ? archivo.name : null,
          options: tool === 'translate'
            ? { to: 'es' }
            : { tipo: 'mixta', cantidad: 10, nivel: (user && user.level) || '' }
        }
      });

      if (data.usage && typeof rrUpdateUsage === 'function') rrUpdateUsage(data.usage);
      mostrarResultado(data, { t, nombre, devolverPDF });
      quitarArchivo();
    } catch (err) {
      const p = err.payload || {};
      if (p.partial) {
        // Se cayó a mitad de un documento largo: lo que salió no se tira.
        mostrarResultado({ result: p.partial, truncated: true, truncatedReason: err.message },
          { t, nombre, devolverPDF });
      } else if (p.needsKey) {
        chat.addBubble(`${err.message} ${p.hint}`, 'bot');
      } else {
        chat.addBubble(`No pude con eso: ${err.message}`, 'bot');
      }
    } finally {
      espera.close();
    }
  }, true);

  function mostrarResultado(data, { t, nombre, devolverPDF }) {
    const burbuja = chat.addBubble(data.result, 'bot');
    burbuja.classList.add('rr-bubble-doc');

    const pie = document.createElement('div');
    pie.className = 'rr-doc-actions';

    const salida = nombre.replace(/\.[^.]+$/, '') +
      (t.id === 'translate' ? ' (traducido).pdf' : ' (actividad).pdf');

    pie.innerHTML = `
      ${data.truncated ? `<p class="rr-doc-warn">⚠ ${rrEscapeHtml(data.truncatedReason || 'Salió incompleto.')}</p>` : ''}
      <div class="rr-doc-btns">
        <button type="button" class="btn btn-sm btn-primary" data-pdf>⬇ Descargar en PDF</button>
        <button type="button" class="btn btn-sm btn-soft" data-copy>Copiar el texto</button>
      </div>
      ${devolverPDF ? '' : '<small class="rr-doc-hint">Lo que mandaste no era un PDF, pero igual te lo puedo dar en PDF.</small>'}`;
    burbuja.appendChild(pie);

    pie.querySelector('[data-pdf]').addEventListener('click', async (ev) => {
      const boton = ev.currentTarget;
      boton.disabled = true;
      const antes = boton.textContent;
      boton.innerHTML = rrLoadingHtml('Armando el PDF', { size: 'inline' });
      try {
        await rrPDFDeTexto(data.result, {
          titulo: t.id === 'translate' ? `Traducción — ${nombre}` : `Actividad — ${nombre}`,
          nombre: salida
        });
      } catch (err) {
        rrToast(err.message, 'error');
      } finally {
        boton.disabled = false;
        boton.textContent = antes;
      }
    });

    pie.querySelector('[data-copy]').addEventListener('click', (ev) => {
      rrCopy(data.result, ev.currentTarget);
    });

    if (t.id === 'activity' && conClave) {
      const nota = document.createElement('small');
      nota.className = 'rr-doc-hint';
      nota.textContent = 'La hoja de respuestas va al final, después de la línea de guiones. Recórtala antes de repartir.';
      pie.appendChild(nota);
    }
  }

  setTool('chat');
  return { setTool, get tool() { return tool; } };
}
