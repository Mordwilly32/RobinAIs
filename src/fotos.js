// src/fotos.js
// Las fotos de perfil, que ahora sí viven en el servidor.
// ---------------------------------------------------------------------------
// Antes se quedaban en el navegador de quien las ponía. Eso tenía una virtud
// —una cara no salía de su aparato— y un costo que al final pesó más: solo tú
// veías tu foto, y solo en ese navegador. En la lista del profesor y en la de
// la dirección todo el mundo salía con el muñequito gris, y cambiar de
// computadora o limpiar el navegador era perderla sin que nada avisara.
//
// Lo que NO cambia: las caras del pase de lista (facePhoto, faceDescriptor)
// siguen sin salir del aparato. Son datos biométricos de menores y esa
// decisión se mantiene tal cual. Ver public/js/face-vault.js y la cabecera de
// src/store.js.
//
// Por qué Storage y no una columna de Postgres
//
// La base entera se carga en memoria al arrancar y se compara campo por campo
// en cada guardado. Una foto en base64 dentro de la ficha significa cargar
// todas las fotos de todo el mundo en RAM para siempre, y volver a serializar
// cientos de kilobytes cada vez que alguien cambia su nombre. Por eso la
// imagen va a Supabase Storage —archivos, que es lo que es— y en la ficha
// queda solo 'profilePicUrl': una línea de texto.
// ---------------------------------------------------------------------------

const store = require('./store');

const BUCKET = 'fotos-perfil';

// El navegador ya no deja pasar de 1 MB (ver photoData() en los paneles).
// Esto es el mismo techo del lado de acá, porque un límite que solo vive en el
// navegador no es un límite.
const MAX_BYTES = 1024 * 1024;

// Solo imágenes, y solo estas. La extensión sale del tipo declarado y no del
// nombre del archivo: el nombre lo escribe quien sube.
const TIPOS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

// Abre una data URL ("data:image/png;base64,iVBOR...") y dice qué trae.
// Devuelve null si no es una imagen de las que aceptamos, si viene rota, o si
// pesa de más — en los tres casos quien llama decide qué contarle a la gente.
//
// Cuenta los bytes sin llegar a materializarlos, y no es por elegancia: este
// archivo también se empaqueta para la versión de GitHub Pages, donde corre
// dentro del navegador y ahí no existe Buffer (ver tools/build-pages.js y
// web/js/rr-runtime.js). El Buffer se crea más abajo, en la rama de Supabase,
// que en el navegador no se pisa nunca.
function abrirDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;

  const corte = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl.trim());
  if (!corte) return null;

  const mime = corte[1].toLowerCase();
  const ext = TIPOS[mime];
  if (!ext) return null;

  const base64 = corte[2];
  if (!base64) return null;

  // Cada 4 caracteres de base64 son 3 bytes, menos el relleno del final.
  const relleno = (base64.match(/=+$/) || [''])[0].length;
  const bytes = Math.floor(base64.length * 3 / 4) - relleno;
  if (bytes <= 0 || bytes > MAX_BYTES) return null;

  return { base64, bytes, mime, ext };
}

// El bucket se crea solo, la primera vez que hace falta.
//
// Podría pedirse a mano en el panel de Supabase, pero entonces un despliegue
// nuevo contra un proyecto nuevo arrancaría a medias y el fallo aparecería
// recién cuando alguien intentara poner su foto. Se intenta una vez por
// proceso y el resultado se recuerda, así que no es un viaje extra por foto.
let bucketListo = null;

async function asegurarBucket(sb) {
  if (bucketListo) return bucketListo;

  bucketListo = (async () => {
    const { error } = await sb.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: Object.keys(TIPOS)
    });

    // "ya existe" es el caso normal a partir del segundo arranque, y no es un
    // error. Cualquier otro sí lo es, y se vuelve a intentar en la siguiente
    // foto en lugar de quedar marcado como imposible para siempre.
    if (error && !/exist/i.test(error.message || '')) {
      bucketListo = null;
      throw new Error('No se pudo preparar el almacén de fotos: ' + error.message);
    }
    return true;
  })();

  return bucketListo;
}

// Un nombre fijo por persona, y no uno nuevo cada vez: si cada foto estrenara
// nombre, las viejas se quedarían ocupando espacio para siempre sin que nadie
// las mire. Al reemplazarla, el archivo se pisa.
function rutaDe(userId, ext) {
  return `usuario-${userId}.${ext}`;
}

// Guarda la foto y devuelve la dirección donde quedó.
//
//   undefined -> no la tocaste; se queda la que había
//   null o '' -> quítala
//   data URL  -> esta es la nueva
//
// Sin Supabase configurado (el modo de data/db.json, para trabajar aquí) no
// hay Storage donde poner nada: la data URL se guarda tal cual en la ficha.
// En un archivo local eso no le hace daño a nadie.
async function guardarFoto(userId, dataUrl) {
  if (dataUrl === undefined) return undefined;

  if (!dataUrl) {
    await borrarFoto(userId);
    return null;
  }

  const foto = abrirDataUrl(dataUrl);
  if (!foto) {
    throw new Error('La foto tiene que ser una imagen (PNG, JPG, WEBP o GIF) de menos de 1 MB.');
  }

  if (!store.USA_SUPABASE) return dataUrl;

  const sb = store.clienteSupabase();
  await asegurarBucket(sb);

  const ruta = rutaDe(userId, foto.ext);
  const { error } = await sb.storage.from(BUCKET).upload(ruta, Buffer.from(foto.base64, 'base64'), {
    contentType: foto.mime,
    upsert: true
  });
  if (error) throw new Error('No se pudo guardar la foto: ' + error.message);

  // Si antes tenía la foto en otro formato, ese archivo quedaría huérfano:
  // el nombre lleva la extensión, así que usuario-7.png y usuario-7.jpg son
  // dos archivos distintos. Se limpian los demás.
  const sobras = Object.values(TIPOS)
    .filter(e => e !== foto.ext)
    .map(e => rutaDe(userId, e));
  await sb.storage.from(BUCKET).remove(sobras).catch(() => { /* no había */ });

  const { data } = sb.storage.from(BUCKET).getPublicUrl(ruta);

  // El ?v= es para el caché del navegador. El archivo se llama siempre igual,
  // así que sin esto quien cambia su foto sigue viendo la anterior hasta que
  // se le ocurra recargar sin caché, y jura que no se guardó.
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function borrarFoto(userId) {
  if (!store.USA_SUPABASE) return;

  const sb = store.clienteSupabase();
  const todas = Object.values(TIPOS).map(e => rutaDe(userId, e));
  await sb.storage.from(BUCKET).remove(todas).catch(() => { /* no había */ });
}

module.exports = { BUCKET, MAX_BYTES, TIPOS, abrirDataUrl, guardarFoto, borrarFoto };
