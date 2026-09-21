// Marcado por tools/build-pages.js: biblioteca. Corre una sola vez; lo
// que se repite en cada pantalla es lo que registró con rrAlEntrar().
RRPagina.inicio(new URL(document.currentScript.src).pathname);
// public/js/ai-settings.js
// ---------------------------------------------------------------------------
// La conexión con Claude, en la pantalla de configuración de cada cuenta.
//
// Aquí se pone la llave de la API, se elige el modelo y —lo que de verdad
// importa— se comprueba que la petición sale bien. Esa comprobación no se
// adivina mirando el formato de la llave: se manda una petición de verdad, la
// más pequeña posible, y se enseña qué contestó el servidor, cuánto tardó y
// con qué modelo.
//
// La llave NO baja nunca entera al navegador. El servidor manda solo los
// últimos caracteres, lo justo para reconocer cuál está puesta.
//
// Sin llave Robin no se rompe: contesta con su modo local, que no se conecta
// a ningún lado. La llave es lo que lo hace contestar con Claude.

function rrMountAiSettings(container) {
  if (!container) return null;
  let estado = null;

  container.innerHTML = rrLoadingHtml('Mirando cómo tienes conectado a Robin');

  function render() {
    const t = estado.lastTest;

    container.innerHTML = `
      <div class="rr-ai-head">
        <h3>Robin y la API de Claude</h3>
        <span class="rr-ai-dot ${claseEstado()}">${textoEstado()}</span>
      </div>
      <p class="text-muted rr-ai-lead">${leyenda()}</p>

      <div class="form-error" id="aiError"></div>

      <div class="field">
        <label for="aiKey">Llave de la API</label>
        <input type="password" id="aiKey" autocomplete="off" spellcheck="false"
               placeholder="${estado.hasKey ? rrEscapeHtml(estado.keyHint) : 'sk-ant-…'}" />
        <div class="hint">
          Se saca de console.anthropic.com. Se guarda en esta computadora, dentro de
          <code>data/db.json</code>, y no se le enseña a nadie más — ni siquiera a ti:
          a partir de ahora solo verás los últimos caracteres.
        </div>
      </div>

      <div class="field">
        <label for="aiModel">Modelo</label>
        <select id="aiModel">
          <option value="">El que decida roboRobin (${rrEscapeHtml(estado.effectiveModel)})</option>
          ${estado.models.map(m => `
            <option value="${rrEscapeHtml(m.id)}" ${m.id === estado.model ? 'selected' : ''}>
              ${rrEscapeHtml(m.name)}
            </option>`).join('')}
        </select>
        <div class="hint" id="aiModelNote">${rrEscapeHtml(notaModelo())}</div>
      </div>

      <div class="rr-ai-actions">
        <button class="btn btn-primary" id="aiSave">Guardar</button>
        <button class="btn btn-soft" id="aiTest" ${estado.connected ? '' : 'disabled'}>Probar la conexión</button>
        ${estado.hasKey ? '<button class="btn btn-ghost btn-sm" id="aiClear">Quitar mi llave</button>' : ''}
      </div>

      <div id="aiResult">${t ? resultadoHtml(t) : ''}</div>`;

    container.querySelector('#aiSave').addEventListener('click', guardar);
    container.querySelector('#aiTest').addEventListener('click', probar);
    const quitar = container.querySelector('#aiClear');
    if (quitar) quitar.addEventListener('click', () => guardar(true));

    container.querySelector('#aiModel').addEventListener('change', (e) => {
      const nota = container.querySelector('#aiModelNote');
      const m = estado.models.find(x => x.id === e.target.value);
      nota.textContent = m ? m.note : notaModelo();
    });
  }

  function notaModelo() {
    const m = estado.models.find(x => x.id === estado.model);
    if (m) return m.note;
    return 'Sin elegir, roboRobin usa el que corresponda a tu plan.';
  }

  function claseEstado() {
    if (!estado.connected) return 'off';
    if (estado.lastTest) return estado.lastTest.ok ? 'ok' : 'bad';
    return 'unknown';
  }

  function textoEstado() {
    if (!estado.connected) return 'Sin conectar';
    if (estado.lastTest) return estado.lastTest.ok ? 'Funciona' : 'Falla';
    return 'Sin probar';
  }

  function leyenda() {
    if (estado.source === 'propia') {
      return 'Robin contesta con Claude usando tu llave. Puedes cambiarla o quitarla cuando quieras.';
    }
    if (estado.source === 'proyecto') {
      return 'Robin ya está conectado con la llave del proyecto (config.json). Si pones la tuya aquí, se usará la tuya.';
    }
    return 'Todavía no hay ninguna llave, así que Robin contesta con su modo local: funciona sin internet, pero es mucho más limitado. Pon tu llave para que conteste con Claude.';
  }

  // Lo que contestó la última petición de verdad. Es la respuesta honesta a
  // «¿se envió bien?»: el código de estado, el tiempo y lo que dijo el modelo.
  function resultadoHtml(t) {
    const cuando = t.at ? rrFormatDate(t.at) : '';
    if (t.ok) {
      return `
        <div class="rr-ai-result ok">
          <strong>✅ La petición salió bien</strong>
          <ul>
            <li><span>Respuesta del servidor</span><em>HTTP ${t.status}</em></li>
            <li><span>Tardó</span><em>${t.ms} ms</em></li>
            <li><span>Modelo</span><em>${rrEscapeHtml(t.model || '')}</em></li>
            ${t.usage ? `<li><span>Tokens</span><em>${t.usage.input_tokens} de entrada · ${t.usage.output_tokens} de salida</em></li>` : ''}
            ${t.reply ? `<li><span>Contestó</span><em>«${rrEscapeHtml(t.reply)}»</em></li>` : ''}
          </ul>
          <small>Probado el ${rrEscapeHtml(cuando)}</small>
        </div>`;
    }
    return `
      <div class="rr-ai-result bad">
        <strong>❌ La petición no salió</strong>
        <p>${rrEscapeHtml(t.error || '')}</p>
        <ul>
          ${t.status ? `<li><span>Respuesta del servidor</span><em>HTTP ${t.status}</em></li>` : '<li><span>Respuesta del servidor</span><em>no hubo</em></li>'}
          <li><span>Tardó</span><em>${t.ms} ms</em></li>
          <li><span>Modelo</span><em>${rrEscapeHtml(t.model || '')}</em></li>
        </ul>
        <small>Probado el ${rrEscapeHtml(cuando)}</small>
      </div>`;
  }

  function error(mensaje) {
    const caja = container.querySelector('#aiError');
    if (!caja) return;
    caja.textContent = mensaje;
    caja.classList.toggle('visible', Boolean(mensaje));
  }

  async function guardar(borrar = false) {
    const campo = container.querySelector('#aiKey');
    const btn = container.querySelector(borrar === true ? '#aiClear' : '#aiSave');
    error('');

    const cuerpo = { model: container.querySelector('#aiModel').value };
    // Si el campo está vacío no se toca la llave que ya hubiera: vaciar la
    // casilla no puede significar «bórrala», o se perdería sin querer al
    // cambiar solo el modelo. Para borrarla está su propio botón.
    if (borrar === true) cuerpo.key = '';
    else if (campo.value.trim()) cuerpo.key = campo.value.trim();

    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = rrLoadingHtml('Guardando', { size: 'inline' });

    try {
      const data = await rrApi('/api/ai/settings', { method: 'PUT', body: cuerpo });
      rrToast(data.message, 'success');
      await cargar();
    } catch (err) {
      error(err.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function probar() {
    const btn = container.querySelector('#aiTest');
    const caja = container.querySelector('#aiResult');
    error('');
    btn.disabled = true;
    btn.innerHTML = rrLoadingHtml('Probando', { size: 'inline' });
    caja.innerHTML = rrLoadingHtml('Hablando con la API de Anthropic', {
      sub: 'Se le manda un mensaje de una línea para ver si tu clave contesta. Puede tardar unos segundos.'
    });

    try {
      const t = await rrApi('/api/ai/test', { method: 'POST' });
      estado.lastTest = t;
      caja.innerHTML = resultadoHtml(t);
      const chip = container.querySelector('.rr-ai-dot');
      chip.className = `rr-ai-dot ${claseEstado()}`;
      chip.textContent = textoEstado();
      rrToast(t.ok ? 'La conexión funciona.' : 'La conexión no funciona.', t.ok ? 'success' : 'error');
    } catch (err) {
      caja.innerHTML = '';
      error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Probar la conexión';
    }
  }

  async function cargar() {
    try {
      estado = await rrApi('/api/ai/settings');
      render();
    } catch (err) {
      container.innerHTML = `<div class="form-error visible">${rrEscapeHtml(err.message)}</div>`;
    }
  }

  cargar();
  return { reload: cargar };
}

RRPagina.fin();
