// src/mailer.js
// ---------------------------------------------------------------------------
// Mandar correo.
//
// Solo hay un correo que mandar —el código para activar una cuenta— y por eso
// este archivo es corto. Si algún día hay más, cada uno es otra función aquí y
// el transporte se queda como está.
//
// Los transportes
//
//   consola   Se imprime el código en la terminal y no sale nada a la red. Es
//             lo que pasa si no hay nada configurado, y es lo que quieres
//             mientras trabajas en esta computadora: se registra, se mira la
//             terminal, se copia el código.
//
//   resend    Se manda de verdad, con la API de Resend. Hace falta
//             RESEND_API_KEY y MAIL_DESDE.
//
// Por qué Resend y no Cloudflare
//   El dominio ya tiene los MX de Cloudflare Email Routing, y eso hace que
//   roborobin.site pueda RECIBIR correo y reenviarlo a otra dirección. No
//   sirve para mandar: Email Routing no tiene salida. Para mandar hace falta
//   alguien que lo haga, y Resend es gratis hasta 3.000 al mes y se usa con
//   una petición HTTPS, sin añadir ninguna dependencia al proyecto.
//
//   Se cambia de proveedor escribiendo otra función como enviarConResend() y
//   otra rama en elegirTransporte(). Lo que no cambia es lo de abajo.
// ---------------------------------------------------------------------------

const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();

// De quién viene el correo. Tiene que ser una dirección de un dominio que el
// proveedor tenga verificado, o rebota.
const MAIL_DESDE = (process.env.MAIL_DESDE || 'roboRobin <robin@roborobin.site>').trim();

// A dónde contesta quien le dé a "responder". Suele ser una dirección de
// verdad, de las que sí lee alguien — ahí es donde Cloudflare Email Routing
// hace su trabajo.
const MAIL_RESPONDER_A = (process.env.MAIL_RESPONDER_A || '').trim();

function elegirTransporte() {
  if (RESEND_API_KEY) return 'resend';
  return 'consola';
}

const TRANSPORTE = elegirTransporte();

// ---------------------------------------------------------------------------
// Los transportes
// ---------------------------------------------------------------------------

async function enviarConResend({ para, asunto, texto, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: MAIL_DESDE,
      to: [para],
      subject: asunto,
      text: texto,
      html,
      ...(MAIL_RESPONDER_A ? { reply_to: MAIL_RESPONDER_A } : {})
    })
  });

  if (!res.ok) {
    // El cuerpo del error de Resend dice cosas útiles —dominio sin verificar,
    // dirección mal escrita— y perderlo obliga a adivinar.
    let detalle = '';
    try {
      const cuerpo = await res.json();
      detalle = cuerpo && (cuerpo.message || cuerpo.error || JSON.stringify(cuerpo));
    } catch { detalle = 'sin detalle'; }
    throw new Error(`Resend contestó ${res.status}: ${detalle}`);
  }

  return res.json();
}

function enviarPorConsola({ para, asunto, texto }) {
  console.log('');
  console.log('┌─ correo que NO se mandó (no hay proveedor configurado) ─────');
  console.log('│ Para:   ' + para);
  console.log('│ Asunto: ' + asunto);
  texto.split('\n').forEach(l => console.log('│ ' + l));
  console.log('└────────────────────────────────────────────────────────────');
  console.log('');
  return Promise.resolve({ id: 'consola' });
}

function enviar(mensaje) {
  if (TRANSPORTE === 'resend') return enviarConResend(mensaje);
  return enviarPorConsola(mensaje);
}

// ---------------------------------------------------------------------------
// El correo del código
// ---------------------------------------------------------------------------

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sin imágenes ni tipografías traídas de fuera: muchos clientes de correo las
// bloquean, y un código que no se lee porque no cargó una imagen es un código
// inútil. Solo texto, con el número grande y aparte.
function plantillaCodigo({ nombre, codigo, minutos }) {
  const saludo = nombre ? `Hola, ${nombre}:` : 'Hola:';

  const texto = [
    saludo,
    '',
    'Tu código para activar la cuenta de roboRobin es:',
    '',
    '    ' + codigo,
    '',
    `Vence en ${minutos} minutos.`,
    '',
    'Si no fuiste tú quien creó esta cuenta, no hagas nada: sin el código',
    'no se activa, y a las 24 horas se borra sola.',
    '',
    '— roboRobin'
  ].join('\n');

  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#1a1a1a;max-width:480px">
  <p>${escapar(saludo)}</p>
  <p>Tu código para activar la cuenta de roboRobin es:</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:.22em;margin:24px 0;padding:18px 0;text-align:center;background:#f6f6f7;border-radius:10px">${escapar(codigo)}</p>
  <p>Vence en ${minutos} minutos.</p>
  <p style="color:#666;font-size:14px">Si no fuiste tú quien creó esta cuenta, no hagas nada: sin el código no se activa, y a las 24 horas se borra sola.</p>
  <p style="color:#666;font-size:14px">— roboRobin</p>
</div>`.trim();

  return { texto, html };
}

async function enviarCodigo({ para, nombre, codigo, minutos }) {
  const { texto, html } = plantillaCodigo({ nombre, codigo, minutos });
  return enviar({
    para,
    asunto: `${codigo} es tu código de roboRobin`,
    texto,
    html
  });
}

module.exports = {
  TRANSPORTE,
  MAIL_DESDE,
  enviarCodigo,
  // Para la pantalla de salud y los mensajes de arranque.
  mandaDeVerdad: TRANSPORTE !== 'consola'
};
