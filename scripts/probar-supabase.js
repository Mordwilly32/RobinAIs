// scripts/probar-supabase.js
// ---------------------------------------------------------------------------
// Antes de desplegar nada: ¿llega roboRobin a Supabase y están las tablas?
//
//   npm run supabase:probar
//
// Lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del entorno o de .env, y dice
// en español qué falta. No escribe nada.
// ---------------------------------------------------------------------------

try { require('dotenv').config(); } catch { /* opcional */ }

const store = require('../src/store');

async function main() {
  if (!store.USA_SUPABASE) {
    console.error('Faltan las variables. Necesito las dos:');
    console.error('  SUPABASE_URL=https://xxxxxxxx.supabase.co');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=...');
    console.error('');
    console.error('Ponlas en un archivo .env en la raíz (copia .env.example) o');
    console.error('en el panel del servidor donde lo despliegues.');
    process.exit(1);
  }

  console.log('Proyecto:', store.donde);
  console.log('');

  const sb = store.clienteSupabase();
  const tablas = [store.TABLA_META, ...Object.values(store.TABLAS)];
  const faltan = [];
  let filas = 0;

  for (const tabla of tablas) {
    const { count, error } = await sb.from(tabla).select('id', { count: 'exact', head: true });
    if (error) {
      // 42P01 es "esa tabla no existe". Cualquier otra cosa es un problema
      // distinto —llave equivocada, proyecto pausado— y hay que verlo entero.
      if (error.code === '42P01' || /does not exist|Could not find the table/i.test(error.message)) {
        faltan.push(tabla);
        console.log('  ✗', tabla.padEnd(20), 'no existe');
        continue;
      }
      console.error('');
      console.error('No se pudo hablar con Supabase:', error.message);
      console.error('');
      console.error('Suele ser una de tres: la SUPABASE_SERVICE_ROLE_KEY no es la');
      console.error('de este proyecto, la URL tiene una errata, o el proyecto está');
      console.error('en pausa (los gratuitos se duermen a los 7 días sin uso y hay');
      console.error('que despertarlos desde el panel).');
      process.exit(1);
    }
    filas += count || 0;
    console.log('  ✓', tabla.padEnd(20), String(count || 0).padStart(6), 'filas');
  }

  console.log('');
  if (faltan.length) {
    console.log('Faltan ' + faltan.length + ' tablas.');
    console.log('Abre el SQL Editor de Supabase y pega entero el archivo:');
    console.log('  supabase/migrations/20260921120000_esquema_roborobin.sql');
    process.exit(1);
  }

  console.log('Todo en su sitio. ' + filas + ' filas en total.');
  if (filas === 0) {
    console.log('');
    console.log('La base está vacía. Si quieres llevarte lo que tienes en');
    console.log('data/db.json:  npm run supabase:subir');
  }
}

main().catch(err => {
  console.error('Falló la prueba:', err.message);
  process.exit(1);
});
