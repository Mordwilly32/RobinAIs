// src/games.js
// ---------------------------------------------------------------------------
// Los minijuegos de roboRobin. Hay uno por materia y todos salen de la misma
// idea: un reto corto, con una respuesta que SIEMPRE se puede encontrar.
//
// La dificultad sube con el nivel escolar (Parvularia 1 … Bachillerato 4),
// pero nunca hasta volverse imposible: si el reto no se puede resolver con lo
// que se ve en pantalla, está mal hecho.
//
// Los retos se arman aquí, en el servidor, y la respuesta NO viaja al
// navegador. Así la pista de Robin significa algo: no se puede mirar el
// código de la página para hacer trampa.
//
// Cada reto trae dos ayudas distintas:
//   hint   una pista que empuja en la dirección correcta sin decir el resultado
//   steps  el camino paso a paso, que es lo que Robin explica cuando alguien
//          de verdad se atoró — y aun así la última palabra la pone la persona
// ---------------------------------------------------------------------------

// ---- Utilidades ------------------------------------------------------------

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Arma las opciones de un reto de opción múltiple: la correcta más distractores
// que no se repitan ni coincidan con ella.
function choices(correct, distractors) {
  const seen = new Set([String(correct)]);
  const out = [String(correct)];
  distractors.forEach(d => {
    const key = String(d);
    if (!seen.has(key) && out.length < 4) { seen.add(key); out.push(key); }
  });
  return shuffle(out);
}

// Un banco de preguntas repartido por dificultad: { 2: [...], 3: [...] }.
// Devuelve la lista del nivel que toca. Si ese nivel no existe en ese banco
// concreto, baja al más cercano por debajo y, si tampoco hay, sube: así un
// banco puede empezar en tercero (las figuras literarias) o acabar en tercero
// (la teoría del color) sin que nadie se quede sin reto.
function porNivel(banco, d) {
  const n = Math.min(4, Math.max(1, Number(d) || 1));
  for (let i = n; i >= 1; i--) if (banco[i] && banco[i].length) return banco[i];
  for (let i = n + 1; i <= 4; i++) if (banco[i] && banco[i].length) return banco[i];
  return [];
}

// ---- Retos de armar con piezas ---------------------------------------------
// El tercer tipo de reto, además de elegir una opción y escribir la respuesta:
// hay un montón de piezas sueltas y hay que colocarlas en su sitio.
//
// Sirve para casi todo lo que no se puede preguntar con cuatro botones: armar
// una ecuación con sus números y sus signos, formar una palabra letra por
// letra, juntar dos ingredientes en una poción, ordenar las líneas de un
// programa. Es el mismo mecanismo en las siete materias, así que quien
// aprendió a jugarlo en una lo sabe jugar en todas.
//
//   answer     las piezas correctas, en su orden ('3 + 4 = 7' o un arreglo)
//   extras     piezas de más que sobran, para que no se resuelva por descarte
//   join       ' ' entre piezas (una ecuación) o '' pegadas (una palabra)
//   unordered  cuando el orden da igual: juntar sodio y cloro, o cloro y sodio
function build({ prompt, lead, answer, extras = [], join = ' ', unordered = false, hint, steps }) {
  const piezas = Array.isArray(answer) ? answer.map(String) : String(answer).split(' ');
  return {
    kind: 'build',
    prompt,
    lead,
    pieces: shuffle(piezas.concat(extras.map(String))),
    slots: piezas.length,
    join,
    unordered,
    answer: piezas.join(join === '' ? '' : ' '),
    answerPieces: piezas,
    hint,
    steps
  };
}

// Las letras de una palabra, revueltas, más un par de letras que sobran para
// que no baste con "usa todas las que hay".
function letrasDe(palabra, sobran = 2) {
  const abecedario = 'abcdefghijklmnoprstuvz'.split('');
  const usadas = palabra.split('');
  const ruido = [];
  while (ruido.length < sobran) {
    const letra = pick(abecedario);
    if (!usadas.includes(letra) && !ruido.includes(letra)) ruido.push(letra);
  }
  return ruido;
}

// La dificultad que le toca a alguien. Los más peques juegan en 1 aunque el
// nivel diga otra cosa; nadie empieza frustrado.
const LEVEL_DIFFICULTY = {
  'Parvularia': 1,
  'Primaria': 2,
  'Secundaria': 3,
  'Bachillerato': 4,
  // La universidad no juega a los minijuegos (ver availableGamesFor en db.js),
  // pero el número hace falta igual: lo usa Robin para saber a qué altura
  // explicar en el chat.
  'Universidad': 4
};

// Primero, segundo y tercer grado siguen contando como "peques": la primaria
// alta es la que salta a dificultad 2.
const LITTLE_GRADES = /^(?:k|kinder|prep|1|2|3)(?:\s*(?:°|º|er|do|ro|to|grado))?\b/i;

// Una cuenta personal no tiene nivel ni grado: lo único que sabemos de ella es
// la edad que puso al registrarse. Sin esto, alguien de 6 años y alguien de 40
// recibían exactamente el mismo reto.
function difficultyForAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  if (n <= 7) return 1;
  if (n <= 11) return 2;
  if (n <= 14) return 3;
  return 4;
}

function difficultyFor(user) {
  if (!user) return 2;
  if (!user.level && user.age) return difficultyForAge(user.age) || 2;
  const base = LEVEL_DIFFICULTY[user.level] || 2;
  if (base === 2 && user.grade && LITTLE_GRADES.test(String(user.grade).trim())) return 1;
  return base;
}

// ---- Matemáticas -----------------------------------------------------------
// Dos formas de preguntar lo mismo, alternadas al azar:
//
//   armar     las piezas de la operación están sueltas y hay que colocarlas.
//             Obliga a entender la estructura —qué va a cada lado del igual—,
//             no solo a calcular el resultado.
//   resolver  la operación ya está escrita y solo falta el número.
//
// Lo que sube con el nivel no es el tamaño de los números: es el tema. Hasta
// segundo se junta y se quita; en primaria alta entran la división con
// residuo, las fracciones, el porcentaje y el perímetro; en secundaria, las
// ecuaciones, la proporción, Pitágoras y las áreas; en bachillerato, las
// cuadráticas, los logaritmos, la trigonometría, los sistemas y las
// progresiones. Un reto de bachillerato que se resuelve contando con los dedos
// no es un reto de bachillerato.

function mathBuild(d) {
  if (d <= 1) {
    const a = rand(1, 5), b = rand(1, 5);
    return build({
      prompt: `Arma la suma: Robin juntó ${a} semillas y encontró ${b} más.`,
      lead: 'Toca las piezas en el orden correcto para armar la operación.',
      answer: [String(a), '+', String(b), '=', String(a + b)],
      extras: ['−', String(a + b + 1), String(Math.max(1, a + b - 1))],
      hint: 'Primero lo que tenía, luego el signo de juntar, luego lo que encontró, y al final el igual con el total.',
      steps: [
        `La operación empieza con las semillas que ya tenía: ${a}.`,
        'Juntar cosas es sumar, así que después va el signo +.',
        `Luego va lo que encontró: ${b}.`,
        'Al final el signo = y el total de las dos cantidades juntas.'
      ]
    });
  }

  if (d === 2) {
    const a = rand(12, 60), b = rand(3, 12);
    const op = pick(['×', '+', '−']);
    const valor = op === '×' ? a * b : op === '+' ? a + b : a - b;
    return build({
      prompt: `Arma la operación completa. El resultado tiene que ser ${valor}.`,
      lead: 'Los signos también son piezas: colócalos donde van.',
      answer: [String(a), op, String(b), '=', String(valor)],
      extras: [op === '×' ? '+' : '×', String(valor + 10), String(b + 1)],
      hint: `Busca qué dos números dan ${valor} con el signo que tienes, y recuerda que el resultado va siempre después del igual.`,
      steps: [
        'Coloca primero el número más grande: es el que abre la operación.',
        `Prueba el signo que tienes con cada número hasta llegar a ${valor}.`,
        'El igual va antes del resultado, nunca al principio.'
      ]
    });
  }

  if (d === 3) {
    const x = rand(2, 9), a = rand(2, 6), b = rand(1, 20);
    const total = a * x + b;
    return build({
      prompt: `Arma la ecuación que se resuelve con x = ${x}.`,
      lead: 'Tiene que seguir siendo cierta al sustituir la x por su valor.',
      answer: [String(a) + 'x', '+', String(b), '=', String(total)],
      extras: ['−', String(total + a), String(b + 3)],
      hint: `Sustituye: el número que multiplica a la x, por ${x}, más el que se suma aparte, tiene que dar el total.`,
      steps: [
        'La ecuación empieza con el término que lleva la x.',
        'Después va el signo + y el número que se suma aparte.',
        `Comprueba: ${a} · ${x} = ${a * x}, y ${a * x} + ${b} = ${total}. Ese es el número que va tras el igual.`
      ]
    });
  }

  // Bachillerato: la factorización, armada con dos paréntesis. Se parte de las
  // raíces para que siempre exista y sea entera.
  // Las dos raíces distintas a propósito: con raíz doble, el mismo paréntesis
  // aparecía dos veces en el montón y el reto dejaba de tener sentido visual.
  const r1 = rand(1, 5);
  let r2 = rand(1, 6);
  if (r2 === r1) r2 = r1 + 1;
  const B = r1 + r2;
  const C = r1 * r2;
  return build({
    prompt: `Arma la factorización de   x² − ${B}x + ${C}`,
    lead: 'Junta los dos paréntesis que, multiplicados, dan esa expresión. El orden da igual.',
    answer: [`(x − ${r1})`, `(x − ${r2})`],
    extras: [`(x + ${r1})`, `(x + ${r2})`, `(x − ${B})`],
    unordered: true,
    hint: `Necesitas dos números que multiplicados den ${C} y sumados den ${B}. Los dos van restando.`,
    steps: [
      `Busca las parejas de números que multiplicadas den ${C}.`,
      `De esas parejas, quédate con la que sume ${B}.`,
      'Como el término del medio es negativo y el independiente positivo, los dos paréntesis llevan resta.'
    ]
  });
}

// ---- Los retos de resolver, uno por tema -----------------------------------
// Cada función es UN tipo de ejercicio, y MATE_POR_NIVEL dice cuáles puede
// sacar cada nivel. Así se agrega un tema nuevo sin tocar nada de lo demás, y
// se ve de un vistazo qué le puede tocar a alguien de tercero y qué no.

// Parvularia: juntar y quitar, con números que caben en dos manos.
function mateContar() {
  const a = rand(1, 5), b = rand(1, 5);
  return {
    kind: 'choice',
    prompt: `Robin juntó ${a} semillas y luego encontró ${b} más. ¿Cuántas tiene?`,
    answer: String(a + b),
    options: choices(a + b, [a + b + 1, Math.max(1, a + b - 1), a + b + 2]),
    hint: 'Cuenta con los dedos: primero las que ya tenía y sigue contando las nuevas, una por una.',
    steps: [
      `Empieza en ${a}.`,
      `Cuenta ${b} más, de uno en uno.`,
      'El número donde te detienes es la respuesta.'
    ]
  };
}

function mateQuitar() {
  const a = rand(4, 9), b = rand(1, a - 1);
  return {
    kind: 'choice',
    prompt: `Robin tenía ${a} semillas y se comió ${b}. ¿Cuántas le quedan?`,
    answer: String(a - b),
    options: choices(a - b, [a - b + 1, Math.max(0, a - b - 1), a + b]),
    hint: 'Quitar es restar: empieza en el total y ve contando hacia atrás.',
    steps: [
      `Empieza en ${a}.`,
      `Cuenta ${b} hacia atrás, de uno en uno.`,
      'Donde te detienes es lo que le queda.'
    ]
  };
}

// Primaria alta: la cuenta escrita, en columna.
function mateOperacion() {
  const a = rand(12, 99), b = rand(3, 12);
  const op = pick(['x', '+', '-']);
  const value = op === 'x' ? a * b : op === '+' ? a + b : a - b;
  const decenas = Math.floor(a / 10) * 10;
  return {
    kind: 'input',
    prompt: `Resuelve: ${a} ${op} ${b}`,
    answer: String(value),
    hint: op === 'x'
      ? 'Parte el número grande: multiplica primero las decenas y luego las unidades, y suma los dos resultados.'
      : 'Ordena en columna las unidades debajo de las unidades y las decenas debajo de las decenas.',
    steps: op === 'x'
      ? [
          `Separa ${a} en ${decenas} + ${a % 10}.`,
          `Multiplica ${decenas} x ${b} = ${decenas * b}.`,
          `Multiplica ${a % 10} x ${b} = ${(a % 10) * b}.`,
          'Suma los dos resultados y ya tienes el total.'
        ]
      : [
          'Escribe los dos números uno debajo del otro, alineando las unidades.',
          `Opera columna por columna, de derecha a izquierda (${op}).`,
          'Si te pasas de 9 en una columna, lleva 1 a la siguiente.'
        ]
  };
}

// La división que no da exacta, que es la que de verdad cuesta: sobra algo, y
// según lo que se pregunte la respuesta es el cociente o el resto.
function mateDivision() {
  const b = rand(3, 9);
  const q = rand(4, 15);
  const r = rand(1, b - 1);
  const a = b * q + r;
  const porElResto = Math.random() < 0.4;
  return {
    kind: 'input',
    prompt: porElResto
      ? `Repartes ${a} lápices en partes iguales entre ${b} niños. ¿Cuántos lápices sobran?`
      : `Tienes ${a} lápices y los guardas en cajas de ${b}. ¿Cuántas cajas llenas completas?`,
    answer: String(porElResto ? r : q),
    hint: porElResto
      ? 'Reparte todo lo que puedas en partes iguales; lo que ya no alcanza para darle uno a cada quien es lo que sobra.'
      : 'Solo cuentan las cajas que quedan llenas del todo. La que queda a medias no se cuenta.',
    steps: [
      `Pregúntate cuántas veces cabe ${b} dentro de ${a}.`,
      `Cabe ${q} veces: ${b} × ${q} = ${b * q}.`,
      `De ${b * q} a ${a} faltan ${r}: ese es el resto.`,
      porElResto ? 'Lo que sobra es el resto.' : 'Las cajas llenas son el cociente, no el resto.'
    ]
  };
}

// Fracciones con el mismo denominador: se suman los de arriba y el de abajo se
// queda quieto. Sumar también los de abajo es el error clásico, así que una de
// las opciones equivocadas lo comete.
function mateFraccion() {
  const den = pick([5, 7, 8, 9, 11]);
  const a = rand(1, den - 2);
  const b = rand(1, den - a - 1);
  const suma = a + b;
  return {
    kind: 'choice',
    prompt: `¿Cuánto es   ${a}/${den} + ${b}/${den} ?`,
    answer: `${suma}/${den}`,
    options: choices(`${suma}/${den}`, [
      `${suma}/${den * 2}`,
      `${a * b}/${den}`,
      `${suma}/${den + 1}`
    ]),
    hint: 'Si las dos fracciones tienen el mismo número abajo, ese número NO se toca: solo se suman los de arriba.',
    steps: [
      `Las dos partes están cortadas en ${den} pedazos iguales, así que se pueden juntar directamente.`,
      `Suma solo los de arriba: ${a} + ${b} = ${suma}.`,
      `El de abajo sigue siendo ${den}, porque el tamaño del pedazo no cambió.`
    ]
  };
}

// Perímetro y área se confunden entre sí, así que la una siempre está entre
// las opciones equivocadas de la otra.
function matePerimetro() {
  const largo = rand(4, 15), ancho = rand(2, largo - 1);
  const perimetro = 2 * (largo + ancho);
  const area = largo * ancho;
  const pidePerimetro = Math.random() < 0.5;
  return {
    kind: 'choice',
    prompt: pidePerimetro
      ? `Un patio mide ${largo} m de largo y ${ancho} m de ancho. ¿Cuántos metros de malla hacen falta para cercarlo por completo?`
      : `Un patio mide ${largo} m de largo y ${ancho} m de ancho. ¿Cuántos metros cuadrados de césped cubren todo el patio?`,
    answer: String(pidePerimetro ? perimetro : area),
    options: choices(pidePerimetro ? perimetro : area, [
      pidePerimetro ? area : perimetro,
      largo + ancho,
      pidePerimetro ? perimetro + largo : area + largo
    ]),
    hint: pidePerimetro
      ? 'Cercar es dar la vuelta al borde: se suman los cuatro lados, y los lados opuestos miden lo mismo.'
      : 'Cubrir la superficie es área: se multiplica el largo por el ancho.',
    steps: pidePerimetro
      ? [
          'Dibuja el rectángulo y escribe la medida de cada uno de sus cuatro lados.',
          `Hay dos lados de ${largo} y dos de ${ancho}.`,
          `Súmalos todos: 2 × (${largo} + ${ancho}) = ${perimetro} metros.`
        ]
      : [
          'El área es cuántos cuadraditos de 1 m × 1 m caben dentro.',
          `Caben ${largo} en cada fila y hay ${ancho} filas.`,
          `${largo} × ${ancho} = ${area} metros cuadrados.`
        ]
  };
}

// Secundaria: despejar la x.
function mateEcuacion() {
  const x = rand(2, 12), a = rand(2, 9), b = rand(1, 30);
  return {
    kind: 'input',
    prompt: `Despeja x:   ${a}x + ${b} = ${a * x + b}`,
    answer: String(x),
    hint: 'Deja la x sola: primero quita lo que está sumando y después quita lo que está multiplicando.',
    steps: [
      `Resta ${b} en los dos lados de la igualdad: te queda ${a}x = ${a * x}.`,
      `Divide los dos lados entre ${a}.`,
      'Lo que queda a la derecha es x. Compruébalo sustituyendo en la ecuación original.'
    ]
  };
}

function matePorcentaje() {
  const p = pick([10, 20, 25, 40, 50, 60, 75]);
  const total = pick([40, 60, 80, 120, 200, 300]);
  const valor = (total * p) / 100;
  return {
    kind: 'input',
    prompt: `En una escuela de ${total} estudiantes, el ${p} % participa en el festival. ¿Cuántos estudiantes son?`,
    answer: String(valor),
    hint: 'Un porcentaje es una fracción sobre 100: divide el total entre 100 y multiplica por el porcentaje.',
    steps: [
      `El 1 % de ${total} es ${total} ÷ 100 = ${total / 100}.`,
      `El ${p} % son ${p} veces eso: ${total / 100} × ${p}.`,
      `Resultado: ${valor} estudiantes.`
    ]
  };
}

function mateProporcion() {
  const unidad = rand(2, 9);
  const a = rand(2, 6);
  const b = a + rand(2, 6);
  const costoA = unidad * a;
  return {
    kind: 'input',
    prompt: `Si ${a} cuadernos cuestan $${costoA}, ¿cuánto cuestan ${b} cuadernos del mismo precio?`,
    answer: String(unidad * b),
    hint: 'Averigua primero cuánto cuesta UNO. Con el precio de uno, lo demás es multiplicar.',
    steps: [
      `Uno cuesta $${costoA} ÷ ${a} = $${unidad}.`,
      `${b} cuestan $${unidad} × ${b}.`,
      `Total: $${unidad * b}.`
    ]
  };
}

// Ternas pitagóricas, para que la hipotenusa salga siempre entera: una raíz
// con decimales convierte el reto en un ejercicio de calculadora.
const TERNAS = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [7, 24, 25], [20, 21, 29]];

function matePitagoras() {
  const [a, b, c] = pick(TERNAS);
  return {
    kind: 'input',
    prompt: `Un triángulo rectángulo tiene catetos de ${a} cm y ${b} cm. ¿Cuánto mide la hipotenusa, en cm?`,
    answer: String(c),
    hint: 'Teorema de Pitágoras: el cuadrado de la hipotenusa es la suma de los cuadrados de los catetos.',
    steps: [
      `Eleva cada cateto al cuadrado: ${a}² = ${a * a} y ${b}² = ${b * b}.`,
      `Súmalos: ${a * a} + ${b * b} = ${c * c}.`,
      `La hipotenusa es la raíz cuadrada de ${c * c}, o sea ${c} cm.`
    ]
  };
}

function mateArea() {
  const base = rand(2, 10) * 2; // par, para que la mitad salga entera
  const altura = rand(3, 15);
  const triangulo = (base * altura) / 2;
  return {
    kind: 'choice',
    prompt: `Un triángulo tiene ${base} cm de base y ${altura} cm de altura. ¿Cuál es su área?`,
    answer: `${triangulo} cm²`,
    // Los tres distractores se calculan para no poder coincidir nunca entre sí
    // ni con el área: con «base + altura» a secas, un triángulo de 6 × 3 daba
    // 9 de área y 9 de distractor, choices() lo quitaba por repetido y el reto
    // salía con dos botones en vez de cuatro.
    options: choices(`${triangulo} cm²`, [
      `${base * altura} cm²`,
      `${triangulo + altura} cm²`,
      `${2 * triangulo + base} cm²`
    ]),
    hint: 'Un triángulo es la mitad de un rectángulo de la misma base y la misma altura.',
    steps: [
      `El rectángulo entero mediría ${base} × ${altura} = ${base * altura} cm².`,
      'El triángulo es exactamente la mitad de ese rectángulo.',
      `${base * altura} ÷ 2 = ${triangulo} cm².`
    ]
  };
}

// Bachillerato.
function mateRaices() {
  const r1 = rand(-6, 6);
  const r2 = rand(-6, 6);
  const B = -(r1 + r2);
  const C = r1 * r2;
  const correcta = [r1, r2].sort((p, q) => p - q).join(' y ');
  const termB = B === 0 ? '' : B > 0 ? ` + ${B}x` : ` - ${Math.abs(B)}x`;
  const termC = C === 0 ? '' : C > 0 ? ` + ${C}` : ` - ${Math.abs(C)}`;

  return {
    kind: 'choice',
    prompt: `¿Cuáles son las raíces de   x²${termB}${termC} = 0 ?`,
    answer: correcta,
    options: choices(correcta, [
      [r1 + 1, r2].sort((p, q) => p - q).join(' y '),
      [-r1, -r2].sort((p, q) => p - q).join(' y '),
      [r1, r2 + 2].sort((p, q) => p - q).join(' y '),
      [r1 - 2, r2 + 1].sort((p, q) => p - q).join(' y ')
    ]),
    hint: 'Busca dos números que multiplicados den el término independiente y sumados den el coeficiente del medio con el signo cambiado.',
    steps: [
      `Necesitas dos números cuyo producto sea ${C}.`,
      `De esas parejas, quédate con la que sume ${-B}.`,
      'Esas dos son las raíces. Compruébalas sustituyendo en la ecuación.'
    ]
  };
}

function mateLogaritmo() {
  const base = pick([2, 3, 5, 10]);
  const exp = rand(2, base === 10 ? 4 : 5);
  const valor = Math.pow(base, exp);
  return {
    kind: 'input',
    prompt: base === 10
      ? `¿Cuánto vale   log ${valor}   (logaritmo en base 10)?`
      : `¿Cuánto vale   log_${base} ${valor} ?`,
    answer: String(exp),
    hint: 'Un logaritmo pregunta un exponente: ¿a qué potencia hay que elevar la base para llegar a ese número?',
    steps: [
      `La pregunta es: ${base} elevado a qué da ${valor}.`,
      `Ve multiplicando: ${base}² = ${base * base}, ${base}³ = ${Math.pow(base, 3)}…`,
      `Se llega a ${valor} con el exponente ${exp}, así que ese es el logaritmo.`
    ]
  };
}

const TRIG = [
  { q: 'sen 30°', ok: '1/2', bad: ['√3/2', '√2/2', '1'] },
  { q: 'cos 60°', ok: '1/2', bad: ['√3/2', '√2/2', '0'] },
  { q: 'sen 45°', ok: '√2/2', bad: ['1/2', '√3/2', '1'] },
  { q: 'cos 45°', ok: '√2/2', bad: ['1/2', '√3/2', '0'] },
  { q: 'cos 30°', ok: '√3/2', bad: ['1/2', '√2/2', '0'] },
  { q: 'sen 60°', ok: '√3/2', bad: ['1/2', '√2/2', '1'] },
  { q: 'tan 45°', ok: '1', bad: ['0', '√3', '1/2'] },
  { q: 'sen 90°', ok: '1', bad: ['0', '1/2', '√2/2'] },
  { q: 'cos 90°', ok: '0', bad: ['1', '1/2', '√3/2'] },
  { q: 'tan 60°', ok: '√3', bad: ['1', '√3/3', '1/2'] }
];

function mateTrigonometria() {
  const item = pick(TRIG);
  return {
    kind: 'choice',
    prompt: `¿Cuál es el valor exacto de   ${item.q} ?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Dibuja el triángulo de 30-60-90 (lados 1, √3 y 2) o el de 45-45-90 (lados 1, 1 y √2) y lee la razón que te piden.',
    steps: [
      'Seno es cateto opuesto entre hipotenusa; coseno, cateto adyacente entre hipotenusa; tangente, opuesto entre adyacente.',
      'En el triángulo 30-60-90 los lados son 1, √3 y 2; en el 45-45-90 son 1, 1 y √2.',
      'Coloca el ángulo que te piden en el dibujo y lee los dos lados que te hacen falta.'
    ]
  };
}

function mateSistema() {
  const x = rand(1, 8), y = rand(1, 8);
  const a1 = rand(1, 4), b1 = rand(1, 4);
  const a2 = rand(1, 4);
  let b2 = rand(1, 4);
  // Sin esto las dos ecuaciones pueden salir proporcionales, y entonces el
  // sistema no tiene UNA solución sino infinitas: el reto se queda sin
  // respuesta que calificar.
  if (a1 * b2 === a2 * b1) b2 = (b2 % 4) + 1;
  const c1 = a1 * x + b1 * y;
  const c2 = a2 * x + b2 * y;
  return {
    kind: 'input',
    prompt: `Resuelve el sistema y escribe el valor de x:\n\n${a1}x + ${b1}y = ${c1}\n${a2}x + ${b2}y = ${c2}`,
    answer: String(x),
    hint: 'Multiplica una ecuación (o las dos) para que la y quede con el mismo coeficiente en ambas, y réstalas: la y desaparece.',
    steps: [
      `Multiplica la primera por ${b2} y la segunda por ${b1}: así la y queda con ${b1 * b2} en las dos.`,
      'Resta una de la otra. La y se cancela y queda una sola ecuación con x.',
      'Despeja x y compruébala sustituyendo en cualquiera de las dos ecuaciones originales.'
    ]
  };
}

function mateProgresion() {
  const a1 = rand(2, 6);
  const n = rand(5, 8);

  if (Math.random() < 0.45) {
    const r = rand(2, 3);
    const termino = a1 * Math.pow(r, n - 1);
    return {
      kind: 'input',
      prompt: `En la progresión geométrica  ${a1}, ${a1 * r}, ${a1 * r * r}, ${a1 * Math.pow(r, 3)}, …  ¿cuál es el término número ${n}?`,
      answer: String(termino),
      hint: 'En una progresión geométrica cada término se obtiene multiplicando el anterior por una razón fija. Busca primero esa razón.',
      steps: [
        `Divide un término entre el anterior para hallar la razón: ${a1 * r} ÷ ${a1} = ${r}.`,
        `La fórmula es aₙ = a₁ · r^(n−1), o sea ${a1} · ${r}^${n - 1}.`,
        `${a1} · ${Math.pow(r, n - 1)} = ${termino}.`
      ]
    };
  }

  const dif = rand(3, 9);
  const termino = a1 + (n - 1) * dif;
  return {
    kind: 'input',
    prompt: `En la progresión aritmética  ${a1}, ${a1 + dif}, ${a1 + 2 * dif}, ${a1 + 3 * dif}, …  ¿cuál es el término número ${n}?`,
    answer: String(termino),
    hint: 'En una progresión aritmética siempre se suma la misma cantidad. Halla esa diferencia y cuenta cuántas veces se suma.',
    steps: [
      `Resta dos términos seguidos para hallar la diferencia: ${a1 + dif} − ${a1} = ${dif}.`,
      `Del primero al término ${n} hay ${n - 1} saltos, no ${n}.`,
      `aₙ = ${a1} + ${n - 1} · ${dif} = ${termino}.`
    ]
  };
}

// Qué tipo de ejercicio le puede tocar a cada nivel. Un tema se repite en dos
// niveles cuando de verdad se practica en los dos —la ecuación lineal se sigue
// usando en bachillerato—; lo que no aparece es lo que todavía no toca.
const MATE_POR_NIVEL = {
  1: [mateContar, mateQuitar],
  2: [mateOperacion, mateOperacion, mateDivision, mateFraccion, matePerimetro],
  3: [mateEcuacion, matePorcentaje, mateProporcion, matePitagoras, mateArea],
  4: [mateRaices, mateLogaritmo, mateTrigonometria, mateSistema, mateProgresion, mateEcuacion]
};

function mathSolve(d) {
  return pick(porNivel(MATE_POR_NIVEL, d))(d);
}

function mathRound(d) {
  // Armar la operación enseña más que calcularla, pero solo hay un reto de
  // armar por nivel y ahora hay cinco o seis de resolver: si pesara igual en
  // todos, en bachillerato saldría la misma factorización una vez de cada dos.
  // Pesa más abajo, que es donde entender la estructura es justo lo que toca.
  return Math.random() < (d <= 2 ? 0.55 : 0.3) ? mathBuild(d) : mathSolve(d);
}

// ---- Lenguaje --------------------------------------------------------------
// Quien apenas está aprendiendo a leer no necesita que le pregunten por
// sinónimos: necesita formar la palabra. Por eso la materia está partida en
// dos mitades que casi no se parecen.
//
//   peques (1 y 2)   armar la palabra letra por letra, a partir de una pista,
//                    y rimas.
//   grandes (3 y 4)  sinónimos, antónimos, ordenar una oración, conectores,
//                    acentuación, homófonos y figuras literarias.
//
// TODOS los bancos van repartidos por nivel, no en una lista única. Parece un
// detalle y no lo es: con una sola lista, a alguien de cuarto grado le podía
// salir «perspicaz» o «efímero» —la palabra correcta, en el año equivocado— y
// el juego dejaba de enseñar para pasar a adivinar.

// Palabras para formar, con la pista que dice cuál es sin deletrearla.
const PALABRAS = {
  1: [
    { palabra: 'sol', pista: 'Sale de día y calienta todo.' },
    { palabra: 'luna', pista: 'Sale de noche y cambia de forma.' },
    { palabra: 'gato', pista: 'Hace miau y le gusta dormir.' },
    { palabra: 'casa', pista: 'Es donde vives con tu familia.' },
    { palabra: 'flor', pista: 'Nace en la planta y huele rico.' },
    { palabra: 'pato', pista: 'Nada en el agua y hace cuac.' },
    { palabra: 'mesa', pista: 'Tiene cuatro patas y comes encima.' },
    { palabra: 'nube', pista: 'Es blanca, está en el cielo y trae lluvia.' },
    { palabra: 'mano', pista: 'Tiene cinco dedos y con ella agarras las cosas.' },
    { palabra: 'pelota', pista: 'Es redonda, bota y sirve para jugar.' },
    { palabra: 'leche', pista: 'Es blanca, se toma y viene de la vaca.' },
    { palabra: 'zapato', pista: 'Se pone en el pie para salir a la calle.' },
    { palabra: 'árbol', pista: 'Es alto, tiene tronco y hojas, y da sombra.' },
    { palabra: 'pez', pista: 'Vive en el agua y tiene aletas.' }
  ],
  2: [
    { palabra: 'escuela', pista: 'El lugar donde aprendes con tus compañeros.' },
    { palabra: 'bicicleta', pista: 'Tiene dos ruedas y pedales.' },
    { palabra: 'ventana', pista: 'Por ahí entra la luz al cuarto.' },
    { palabra: 'montaña', pista: 'Es muy alta y hay que subirla.' },
    { palabra: 'cuaderno', pista: 'Ahí escribes lo que te enseñan.' },
    { palabra: 'mariposa', pista: 'Antes fue oruga y ahora vuela con colores.' },
    { palabra: 'biblioteca', pista: 'Está llena de libros y hay que hablar bajito.' },
    { palabra: 'hospital', pista: 'Ahí trabajan los médicos y curan a la gente.' },
    { palabra: 'semilla', pista: 'Se siembra en la tierra y de ella nace una planta.' },
    { palabra: 'tormenta', pista: 'Trae lluvia fuerte, truenos y relámpagos.' },
    { palabra: 'cocina', pista: 'El cuarto de la casa donde se prepara la comida.' },
    { palabra: 'elefante', pista: 'Es enorme, gris y tiene trompa.' },
    { palabra: 'peluche', pista: 'Es un muñeco suave para abrazar.' },
    { palabra: 'calendario', pista: 'Ahí se ven los días y los meses del año.' }
  ]
};

// Ortografía: SOLO palabras donde las opciones equivocadas no existen en
// español. Las parejas que sí existen las dos —vaya y valla, echo y hecho— no
// van aquí: en «¿cuál está bien escrita?» todas estarían bien escritas y la
// pregunta tendría cuatro respuestas correctas. Esas viven en HOMOFONOS, con
// una frase que decide cuál toca.
const SPELLING = {
  2: [
    { ok: 'hacer', bad: ['aser', 'acer', 'haser'], why: 'Lleva h muda al inicio, y c antes de e.' },
    { ok: 'había', bad: ['abía', 'havía', 'habia'], why: 'Viene de haber: h muda, y tilde en la í porque rompe el diptongo.' },
    { ok: 'bicicleta', bad: ['bisicleta', 'vicicleta', 'bicecleta'], why: 'Con b al inicio y c en las dos sílabas siguientes.' },
    { ok: 'hombre', bad: ['ombre', 'honbre', 'onbre'], why: 'H muda al inicio, y antes de b siempre va m, nunca n.' },
    { ok: 'llave', bad: ['yave', 'llabe', 'yabe'], why: 'Con ll al principio y con v al final.' },
    { ok: 'cabeza', bad: ['caveza', 'cabesa', 'kabesa'], why: 'Con b y con z, aunque la z suene igual que la s.' },
    { ok: 'invierno', bad: ['imbierno', 'inbierno', 'imvierno'], why: 'Antes de v va n; la m solo va antes de b y de p.' },
    { ok: 'gigante', bad: ['jigante', 'gigantte', 'giganje'], why: 'Con g, que antes de i suena como j.' },
    { ok: 'bosque', bad: ['vosque', 'bosqe', 'boske'], why: 'Con b, y el sonido /k/ antes de e se escribe qu.' }
  ],
  3: [
    { ok: 'también', bad: ['tambien', 'tanbien', 'tanvien'], why: 'Antes de b va m, y es aguda terminada en n: lleva tilde.' },
    { ok: 'excelente', bad: ['ecelente', 'exelente', 'escelente'], why: 'Se escribe con x seguida de c.' },
    { ok: 'absorber', bad: ['absorver', 'abzorber', 'asorber'], why: 'Las dos con b, aunque la segunda suene igual que una v.' },
    { ok: 'prohibido', bad: ['proibido', 'proivido', 'prohivido'], why: 'Lleva una h muda en medio y termina con b, no con v.' },
    { ok: 'atravesar', bad: ['atrabesar', 'atravezar', 'atrabezar'], why: 'Con v en medio y con s al final.' },
    { ok: 'exuberante', bad: ['exuverante', 'esuberante', 'exhuberante'], why: 'Con x y con b, y sin h: la h de «exhibir» aquí no va.' },
    { ok: 'inyección', bad: ['inllección', 'injección', 'inyecsión'], why: 'Con y, y la terminación -ción siempre con c.' },
    { ok: 'sugerencia', bad: ['sujerencia', 'sugerensia', 'sujerensia'], why: 'Con g, que antes de e suena como j, y con c en -cia.' },
    { ok: 'ejercicio', bad: ['ejersicio', 'egercicio', 'ejercisio'], why: 'Con j, y las dos c de -cicio.' }
  ],
  4: [
    { ok: 'excepción', bad: ['ecepción', 'exepción', 'excepsión'], why: 'Lleva xc y termina en -ción, con c.' },
    { ok: 'idiosincrasia', bad: ['idiosincracia', 'ideosincrasia', 'idiosincrazia'], why: 'Termina en -asia, con s: es de las pocas que no llevan c.' },
    { ok: 'transgredir', bad: ['tranzgredir', 'transgrredir', 'trasgedir'], why: 'Con s en el prefijo trans- y una sola r.' },
    { ok: 'inhóspito', bad: ['inospito', 'inóspito', 'inhospito'], why: 'Con h muda en medio, y es esdrújula: lleva tilde sí o sí.' },
    { ok: 'subrepticio', bad: ['surrepticio', 'subrreticio', 'subreptisio'], why: 'Del prefijo sub-, y con c en la terminación -icio.' },
    { ok: 'exhaustivo', bad: ['exaustivo', 'ehaustivo', 'exhaustibo'], why: 'Lleva x y h juntas: ex-h-austivo.' },
    { ok: 'vicisitud', bad: ['visisitud', 'vicicitud', 'bicisitud'], why: 'Empieza con v y alterna c y s: vi-ci-si-tud.' },
    { ok: 'concienzudo', bad: ['conciensudo', 'conzienzudo', 'consienzudo'], why: 'Con c en «con-cien» y con z antes de la u.' }
  ]
};

// Homófonos: suenan igual y las dos formas existen, así que la pregunta NO
// puede ser «cuál está bien escrita» —lo están todas—. Aquí hay una frase, y
// la frase es la que decide cuál toca. Es el ejercicio de ortografía que de
// verdad se falla en un examen.
const HOMOFONOS = {
  3: [
    { q: 'Espero que te ___ bien en el examen.', ok: 'vaya', bad: ['valla', 'baya', 'balla'], why: 'Vaya es del verbo ir. Valla es una cerca y baya es un fruto pequeño.' },
    { q: 'No fui a clase ___ estaba enfermo.', ok: 'porque', bad: ['por que', 'porqué', 'por qué'], why: 'Junto y sin tilde cuando responde a una causa.' },
    { q: '¿___ no viniste ayer?', ok: 'Por qué', bad: ['Porque', 'Porqué', 'Por que'], why: 'Separado y con tilde cuando pregunta.' },
    { q: 'Ya está ___ el trabajo que nos dejaron.', ok: 'hecho', bad: ['echo', 'echó', 'heche'], why: 'Hecho viene de hacer; echo viene de echar.' },
    { q: 'Vamos ___ qué dice la profesora.', ok: 'a ver', bad: ['haber', 'aver', 'a haber'], why: 'A ver es mirar. Haber es el verbo: «tiene que haber una razón».' },
    { q: 'El ___ del agua se rompió anoche.', ok: 'tubo', bad: ['tuvo', 'tubbo', 'tuvó'], why: 'Tubo es el cilindro; tuvo es del verbo tener.' },
    { q: 'No ___ nadie en el salón.', ok: 'hay', bad: ['ahí', 'ay', 'hai'], why: 'Hay es del verbo haber; ahí es un lugar y ay es una queja.' }
  ],
  4: [
    { q: 'Ojalá ___ suficiente comida para todos.', ok: 'haya', bad: ['halla', 'aya', 'allá'], why: 'Haya es del verbo haber. Halla es de hallar (encontrar) y allá es un lugar.' },
    { q: 'No quiero café ___ té.', ok: 'sino', bad: ['si no', 'sinó', 'si nó'], why: 'Sino junto contrapone. Si no separado es una condición: «si no vienes, empezamos».' },
    { q: 'Cantas ___ que deberías grabar un disco.', ok: 'tan bien', bad: ['también', 'tanbien', 'tan bién'], why: 'Tan bien separado mide cuánto. También junto es «además».' },
    { q: 'Nadie entendió el ___ de su renuncia.', ok: 'porqué', bad: ['porque', 'por qué', 'por que'], why: 'Con tilde y junto es un sustantivo: el motivo. Lleva artículo delante.' },
    { q: 'Se lo dije ___ no me creyó.', ok: 'mas', bad: ['más', 'màs', 'mass'], why: 'Mas sin tilde equivale a «pero». Más con tilde es cantidad.' },
    { q: 'Lo dejó ___ de la puerta, en el suelo.', ok: 'delante', bad: ['de lante', 'delanté', 'dellante'], why: 'Se escribe en una sola palabra y sin tilde: es grave terminada en vocal.' },
    { q: 'La razón ___ me expulsaron nunca se aclaró.', ok: 'por que', bad: ['porque', 'porqué', 'por qué'], why: 'Separado y sin tilde cuando equivale a «por la cual».' }
  ]
};

const SYNONYMS = {
  2: [
    { word: 'veloz', ok: 'rápido', bad: ['lento', 'pesado', 'quieto'] },
    { word: 'alegre', ok: 'contento', bad: ['triste', 'enojado', 'aburrido'] },
    { word: 'enorme', ok: 'gigante', bad: ['diminuto', 'estrecho', 'liviano'] },
    { word: 'bonito', ok: 'hermoso', bad: ['feo', 'sucio', 'viejo'] },
    { word: 'difícil', ok: 'complicado', bad: ['sencillo', 'corto', 'barato'] },
    { word: 'empezar', ok: 'comenzar', bad: ['terminar', 'romper', 'guardar'] },
    { word: 'mirar', ok: 'observar', bad: ['escuchar', 'hablar', 'correr'] },
    { word: 'listo', ok: 'inteligente', bad: ['torpe', 'callado', 'alto'] }
  ],
  3: [
    { word: 'sabio', ok: 'culto', bad: ['torpe', 'distraído', 'ingenuo'] },
    { word: 'valiente', ok: 'audaz', bad: ['cobarde', 'prudente', 'tímido'] },
    { word: 'escaso', ok: 'insuficiente', bad: ['abundante', 'costoso', 'lejano'] },
    { word: 'obstinado', ok: 'terco', bad: ['flexible', 'alegre', 'generoso'] },
    { word: 'minucioso', ok: 'detallado', bad: ['descuidado', 'rápido', 'ruidoso'] },
    { word: 'sereno', ok: 'tranquilo', bad: ['nervioso', 'ruidoso', 'apurado'] },
    { word: 'adversario', ok: 'rival', bad: ['aliado', 'testigo', 'vecino'] },
    { word: 'anhelar', ok: 'desear', bad: ['rechazar', 'olvidar', 'temer'] }
  ],
  4: [
    { word: 'efímero', ok: 'pasajero', bad: ['eterno', 'sólido', 'enorme'] },
    { word: 'perspicaz', ok: 'astuto', bad: ['ingenuo', 'callado', 'amable'] },
    { word: 'inefable', ok: 'indescriptible', bad: ['evidente', 'común', 'ruidoso'] },
    { word: 'exiguo', ok: 'escaso', bad: ['cuantioso', 'exacto', 'exigente'] },
    { word: 'pertinaz', ok: 'persistente', bad: ['fugaz', 'pertinente', 'dócil'] },
    { word: 'conciso', ok: 'breve', bad: ['extenso', 'confuso', 'preciso'] },
    { word: 'ecuánime', ok: 'imparcial', bad: ['arbitrario', 'entusiasta', 'idéntico'] },
    { word: 'vehemente', ok: 'apasionado', bad: ['indiferente', 'violento', 'vacilante'] }
  ]
};

const ANTONYMS = {
  2: [
    { word: 'grande', ok: 'pequeño', bad: ['ancho', 'gordo', 'largo'] },
    { word: 'lleno', ok: 'vacío', bad: ['pesado', 'abierto', 'nuevo'] },
    { word: 'rápido', ok: 'lento', bad: ['fuerte', 'corto', 'ligero'] },
    { word: 'duro', ok: 'blando', bad: ['frío', 'seco', 'pesado'] },
    { word: 'encender', ok: 'apagar', bad: ['calentar', 'guardar', 'abrir'] },
    { word: 'temprano', ok: 'tarde', bad: ['pronto', 'ayer', 'rápido'] }
  ],
  3: [
    { word: 'generoso', ok: 'tacaño', bad: ['amable', 'alegre', 'sincero'] },
    { word: 'escaso', ok: 'abundante', bad: ['pequeño', 'barato', 'lejano'] },
    { word: 'humilde', ok: 'soberbio', bad: ['sencillo', 'tranquilo', 'pobre'] },
    { word: 'valiente', ok: 'cobarde', bad: ['prudente', 'fuerte', 'sereno'] },
    { word: 'claro', ok: 'confuso', bad: ['brillante', 'sencillo', 'limpio'] },
    { word: 'culpable', ok: 'inocente', bad: ['acusado', 'sospechoso', 'castigado'] }
  ],
  4: [
    { word: 'efímero', ok: 'perpetuo', bad: ['veloz', 'frágil', 'raro'] },
    { word: 'austero', ok: 'ostentoso', bad: ['severo', 'sobrio', 'honesto'] },
    { word: 'cauto', ok: 'temerario', bad: ['astuto', 'sereno', 'reservado'] },
    { word: 'afable', ok: 'hosco', bad: ['amable', 'discreto', 'sociable'] },
    { word: 'sutil', ok: 'burdo', bad: ['delicado', 'leve', 'ingenioso'] },
    { word: 'prolífico', ok: 'estéril', bad: ['famoso', 'extenso', 'profundo'] }
  ]
};

const RHYMES = {
  1: [
    { word: 'gato', ok: 'pato', bad: ['perro', 'casa', 'sol'] },
    { word: 'flor', ok: 'color', bad: ['árbol', 'nube', 'pez'] },
    { word: 'ratón', ok: 'balón', bad: ['queso', 'mesa', 'lápiz'] },
    { word: 'luna', ok: 'cuna', bad: ['sol', 'estrella', 'noche'] },
    { word: 'pelota', ok: 'gota', bad: ['juego', 'patio', 'niño'] }
  ],
  2: [
    { word: 'ventana', ok: 'campana', bad: ['puerta', 'vidrio', 'cortina'] },
    { word: 'camino', ok: 'molino', bad: ['sendero', 'viaje', 'carreta'] },
    { word: 'sombrero', ok: 'sendero', bad: ['gorra', 'cabeza', 'verano'] },
    { word: 'canción', ok: 'corazón', bad: ['música', 'letra', 'cantante'] }
  ]
};

// Oraciones para ordenar, cada vez más largas. Se eligen a propósito con un
// orden claramente natural (sujeto, verbo, complementos): en español casi
// siempre se puede adelantar un complemento y seguir siendo correcto, así que
// una oración que admita dos órdenes igual de buenos no sirve para este reto.
const ORACIONES = {
  2: [
    ['El', 'gato', 'duerme', 'sobre', 'la', 'mesa'],
    ['Mi', 'hermana', 'riega', 'las', 'plantas'],
    ['Los', 'niños', 'juegan', 'en', 'el', 'patio']
  ],
  3: [
    ['Mañana', 'entregamos', 'el', 'informe', 'de', 'ciencias'],
    ['La', 'profesora', 'explicó', 'el', 'tema', 'con', 'calma'],
    ['Robin', 'siempre', 'responde', 'cuando', 'le', 'preguntas'],
    ['El', 'equipo', 'ganó', 'el', 'partido', 'sin', 'mucho', 'esfuerzo']
  ],
  4: [
    ['La', 'reunión', 'se', 'aplazó', 'porque', 'faltaba', 'la', 'mitad', 'del', 'grupo'],
    ['Nadie', 'sabía', 'que', 'el', 'examen', 'incluía', 'el', 'último', 'capítulo'],
    ['El', 'científico', 'publicó', 'sus', 'resultados', 'después', 'de', 'diez', 'años']
  ]
};

// Acentuación: se elige cuál de las cuatro está bien acentuada. Las tres malas
// llevan la tilde donde no va, o le falta.
const TILDES = {
  2: [
    { ok: 'árbol', bad: ['arbol', 'arból', 'àrbol'], why: 'Grave que NO termina en n, s ni vocal: lleva tilde.' },
    { ok: 'camión', bad: ['camion', 'cámion', 'camiòn'], why: 'Aguda terminada en n: lleva tilde.' },
    { ok: 'lápiz', bad: ['lapiz', 'lapíz', 'làpiz'], why: 'Grave terminada en z: lleva tilde.' },
    { ok: 'examen', bad: ['exámen', 'examén', 'exàmen'], why: 'Grave terminada en n: NO lleva tilde.' },
    { ok: 'reloj', bad: ['relój', 'réloj', 'relòj'], why: 'Aguda terminada en j: no lleva tilde.' },
    { ok: 'joven', bad: ['jóven', 'jovén', 'jovèn'], why: 'Grave terminada en n: no lleva tilde. Pero su plural, jóvenes, sí.' }
  ],
  3: [
    { ok: 'cántaro', bad: ['cantaro', 'cantáro', 'cantarò'], why: 'Es esdrújula: todas llevan tilde, sin excepción.' },
    { ok: 'compás', bad: ['compas', 'cómpas', 'compàs'], why: 'Aguda terminada en s: lleva tilde.' },
    { ok: 'útil', bad: ['util', 'utíl', 'ùtil'], why: 'Grave terminada en l: lleva tilde.' },
    { ok: 'imagen', bad: ['imágen', 'imagén', 'imàgen'], why: 'Grave terminada en n: no lleva tilde. El plural, imágenes, sí.' },
    { ok: 'química', bad: ['quimica', 'quimíca', 'químíca'], why: 'Esdrújula: siempre con tilde.' },
    { ok: 'volumen', bad: ['volúmen', 'volumén', 'vólumen'], why: 'Grave terminada en n: sin tilde.' }
  ],
  4: [
    { ok: 'increíble', bad: ['increible', 'incréible', 'increíblé'], why: 'La í tónica rompe el diptongo: el hiato siempre lleva tilde.' },
    { ok: 'raíz', bad: ['raiz', 'ráiz', 'raìz'], why: 'Hiato de a + í: la vocal débil tónica lleva tilde aunque la regla general diga que no.' },
    { ok: 'búho', bad: ['buho', 'bùho', 'búhó'], why: 'La h no rompe el hiato: bú-ho lleva tilde igual.' },
    { ok: 'carácter', bad: ['caracter', 'carácterr', 'caractér'], why: 'Grave terminada en r: lleva tilde. Ojo: el plural es caracteres, sin tilde.' },
    { ok: 'régimen', bad: ['regimen', 'regímen', 'regimén'], why: 'Esdrújula. Y su plural es regímenes: la sílaba fuerte se mueve.' },
    { ok: 'decimoséptimo', bad: ['decimoseptimo', 'décimoséptimo', 'decimoseptímo'], why: 'Solo la última parte de la palabra compuesta conserva su tilde.' }
  ]
};

const FIGURAS = {
  3: [
    { q: '«Sus ojos son dos luceros». ¿Qué figura literaria es?', ok: 'Metáfora', bad: ['Símil', 'Hipérbole', 'Personificación'], hint: 'Dice que una cosa ES otra, sin usar «como».' },
    { q: '«Corre como el viento». ¿Qué figura literaria es?', ok: 'Símil', bad: ['Metáfora', 'Ironía', 'Metonimia'], hint: 'La palabra «como» es la pista: está comparando.' },
    { q: '«Te lo he dicho un millón de veces». ¿Qué figura literaria es?', ok: 'Hipérbole', bad: ['Metáfora', 'Símil', 'Elipsis'], hint: 'Exagera a propósito, muchísimo más de lo real.' },
    { q: '«El viento susurraba entre los árboles». ¿Qué figura literaria es?', ok: 'Personificación', bad: ['Hipérbole', 'Símil', 'Metáfora'], hint: 'Le da a algo que no está vivo una acción de persona.' }
  ],
  4: [
    { q: '«Un silencio ensordecedor llenó la sala». ¿Qué figura literaria es?', ok: 'Oxímoron', bad: ['Hipérbole', 'Antítesis', 'Paradoja'], hint: 'Junta en dos palabras seguidas dos ideas que se contradicen.' },
    { q: '«Aquí todo se sabe, aquí todo se cuenta, aquí todo se olvida». ¿Qué figura literaria es?', ok: 'Anáfora', bad: ['Aliteración', 'Elipsis', 'Hipérbaton'], hint: 'Se repite lo mismo al COMIENZO de cada parte.' },
    { q: '«Se tomó dos copas antes de irse». ¿Qué figura literaria hay en «copas»?', ok: 'Metonimia', bad: ['Metáfora', 'Símil', 'Sinestesia'], hint: 'Se nombra el recipiente para referirse a lo que había dentro.' },
    { q: '«El ruido con que rueda la ronca tempestad». ¿Qué figura literaria domina?', ok: 'Aliteración', bad: ['Anáfora', 'Hipérbole', 'Metáfora'], hint: 'Léela en voz alta y escucha qué sonido se repite una y otra vez.' },
    { q: '«Ayer naciste y morirás mañana». ¿Qué figura literaria es?', ok: 'Antítesis', bad: ['Oxímoron', 'Paradoja', 'Anáfora'], hint: 'Contrapone dos ideas opuestas en partes distintas de la frase, no pegadas en una.' },
    { q: '«Del salón en el ángulo oscuro… ». ¿Qué figura literaria es?', ok: 'Hipérbaton', bad: ['Elipsis', 'Anáfora', 'Metonimia'], hint: 'Las palabras están, pero en un orden que nadie usaría al hablar.' }
  ]
};

const CONECTORES = {
  3: [
    { q: 'Estudié toda la noche; ___, aprobé el examen.', ok: 'por lo tanto', bad: ['sin embargo', 'aunque', 'mientras'], hint: 'La segunda parte es la consecuencia de la primera.' },
    { q: 'Estudié toda la noche; ___, reprobé el examen.', ok: 'sin embargo', bad: ['por lo tanto', 'además', 'porque'], hint: 'La segunda parte contradice lo que se esperaba.' },
    { q: 'Trajo el cuaderno ___ olvidó el lápiz.', ok: 'pero', bad: ['porque', 'entonces', 'así que'], hint: 'Une dos cosas que se oponen.' },
    { q: 'Llegó tarde ___ el autobús se descompuso.', ok: 'porque', bad: ['aunque', 'pero', 'sin embargo'], hint: 'La segunda parte explica la causa de la primera.' },
    { q: 'Termina la tarea ___ podrás salir a jugar.', ok: 'y entonces', bad: ['aunque', 'sin embargo', 'no obstante'], hint: 'Lo segundo pasa después de lo primero, y gracias a ello.' }
  ],
  4: [
    { q: 'El informe estaba completo; ___, el comité lo rechazó.', ok: 'no obstante', bad: ['por consiguiente', 'en efecto', 'es decir'], hint: 'Introduce algo que va en contra de lo que se acaba de afirmar.' },
    { q: 'No presentó las pruebas; ___, el caso se cerró.', ok: 'por consiguiente', bad: ['no obstante', 'en cambio', 'aunque'], hint: 'Marca el resultado lógico de lo anterior.' },
    { q: 'La muestra era mínima; ___, los resultados no son concluyentes.', ok: 'en consecuencia', bad: ['a pesar de ello', 'por el contrario', 'igualmente'], hint: 'Lo segundo se deduce de lo primero.' },
    { q: 'El texto es breve; ___, dice más que muchos tratados.', ok: 'con todo', bad: ['por ende', 'asimismo', 'de ahí que'], hint: 'Concede lo anterior pero afirma lo contrario de lo esperado.' },
    { q: 'Hubo dos versiones del hecho; ___, ninguna pudo verificarse.', ok: 'ahora bien', bad: ['por lo tanto', 'además', 'en resumen'], hint: 'Introduce un matiz que limita lo que se acaba de decir.' }
  ]
};

// Peques: formar la palabra letra por letra.
function palabraRound(d) {
  const item = pick(porNivel(PALABRAS, d));
  const letras = item.palabra.split('');
  return build({
    prompt: `Forma la palabra: ${item.pista}`,
    lead: 'Toca las letras en orden. Sobran algunas.',
    answer: letras,
    extras: letrasDe(item.palabra, d <= 1 ? 2 : 3),
    join: '',
    hint: `Empieza por el sonido con el que arranca la palabra. Tiene ${letras.length} letras.`,
    steps: [
      'Di la palabra en voz alta, despacio.',
      'Escucha con qué sonido empieza y busca esa letra.',
      'Sigue sonido por sonido hasta el final; las letras que sobren no se usan.'
    ]
  });
}

function languageRound(d) {
  // Peques: casi siempre formar palabras. Es lo que toca practicar a esa edad
  // y repetirlo no aburre, porque la palabra cambia cada vez.
  if (d <= 1) return Math.random() < 0.7 ? palabraRound(d) : rimaRound(d);
  if (d === 2) {
    return pick([
      () => palabraRound(d), () => palabraRound(d),
      () => rimaRound(d), () => ortografiaRound(d),
      () => tildeRound(d), () => sinonimoRound(d),
      () => antonimoRound(d), () => oracionRound(d)
    ])();
  }

  // Grandes: ocho tipos distintos de reto, uno cada vez.
  const tipos = [ortografiaRound, sinonimoRound, antonimoRound, oracionRound,
                 tildeRound, conectorRound, homofonoRound, figuraRound];
  return pick(tipos)(d);
}

function rimaRound(d) {
  const item = pick(porNivel(RHYMES, d));
  return {
    kind: 'choice',
    prompt: `¿Cuál palabra rima con «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Rimar es terminar con el mismo sonido. Di las palabras en voz alta y escucha el final.',
    steps: [
      `Di «${item.word}» despacio y quédate con el sonido del final.`,
      'Ahora di cada opción en voz alta.',
      'La que termine igual es la que rima.'
    ]
  };
}

function ortografiaRound(d) {
  const item = pick(porNivel(SPELLING, d));
  return {
    kind: 'choice',
    prompt: '¿Cuál de estas palabras está bien escrita?',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Fíjate en la h, en la b/v, en la c/s/z y en las tildes. Una sola letra cambiada ya la vuelve incorrecta.',
    steps: [
      'Lee las cuatro opciones despacio, letra por letra.',
      'Descarta las que cambien una consonante que suena igual (b/v, s/c/z, g/j).',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

// Homófonos: la frase manda. Sin ella, las cuatro opciones estarían bien
// escritas y la pregunta no tendría UNA respuesta.
function homofonoRound(d) {
  const item = pick(porNivel(HOMOFONOS, d));
  return {
    kind: 'choice',
    prompt: `Completa: «${item.q}»`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Las cuatro suenan igual, así que el oído no sirve aquí: lo que decide es qué significa la frase.',
    steps: [
      'Lee la frase completa y di con tus palabras qué está queriendo decir.',
      'Piensa qué significa cada opción por separado; son palabras distintas aunque suenen igual.',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

function sinonimoRound(d) {
  const item = pick(porNivel(SYNONYMS, d));
  return {
    kind: 'choice',
    prompt: d >= 4
      ? `En la frase «su fama fue ${item.word}», ¿qué palabra la reemplaza sin cambiar el sentido?`
      : `¿Cuál es un sinónimo de «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Prueba metiendo cada opción en la frase. Si la frase cambia de significado, no es sinónimo.',
    steps: [
      `Explica con tus propias palabras qué significa «${item.word}».`,
      'Descarta las opciones que signifiquen lo contrario.',
      'De las que queden, elige la que podrías intercambiar sin que la frase suene rara.'
    ]
  };
}

function antonimoRound(d) {
  const item = pick(porNivel(ANTONYMS, d));
  return {
    kind: 'choice',
    prompt: `¿Cuál es lo CONTRARIO de «${item.word}»?`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Cuidado: entre las opciones hay sinónimos, que son la trampa. Buscas lo opuesto, no lo parecido.',
    steps: [
      `Di qué significa «${item.word}».`,
      'Descarta primero las que signifiquen algo parecido: esas son sinónimos.',
      'De las que quedan, la que se opone del todo es la respuesta.'
    ]
  };
}

function oracionRound(d) {
  const palabras = pick(porNivel(ORACIONES, d));
  return build({
    prompt: 'Ordena las palabras para formar la oración más natural.',
    lead: 'Toca las palabras en el orden en que las dirías.',
    answer: palabras,
    hint: 'En español lo normal es sujeto, después verbo y al final el resto. Empieza buscando quién hace la acción.',
    steps: [
      'Busca el verbo: es la acción de la oración.',
      'Busca quién la hace: ese es el sujeto y va primero.',
      'Lo que queda completa la acción y va al final.'
    ]
  });
}

function tildeRound(d) {
  const item = pick(porNivel(TILDES, d));
  return {
    kind: 'choice',
    prompt: '¿Cuál de estas está bien acentuada?',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Di la palabra en voz alta y localiza la sílaba que suena más fuerte. Después aplica la regla de agudas, graves y esdrújulas.',
    steps: [
      'Separa la palabra en sílabas y marca cuál suena más fuerte.',
      'Si la fuerte es la última es aguda; la penúltima, grave; la antepenúltima, esdrújula.',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

function conectorRound(d) {
  const item = pick(porNivel(CONECTORES, d));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee las dos mitades de la frase por separado.',
      '¿La segunda es consecuencia de la primera, o la contradice?',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function figuraRound(d) {
  const item = pick(porNivel(FIGURAS, d));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la frase y pregúntate si lo que dice puede ser literal.',
      'Si compara con «como», es símil; si dice que una cosa es otra, metáfora.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Ciencias --------------------------------------------------------------

const SCIENCE = {
  1: [
    { q: '¿Cuál de estos está vivo?', ok: 'Un árbol', bad: ['Una piedra', 'Una silla', 'Un lápiz'], hint: 'Lo que está vivo crece, come o respira.' },
    { q: '¿Qué necesitan las plantas para crecer?', ok: 'Agua y luz del sol', bad: ['Arena y viento', 'Solo piedras', 'Oscuridad'], hint: 'Piensa en lo que le das a una planta en casa.' },
    { q: '¿Dónde vive un pez?', ok: 'En el agua', bad: ['En el aire', 'Bajo la tierra', 'En el fuego'], hint: 'Fíjate cómo respira: tiene branquias, no pulmones.' },
    { q: '¿Con qué parte del cuerpo hueles?', ok: 'La nariz', bad: ['La oreja', 'La mano', 'El codo'], hint: 'Es la que está en medio de la cara.' },
    { q: 'Si dejas un hielo al sol, ¿qué le pasa?', ok: 'Se derrite y se vuelve agua', bad: ['Se pone más duro', 'Se vuelve piedra', 'No le pasa nada'], hint: 'El calor ablanda el hielo hasta que deja de ser sólido.' },
    { q: '¿Cuál de estos animales pone huevos?', ok: 'La gallina', bad: ['El perro', 'El gato', 'La vaca'], hint: 'Piensa de dónde salen los pollitos.' },
    { q: 'Cuando llueve, ¿qué cae del cielo?', ok: 'Agua', bad: ['Arena', 'Tierra', 'Hojas'], hint: 'Es lo mismo que sale del grifo.' },
    { q: '¿Qué nos da luz y calor durante el día?', ok: 'El Sol', bad: ['La Luna', 'Las nubes', 'Las estrellas de noche'], hint: 'Aparece por la mañana y se esconde por la tarde.' },
    { q: '¿Cuántas patas tiene un insecto como la hormiga?', ok: 'Seis', bad: ['Cuatro', 'Ocho', 'Dos'], hint: 'Cuéntalas de tres en tres: tres de cada lado.' }
  ],
  2: [
    { q: '¿Cómo se llama el paso del agua de líquido a gas?', ok: 'Evaporación', bad: ['Condensación', 'Solidificación', 'Filtración'], hint: 'Es lo que pasa cuando hierve el agua y sube el vapor.' },
    { q: '¿Cómo se llama el paso del agua de gas a líquido?', ok: 'Condensación', bad: ['Evaporación', 'Fusión', 'Sublimación'], hint: 'Son las gotitas que aparecen en el vidrio frío de un vaso.' },
    { q: '¿Qué órgano bombea la sangre por todo el cuerpo?', ok: 'El corazón', bad: ['El pulmón', 'El hígado', 'El estómago'], hint: 'Es el que late y puedes escuchar en el pecho.' },
    { q: '¿Qué parte de la planta absorbe el agua del suelo?', ok: 'La raíz', bad: ['La hoja', 'El tallo', 'La flor'], hint: 'Es la parte que no se ve, la que está enterrada.' },
    { q: '¿Cuántos planetas tiene el sistema solar?', ok: 'Ocho', bad: ['Nueve', 'Siete', 'Doce'], hint: 'Desde 2006 Plutón dejó de contarse como planeta.' },
    { q: '¿Qué hueso protege el cerebro?', ok: 'El cráneo', bad: ['Las costillas', 'La columna', 'El fémur'], hint: 'Es la caja dura que tienes en la cabeza.' },
    { q: '¿Qué tienen en común el perro, el delfín y el murciélago?', ok: 'Los tres son mamíferos', bad: ['Los tres viven en el agua', 'Los tres ponen huevos', 'Los tres vuelan'], hint: 'Piensa en cómo alimentan a sus crías cuando nacen.' },
    { q: '¿Qué materiales atrae un imán?', ok: 'Los que tienen hierro', bad: ['La madera', 'El plástico', 'El vidrio'], hint: 'Prueba mentalmente con un clavo y con un lápiz.' },
    { q: 'En una cadena alimenticia, las plantas son…', ok: 'Productoras: fabrican su propio alimento', bad: ['Consumidoras', 'Descomponedoras', 'Depredadoras'], hint: 'Son las únicas que no necesitan comerse a nadie.' }
  ],
  3: [
    { q: '¿Qué gas usan las plantas en la fotosíntesis?', ok: 'Dióxido de carbono', bad: ['Oxígeno', 'Nitrógeno', 'Hidrógeno'], hint: 'Es el gas que nosotros soltamos al exhalar.' },
    { q: '¿Cuál es la unidad básica de todos los seres vivos?', ok: 'La célula', bad: ['El átomo', 'El tejido', 'La molécula'], hint: 'Es lo más pequeño que todavía está vivo por sí mismo.' },
    { q: 'Si empujas algo y no se mueve, ¿qué fuerza lo frena contra el suelo?', ok: 'La fricción', bad: ['La gravedad', 'El magnetismo', 'La inercia'], hint: 'Piensa por qué cuesta más arrastrar una caja sobre alfombra que sobre hielo.' },
    { q: '¿Qué partícula del átomo tiene carga negativa?', ok: 'El electrón', bad: ['El protón', 'El neutrón', 'El núcleo'], hint: 'Es la que gira por fuera, no la que está en el centro.' },
    { q: '¿Qué organelo de la célula produce la energía?', ok: 'La mitocondria', bad: ['El ribosoma', 'El núcleo', 'La vacuola'], hint: 'La llaman «la central eléctrica» de la célula.' },
    { q: '¿Qué vaso lleva la sangre desde el corazón hacia el resto del cuerpo?', ok: 'La arteria', bad: ['La vena', 'El capilar', 'El nervio'], hint: 'Las venas hacen justo lo contrario: traen la sangre de vuelta.' },
    { q: '¿Qué es la densidad de un material?', ok: 'Su masa dividida entre su volumen', bad: ['Su peso total', 'Lo duro que es', 'Cuánto espacio ocupa'], hint: 'Explica por qué un kilo de plomo y un kilo de plumas no ocupan lo mismo.' },
    { q: '¿Qué gas es el más abundante en la atmósfera de la Tierra?', ok: 'Nitrógeno', bad: ['Oxígeno', 'Dióxido de carbono', 'Hidrógeno'], hint: 'No es el que respiramos: ese es solo una quinta parte del aire.' },
    { q: 'En la montaña el agua hierve antes que a nivel del mar. ¿Por qué?', ok: 'Porque hay menos presión atmosférica', bad: ['Porque hace más frío', 'Porque el agua está más limpia', 'Porque hay menos oxígeno'], hint: 'Cuanto menos aire empuja hacia abajo, más fácil le resulta al agua convertirse en vapor.' },
    { q: '¿Qué tipo de roca se forma al enfriarse el magma?', ok: 'Ígnea', bad: ['Sedimentaria', 'Metamórfica', 'Caliza'], hint: 'El nombre viene de «ignis», que en latín es fuego.' }
  ],
  4: [
    { q: 'En F = m·a, si la masa se duplica y la fuerza no cambia, ¿qué pasa con la aceleración?', ok: 'Se reduce a la mitad', bad: ['Se duplica', 'No cambia', 'Se hace cuatro veces mayor'], hint: 'Despeja a = F/m y mira qué le pasa al cociente cuando el de abajo crece.' },
    { q: '¿Qué enlace se forma cuando dos átomos comparten electrones?', ok: 'Covalente', bad: ['Iónico', 'Metálico', 'Puente de hidrógeno'], hint: 'Compartir, no ceder. El que cede electrones es el otro tipo.' },
    { q: '¿En qué fase de la mitosis se alinean los cromosomas en el centro de la célula?', ok: 'Metafase', bad: ['Profase', 'Anafase', 'Telofase'], hint: 'El prefijo «meta» te dice que va justo en medio del proceso.' },
    { q: 'En el ADN, ¿con qué base se aparea siempre la adenina?', ok: 'Timina', bad: ['Citosina', 'Guanina', 'Uracilo'], hint: 'A con T y C con G. El uracilo solo aparece en el ARN.' },
    { q: 'Al caminar empujas el suelo hacia atrás y el suelo te empuja hacia adelante. ¿Qué ley es?', ok: 'La tercera ley de Newton', bad: ['La primera ley de Newton', 'La segunda ley de Newton', 'La ley de la gravitación'], hint: 'Es la de acción y reacción: fuerzas iguales y en sentido contrario.' },
    { q: 'Una disolución con pH 3 es…', ok: 'Ácida', bad: ['Básica', 'Neutra', 'Salina'], hint: 'El 7 es el neutro. Por debajo, ácido; por encima, base.' },
    { q: 'Al cruzar dos individuos Aa × Aa, ¿qué proporción de fenotipos sale?', ok: '3 dominantes por 1 recesivo', bad: ['1 por 1', '2 por 2', 'Todos dominantes'], hint: 'Arma el cuadro de Punnett: salen AA, Aa, aA y aa.' },
    { q: 'La primera ley de la termodinámica dice que la energía…', ok: 'No se crea ni se destruye, solo se transforma', bad: ['Siempre aumenta', 'Siempre se pierde como calor', 'Se puede crear con trabajo'], hint: 'Es la conservación de la energía aplicada al calor y al trabajo.' },
    { q: '¿Cuántas partículas hay en un mol de cualquier sustancia?', ok: '6,022 × 10²³', bad: ['3,14 × 10⁸', '9,8 × 10¹⁰', '1,6 × 10⁻¹⁹'], hint: 'Es el número de Avogadro, y vale lo mismo para átomos que para moléculas.' },
    { q: 'En una reacción química, la masa total de los productos…', ok: 'Es igual a la de los reactivos', bad: ['Siempre es menor', 'Siempre es mayor', 'Depende de la temperatura'], hint: 'Es la ley de conservación de la masa, de Lavoisier: nada se pierde.' }
  ]
};

// El laboratorio: hay un frasco vacío y un montón de ingredientes, y hay que
// meter los DOS que dan lo que se pide. El orden da igual —sodio con cloro es
// lo mismo que cloro con sodio—, así que el reto es saber qué reacciona con
// qué, no en qué orden se escribe.
//
// Abajo son mezclas y cambios de estado que se ven en casa; de tercero en
// adelante son compuestos y reacciones de verdad, con su fórmula. Lo que NO
// hay son fusiones inventadas: si la mezcla no ocurre fuera de la pantalla, no
// enseña nada.
const FUSIONES = {
  1: [
    { sale: 'lodo', con: ['tierra', 'agua'], sobran: ['piedra', 'hoja', 'aire'], pista: 'Piensa en lo que se hace en el patio cuando llueve.' },
    { sale: 'una planta', con: ['semilla', 'agua'], sobran: ['piedra', 'arena', 'hielo'], pista: 'Algo que se siembra más algo que se riega.' },
    { sale: 'hielo', con: ['agua', 'frío'], sobran: ['fuego', 'viento', 'tierra'], pista: '¿Qué le tiene que pasar al agua para ponerse dura?' },
    { sale: 'humo y ceniza', con: ['fuego', 'madera'], sobran: ['agua', 'hielo', 'arena'], pista: 'Lo que queda y lo que sube de una fogata.' },
    { sale: 'una sombra', con: ['luz', 'un objeto'], sobran: ['agua', 'ruido', 'viento'], pista: 'Hace falta algo que alumbre y algo que tape esa luz.' }
  ],
  2: [
    { sale: 'vapor de agua', con: ['agua', 'calor'], sobran: ['frío', 'sal', 'tierra'], pista: 'Es lo que sale de la olla cuando hierve.' },
    { sale: 'agua líquida', con: ['hielo', 'calor'], sobran: ['frío', 'vapor', 'aire'], pista: 'Fusión se llama justo a este cambio de estado.' },
    { sale: 'agua salada', con: ['agua', 'sal'], sobran: ['aceite', 'arena', 'azúcar'], pista: 'Una se disuelve en la otra y ya no se ve.' },
    { sale: 'gotas en el vidrio (condensación)', con: ['vapor de agua', 'una superficie fría'], sobran: ['calor', 'sal', 'viento'], pista: 'El vapor se enfría de golpe y vuelve a ser líquido.' },
    { sale: 'oxígeno (fotosíntesis)', con: ['luz del sol', 'dióxido de carbono'], sobran: ['oxígeno', 'nitrógeno', 'oscuridad'], pista: 'La planta necesita luz y el gas que nosotros exhalamos.' },
    { sale: 'una mezcla que NO se disuelve', con: ['agua', 'aceite'], sobran: ['sal', 'azúcar', 'calor'], pista: 'Por más que la agites, al rato se vuelven a separar en dos capas.' }
  ],
  3: [
    { sale: 'agua (H₂O)', con: ['hidrógeno', 'oxígeno'], sobran: ['carbono', 'nitrógeno', 'sodio'], pista: 'La fórmula te dice los dos elementos: H y O.' },
    { sale: 'sal de mesa (NaCl)', con: ['sodio', 'cloro'], sobran: ['potasio', 'oxígeno', 'calcio'], pista: 'Na y Cl. Uno cede un electrón y el otro lo toma.' },
    { sale: 'dióxido de carbono (CO₂)', con: ['carbono', 'oxígeno'], sobran: ['hidrógeno', 'azufre', 'hierro'], pista: 'C y O: lo que sueltas al exhalar.' },
    { sale: 'óxido de hierro (herrumbre)', con: ['hierro', 'oxígeno'], sobran: ['cloro', 'sodio', 'nitrógeno'], pista: 'Es lo que le pasa a un clavo mojado con el tiempo.' },
    { sale: 'metano (CH₄)', con: ['carbono', 'hidrógeno'], sobran: ['oxígeno', 'nitrógeno', 'azufre'], pista: 'C y H: el gas de la cocina y el de los pantanos.' },
    { sale: 'ácido clorhídrico (HCl)', con: ['hidrógeno', 'cloro'], sobran: ['sodio', 'oxígeno', 'calcio'], pista: 'H y Cl. Es el ácido que tu propio estómago fabrica.' },
    { sale: 'amoníaco (NH₃)', con: ['nitrógeno', 'hidrógeno'], sobran: ['oxígeno', 'cloro', 'carbono'], pista: 'N y H, en el proceso de Haber-Bosch con el que se hacen los fertilizantes.' }
  ],
  4: [
    { sale: 'una sal y agua', con: ['un ácido', 'una base'], sobran: ['un metal noble', 'un gas inerte', 'agua destilada'], pista: 'Se llama reacción de neutralización.' },
    { sale: 'dióxido de carbono y agua (combustión)', con: ['metano', 'oxígeno'], sobran: ['nitrógeno', 'helio', 'agua'], pista: 'Es lo que sale al quemar del todo un hidrocarburo.' },
    { sale: 'etanol y CO₂ (fermentación)', con: ['glucosa', 'levadura'], sobran: ['oxígeno', 'sal', 'ácido sulfúrico'], pista: 'Sin oxígeno, el azúcar y el hongo hacen cerveza y pan.' },
    { sale: 'ATP, CO₂ y agua (respiración celular)', con: ['glucosa', 'oxígeno'], sobran: ['nitrógeno', 'luz del sol', 'clorofila'], pista: 'Es justo lo contrario de la fotosíntesis, y pasa en la mitocondria.' },
    { sale: 'jabón (saponificación)', con: ['una grasa', 'hidróxido de sodio'], sobran: ['un ácido fuerte', 'alcohol', 'agua salada'], pista: 'Una base fuerte rompe la grasa: es como se hace el jabón desde hace siglos.' },
    { sale: 'hidrógeno gaseoso y una sal', con: ['un metal activo', 'un ácido'], sobran: ['un gas noble', 'una base', 'agua destilada'], pista: 'Es la reacción que burbujea al echar zinc en ácido clorhídrico.' }
  ]
};

function fusionRound(d) {
  const item = pick(porNivel(FUSIONES, d));
  return build({
    prompt: `Fusión: mete en el frasco los DOS ingredientes que dan ${item.sale}.`,
    lead: 'El orden da igual. Sobran ingredientes que no sirven aquí.',
    answer: item.con,
    extras: item.sobran,
    unordered: true,
    hint: item.pista,
    steps: [
      `Lee otra vez qué tiene que salir: ${item.sale}.`,
      'Descarta los ingredientes que no tienen nada que ver con eso.',
      `Pista de Robin: ${item.pista}`
    ]
  });
}

function scienceRound(d) {
  // Más o menos la mitad de las veces se juega al laboratorio de fusiones, que
  // es lo que le da cara propia a la materia; el resto son preguntas de
  // siempre, para que no se vuelva un solo mecanismo repetido.
  if (Math.random() < 0.5) return fusionRound(d);

  const item = pick(porNivel(SCIENCE, d));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la pregunta otra vez y subraya la palabra clave.',
      'Descarta las opciones que sabes seguro que no son.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Estudios Sociales -----------------------------------------------------
// Tres cosas, mezcladas: dónde están las cosas (geografía), qué pasó y cuándo
// (historia) y cómo se organiza la gente (civismo y economía). Las fechas
// llevan el año escrito dentro de la opción a propósito: el reto es situarlas
// unas respecto a otras, no recitarlas de memoria.

const SOCIAL = {
  1: [
    { q: '¿Quién nos ayuda cuando hay un incendio?', ok: 'Los bomberos', bad: ['El panadero', 'El cartero', 'El pintor'], hint: 'Piensa en quién llega en el camión rojo.' },
    { q: '¿Cómo se llama el lugar donde vives con tu familia?', ok: 'El hogar', bad: ['La escuela', 'El parque', 'El mercado'], hint: 'Es el lugar donde duermes cada noche.' },
    { q: 'En un semáforo, ¿qué significa la luz roja?', ok: 'Hay que detenerse', bad: ['Se puede pasar', 'Hay que correr', 'Se puede girar'], hint: 'Es la que está más arriba, y nadie debe pasar con ella.' },
    { q: '¿A quién llamas si te pierdes en la calle?', ok: 'A un policía', bad: ['A un vendedor', 'A cualquier desconocido', 'A nadie'], hint: 'Lleva uniforme y su trabajo es cuidar a la gente.' },
    { q: '¿Para qué sirve la escuela?', ok: 'Para aprender y convivir con otros', bad: ['Para dormir', 'Para vender cosas', 'Para curar enfermos'], hint: 'Piensa en lo que haces allí todos los días.' },
    { q: '¿Quién atiende a las personas enfermas?', ok: 'El médico', bad: ['El bombero', 'El chofer', 'El carpintero'], hint: 'Trabaja en el hospital y usa un estetoscopio.' },
    { q: '¿Dónde se compran las frutas y las verduras?', ok: 'En el mercado', bad: ['En la escuela', 'En el hospital', 'En la biblioteca'], hint: 'Es donde van los adultos a hacer las compras de la comida.' },
    { q: 'Antes de cruzar la calle, ¿qué hay que hacer?', ok: 'Mirar a los dos lados', bad: ['Correr rápido', 'Cerrar los ojos', 'Cruzar sin mirar'], hint: 'Los carros pueden venir de cualquiera de los dos lados.' },
    { q: '¿Quién enseña en la escuela?', ok: 'El maestro o la maestra', bad: ['El bombero', 'El médico', 'El panadero'], hint: 'Es quien está al frente del salón todos los días.' },
    { q: '¿Qué hacemos con la basura?', ok: 'Ponerla en el basurero', bad: ['Tirarla en la calle', 'Guardarla en la mochila', 'Dejarla en el patio'], hint: 'Piensa en qué mantiene limpio el lugar donde estás.' }
  ],
  2: [
    { q: '¿Qué instrumento sirve para orientarse y señala siempre al norte?', ok: 'La brújula', bad: ['El reloj', 'El termómetro', 'La regla'], hint: 'Tiene una aguja imantada que gira sola.' },
    { q: '¿Cómo se llama el mapa que muestra montañas y ríos?', ok: 'Mapa físico', bad: ['Mapa político', 'Mapa del metro', 'Mapa del clima'], hint: 'Físico viene del terreno mismo, no de las fronteras.' },
    { q: '¿Cuáles son los cuatro puntos cardinales?', ok: 'Norte, sur, este y oeste', bad: ['Arriba, abajo, izquierda y derecha', 'Norte, sur, centro y borde', 'Este, oeste, cerca y lejos'], hint: 'El Sol sale por uno de ellos y se pone por el opuesto.' },
    { q: '¿Cuál es el océano más grande del planeta?', ok: 'El Pacífico', bad: ['El Atlántico', 'El Índico', 'El Ártico'], hint: 'Está entre América y Asia, y cabe toda la tierra firme dentro.' },
    { q: '¿Cuál es el continente más grande?', ok: 'Asia', bad: ['África', 'América', 'Europa'], hint: 'Ahí están China, India y Rusia.' },
    { q: '¿Cómo se llama la persona que gobierna un municipio?', ok: 'El alcalde', bad: ['El presidente', 'El gobernador del país', 'El juez'], hint: 'Es la autoridad más cercana a tu barrio, no la del país entero.' },
    { q: '¿Qué es la capital de un país?', ok: 'La ciudad donde está la sede del gobierno', bad: ['La ciudad más antigua', 'La ciudad con más árboles', 'La ciudad del centro geográfico'], hint: 'Es donde se toman las decisiones del país, aunque no sea la más grande.' },
    { q: '¿Cómo se llama la línea imaginaria que parte la Tierra en hemisferio norte y sur?', ok: 'El ecuador', bad: ['El meridiano de Greenwich', 'El trópico de Cáncer', 'El eje terrestre'], hint: 'Es la que da la vuelta justo por la mitad, a la misma distancia de los dos polos.' }
  ],
  3: [
    { q: 'De estos hechos, ¿cuál ocurrió primero?', ok: 'La independencia de Centroamérica (1821)', bad: ['La Segunda Guerra Mundial (1939)', 'La llegada del hombre a la Luna (1969)', 'La caída del Muro de Berlín (1989)'], hint: 'Mira solo los años y busca el número más pequeño.' },
    { q: '¿Qué es una democracia?', ok: 'Un sistema donde el pueblo elige a sus gobernantes', bad: ['Un sistema donde manda una sola familia', 'Un sistema sin leyes', 'Un sistema donde manda el ejército'], hint: 'La palabra viene del griego: demos = pueblo, kratos = poder.' },
    { q: '¿En qué año llegó Cristóbal Colón a América?', ok: '1492', bad: ['1521', '1776', '1810'], hint: 'Fue en el siglo XV, al final del reinado de los Reyes Católicos.' },
    { q: '¿En qué año empezó la Revolución Francesa?', ok: '1789', bad: ['1492', '1821', '1914'], hint: 'Se recuerda por la toma de la Bastilla, el 14 de julio.' },
    { q: '¿Cuáles son los tres poderes del Estado?', ok: 'Legislativo, ejecutivo y judicial', bad: ['Militar, civil y religioso', 'Nacional, regional y local', 'Económico, social y político'], hint: 'Uno hace las leyes, otro las aplica y otro juzga a quien las rompe.' },
    { q: '¿Qué separa a América de Europa y África?', ok: 'El océano Atlántico', bad: ['El océano Pacífico', 'El mar Mediterráneo', 'El océano Índico'], hint: 'Es el que cruzó Colón en 1492.' },
    { q: '¿Qué fue la Colonia en América?', ok: 'El período en que las potencias europeas gobernaron el continente', bad: ['La época anterior a los pueblos originarios', 'El período posterior a la independencia', 'Una guerra entre países americanos'], hint: 'Va desde la llegada de los europeos hasta las independencias del siglo XIX.' },
    { q: '¿Qué es el censo de población?', ok: 'El conteo oficial de cuántas personas viven en un territorio', bad: ['Una elección de gobernantes', 'Un mapa de las carreteras', 'El registro de las empresas'], hint: 'Se hace cada varios años y sirve para repartir escuelas, hospitales y presupuesto.' },
    { q: '¿Qué es una migración?', ok: 'El desplazamiento de personas de un lugar a otro para vivir allí', bad: ['Un viaje de vacaciones', 'El crecimiento de una ciudad', 'El cambio de gobierno'], hint: 'Puede ser dentro del mismo país o hacia otro.' }
  ],
  4: [
    { q: '¿Cuál es la función principal del poder legislativo?', ok: 'Crear y aprobar las leyes', bad: ['Aplicar las leyes', 'Juzgar los delitos', 'Dirigir el ejército'], hint: 'La palabra «legislar» ya te da casi toda la respuesta.' },
    { q: 'Que haya inflación alta significa que…', ok: 'El dinero pierde poder de compra', bad: ['Los precios bajan', 'Sube el ahorro', 'Baja el desempleo siempre'], hint: 'Si todo cuesta más, ¿qué le pasa al mismo billete de ayer?' },
    { q: '¿Qué mide el Producto Interno Bruto (PIB)?', ok: 'El valor de todo lo que produce un país en un año', bad: ['Cuánto dinero tiene el gobierno', 'Cuánta gente vive en el país', 'Cuánto exporta el país'], hint: 'Es la suma de bienes y servicios producidos dentro de las fronteras.' },
    { q: 'Si sube la demanda de un producto y la oferta no cambia, el precio…', ok: 'Tiende a subir', bad: ['Tiende a bajar', 'Se queda igual', 'Desaparece'], hint: 'Más gente peleando por la misma cantidad de algo.' },
    { q: '¿En qué año se aprobó la Declaración Universal de los Derechos Humanos?', ok: '1948', bad: ['1918', '1969', '1989'], hint: 'Fue poco después de la Segunda Guerra Mundial, ya creada la ONU.' },
    { q: '¿Qué significa que un país sea un Estado de derecho?', ok: 'Que la ley está por encima de todos, gobernantes incluidos', bad: ['Que tiene muchas leyes', 'Que el presidente decide las leyes', 'Que tiene un ejército propio'], hint: 'Lo contrario es que quien manda esté por encima de la ley.' },
    { q: '¿Para qué se creó la Organización de las Naciones Unidas en 1945?', ok: 'Para mantener la paz y la cooperación entre países', bad: ['Para crear una moneda mundial', 'Para gobernar a los países miembros', 'Para organizar los Juegos Olímpicos'], hint: 'Nació al terminar la Segunda Guerra Mundial, y ese es todo el motivo.' },
    { q: '¿Qué caracterizó a la Guerra Fría?', ok: 'La tensión entre Estados Unidos y la URSS sin llegar a un choque directo', bad: ['Una guerra abierta entre Europa y Asia', 'Un conflicto por el clima', 'Una guerra entre países de América'], hint: 'El nombre lo dice: nunca se dispararon entre sí, pero el mundo entero estuvo dividido.' },
    { q: '¿Qué es la globalización?', ok: 'La creciente interconexión económica y cultural entre países', bad: ['El cierre de fronteras', 'El aumento de la población mundial', 'La expansión de un solo idioma'], hint: 'Piensa en un teléfono diseñado en un país, fabricado en otro y vendido en todos.' },
    { q: '¿Qué es el desarrollo sostenible?', ok: 'Cubrir las necesidades de hoy sin comprometer las de las próximas generaciones', bad: ['Crecer lo más rápido posible', 'Dejar de producir', 'Usar solo recursos importados'], hint: 'La palabra clave es «sostener»: que se pueda seguir haciendo dentro de cien años.' }
  ]
};

function socialRound(d) {
  const item = pick(porNivel(SOCIAL, d));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Fíjate primero en qué te está preguntando exactamente.',
      'Descarta lo que claramente pertenece a otro tema.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Inglés ----------------------------------------------------------------
// Dos juegos en uno:
//
//   spelling bee  se da la palabra en español y se deletrea en inglés, letra
//                 por letra. Es el concurso de siempre, y funciona porque en
//                 inglés casi nada se escribe como suena.
//   el resto      vocabulario, gramática, tiempos verbales y phrasal verbs.
//
// La gramática sube por donde sube de verdad en clase: primero el verbo to be,
// después la tercera persona y el pasado, luego los condicionales y el
// presente perfecto, y al final la pasiva, el estilo indirecto y el past
// perfect.

const ENGLISH = {
  1: [
    { q: '¿Cómo se dice «perro» en inglés?', ok: 'dog', bad: ['cat', 'cow', 'bird'] },
    { q: '¿Cómo se dice «rojo» en inglés?', ok: 'red', bad: ['blue', 'green', 'black'] },
    { q: '¿Cómo se dice «casa» en inglés?', ok: 'house', bad: ['horse', 'mouse', 'chair'] },
    { q: '¿Cómo se dice «agua» en inglés?', ok: 'water', bad: ['milk', 'bread', 'fire'] },
    { q: '¿Cómo se dice «libro» en inglés?', ok: 'book', bad: ['pen', 'door', 'shoe'] },
    { q: '¿Cómo se dice «madre» en inglés?', ok: 'mother', bad: ['father', 'sister', 'brother'] },
    { q: '¿Qué número es «three»?', ok: 'tres', bad: ['dos', 'trece', 'treinta'] },
    { q: '¿Cómo se dice «escuela» en inglés?', ok: 'school', bad: ['street', 'store', 'sky'] }
  ],
  2: [
    { q: 'Completa: «I ___ a student.»', ok: 'am', bad: ['is', 'are', 'be'] },
    { q: 'Completa: «She ___ to school every day.»', ok: 'goes', bad: ['go', 'going', 'gone'] },
    { q: '¿Cómo se dice «mañana» (el día siguiente)?', ok: 'tomorrow', bad: ['morning', 'today', 'yesterday'] },
    { q: '¿Cuál es el plural de «child»?', ok: 'children', bad: ['childs', 'childes', 'childrens'] },
    { q: 'Completa: «The cat is ___ the table.» (encima)', ok: 'on', bad: ['in', 'at', 'under'] },
    { q: 'Completa: «They ___ playing football right now.»', ok: 'are', bad: ['is', 'am', 'be'] },
    { q: '¿Cómo se pregunta la hora en inglés?', ok: 'What time is it?', bad: ['How is the time?', 'What hour is?', 'When is the clock?'] },
    { q: 'Completa: «I have two ___.» (pies)', ok: 'feet', bad: ['foots', 'feets', 'foot'] }
  ],
  3: [
    { q: 'Completa: «If it rains, we ___ stay home.»', ok: 'will', bad: ['would', 'were', 'are'] },
    { q: '¿Cuál es el pasado de «buy»?', ok: 'bought', bad: ['buyed', 'boughted', 'buied'] },
    { q: 'Completa: «I have lived here ___ 2019.»', ok: 'since', bad: ['for', 'during', 'ago'] },
    { q: 'Completa: «He is ___ than his brother.» (más alto)', ok: 'taller', bad: ['more tall', 'tallest', 'the taller'] },
    { q: 'Completa: «She has ___ to Paris twice.»', ok: 'been', bad: ['gone', 'went', 'being'] },
    { q: 'Completa: «I ___ my homework yesterday.»', ok: 'did', bad: ['do', 'done', 'was doing'] },
    { q: '¿Cuál es el pasado de «teach»?', ok: 'taught', bad: ['teached', 'teacht', 'tought'] },
    { q: 'Completa: «There ___ many people at the concert.» (pasado)', ok: 'were', bad: ['was', 'are', 'is'] },
    { q: '¿Qué significa el phrasal verb «to look for»?', ok: 'buscar', bad: ['mirar hacia', 'cuidar', 'parecerse a'] }
  ],
  4: [
    { q: 'Completa: «If I ___ more time, I would travel.»', ok: 'had', bad: ['have', 'will have', 'would have'] },
    { q: 'Completa en voz pasiva: «The report ___ by the team yesterday.»', ok: 'was written', bad: ['wrote', 'is writing', 'has wrote'] },
    { q: '¿Qué significa el phrasal verb «to give up»?', ok: 'rendirse', bad: ['regalar', 'levantarse', 'subir'] },
    { q: 'Completa: «If she had studied, she ___ passed.»', ok: 'would have', bad: ['would', 'will have', 'had'] },
    { q: 'Estilo indirecto: «He said he ___ tired.»', ok: 'was', bad: ['is', 'has been', 'will be'] },
    { q: 'Completa: «The man ___ car was stolen called the police.»', ok: 'whose', bad: ['who', 'which', "who's"] },
    { q: 'Completa: «By the time we arrived, the film ___.»', ok: 'had started', bad: ['started', 'has started', 'was starting'] },
    { q: '¿Qué significa el phrasal verb «to put off»?', ok: 'aplazar', bad: ['apagar', 'ponerse algo', 'quitar'] },
    { q: 'Completa: «I wish I ___ speak Japanese.»', ok: 'could', bad: ['can', 'will', 'would have'] },
    { q: 'Completa: «She is used to ___ early.»', ok: 'waking up', bad: ['wake up', 'woke up', 'wakes up'] }
  ]
};

const ENGLISH_HINTS = {
  1: 'Di la palabra en voz alta. Muchas se parecen bastante al español.',
  2: 'Mira quién hace la acción: I → am, he/she/it → is, y al verbo se le agrega -s.',
  3: 'Fíjate en el tiempo que pide la frase: pasado simple, futuro o presente perfecto.',
  4: 'Revisa la estructura completa: qué condicional es, si la voz es pasiva, o si el verbo pide gerundio.'
};

// Spelling bee. Las palabras suben de dificultad con el nivel, y cada una trae
// el detalle que la hace caer en un concurso de verdad.
const SPELLING_BEE = {
  1: [
    { es: 'gato', en: 'cat', ojo: 'Tres letras y empieza con el sonido /k/, pero se escribe con c.' },
    { es: 'libro', en: 'book', ojo: 'Lleva dos oes juntas.' },
    { es: 'azul', en: 'blue', ojo: 'Termina en -ue, y esa e no suena.' },
    { es: 'árbol', en: 'tree', ojo: 'Doble e al final.' },
    { es: 'pez', en: 'fish', ojo: 'El sonido /sh/ se escribe con s y h juntas.' },
    { es: 'sol', en: 'sun', ojo: 'Tres letras, y la del medio es u, no o.' },
    { es: 'mano', en: 'hand', ojo: 'Empieza con h y termina con d, no con t.' },
    { es: 'leche', en: 'milk', ojo: 'Cuatro letras y ninguna muda.' }
  ],
  2: [
    { es: 'escuela', en: 'school', ojo: 'Empieza con sch, aunque suene /sk/.' },
    { es: 'amigo', en: 'friend', ojo: 'Lleva una i que no se oye: fr-i-end.' },
    { es: 'jueves', en: 'thursday', ojo: 'Th al principio y una r después de u.' },
    { es: 'naranja', en: 'orange', ojo: 'Termina en -ge, no en -ch.' },
    { es: 'porque', en: 'because', ojo: 'Termina en -ause, con esa e final muda.' },
    { es: 'gente', en: 'people', ojo: 'La e va antes de la o: p-e-o-ple.' },
    { es: 'hermano', en: 'brother', ojo: 'Termina en -er, aunque suene como una a.' },
    { es: 'escuchar', en: 'listen', ojo: 'Lleva una t que no se pronuncia: lis-t-en.' },
    { es: 'clima', en: 'weather', ojo: 'Empieza con wea- y lleva th en medio.' }
  ],
  3: [
    { es: 'hermoso', en: 'beautiful', ojo: 'Tres vocales seguidas al principio: b-e-a-u.' },
    { es: 'necesario', en: 'necessary', ojo: 'Una c y dos eses. Es la que más se falla.' },
    { es: 'gobierno', en: 'government', ojo: 'Lleva una n en medio que casi no se pronuncia: govern-ment.' },
    { es: 'recibir', en: 'receive', ojo: 'Después de c va ei, no ie.' },
    { es: 'separado', en: 'separate', ojo: 'La del medio es una a, no una e.' },
    { es: 'negocio', en: 'business', ojo: 'Lleva una i muda: bus-i-ness, y termina en doble s.' },
    { es: 'conocimiento', en: 'knowledge', ojo: 'Empieza con una k que no suena, y lleva d antes de -ge.' },
    { es: 'febrero', en: 'february', ojo: 'Lleva una r después de la b: feb-r-uary.' },
    { es: 'restaurante', en: 'restaurant', ojo: 'Termina en -ant, sin e final.' },
    { es: 'definitivamente', en: 'definitely', ojo: 'Todas las vocales del medio son i: de-fi-ni-te-ly.' }
  ],
  4: [
    { es: 'conciencia', en: 'conscience', ojo: 'Lleva sc en medio: con-sci-ence.' },
    { es: 'vergonzoso', en: 'embarrassed', ojo: 'Dos erres y dos eses. Las dos dobles.' },
    { es: 'suceso', en: 'occurrence', ojo: 'Dos ces y dos erres.' },
    { es: 'emprendedor', en: 'entrepreneur', ojo: 'Viene del francés y se escribe tal cual: entre-pre-neur.' },
    { es: 'rítmico', en: 'rhythm', ojo: 'Solo tiene una vocal visible: la y hace de vocal.' },
    { es: 'burocracia', en: 'bureaucracy', ojo: 'Lleva -eau- del francés: bur-eau-cracy.' },
    { es: 'milenio', en: 'millennium', ojo: 'Dos eles y dos enes: mil-len-nium.' },
    { es: 'alojar', en: 'accommodate', ojo: 'Dos ces y dos emes. La que más se escribe mal en inglés.' },
    { es: 'enlace', en: 'liaison', ojo: 'Tres vocales seguidas en medio: li-ai-son.' }
  ]
};

function spellingBeeRound(d) {
  const item = pick(porNivel(SPELLING_BEE, d));
  const letras = item.en.split('');
  return build({
    prompt: `Spelling bee: deletrea «${item.es}» en inglés.`,
    lead: 'Toca las letras en orden. Sobran algunas.',
    answer: letras,
    extras: letrasDe(item.en, d <= 2 ? 3 : 4),
    join: '',
    hint: item.ojo,
    steps: [
      `La palabra tiene ${letras.length} letras.`,
      'Dila en voz alta y ve escribiéndola sonido por sonido.',
      `Ojo con esto: ${item.ojo}`
    ]
  });
}

function englishRound(d) {
  const level = Math.min(4, Math.max(1, d));
  if (Math.random() < 0.5) return spellingBeeRound(level);

  const item = pick(porNivel(ENGLISH, level));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: ENGLISH_HINTS[level],
    steps: [
      'Lee la frase completa antes de mirar las opciones.',
      'Prueba cada opción dentro de la frase y escucha cuál suena natural.',
      `Pista de Robin: ${ENGLISH_HINTS[level]}`
    ]
  };
}

// ---- Arte y Música ---------------------------------------------------------
// La materia más ancha de todas: color, ritmo, notas, instrumentos, épocas y
// obras. Los retos que se hacen con las manos —mezclar colores, armar un
// acorde, seguir la escala— se quedan abajo y en medio; las preguntas de
// historia del arte y de teoría musical solo salen de tercero en adelante,
// porque antes no se han visto.

const COLOR_MIX = [
  { a: 'azul', b: 'amarillo', ok: 'verde', bad: ['morado', 'naranja', 'café'] },
  { a: 'rojo', b: 'amarillo', ok: 'naranja', bad: ['verde', 'morado', 'gris'] },
  { a: 'rojo', b: 'azul', ok: 'morado', bad: ['verde', 'naranja', 'rosa'] }
];

const NOTE_SEQ = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];

// Acordes de tres notas, para armar juntándolas. El orden da igual.
const ACORDES = [
  { nombre: 'do mayor', notas: ['do', 'mi', 'sol'], sobran: ['re', 'fa', 'la'] },
  { nombre: 'fa mayor', notas: ['fa', 'la', 'do'], sobran: ['mi', 'sol', 'si'] },
  { nombre: 'sol mayor', notas: ['sol', 'si', 're'], sobran: ['do', 'fa', 'la'] },
  { nombre: 're menor', notas: ['re', 'fa', 'la'], sobran: ['do', 'mi', 'si'] },
  { nombre: 'mi menor', notas: ['mi', 'sol', 'si'], sobran: ['re', 'fa', 'do'] },
  { nombre: 'la menor', notas: ['la', 'do', 'mi'], sobran: ['re', 'fa', 'si'] }
];

const INSTRUMENTOS = {
  2: [
    { q: '¿A qué familia pertenece el violín?', ok: 'Cuerda', bad: ['Viento', 'Percusión', 'Teclado'], hint: 'Suena porque el arco frota unos hilos tensados.' },
    { q: '¿A qué familia pertenece la trompeta?', ok: 'Viento', bad: ['Cuerda', 'Percusión', 'Teclado'], hint: 'Suena porque soplas aire dentro.' },
    { q: '¿A qué familia pertenece el timbal?', ok: 'Percusión', bad: ['Viento', 'Cuerda', 'Teclado'], hint: 'Suena porque lo golpeas.' },
    { q: '¿A qué familia pertenece la guitarra?', ok: 'Cuerda', bad: ['Viento', 'Percusión', 'Metal'], hint: 'Suena al pulsar unos hilos tensados sobre una caja.' }
  ],
  3: [
    { q: '¿Qué instrumento es a la vez de cuerda y de percusión?', ok: 'El piano', bad: ['La guitarra', 'El arpa', 'El violonchelo'], hint: 'Tiene cuerdas dentro, pero unos martillos las golpean.' },
    { q: 'Aunque está hecho de metal, ¿a qué familia pertenece el saxofón?', ok: 'Viento madera', bad: ['Viento metal', 'Percusión', 'Cuerda'], hint: 'La familia la decide cómo se produce el sonido: aquí, una lengüeta que vibra.' },
    { q: '¿Cuál de estos NO es un instrumento de cuerda frotada?', ok: 'El arpa', bad: ['El violín', 'La viola', 'El contrabajo'], hint: 'Los otros tres se tocan con arco; este se pulsa con los dedos.' },
    { q: '¿Cuál es el instrumento más grave de la familia de cuerda frotada?', ok: 'El contrabajo', bad: ['El violonchelo', 'La viola', 'El violín'], hint: 'Es el más grande de los cuatro, y hay que tocarlo de pie.' }
  ]
};

const FIGURAS_MUSICALES = {
  3: [
    { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una negra?', ok: '1 tiempo', bad: ['2 tiempos', '4 tiempos', 'medio tiempo'], hint: 'Cada figura dura la mitad que la anterior: redonda, blanca, negra.' },
    { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una blanca?', ok: '2 tiempos', bad: ['1 tiempo', '4 tiempos', '8 tiempos'], hint: 'La blanca es la mitad de la redonda.' },
    { q: '¿Cuántas corcheas caben en una negra?', ok: '2', bad: ['4', '1', '8'], hint: 'La corchea dura la mitad que la negra.' },
    { q: '¿Cuántas líneas tiene un pentagrama?', ok: 'Cinco', bad: ['Cuatro', 'Seis', 'Siete'], hint: 'El nombre lo dice: «penta» es cinco en griego.' }
  ],
  4: [
    { q: 'En un compás de 4/4, ¿cuántas negras caben?', ok: 'Cuatro', bad: ['Dos', 'Ocho', 'Una'], hint: 'El número de arriba dice cuántas figuras, y el de abajo, de cuál.' },
    { q: '¿Cuántas semicorcheas caben en una negra?', ok: '4', bad: ['2', '8', '16'], hint: 'La corchea es media negra, y la semicorchea es media corchea.' },
    { q: '¿Qué indica la clave de sol al inicio del pentagrama?', ok: 'Dónde se sitúa la nota sol, y con ella todas las demás', bad: ['La velocidad de la pieza', 'El volumen', 'El número de compases'], hint: 'Sin una clave, las notas escritas no tendrían nombre.' },
    { q: '¿Qué indica una indicación como «allegro»?', ok: 'El tempo: a qué velocidad se toca', bad: ['El volumen', 'El instrumento', 'La tonalidad'], hint: 'Va antes de la música y no se toca: se obedece.' }
  ]
};

const COLOR_TEORIA = {
  2: [
    { q: '¿Cuáles son los tres colores primarios en pintura?', ok: 'Rojo, azul y amarillo', bad: ['Verde, naranja y morado', 'Blanco, negro y gris', 'Rojo, verde y azul'], hint: 'Son los que no se pueden obtener mezclando otros.' },
    { q: 'Los colores cálidos son…', ok: 'Rojo, naranja y amarillo', bad: ['Azul, verde y morado', 'Blanco y negro', 'Solo el rojo'], hint: 'Piensa en el fuego y el sol.' },
    { q: '¿Cuáles son los colores secundarios?', ok: 'Verde, naranja y morado', bad: ['Rojo, azul y amarillo', 'Blanco, negro y gris', 'Rosa, celeste y beige'], hint: 'Salen de mezclar dos primarios entre sí.' }
  ],
  3: [
    { q: '¿Qué color es complementario del rojo?', ok: 'Verde', bad: ['Azul', 'Naranja', 'Morado'], hint: 'Está justo enfrente en la rueda de color.' },
    { q: '¿Qué color es complementario del azul?', ok: 'Naranja', bad: ['Verde', 'Morado', 'Rojo'], hint: 'Está justo enfrente del azul en la rueda de color.' },
    { q: '¿Qué pasa si mezclas un color con su complementario?', ok: 'Se apaga y tira a gris', bad: ['Se vuelve más brillante', 'No cambia nada', 'Se vuelve primario'], hint: 'Los opuestos de la rueda se neutralizan entre sí.' },
    { q: '¿Qué es un color terciario?', ok: 'La mezcla de un primario con un secundario vecino', bad: ['La mezcla de dos primarios', 'Cualquier color con blanco', 'Un color sin nombre'], hint: 'El rojo anaranjado y el azul verdoso son dos de ellos.' }
  ]
};

const OBRAS = {
  3: [
    { q: '¿Quién pintó «La noche estrellada»?', ok: 'Vincent van Gogh', bad: ['Pablo Picasso', 'Claude Monet', 'Salvador Dalí'], hint: 'Un pintor neerlandés de pinceladas gruesas y arremolinadas.' },
    { q: '¿Quién pintó «La Gioconda» (la Mona Lisa)?', ok: 'Leonardo da Vinci', bad: ['Miguel Ángel', 'Rafael', 'Rembrandt'], hint: 'El mismo que dibujaba máquinas voladoras en sus cuadernos.' },
    { q: '¿Quién esculpió «El David» de Florencia?', ok: 'Miguel Ángel', bad: ['Donatello', 'Leonardo da Vinci', 'Bernini'], hint: 'El mismo que pintó el techo de la Capilla Sixtina.' },
    { q: '¿Quién pintó «El grito»?', ok: 'Edvard Munch', bad: ['Vincent van Gogh', 'Gustav Klimt', 'Paul Gauguin'], hint: 'Un pintor noruego; la figura se tapa las orejas sobre un puente.' },
    { q: '¿De qué país era Frida Kahlo?', ok: 'México', bad: ['España', 'Argentina', 'Colombia'], hint: 'Estuvo casada con el muralista Diego Rivera.' }
  ],
  4: [
    { q: '¿A qué movimiento pertenece «Las señoritas de Avignon», de Picasso?', ok: 'Cubismo', bad: ['Impresionismo', 'Surrealismo', 'Romanticismo'], hint: 'Descompone las figuras en planos con esquinas.' },
    { q: '«Los relojes blandos» de Dalí pertenecen al…', ok: 'Surrealismo', bad: ['Cubismo', 'Realismo', 'Barroco'], hint: 'Pinta cosas imposibles, como salidas de un sueño.' },
    { q: '¿Qué buscaban los impresionistas como Monet?', ok: 'Captar la luz de un instante', bad: ['Copiar la realidad al detalle', 'Pintar solo temas religiosos', 'Usar únicamente blanco y negro'], hint: 'El nombre viene de un cuadro suyo: «Impresión, sol naciente».' },
    { q: '¿Qué denunció Picasso en su «Guernica»?', ok: 'El bombardeo de un pueblo durante la Guerra Civil española', bad: ['La Revolución Francesa', 'La conquista de América', 'La Primera Guerra Mundial'], hint: 'Está pintado en blanco, negro y gris, como una noticia de periódico.' },
    { q: '¿A qué período musical pertenece Johann Sebastian Bach?', ok: 'Barroco', bad: ['Clasicismo', 'Romanticismo', 'Renacimiento'], hint: 'Es el período de la fuga y el contrapunto, anterior a Mozart.' },
    { q: '¿Qué tenía de extraordinario Beethoven al componer sus últimas obras?', ok: 'Que ya estaba sordo', bad: ['Que era ciego', 'Que nunca estudió música', 'Que no sabía escribir partituras'], hint: 'Componía lo que ya no podía escuchar.' },
    { q: '¿Quién compuso «Las cuatro estaciones»?', ok: 'Antonio Vivaldi', bad: ['Wolfgang A. Mozart', 'Johann S. Bach', 'Franz Schubert'], hint: 'Un compositor veneciano del Barroco; son cuatro conciertos para violín.' },
    { q: '¿Qué caracterizó al muralismo mexicano de Diego Rivera y Orozco?', ok: 'Pintar la historia del pueblo en muros públicos', bad: ['Pintar solo retratos por encargo', 'Pintar paisajes en miniatura', 'Pintar únicamente temas religiosos'], hint: 'La idea era que el arte estuviera donde cualquiera pudiera verlo, sin entrar a un museo.' }
  ]
};

function artPatron() {
  const colores = shuffle(['🔴', '🔵', '🟡', '🟢']).slice(0, 2);
  const patron = [colores[0], colores[1], colores[0], colores[1], colores[0]];
  return {
    kind: 'choice',
    prompt: `Sigue el patrón:  ${patron.join('  ')}  →  ?`,
    answer: colores[1],
    options: choices(colores[1], ['🔴', '🔵', '🟡', '🟢'].filter(c => c !== colores[1])),
    hint: 'Mira cómo se turnan los colores: uno, otro, uno, otro…',
    steps: [
      'Señala cada figura con el dedo y di su color en voz alta.',
      'Escucha el ritmo: se repiten de dos en dos.',
      'Continúa con el color al que le toca el turno.'
    ]
  };
}

function artMezcla() {
  const mix = pick(COLOR_MIX);
  return {
    kind: 'choice',
    prompt: `Si mezclas ${mix.a} y ${mix.b}, ¿qué color sale?`,
    answer: mix.ok,
    options: choices(mix.ok, mix.bad),
    hint: 'Los colores primarios son rojo, azul y amarillo. Mezclar dos primarios da siempre un secundario.',
    steps: [
      'Recuerda cuáles son los tres colores primarios.',
      'Mezclar dos de ellos siempre da un color secundario.',
      'Piensa en la rueda de color: el resultado queda justo entre los dos.'
    ]
  };
}

function artEscala(d) {
  const start = rand(0, 4);
  const step = d >= 4 ? 2 : 1;
  const seq = [0, 1, 2].map(i => NOTE_SEQ[(start + i * step) % NOTE_SEQ.length]);
  const next = NOTE_SEQ[(start + 3 * step) % NOTE_SEQ.length];
  return {
    kind: 'choice',
    prompt: `La escala avanza así:  ${seq.join(' · ')} · ?  — ¿qué nota sigue?`,
    answer: next,
    options: choices(next, shuffle(NOTE_SEQ.filter(n => n !== next)).slice(0, 3)),
    hint: `Las notas van do · re · mi · fa · sol · la · si y vuelven a empezar. Aquí el salto es de ${step} nota${step === 1 ? '' : 's'}.`,
    steps: [
      'Escribe la escala completa: do re mi fa sol la si.',
      `Marca dónde cae cada nota del reto y mide cuántos pasos hay entre ellas (${step}).`,
      'Avanza ese mismo salto desde la última nota que te dieron.'
    ]
  };
}

function artEscalaArmada() {
  const start = rand(0, 3);
  const notas = [0, 1, 2, 3].map(i => NOTE_SEQ[(start + i) % NOTE_SEQ.length]);
  return build({
    prompt: `Ordena estas notas como van en la escala, empezando por «${notas[0]}».`,
    lead: 'Toca las notas en el orden en que se tocan.',
    answer: notas,
    extras: shuffle(NOTE_SEQ.filter(n => !notas.includes(n))).slice(0, 2),
    hint: 'La escala es do · re · mi · fa · sol · la · si, y después vuelve a do.',
    steps: [
      'Escribe la escala entera en una hoja: do re mi fa sol la si.',
      `Busca «${notas[0]}» en esa fila.`,
      'Sigue hacia la derecha nota por nota; al llegar al final vuelves al principio.'
    ]
  });
}

function artAcorde() {
  const item = pick(ACORDES);
  return build({
    prompt: `Arma el acorde de ${item.nombre}: mete sus tres notas.`,
    lead: 'El orden da igual: un acorde suena igual se toque como se toque.',
    answer: item.notas,
    extras: item.sobran,
    unordered: true,
    hint: 'Un acorde se arma saltando notas: tomas una, te saltas la siguiente, tomas la otra, y así.',
    steps: [
      'Escribe la escala: do re mi fa sol la si.',
      `Empieza en la nota que da nombre al acorde (${item.notas[0]}).`,
      'Salta una nota, toma la siguiente, salta otra y toma la siguiente. Esas tres son.'
    ]
  });
}

function artPregunta(banco, d) {
  const item = pick(porNivel(banco, d));
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la pregunta otra vez y quédate con la palabra clave.',
      'Descarta lo que claramente es de otra familia o de otra época.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function artRound(d) {
  if (d <= 1) return pick([artPatron, artMezcla])();
  if (d === 2) {
    return pick([
      () => artMezcla(),
      () => artEscalaArmada(),
      () => artEscala(d),
      () => artPregunta(INSTRUMENTOS, d),
      () => artPregunta(COLOR_TEORIA, d)
    ])();
  }
  return pick([
    () => artEscala(d),
    () => artAcorde(),
    () => artEscalaArmada(),
    () => artPregunta(INSTRUMENTOS, d),
    () => artPregunta(FIGURAS_MUSICALES, d),
    () => artPregunta(COLOR_TEORIA, d),
    () => artPregunta(OBRAS, d),
    () => artPregunta(OBRAS, d)
  ])();
}

// ---- Programación ----------------------------------------------------------
// La materia nueva. Se aprende a programar leyendo y ordenando código, no
// eligiendo entre cuatro botones, así que casi todos los retos son de armar:
// se ordenan los pasos de un algoritmo, las líneas de un programa o las piezas
// de una condición. Los pocos de opción múltiple son para "¿qué imprime esto?",
// que es lo único que sí se contesta con un valor.
//
// Qué idioma habla cada cosa
// --------------------------
// Todo el código de esta materia es Python de verdad, y por tanto está en
// inglés: print, for, if, else, def, return, break, True, len(). No es un
// capricho —es que un «mostrar» o un «si no» traducidos no existen en ningún
// intérprete del mundo, y quien los aprende aquí tiene que desaprenderlos el
// día que abre un editor. Los nombres de las variables van igual en inglés,
// para que el programa se lea entero en un solo idioma.
//
// Los BLOQUES siguen en español: los pasos de ALGORITMOS —lavarse las manos,
// sembrar una planta— son las piezas del nivel de abajo, donde todavía no hay
// una sola línea de código, y ahí el idioma del país no estorba nada.
//
// Y lo que se cuenta alrededor —enunciados, pistas, paso a paso— también va
// en español siempre. Se traduce la explicación, nunca el lenguaje.

const ALGORITMOS = {
  1: [
    { que: 'lavarte los dientes', pasos: ['Tomar el cepillo', 'Ponerle pasta', 'Cepillar los dientes', 'Enjuagarse la boca'] },
    { que: 'hacer un sándwich', pasos: ['Sacar el pan', 'Poner el relleno', 'Tapar con la otra rebanada', 'Comérselo'] },
    { que: 'salir de casa', pasos: ['Ponerse los zapatos', 'Tomar la mochila', 'Abrir la puerta', 'Cerrar con llave'] },
    { que: 'lavarte las manos', pasos: ['Abrir el grifo', 'Mojarse las manos', 'Echar jabón y frotar', 'Enjuagar y cerrar el grifo'] },
    { que: 'servirte un vaso de agua', pasos: ['Sacar un vaso', 'Tomar la jarra', 'Llenar el vaso', 'Guardar la jarra'] },
    { que: 'prestar un libro a un amigo', pasos: ['Buscar el libro', 'Preguntarle si lo quiere', 'Dárselo', 'Anotar que se lo prestaste'] },
    { que: 'guardar los juguetes', pasos: ['Dejar de jugar', 'Juntar los juguetes del suelo', 'Meterlos en la caja', 'Cerrar la caja'] }
  ],
  2: [
    { que: 'sembrar una planta', pasos: ['Hacer un hoyo en la tierra', 'Poner la semilla dentro', 'Taparla con tierra', 'Regarla con agua'] },
    { que: 'buscar un libro en la biblioteca', pasos: ['Buscar el título en el catálogo', 'Anotar en qué estante está', 'Ir a ese estante', 'Tomar el libro'] },
    { que: 'enviar una carta', pasos: ['Escribir la carta', 'Meterla en el sobre', 'Escribir la dirección', 'Echarla al buzón'] },
    { que: 'preparar la mochila para mañana', pasos: ['Mirar el horario del día siguiente', 'Sacar los cuadernos que no tocan', 'Meter los que sí tocan', 'Cerrar la mochila'] },
    { que: 'pagar en una tienda', pasos: ['Elegir lo que vas a llevar', 'Hacer la fila en la caja', 'Entregar el dinero', 'Recibir el cambio y el recibo'] },
    { que: 'buscar una palabra en el diccionario', pasos: ['Fijarte en la primera letra', 'Abrir el diccionario por esa letra', 'Avanzar hasta la segunda letra', 'Leer la definición'] }
  ]
};

// Programas cortos en Python, para ordenar línea por línea.
//
// El código está en Python de verdad —print, for, if, else, in— y por eso
// está en inglés: quien ordena aquí estas líneas abre mañana cualquier
// editor, cualquier tutorial o cualquier examen y reconoce exactamente lo
// mismo. Un pseudocódigo traducido («mostrar», «si no») se entiende el primer
// día y estorba el segundo, porque no existe fuera de esta pantalla.
//
// Lo que se cuenta ALREDEDOR del código sigue en español: el enunciado, la
// pista y el paso a paso. Se traduce la explicación, nunca el lenguaje.
const PROGRAMAS = {
  3: [
    {
      que: 'sumar los números del 1 al 5',
      lineas: ['total = 0', 'for i in range(1, 6):', '    total = total + i', 'print(total)'],
      pista: 'Una variable se crea ANTES de usarla, y el resultado se imprime al final, cuando ya está completo.'
    },
    {
      que: 'decir si alguien es mayor de edad',
      lineas: ['age = int(input())', 'if age >= 18:', '    print("adult")', 'else:', '    print("minor")'],
      pista: 'Primero se consigue el dato, después se pregunta por él. No puedes comparar algo que todavía no existe.'
    }
  ],
  4: [
    {
      que: 'encontrar el número más grande de una lista',
      lineas: ['largest = numbers[0]', 'for n in numbers:', '    if n > largest:', '        largest = n', 'print(largest)'],
      pista: 'Se empieza suponiendo que el primero es el mayor, y se va corrigiendo al recorrer el resto.'
    },
    {
      que: 'contar cuántas veces aparece una letra',
      lineas: ['count = 0', 'for letter in word:', '    if letter == target:', '        count = count + 1', 'print(count)'],
      pista: 'El contador arranca en cero fuera del bucle; si lo pones dentro, se reinicia en cada vuelta.'
    }
  ]
};

const CODIGO_SALIDA = {
  2: [
    { code: 'x = 3\ny = 4\nprint(x + y)', ok: '7', bad: ['34', '12', '1'], hint: 'El signo + entre dos números los suma; no los pega uno al lado del otro.' },
    { code: 'count = 0\ncount = count + 2\ncount = count + 2\nprint(count)', ok: '4', bad: ['2', '0', '22'], hint: 'Cada línea reemplaza el valor anterior. Ve anotando cuánto vale después de cada una.' }
  ],
  3: [
    { code: 'total = 0\nfor i in range(1, 5):\n    total = total + i\nprint(total)', ok: '10', bad: ['4', '24', '0'], hint: 'range(1, 5) da cuatro vueltas —1, 2, 3 y 4— porque el número final no entra: 1, luego 1+2, luego 1+2+3…' },
    { code: 'word = "robin"\nprint(len(word))', ok: '5', bad: ['4', '6', 'robin'], hint: 'len() cuenta las letras una por una, incluida la última.' },
    { code: 'x = 10\nif x > 5:\n    print("big")\nelse:\n    print("small")', ok: 'big', bad: ['small', '10', 'nada'], hint: '¿Es cierto que 10 es mayor que 5? Solo se ejecuta la rama que sea verdadera.' }
  ],
  4: [
    { code: 'numbers = [3, 1, 4, 1, 5]\nprint(len(numbers))', ok: '5', bad: ['4', '14', '3'], hint: 'Cuenta los elementos, aunque alguno se repita: el 1 aparece dos veces y cuenta dos veces.' },
    { code: 'x = 7\nprint(x % 2)', ok: '1', bad: ['3', '3.5', '0'], hint: 'El % da el RESTO de la división, no el resultado.' },
    { code: 'total = 1\nfor i in range(1, 5):\n    total = total * i\nprint(total)', ok: '24', bad: ['10', '4', '0'], hint: 'Es un producto, no una suma: 1·1·2·3·4.' }
  ]
};

const CODIGO_CONCEPTO = {
  3: [
    { q: '¿Para qué sirve un bucle (un for o un while)?', ok: 'Repetir instrucciones sin escribirlas muchas veces', bad: ['Guardar un dato', 'Decidir entre dos caminos', 'Terminar el programa'], hint: 'Si tienes que hacer lo mismo 100 veces, ¿lo escribes 100 veces?' },
    { q: '¿Qué es una variable?', ok: 'Un nombre que guarda un valor', bad: ['Una orden que se repite', 'Un error del programa', 'Un tipo de bucle'], hint: 'Es como una caja con etiqueta: guardas algo y luego lo pides por su nombre.' },
    { q: 'Si un bucle nunca cambia su condición, ¿qué pasa?', ok: 'Se repite para siempre', bad: ['Se salta el bucle', 'Da error de sintaxis', 'Se ejecuta una sola vez'], hint: 'Si la puerta de salida nunca se abre, no se sale.' }
  ],
  4: [
    { q: '¿Qué hace una función (un def)?', ok: 'Agrupa pasos con un nombre para poder reutilizarlos', bad: ['Guarda un solo número', 'Repite siempre lo mismo sin cambiar', 'Borra las variables'], hint: 'Le das un nombre a un bloque de trabajo y lo llamas cuando lo necesitas.' },
    { q: 'Recorrer los 1 000 elementos de una lista de uno en uno es, en notación O, …', ok: 'O(n)', bad: ['O(1)', 'O(n²)', 'O(log n)'], hint: 'El trabajo crece igual que el tamaño de la lista: el doble de datos, el doble de tiempo.' },
    { q: '¿Qué es depurar (debug) un programa?', ok: 'Buscar y arreglar por qué no hace lo que debería', bad: ['Borrar el código y empezar de nuevo', 'Hacerlo más bonito', 'Traducirlo a otro idioma'], hint: 'El nombre viene de sacarle los bichos al programa.' }
  ]
};

function algoritmoRound(d) {
  const item = pick(ALGORITMOS[d <= 1 ? 1 : 2]);
  return build({
    prompt: `Ordena los pasos para ${item.que}.`,
    lead: 'Un programa es eso: pasos en el orden correcto.',
    answer: item.pasos,
    hint: 'Pregúntate cuál no se puede hacer sin haber hecho otro antes. Ese otro va primero.',
    steps: [
      'Busca el paso que se puede hacer sin nada previo: ese es el primero.',
      'De los que quedan, busca cuál ya se puede hacer ahora.',
      'Repite hasta colocarlos todos. Si un paso necesita algo que aún no pasó, va más adelante.'
    ]
  });
}

function programaRound(d) {
  const item = pick(PROGRAMAS[d >= 4 ? 4 : 3]);
  return build({
    prompt: `Ordena las líneas del programa que sirve para ${item.que}.`,
    lead: 'Las líneas con sangría van dentro de la que tienen encima.',
    answer: item.lineas,
    hint: item.pista,
    steps: [
      'Busca las líneas que crean o piden datos: siempre van antes de usarlos.',
      'Las líneas con sangría van dentro del for o del if que tienen justo arriba: en Python, los dos puntos del final abren lo que viene debajo.',
      `Pista de Robin: ${item.pista}`
    ]
  });
}

function salidaRound(d) {
  const item = pick(CODIGO_SALIDA[Math.min(4, Math.max(2, d))]);
  return {
    kind: 'choice',
    prompt: `¿Qué imprime este programa?\n\n${item.code}`,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee el programa línea por línea, de arriba abajo.',
      'Anota en una hoja cuánto vale cada variable después de cada línea.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function conceptoRound(d) {
  const item = pick(CODIGO_CONCEPTO[d >= 4 ? 4 : 3]);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Quédate con la palabra clave de la pregunta.',
      'Descarta las opciones que describen otra cosa distinta.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Completar el código que falta -----------------------------------------
// El programa ya está escrito y le falta una pieza, marcada con ___. Es el
// reto que más se parece a programar de verdad: casi nunca se empieza de la
// nada, casi siempre se mira código que ya existe y se ve qué le falta.
//
// El enunciado dice QUÉ tiene que hacer el programa, no dónde está el hueco:
// encontrar por qué ese hueco es ese y no otro es medio ejercicio.

const CODIGO_COMPLETA = {
  2: [
    {
      que: 'sumar dos números e imprimir el resultado',
      code: 'a = 5\nb = 3\nprint(___)',
      ok: 'a + b', bad: ['a b', '"a + b"', '5 + 3 = 8'],
      hint: 'Ya tienes los dos números guardados con un nombre. Úsalos por su nombre, no vuelvas a escribir los números.'
    },
    {
      que: 'saludar tres veces',
      code: 'for i in range(___):\n    print("hello")',
      ok: '3', bad: ['1', '"hello"', 'i'],
      hint: 'range(n) da n vueltas. Cuenta cuántos saludos quieres.'
    }
  ],
  3: [
    {
      que: 'contar hasta cuánto suman los números del 1 al 10',
      code: 'total = ___\nfor i in range(1, 11):\n    total = total + i\nprint(total)',
      ok: '0', bad: ['1', '10', 'i'],
      hint: 'El acumulador arranca en el valor que no cambia nada al sumarle el primero. Si empieza en 1, el resultado sale uno de más.'
    },
    {
      que: 'decir si un número es par',
      code: 'if number ___ 2 == 0:\n    print("even")\nelse:\n    print("odd")',
      ok: '%', bad: ['/', '*', '+'],
      hint: 'Par significa que al dividirlo entre dos no sobra nada. ¿Qué signo da lo que sobra?'
    },
    {
      que: 'recorrer todas las palabras de una lista',
      code: 'words = ["sun", "sea", "bread"]\nfor w ___ words:\n    print(w)',
      ok: 'in', bad: ['of', 'at', 'to'],
      hint: 'En Python el bucle se lee como una frase en inglés: for w ___ words. La palabra que falta significa "en".'
    }
  ],
  4: [
    {
      que: 'quedarse con el número más grande de una lista',
      code: 'largest = numbers[0]\nfor n in numbers:\n    if n ___ largest:\n        largest = n\nprint(largest)',
      ok: '>', bad: ['<', '==', '>='],
      hint: 'Solo hay que reemplazar al campeón cuando aparece alguien que lo supera de verdad.'
    },
    {
      que: 'una función que devuelve el doble de un número',
      code: 'def double(n):\n    ___ n * 2\n\nprint(double(7))',
      ok: 'return', bad: ['print', 'n =', 'double'],
      hint: 'print lo pinta en pantalla y se acaba ahí. Para poder escribir double(7) DENTRO de otra cosa, la función tiene que entregar el valor.'
    },
    {
      que: 'sumar solo los números pares de una lista',
      code: 'total = 0\nfor n in numbers:\n    if n % 2 == 0:\n        total = total ___ n\nprint(total)',
      ok: '+', bad: ['*', '-', '='],
      hint: 'El acumulador va creciendo con cada par que encuentra. ¿Qué operación hace crecer?'
    },
    {
      que: 'parar el bucle en cuanto encuentra lo que busca',
      code: 'for n in numbers:\n    if n == target:\n        print("found it")\n        ___',
      ok: 'break', bad: ['continue', 'return n', 'print(n)'],
      hint: 'Ya lo encontraste: seguir recorriendo el resto de la lista es trabajo tirado. La palabra en inglés significa "romper".'
    }
  ]
};

// ---- ¿Está bien este código? -----------------------------------------------
// Se enseña un programa que PARECE correcto y hay que decir qué le pasa. Uno
// de cada tres está bien de verdad, y esa es la gracia: si siempre hubiera un
// error, la respuesta se acertaría sin leer el código.
//
// Es lo que de verdad se hace al programar —mirar código ajeno y encontrar por
// qué no hace lo que dice— y no sale con ningún otro tipo de reto.

const CODIGO_REVISA = {
  3: [
    {
      que: 'sumar los números del 1 al 5',
      code: 'total = 0\nfor i in range(1, 6):\n    total = i\nprint(total)',
      ok: 'Pisa el total en vez de sumarle',
      bad: ['Está bien', 'El bucle empieza en el número equivocado', 'Falta imprimir el total'],
      hint: 'Mira la línea de dentro del bucle. ¿Suma, o reemplaza lo que había?'
    },
    {
      que: 'imprimir los números del 1 al 3',
      code: 'for i in range(1, 4):\n    print(i)',
      ok: 'Está bien',
      bad: ['El bucle no termina nunca', 'Falta crear la variable i', 'Imprime un número de más'],
      hint: 'Recórrelo con el dedo: i vale 1, luego 2, luego 3 —el 4 no entra—. ¿Sale algo raro?'
    },
    {
      que: 'decir si alguien es mayor de edad',
      code: 'if age > 18:\n    print("adult")\nelse:\n    print("minor")',
      ok: 'Con 18 exactos dice que es menor',
      bad: ['Está bien', 'Falta pedir la edad al principio', 'Las dos ramas dicen lo mismo'],
      hint: 'Prueba con age = 18. ¿Es 18 mayor que 18?'
    },
    {
      que: 'contar cuántas veces aparece la letra a',
      code: 'for letter in word:\n    count = 0\n    if letter == "a":\n        count = count + 1\nprint(count)',
      ok: 'El contador se reinicia en cada vuelta',
      bad: ['Está bien', 'Compara con la letra equivocada', 'Le falta el bucle'],
      hint: '¿Dónde está el "count = 0"? Si está dentro del bucle, ¿cuántas veces se ejecuta?'
    }
  ],
  4: [
    {
      que: 'recorrer una lista de 5 elementos',
      code: 'i = 0\nwhile i <= len(numbers):\n    print(numbers[i])\n    i = i + 1',
      ok: 'Se pasa del último elemento',
      bad: ['Está bien', 'Nunca entra al bucle', 'Empieza por el segundo'],
      hint: 'Si la lista tiene 5, sus posiciones son 0, 1, 2, 3 y 4. ¿Hasta dónde llega ese <=?',
      steps: ['Anota qué vale i en cada vuelta.', 'Escribe las posiciones que existen de verdad en la lista.', 'Compara la última vuelta con la última posición: ahí está el fallo.']
    },
    {
      que: 'dividir dos números',
      code: 'def divide(a, b):\n    return a / b\n\nprint(divide(10, 0))',
      ok: 'Revienta al dividir entre cero',
      bad: ['Está bien', 'Le faltan los paréntesis', 'Devuelve el resto en vez del cociente'],
      hint: 'Mira con qué se está llamando a la función, no solo lo que hay dentro de ella.'
    },
    {
      que: 'buscar un nombre en una lista',
      code: 'found = False\nfor n in names:\n    if n == target:\n        found = True\nif found:\n    print("found it")',
      ok: 'Está bien',
      bad: ['Nunca llega a ser True', 'Le falta el else', 'Compara mal los nombres'],
      hint: 'Es lento —recorre la lista entera aunque ya lo encontró— pero lento no es incorrecto. ¿Da la respuesta buena?'
    },
    {
      que: 'invertir el orden de una lista',
      code: 'new = []\ni = len(numbers) - 1\nwhile i >= 0:\n    new.append(numbers[i])\nprint(new)',
      ok: 'El bucle nunca termina',
      bad: ['Está bien', 'Empieza por el primero en vez del último', 'La lista nueva no se crea'],
      hint: '¿Quién cambia el valor de i dentro del bucle? Busca bien: nadie.'
    }
  ]
};

function completaRound(d) {
  const item = pick(CODIGO_COMPLETA[Math.min(4, Math.max(2, d))]);
  return {
    kind: 'choice',
    prompt: `Este programa sirve para ${item.que}, pero le falta una pieza. ¿Cuál va en el hueco?\n\n${item.code}`,
    lead: 'El hueco está marcado con ___',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee primero qué tiene que hacer el programa, antes de mirar el hueco.',
      'Tapa el hueco y pregúntate qué falta ahí para que eso pase.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function revisaRound(d) {
  const item = pick(CODIGO_REVISA[d >= 4 ? 4 : 3]);
  return {
    kind: 'choice',
    prompt: `Este programa debería ${item.que}. ¿Está bien?\n\n${item.code}`,
    lead: 'Cuidado: a veces sí está bien.',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: item.steps || [
      'Recórrelo línea por línea como si fueras la computadora.',
      'Anota cuánto vale cada variable después de cada línea.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

function codeRound(d) {
  // Antes de saber leer código hay que saber ordenar pasos: el nivel de abajo
  // juega solo a eso, sin una sola línea de programa.
  if (d <= 1) return algoritmoRound(d);

  // De aquí arriba el juego subió de nivel. Antes solo había tres cosas que
  // hacer —ordenar líneas, adivinar la salida y contestar una definición— y
  // ninguna se parecía a programar: nadie escribe un programa poniendo en
  // orden líneas que ya existen. Las dos nuevas sí:
  //
  //   completar  hay código escrito y le falta una pieza
  //   revisar    hay código escrito y hay que decir qué le pasa (o que no le
  //              pasa nada, que también sale)
  //
  // Se reparten a propósito: las de mirar código pesan más que las de
  // recitar definiciones, que son las que menos enseñan.
  if (d === 2) return pick([algoritmoRound, completaRound, salidaRound, completaRound])(d);
  if (d === 3) return pick([completaRound, revisaRound, salidaRound, programaRound, completaRound, conceptoRound])(d);
  return pick([revisaRound, completaRound, programaRound, salidaRound, revisaRound, conceptoRound])(d);
}

// ---- Catálogo --------------------------------------------------------------

const GAMES = [
  {
    id: 'mate-rescate',
    name: 'Rescate numérico',
    subject: 'Matemáticas',
    icon: '🧮',
    color: 'red',
    blurb: 'Robin cayó en un pozo de números. Cada operación correcta lo sube un escalón.',
    make: mathRound
  },
  {
    id: 'lengua-cazapalabras',
    name: 'Cazapalabras',
    subject: 'Lenguaje',
    icon: '📖',
    color: 'gold',
    blurb: 'Se escaparon las palabras del cuento. Atrápalas: rimas, ortografía y sinónimos.',
    make: languageRound
  },
  {
    id: 'ciencia-laboratorio',
    name: 'Laboratorio de Robin',
    subject: 'Ciencias',
    icon: '🔬',
    color: 'green',
    blurb: 'Experimentos que salen bien solo si entiendes qué está pasando.',
    make: scienceRound
  },
  {
    id: 'sociales-brujula',
    name: 'La brújula',
    subject: 'Estudios Sociales',
    icon: '🧭',
    color: 'blue',
    blurb: 'Mapas, fechas y cómo funciona el mundo de las personas.',
    make: socialRound
  },
  {
    id: 'ingles-wordbridge',
    name: 'Word Bridge',
    subject: 'Inglés',
    icon: '🌉',
    color: 'blue',
    blurb: 'Cruza el puente una palabra a la vez. Robin traduce solo si te trabas.',
    make: englishRound
  },
  {
    id: 'arte-nido',
    name: 'Nido de ritmos',
    subject: 'Arte y Música',
    icon: '🎨',
    color: 'gold',
    blurb: 'Colores que se mezclan, acordes que se arman y obras que hay que reconocer.',
    make: artRound
  },
  {
    id: 'codigo-taller',
    name: 'Taller de código',
    subject: 'Programación',
    icon: '💻',
    color: 'green',
    blurb: 'Ordena los pasos, arma el programa en Python y averigua qué imprime. Sin escribir una línea desde cero.',
    make: codeRound
  }
];

const GAME_IDS = GAMES.map(g => g.id);

function getGame(id) {
  return GAMES.find(g => g.id === id) || null;
}

// La ficha pública de un minijuego: lo que se dibuja en la galería, sin nada
// de la lógica de los retos.
function gameCard(game) {
  return {
    id: game.id,
    name: game.name,
    subject: game.subject,
    icon: game.icon,
    color: game.color,
    blurb: game.blurb
  };
}

function catalog() {
  return GAMES.map(gameCard);
}

// Arma un reto. Devuelve dos objetos: el que se le manda al navegador (sin la
// respuesta) y el secreto que se guarda en la sesión para calificar y dar
// pistas después.
function buildRound(gameId, difficulty) {
  const game = getGame(gameId);
  if (!game) return null;
  const d = Math.min(4, Math.max(1, Number(difficulty) || 2));
  const round = game.make(d);

  return {
    publicRound: {
      gameId: game.id,
      gameName: game.name,
      subject: game.subject,
      icon: game.icon,
      difficulty: d,
      kind: round.kind,
      prompt: round.prompt,
      lead: round.lead || null,
      options: round.options || null,
      // Solo los retos de armar: el montón de piezas y cuántas caben. La
      // respuesta sigue sin bajar, porque las piezas vienen revueltas y con
      // sobrantes: tenerlas no dice en qué orden van.
      pieces: round.pieces || null,
      slots: round.slots || null,
      join: round.join === undefined ? null : round.join,
      unordered: Boolean(round.unordered)
    },
    secret: {
      gameId: game.id,
      difficulty: d,
      // De qué tipo era el reto: lo mira isCorrect() para decidir si el acento
      // cuenta o no. Ver la nota sobre normalize().
      kind: round.kind,
      answer: String(round.answer),
      answerPieces: round.answerPieces || null,
      join: round.join === undefined ? ' ' : round.join,
      unordered: Boolean(round.unordered),
      hint: round.hint,
      steps: round.steps,
      startedAt: Date.now()
    }
  };
}

// Dos varas de medir, y la diferencia entre las dos importa mucho.
//
// normalize() es la blanda: además de mayúsculas y espacios, quita los
// acentos. Vale para lo que se ESCRIBE a mano —nadie debería fallar un reto de
// matemáticas por no encontrar la tilde en el teclado.
//
// igual() es la estricta: respeta el acento y la ñ. Vale para lo que se ELIGE
// o se ARMA, donde el texto sale de una lista que mandó el propio servidor y
// no hay nada que teclear.
//
// Que la blanda se usara en todo era un fallo que se comía juegos enteros:
// «árbol» y «arbol» normalizan igual, así que en «¿cuál está bien acentuada?»
// las cuatro opciones contaban como correctas y era imposible fallar. Lo mismo
// con «porque» y «porqué», y lo mismo al armar una palabra con letras, donde
// una «a» suelta pasaba por la «á» que tocaba.
function normalize(text) {
  return String(text == null ? '' : text)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// La vara estricta: mayúsculas y espacios sí se perdonan, los acentos no.
function igual(text) {
  return String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Un reto de armar llega como arreglo de piezas; los otros dos, como texto.
//
// Cuando el orden da igual (juntar sodio y cloro) se comparan los dos montones
// ordenados alfabéticamente, no la cadena: de lo contrario "cloro, sodio"
// contaría como error cuando es exactamente la misma mezcla.
function isCorrect(secret, submitted) {
  if (Array.isArray(submitted)) {
    const medir = igual; // las piezas las mandó el servidor: no hay nada que perdonar
    const esperadas = (secret.answerPieces || []).map(medir);
    const puestas = submitted.map(medir);
    if (puestas.length !== esperadas.length) return false;

    if (secret.unordered) {
      const a = puestas.slice().sort();
      const b = esperadas.slice().sort();
      return a.every((pieza, i) => pieza === b[i]);
    }
    return puestas.every((pieza, i) => pieza === esperadas[i]);
  }

  // Escribir a mano se mide con la vara blanda; elegir entre cuatro botones,
  // con la estricta. Ver la nota larga sobre normalize() arriba.
  const medir = secret.kind === 'input' ? normalize : igual;
  return medir(secret.answer) === medir(submitted);
}

module.exports = {
  GAMES, GAME_IDS, catalog, gameCard, getGame,
  buildRound, isCorrect, difficultyFor, difficultyForAge, normalize, LEVEL_DIFFICULTY
};
