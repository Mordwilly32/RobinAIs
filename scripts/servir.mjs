// scripts/servir.mjs
// Servidor estático para trabajar en local. No es el backend: roboRobin ya no
// tiene uno propio, los datos y las funciones viven en Supabase. Esto solo
// entrega los archivos de public/ para poder abrir el sitio en el navegador.
//
//   npm start    →  http://localhost:3000
//
// Al publicar (Netlify, Vercel, GitHub Pages, Supabase Storage…) este archivo
// no se usa: se sube la carpeta public/ tal cual.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const PUERTO = process.env.PORT || 3000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  // normalize() deja los ".." resueltos, así que este candado basta para que
  // nadie salga de public/ pidiendo /../../algo-privado.
  const relativa = normalize(ruta === '/' ? '/index.html' : ruta).replace(/^([/\\.]+)/, '');
  const archivo = join(RAIZ, relativa);

  if (!archivo.startsWith(RAIZ)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream' });
    res.end(contenido);
  } catch {
    // La dirección equivocada sigue visible en la barra del navegador, con su
    // 404 de verdad: nada de redirigir en silencio.
    try {
      res.writeHead(404, { 'Content-Type': TIPOS['.html'] });
      res.end(await readFile(join(RAIZ, '404.html')));
    } catch {
      res.writeHead(404).end('No encontrado');
    }
  }
});

server.listen(PUERTO, () => {
  console.log('==============================================');
  console.log('  roboRobin está corriendo');
  console.log(`  Abre: http://localhost:${PUERTO}`);
  console.log('  Los datos vienen de tu proyecto de Supabase.');
  console.log('==============================================');
});
