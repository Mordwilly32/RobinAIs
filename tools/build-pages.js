// tools/build-pages.js
// ---------------------------------------------------------------------------
// Arma la versión para GitHub Pages en gh-pages/.
//
// Qué hace, en orden:
//   1. Copia public/ y loading/ tal cual.
//   2. Empaqueta src/ y routes/ —el backend entero— en js/rr-modules.js para
//      que corran dentro del navegador con los remedos de rr-runtime.js.
//   3. Arregla las rutas absolutas (/css/…, /images/…): en GitHub Pages el
//      sitio no cuelga de la raíz del dominio sino de /RobinAI/.
//   4. Prepara los scripts de public/js para poder volver a entrar a una
//      pantalla sin recargar el documento (ver web/js/rr-shell.js).
//   5. Mete el runtime en todas las páginas.
//
// No hay paso de minificado ni de bundling: lo que se sube es legible, que es
// media razón de que este proyecto exista.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'gh-pages');

// Los scripts de public/js que son el guion de UNA pantalla: no le exportan
// nada a nadie y se pueden volver a ejecutar enteros al regresar a ellos.
// Todo lo demás es biblioteca y corre una sola vez.
const PANTALLAS = [
  'admin.js', 'landing.js', 'login.js', 'parent.js', 'peques.js',
  'personal.js', 'register.js', 'student.js', 'teacher.js'
];

// Los prefijos de ruta absoluta que hay que volver relativos. /api queda
// fuera a propósito: esas no son rutas de archivo, son las llamadas que
// atiende el servidor de mentira dentro del navegador.
const PREFIJOS = [
  'images/', 'css/', 'js/', 'loading/',
  'index\\.html', 'login\\.html', 'register\\.html', 'terminos\\.html',
  'guia\\.html', '404\\.html', 'dashboard-', 'herramientas/'
];
const RE_PREFIJOS = PREFIJOS.join('|');

// ---------------------------------------------------------------------------

function limpiar(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copiar(desde, hasta) {
  fs.mkdirSync(hasta, { recursive: true });
  for (const entrada of fs.readdirSync(desde, { withFileTypes: true })) {
    const a = path.join(desde, entrada.name);
    const b = path.join(hasta, entrada.name);
    if (entrada.isDirectory()) copiar(a, b);
    else fs.copyFileSync(a, b);
  }
}

function archivosPorExtension(dir, ext, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) archivosPorExtension(p, ext, acc);
    else if (p.toLowerCase().endsWith(ext)) acc.push(p);
  }
  return acc;
}

const leer = p => fs.readFileSync(p, 'utf-8');
const escribir = (p, t) => fs.writeFileSync(p, t, 'utf-8');

// ---------------------------------------------------------------------------
// 2. El backend, empaquetado para el navegador
// ---------------------------------------------------------------------------

function empaquetarBackend() {
  const piezas = [];
  const archivos = [];

  for (const carpeta of ['src', 'routes']) {
    for (const nombre of fs.readdirSync(path.join(RAIZ, carpeta)).sort()) {
      if (!nombre.endsWith('.js')) continue;
      archivos.push(carpeta + '/' + nombre.replace(/\.js$/, ''));
    }
  }

  for (const id of archivos) {
    let codigo = leer(path.join(RAIZ, id + '.js'));

    // La API de Anthropic sí deja llamarla desde el navegador, pero hay que
    // pedírselo de frente con esta cabecera. Sin ella el navegador bloquea la
    // respuesta por CORS y Robin se queda mudo sin decir por qué.
    codigo = codigo.replace(
      /(['"])anthropic-version\1\s*:\s*(['"])2023-06-01\2/g,
      `$1anthropic-version$1: $22023-06-01$2,\n        $1anthropic-dangerous-direct-browser-access$1: $2true$2`
    );

    piezas.push(
      `RRModulos.define(${JSON.stringify(id)}, function (require, module, exports, __dirname, __filename) {\n` +
      codigo +
      `\n});\n`
    );
  }

  return (
    '// js/rr-modules.js — GENERADO por tools/build-pages.js, no se edita a mano.\n' +
    '// Es el backend de roboRobin (src/ y routes/) tal cual, envuelto para que\n' +
    '// corra dentro del navegador. Ver web/js/rr-runtime.js.\n\n' +
    piezas.join('\n')
  );
}

// ---------------------------------------------------------------------------
// 3 y 4. Los scripts de la interfaz
// ---------------------------------------------------------------------------

function arreglarRutasJS(codigo) {
  return codigo.replace(
    new RegExp('([\'"`])/(' + RE_PREFIJOS + ')', 'g'),
    '$1$2'
  );
}

function prepararScript(nombre, codigo) {
  codigo = arreglarRutasJS(codigo);

  // Navegar sin recargar. Una recarga de verdad borraría la sesión, que aquí
  // vive en memoria y en ningún otro lado.
  codigo = codigo.replace(/window\.location\.replace\(/g, 'rrIr(');
  codigo = codigo.replace(/window\.location\.href\s*=\s*([^;]+);/g, 'rrIr($1);');

  // Lo que antes corría al cargar el documento ahora corre también cada vez
  // que se entra a una pantalla que use este script.
  codigo = codigo.replace(/document\.addEventListener\(\s*(['"])DOMContentLoaded\1\s*,\s*/g, 'rrAlEntrar(');

  if (nombre === 'consola.js') {
    // La ventana de la consola cuelga de <body>, y al cambiar de pantalla el
    // shell reemplaza el cuerpo entero: la referencia se queda apuntando a un
    // nodo que ya no está en el documento. Sin esto, el atajo parecería
    // muerto después de la primera navegación.
    codigo = codigo.replace(
      'function alternar() {\n    if (caja) return cerrar();',
      'function alternar() {\n    if (caja && !caja.isConnected) caja = null;\n    if (caja) return cerrar();'
    );
  }

  const clave = "new URL(document.currentScript.src).pathname";

  if (PANTALLAS.includes(nombre)) {
    return (
      `// Envuelto por tools/build-pages.js: esta pantalla se vuelve a ejecutar\n` +
      `// entera cada vez que se regresa a ella, sin recargar el documento.\n` +
      `RRPagina.pantalla(${clave}, function () {\n` +
      codigo +
      `\n});\n`
    );
  }

  return (
    `// Marcado por tools/build-pages.js: biblioteca. Corre una sola vez; lo\n` +
    `// que se repite en cada pantalla es lo que registró con rrAlEntrar().\n` +
    `RRPagina.inicio(${clave});\n` +
    codigo +
    `\nRRPagina.fin();\n`
  );
}

// ---------------------------------------------------------------------------
// 5. Las páginas
// ---------------------------------------------------------------------------

const RUNTIME = [
  'js/rr-shell.js',    // primero: define RRPagina y rrAlEntrar
  'js/rr-runtime.js',  // los remedos de Node y de Express
  'js/rr-modules.js',  // el backend
  'js/rr-server.js'    // lo enciende y desvía fetch('/api/…')
];

// Páginas que no traían api.js ni loading.js porque en la versión con
// servidor no les hacía falta. Aquí sí: la portada lee /api/plans y /api/me,
// y la consola de demostración vive en todas.
const SIEMPRE = ['js/api.js', 'js/loading.js'];

function prepararPagina(html) {
  html = html.replace(/(href|src)="\/"/g, '$1="index.html"');
  html = html.replace(
    new RegExp('(href|src)="/(' + RE_PREFIJOS + ')', 'g'),
    '$1="$2'
  );

  // guia.js nunca existió en public/js; la referencia venía rota de antes y
  // en un sitio estático se ve como un 404 en la consola.
  html = html.replace(/\s*<script src="js\/guia\.js"><\/script>/g, '');

  const yaTiene = src => html.includes(`src="${src}"`);

  const aMeter = RUNTIME.concat(SIEMPRE.filter(s => !yaTiene(s)));
  const bloque = aMeter.map(s => `<script src="${s}"></script>`).join('\n');

  // Todo el runtime va delante del primer script de la página.
  const primero = html.search(/<script src="js\//);
  if (primero === -1) {
    html = html.replace('</body>', bloque + '\n</body>');
  } else {
    html = html.slice(0, primero) + bloque + '\n' + html.slice(primero);
  }

  return html;
}

// ---------------------------------------------------------------------------

function main() {
  limpiar(SALIDA);

  copiar(path.join(RAIZ, 'public'), SALIDA);
  copiar(path.join(RAIZ, 'loading'), path.join(SALIDA, 'loading'));

  // El runtime escrito a mano.
  for (const nombre of ['rr-runtime.js', 'rr-server.js', 'rr-shell.js']) {
    fs.copyFileSync(path.join(RAIZ, 'web', 'js', nombre), path.join(SALIDA, 'js', nombre));
  }

  escribir(path.join(SALIDA, 'js', 'rr-modules.js'), empaquetarBackend());

  // Los scripts de la interfaz.
  for (const nombre of fs.readdirSync(path.join(SALIDA, 'js'))) {
    if (!nombre.endsWith('.js') || nombre.startsWith('rr-')) continue;
    const p = path.join(SALIDA, 'js', nombre);
    escribir(p, prepararScript(nombre, leer(p)));
  }

  // Las rutas absolutas también aparecen dentro del runtime escrito a mano.
  for (const nombre of ['rr-shell.js', 'rr-server.js', 'rr-runtime.js']) {
    const p = path.join(SALIDA, 'js', nombre);
    escribir(p, arreglarRutasJS(leer(p)));
  }

  // Las páginas.
  for (const p of archivosPorExtension(SALIDA, '.html')) {
    if (p.includes(path.sep + 'herramientas' + path.sep)) continue; // sueltas, sin runtime
    if (p.includes(path.sep + 'loading' + path.sep)) continue;      // la animación, sola
    escribir(p, prepararPagina(leer(p)));
  }

  // Jekyll, que es lo que sirve GitHub Pages por defecto, se come las
  // carpetas que empiezan por guion bajo y se entromete donde no debe.
  escribir(path.join(SALIDA, '.nojekyll'), '');

  console.log('gh-pages/ listo.');
}

main();
