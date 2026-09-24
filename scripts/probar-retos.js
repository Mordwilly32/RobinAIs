// scripts/probar-retos.js
// ---------------------------------------------------------------------------
// Saca cientos de retos de cada minijuego, en los cuatro niveles, y comprueba
// que cada uno esté bien hecho:
//
//   - el enunciado no trae undefined ni NaN
//   - hay respuesta, pista y paso a paso
//   - en los de elegir: cuatro opciones distintas, y SOLO UNA cuenta como
//     correcta
//   - en los de escribir: su propia respuesta pasa, y una equivocada no
//   - en los de armar: las piezas correctas están en el montón, sobra alguna
//     cuando hay que elegirlas, y el orden al revés no cuela
//
//     npm run juegos:probar
//
// Lo de «solo una cuenta como correcta» no es paranoia: así se descubrió que
// el juego de acentuación estaba roto. isCorrect() quitaba los acentos antes
// de comparar, «árbol» y «arbol» le parecían la misma palabra, y en «¿cuál
// está bien acentuada?» las cuatro opciones daban por buenas. Lo mismo pasaba
// con «porque» y «porqué», y al armar palabras con letras acentuadas.
//
// Como los retos se arman al azar, este archivo no prueba una lista fija de
// casos: los genera. Un banco nuevo queda revisado sin escribir un test más.
// ---------------------------------------------------------------------------
const path = require('path');
const games = require(path.join(__dirname, '..', 'src', 'games.js'));

const VUELTAS = 400;
const fallos = [];
const vistos = {}; // cuántos enunciados distintos salen por juego y nivel

function anota(juego, d, msg) {
  fallos.push(`[${juego} d${d}] ${msg}`);
}

for (const id of games.GAME_IDS) {
  for (let d = 1; d <= 4; d++) {
    const clave = `${id} d${d}`;
    vistos[clave] = new Set();

    for (let i = 0; i < VUELTAS; i++) {
      const r = games.buildRound(id, d);
      if (!r) { anota(id, d, 'buildRound devolvió null'); break; }
      const { publicRound: p, secret } = r;
      vistos[clave].add(p.prompt);

      if (!p.prompt || /undefined|NaN|\[object/.test(p.prompt)) {
        anota(id, d, `enunciado roto: ${JSON.stringify(p.prompt)}`);
      }
      if (!secret.answer) anota(id, d, `sin respuesta: ${p.prompt}`);
      if (!secret.hint) anota(id, d, `sin pista: ${p.prompt}`);
      if (!Array.isArray(secret.steps) || !secret.steps.length) {
        anota(id, d, `sin paso a paso: ${p.prompt}`);
      }
      if (secret.steps && secret.steps.some(s => !s || /undefined|NaN/.test(s))) {
        anota(id, d, `paso a paso roto: ${p.prompt}`);
      }

      if (p.kind === 'choice') {
        if (!p.options || p.options.length < 3) {
          anota(id, d, `pocas opciones (${p.options && p.options.length}): ${p.prompt}`);
          continue;
        }
        if (new Set(p.options).size !== p.options.length) {
          anota(id, d, `opciones repetidas: ${p.prompt} → ${p.options.join(' | ')}`);
        }
        const buenas = p.options.filter(o => games.isCorrect(secret, o));
        if (buenas.length !== 1) {
          anota(id, d, `${buenas.length} opciones cuentan como correctas: ${p.prompt} → ${p.options.join(' | ')} (respuesta: ${secret.answer})`);
        }
        if (!p.options.includes(secret.answer)) {
          anota(id, d, `la respuesta no está entre las opciones: ${p.prompt} (${secret.answer})`);
        }
      }

      if (p.kind === 'input') {
        if (!games.isCorrect(secret, secret.answer)) {
          anota(id, d, `su propia respuesta da error: ${p.prompt} (${secret.answer})`);
        }
        if (games.isCorrect(secret, String(Number(secret.answer) + 1))) {
          anota(id, d, `acepta una respuesta equivocada: ${p.prompt} (${secret.answer})`);
        }
      }

      if (p.kind === 'build') {
        const piezas = secret.answerPieces || [];
        if (p.slots !== piezas.length) anota(id, d, `huecos (${p.slots}) ≠ piezas (${piezas.length}): ${p.prompt}`);
        const monton = p.pieces.slice();
        for (const pieza of piezas) {
          const donde = monton.indexOf(pieza);
          if (donde === -1) anota(id, d, `falta la pieza «${pieza}» en el montón: ${p.prompt}`);
          else monton.splice(donde, 1);
        }
        // Ordenar (las lineas de un programa, las palabras de una oracion) usa
        // todas las piezas a proposito: ahi el reto ES el orden. Solo se exige
        // que sobre algo cuando hay que ELEGIR piezas de un monton.
        const esOrdenar = p.pieces.length === p.slots;
        if (!p.pieces.length) anota(id, d, `sin piezas: ${p.prompt}`);
        else if (!esOrdenar && p.pieces.length <= p.slots) {
          anota(id, d, `no sobra ninguna pieza, se resuelve por descarte: ${p.prompt}`);
        }
        if (!games.isCorrect(secret, piezas)) {
          anota(id, d, `su propio orden da error: ${p.prompt}`);
        }
        if (piezas.length > 1 && !secret.unordered) {
          const alReves = piezas.slice().reverse();
          if (String(alReves) !== String(piezas) && games.isCorrect(secret, alReves)) {
            anota(id, d, `acepta el orden invertido: ${p.prompt}`);
          }
        }
      }
    }
  }
}

console.log('Variedad de enunciados por juego y nivel (' + VUELTAS + ' tiradas cada uno):');
for (const clave of Object.keys(vistos)) {
  const n = vistos[clave].size;
  console.log(`  ${clave.padEnd(26)} ${String(n).padStart(4)} enunciados distintos${n < 8 ? '   <-- poca variedad' : ''}`);
}

console.log('');
if (!fallos.length) {
  console.log('Sin fallos.');
} else {
  const unicos = [...new Set(fallos)];
  console.log(`${fallos.length} fallos (${unicos.length} distintos):`);
  unicos.slice(0, 40).forEach(f => console.log('  ' + f));
  process.exitCode = 1;
}
