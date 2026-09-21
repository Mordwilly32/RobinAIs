// public/js/face-vault.js
// ---------------------------------------------------------------------------
// Dónde viven las caras.
//
// Aquí y en ningún otro lado: IndexedDB, en este navegador, en esta
// computadora. La foto de reconocimiento de cada estudiante y la huella de 128
// números que face-api saca de ella no viajan al servidor, no llegan a
// Supabase y no están en el repositorio.
//
// Son datos biométricos de menores de edad. Guardarlos en un servidor de
// terceros obliga a responder por ellos —quién los ve, cuánto duran, qué pasa
// si alguien entra— y ninguna de esas respuestas mejora el pase de lista: el
// reconocimiento ya corre entero en el navegador, así que la foto solo hace
// falta donde está la cámara.
//
// Lo que eso significa en la práctica
//   La lista de caras es de la computadora, no de la cuenta. Si la escuela
//   pasa lista siempre desde la misma tablet, se monta una vez y ya. Si mañana
//   se usa otra, hay que volver a tomar las fotos ahí. Y si alguien borra los
//   datos del navegador, se borran.
//
//   Por eso existe RRCaras.exportar() / RRCaras.importar(): un archivo .json
//   que el profesor se puede pasar de un aparato a otro a mano.
//
// El servidor solo se entera de a quién se reconoció, nunca de cómo es su
// cara.
// ---------------------------------------------------------------------------

const RRCaras = (function () {
  'use strict';

  const BASE = 'roborobin-caras';
  const ALMACEN = 'caras';
  const VERSION = 1;

  let abierta = null;

  function abrir() {
    if (abierta) return abierta;
    abierta = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('Este navegador no guarda caras. Prueba con Chrome, Edge o Firefox.'));
      }
      const pet = indexedDB.open(BASE, VERSION);
      pet.onupgradeneeded = () => {
        const bd = pet.result;
        if (!bd.objectStoreNames.contains(ALMACEN)) bd.createObjectStore(ALMACEN, { keyPath: 'id' });
      };
      pet.onsuccess = () => resolve(pet.result);
      pet.onerror = () => reject(new Error('No se pudo abrir el archivo de caras de este navegador.'));
      // En ventana privada, Firefox deja la petición colgada en lugar de
      // fallar. Sin esto, el pase de lista se quedaría esperando para siempre.
      pet.onblocked = () => reject(new Error('Hay otra pestaña de roboRobin abierta. Ciérrala y vuelve a intentar.'));
    });
    return abierta;
  }

  function transaccion(modo, trabajo) {
    return abrir().then(bd => new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, modo);
      const almacen = tx.objectStore(ALMACEN);
      let resultado;
      trabajo(almacen, valor => { resultado = valor; });
      tx.oncomplete = () => resolve(resultado);
      tx.onerror = () => reject(tx.error || new Error('No se pudo escribir en el archivo de caras.'));
      tx.onabort = () => reject(tx.error || new Error('Se quedó sin espacio para guardar la cara.'));
    }));
  }

  // Una cara. Devuelve null si esa persona todavía no tiene foto en este
  // aparato — que es lo normal la primera vez que se abre en una tablet nueva.
  function leer(id) {
    return transaccion('readonly', (almacen, dejar) => {
      const pet = almacen.get(String(id));
      pet.onsuccess = () => dejar(pet.result || null);
    });
  }

  function guardar(id, { facePhoto, faceDescriptor }) {
    return transaccion('readwrite', (almacen, dejar) => {
      const fila = {
        id: String(id),
        facePhoto: facePhoto || null,
        faceDescriptor: Array.isArray(faceDescriptor) && faceDescriptor.length === 128
          ? Array.from(faceDescriptor, Number)
          : null,
        updatedAt: new Date().toISOString()
      };
      almacen.put(fila);
      dejar(fila);
    });
  }

  function borrar(id) {
    return transaccion('readwrite', (almacen, dejar) => {
      almacen.delete(String(id));
      dejar(true);
    });
  }

  function todas() {
    return transaccion('readonly', (almacen, dejar) => {
      const pet = almacen.getAll();
      pet.onsuccess = () => dejar(pet.result || []);
    });
  }

  // Le pone a cada estudiante de la lista su foto y su huella, si las hay en
  // este aparato. Se llama justo después de traer la lista del servidor, que
  // viene sin ellas a propósito.
  //
  // Si IndexedDB falla —ventana privada, permisos, disco lleno— la lista se
  // queda sin fotos pero sigue sirviendo: el pase de lista a mano funciona
  // igual. Romper la pantalla entera por no poder enseñar un avatar sería
  // peor que la falta del avatar.
  async function mezclar(lista) {
    if (!Array.isArray(lista) || !lista.length) return lista;
    let guardadas = [];
    try {
      guardadas = await todas();
    } catch (err) {
      console.warn('[roboRobin] No se pudieron leer las caras de este navegador:', err.message);
      return lista;
    }
    const porId = new Map(guardadas.map(c => [c.id, c]));
    for (const persona of lista) {
      const cara = porId.get(String(persona.id));
      persona.facePhoto = cara ? cara.facePhoto : null;
      persona.faceDescriptor = cara ? cara.faceDescriptor : null;
    }
    return lista;
  }

  async function cuantas() {
    try {
      const guardadas = await todas();
      return {
        total: guardadas.length,
        conHuella: guardadas.filter(c => Array.isArray(c.faceDescriptor)).length
      };
    } catch {
      return { total: 0, conHuella: 0 };
    }
  }

  // Pasarse la lista de caras a otra tablet, a mano y en un archivo. Es la
  // única manera de moverlas, y es a propósito: que cueste un gesto explícito
  // y no un guardado automático que nadie recuerda haber aceptado.
  async function exportar() {
    const guardadas = await todas();
    return {
      formato: 'roborobin-caras',
      version: 1,
      creado: new Date().toISOString(),
      caras: guardadas
    };
  }

  async function importar(paquete) {
    if (!paquete || paquete.formato !== 'roborobin-caras' || !Array.isArray(paquete.caras)) {
      throw new Error('Ese archivo no es una copia de caras de roboRobin.');
    }
    let puestas = 0;
    for (const cara of paquete.caras) {
      if (!cara || cara.id === undefined) continue;
      await guardar(cara.id, cara);
      puestas++;
    }
    return puestas;
  }

  async function borrarTodas() {
    return transaccion('readwrite', (almacen, dejar) => {
      almacen.clear();
      dejar(true);
    });
  }

  return { leer, guardar, borrar, todas, mezclar, cuantas, exportar, importar, borrarTodas };
})();
