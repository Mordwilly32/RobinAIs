// scripts/prueba-store.js
// ---------------------------------------------------------------------------
// Prueba del guardado en Supabase sin Supabase.
//
//   npm run supabase:prueba
//
// Suplanta @supabase/supabase-js por una imitación en memoria que habla el
// mismo dialecto de PostgREST que usa src/store.js, y comprueba el viaje
// completo: subir, leer de vuelta, subir solo lo que cambió, y borrar.
//
// Lo que de verdad vigila, y por lo que existe:
//
//   · que las caras y las fotos de perfil NO salgan de aquí,
//   · que un guardado sin cambios no mande ni una fila —si esto se rompe, cada
//     tecleo del chat reescribe la base entera y el plan gratis se acaba en
//     una tarde—,
//   · que arrancar no reescriba lo que ya está arriba. Postgres reordena las
//     claves de un jsonb al guardarlo, así que comparar el texto tal cual daría
//     que todo cambió siempre. Ver textoEstable() en src/store.js.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

const path = require('path');
const Module = require('module');

// ---- El Supabase de mentira ------------------------------------------------

const tablas = new Map();          // nombre -> Map(id -> data)
const bitacora = { upserts: 0, filasSubidas: 0, borradas: 0 };

function tabla(nombre) {
  if (!tablas.has(nombre)) tablas.set(nombre, new Map());
  return tablas.get(nombre);
}

function consulta(nombre) {
  const t = tabla(nombre);
  const api = {
    select() {
      const p = Promise.resolve({ data: [], error: null });
      p.range = (desde, hasta) => {
        const filas = [...t.entries()].map(([id, data]) => ({ id, data }));
        return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
      };
      p.eq = (col, val) => ({
        maybeSingle: () => Promise.resolve({
          data: t.has(val) ? { data: t.get(val) } : null, error: null
        })
      });
      return p;
    },
    upsert(filas) {
      // supabase-js acepta una fila suelta o un arreglo; el de meta va suelta.
      if (!Array.isArray(filas)) filas = [filas];
      bitacora.upserts++;
      bitacora.filasSubidas += filas.length;
      for (const f of filas) t.set(String(f.id), JSON.parse(JSON.stringify(f.data)));
      return Promise.resolve({ error: null });
    },
    delete() {
      return {
        in(col, ids) {
          bitacora.borradas += ids.length;
          for (const id of ids) t.delete(String(id));
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  return api;
}

const cargaOriginal = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (peticion === '@supabase/supabase-js') {
    return { createClient: () => ({ from: consulta }) };
  }
  return cargaOriginal.apply(this, arguments);
};

// ---- La prueba -------------------------------------------------------------

const store = require(path.join(__dirname, '..', 'src', 'store.js'));

let fallos = 0;
function comprobar(queDice, condicion) {
  console.log((condicion ? '  ok   ' : '  FALLA ') + queDice);
  if (!condicion) fallos++;
}

function base() {
  return {
    meta: { nextUserId: 3, nextTaskId: 2 },
    users: [
      { id: 1, fullName: 'Ada', email: 'ada@escuela.sv', role: 'teacher',
        profilePic: 'data:image/png;base64,AAAA', facePhoto: 'data:image/png;base64,BBBB',
        faceDescriptor: new Array(128).fill(0.5) },
      { id: 2, fullName: 'Luis', email: 'luis@escuela.sv', role: 'student' }
    ],
    schools: [{ id: 1, name: 'Escuela Central' }],
    codes: [], tasks: [{ id: 1, userId: 1, title: 'Revisar notas' }],
    announcements: [], classes: [], activities: [], submissions: [],
    chats: [], attendance: [], aiLogs: [],
    gameScores: [{ userId: 2, gameId: 'suma', plays: 4 }],
    gameSettings: [{ scope: 'school', scopeId: 1, disabled: ['resta'] }]
  };
}

async function main() {
  console.log('Motor:', store.nombre, '\n');
  comprobar('elige Supabase cuando hay variables', store.USA_SUPABASE === true);

  const datos = base();
  store.conectar(() => datos);

  // --- primera subida ---
  store.guardar(datos);
  await store.vaciar();
  comprobar('no hubo error al subir', !store.ultimoError);
  comprobar('subió los 2 usuarios', tabla('rr_users').size === 2);
  comprobar('subió la escuela', tabla('rr_schools').size === 1);
  comprobar('subió la marca de juego con llave compuesta',
    tabla('rr_game_scores').has('2::suma'));
  comprobar('subió el ajuste de juegos con llave compuesta',
    tabla('rr_game_settings').has('school::1'));
  comprobar('subió meta', tabla('rr_meta').get('meta').nextUserId === 3);

  // --- lo que NO debe haber subido ---
  const ada = tabla('rr_users').get('1');
  comprobar('la foto de perfil no subió', ada.profilePic === undefined);
  comprobar('la foto de la cara no subió', ada.facePhoto === undefined);
  comprobar('la huella de la cara no subió', ada.faceDescriptor === undefined);
  comprobar('lo demás del usuario sí subió', ada.fullName === 'Ada' && ada.email === 'ada@escuela.sv');

  // --- guardar sin cambios no debe mandar nada ---
  const antes = bitacora.filasSubidas;
  store.guardar(datos);
  await store.vaciar();
  comprobar('sin cambios no sube ni una fila', bitacora.filasSubidas === antes);

  // --- un cambio pequeño manda una fila ---
  datos.users[1].fullName = 'Luis Alberto';
  store.guardar(datos);
  await store.vaciar();
  comprobar('un cambio sube exactamente una fila', bitacora.filasSubidas === antes + 1);
  comprobar('el cambio llegó', tabla('rr_users').get('2').fullName === 'Luis Alberto');

  // --- tocar solo la foto no debe mandar nada ---
  const antes2 = bitacora.filasSubidas;
  datos.users[0].facePhoto = 'data:image/png;base64,CCCC';
  datos.users[0].profilePic = 'data:image/png;base64,DDDD';
  store.guardar(datos);
  await store.vaciar();
  comprobar('cambiar solo la cara no manda nada', bitacora.filasSubidas === antes2);

  // --- borrar ---
  datos.users = datos.users.filter(u => u.id !== 2);
  store.guardar(datos);
  await store.vaciar();
  comprobar('el usuario borrado desapareció de la tabla', !tabla('rr_users').has('2'));

  // --- leer de vuelta, como al arrancar ---
  const leido = await store.cargar();
  comprobar('lee de vuelta 1 usuario', leido.users.length === 1);
  comprobar('lee de vuelta meta', leido.meta.nextUserId === 3);
  comprobar('lee de vuelta la marca de juego', leido.gameScores[0].gameId === 'suma');
  comprobar('lo leído no trae caras', leido.users[0].facePhoto === undefined);

  // --- tras leer, guardar lo mismo no debe reescribir nada ---
  // (es lo que pasa en cada arranque: si el orden de las claves de jsonb
  //  despistara a la comparación, aquí se reescribiría la base entera)
  const antes3 = bitacora.filasSubidas;
  store.conectar(() => leido);
  store.guardar(leido);
  await store.vaciar();
  comprobar('un arranque no reescribe la base', bitacora.filasSubidas === antes3);

  console.log('\n' + (fallos ? fallos + ' FALLOS' : 'Todo bien.'));
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
