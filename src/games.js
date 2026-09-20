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
// La de armar sale más a menudo porque enseña más: el resultado correcto con
// la ecuación mal puesta no existe.

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

function mathSolve(d) {
  if (d <= 1) {
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

  if (d === 2) {
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

  if (d === 3) {
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

  // Bachillerato: se arma desde las raíces para que siempre tenga solución entera.
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

function mathRound(d) {
  return Math.random() < 0.6 ? mathBuild(d) : mathSolve(d);
}

// ---- Lenguaje --------------------------------------------------------------
// Quien apenas está aprendiendo a leer no necesita que le pregunten por
// sinónimos: necesita formar la palabra. Por eso la materia está partida en
// dos mitades que casi no se parecen.
//
//   peques (1 y 2)   armar la palabra letra por letra, a partir de una pista.
//                    Es lo que de verdad se practica a esa edad.
//   grandes (3 y 4)  variedad: sinónimos, antónimos, ordenar una oración,
//                    conectores, acentuación y figuras literarias.

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
    { palabra: 'nube', pista: 'Es blanca, está en el cielo y trae lluvia.' }
  ],
  2: [
    { palabra: 'escuela', pista: 'El lugar donde aprendes con tus compañeros.' },
    { palabra: 'bicicleta', pista: 'Tiene dos ruedas y pedales.' },
    { palabra: 'ventana', pista: 'Por ahí entra la luz al cuarto.' },
    { palabra: 'montaña', pista: 'Es muy alta y hay que subirla.' },
    { palabra: 'cuaderno', pista: 'Ahí escribes lo que te enseñan.' },
    { palabra: 'mariposa', pista: 'Antes fue oruga y ahora vuela con colores.' },
    { palabra: 'biblioteca', pista: 'Está llena de libros y hay que hablar bajito.' }
  ]
};

const SPELLING = [
  { ok: 'hacer', bad: ['aser', 'acer', 'haser'], why: 'Lleva h al inicio y c antes de e.' },
  { ok: 'había', bad: ['abía', 'havía', 'habia'], why: 'Viene de haber: h muda y tilde en la í.' },
  { ok: 'vaya', bad: ['valla', 'baya', 'vayá'], why: 'Vaya es del verbo ir. Valla es una cerca y baya es un fruto.' },
  { ok: 'porque', bad: ['por que', 'porqué', 'por qué'], why: 'Junto y sin tilde cuando responde a una causa.' },
  { ok: 'también', bad: ['tambien', 'tanbien', 'tanvien'], why: 'Palabra aguda terminada en n: lleva tilde.' },
  { ok: 'excelente', bad: ['ecelente', 'exelente', 'escelente'], why: 'Se escribe con x seguida de c.' },
  { ok: 'bicicleta', bad: ['bisicleta', 'vicicleta', 'bicicletta'], why: 'Con b al inicio y c en las dos sílabas siguientes.' }
];

const SYNONYMS = [
  { word: 'veloz', ok: 'rápido', bad: ['lento', 'pesado', 'quieto'] },
  { word: 'alegre', ok: 'contento', bad: ['triste', 'enojado', 'aburrido'] },
  { word: 'enorme', ok: 'gigante', bad: ['diminuto', 'estrecho', 'liviano'] },
  { word: 'sabio', ok: 'culto', bad: ['torpe', 'distraído', 'ingenuo'] },
  { word: 'efímero', ok: 'pasajero', bad: ['eterno', 'sólido', 'enorme'] },
  { word: 'perspicaz', ok: 'astuto', bad: ['lento', 'callado', 'amable'] }
];

const ANTONYMS = [
  { word: 'generoso', ok: 'tacaño', bad: ['amable', 'alegre', 'sincero'] },
  { word: 'escaso', ok: 'abundante', bad: ['pequeño', 'barato', 'lejano'] },
  { word: 'humilde', ok: 'soberbio', bad: ['sencillo', 'tranquilo', 'pobre'] },
  { word: 'efímero', ok: 'perpetuo', bad: ['veloz', 'frágil', 'raro'] }
];

const RHYMES = [
  { word: 'gato', ok: 'pato', bad: ['perro', 'casa', 'sol'] },
  { word: 'flor', ok: 'color', bad: ['árbol', 'nube', 'pez'] },
  { word: 'ratón', ok: 'balón', bad: ['queso', 'mesa', 'lápiz'] }
];

// Oraciones para ordenar. Cada una tiene un solo orden natural en español.
const ORACIONES = [
  ['El', 'gato', 'duerme', 'sobre', 'la', 'mesa'],
  ['Mañana', 'entregamos', 'el', 'informe', 'de', 'ciencias'],
  ['La', 'profesora', 'explicó', 'el', 'tema', 'con', 'calma'],
  ['Robin', 'siempre', 'responde', 'cuando', 'le', 'preguntas']
];

// Acentuación: la palabra va sin tilde y hay que decir dónde cae.
const TILDES = [
  { ok: 'cántaro', bad: ['cantaro', 'cantáro', 'cantarò'], why: 'Es esdrújula: todas llevan tilde, sin excepción.' },
  { ok: 'compás', bad: ['compas', 'cómpas', 'compàs'], why: 'Aguda terminada en s: lleva tilde.' },
  { ok: 'árbol', bad: ['arbol', 'arból', 'àrbol'], why: 'Grave que NO termina en n, s ni vocal: lleva tilde.' },
  { ok: 'examen', bad: ['exámen', 'examén', 'exàmen'], why: 'Grave terminada en n: no lleva tilde.' }
];

const FIGURAS = [
  { q: '«Sus ojos son dos luceros». ¿Qué figura es?', ok: 'Metáfora', bad: ['Símil', 'Hipérbole', 'Personificación'], hint: 'Dice que una cosa ES otra, sin usar "como".' },
  { q: '«Corre como el viento». ¿Qué figura es?', ok: 'Símil', bad: ['Metáfora', 'Ironía', 'Metonimia'], hint: 'La palabra "como" es la pista: está comparando.' },
  { q: '«Te lo he dicho un millón de veces». ¿Qué figura es?', ok: 'Hipérbole', bad: ['Metáfora', 'Símil', 'Elipsis'], hint: 'Exagera a propósito, muchísimo más de lo real.' },
  { q: '«El viento susurraba entre los árboles». ¿Qué figura es?', ok: 'Personificación', bad: ['Hipérbole', 'Símil', 'Metáfora'], hint: 'Le da a algo que no está vivo una acción de persona.' }
];

const CONECTORES = [
  { q: 'Estudié toda la noche; ___, aprobé el examen.', ok: 'por lo tanto', bad: ['sin embargo', 'aunque', 'mientras'], hint: 'La segunda parte es la consecuencia de la primera.' },
  { q: 'Estudié toda la noche; ___, reprobé el examen.', ok: 'sin embargo', bad: ['por lo tanto', 'además', 'porque'], hint: 'La segunda parte contradice lo que se esperaba.' },
  { q: 'Trajo el cuaderno ___ olvidó el lápiz.', ok: 'pero', bad: ['porque', 'entonces', 'así que'], hint: 'Une dos cosas que se oponen.' }
];

// Peques: formar la palabra letra por letra.
function palabraRound(d) {
  const item = pick(PALABRAS[d <= 1 ? 1 : 2]);
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
  // Peques: siempre formar palabras. Es lo que toca practicar a esa edad y
  // repetirlo no aburre, porque la palabra cambia cada vez.
  if (d <= 2) {
    if (d <= 1) return Math.random() < 0.7 ? palabraRound(d) : rimaRound();
    return Math.random() < 0.55 ? palabraRound(d) : pick([rimaRound, ortografiaRound])();
  }

  // Grandes: seis tipos distintos de reto, uno cada vez.
  const tipos = [ortografiaRound, sinonimoRound, antonimoRound, oracionRound, tildeRound, conectorRound];
  if (d >= 4) tipos.push(figuraRound);
  return pick(tipos)(d);
}

function rimaRound() {
  const item = pick(RHYMES);
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

function ortografiaRound() {
  const item = pick(SPELLING);
  return {
    kind: 'choice',
    prompt: '¿Cuál de estas palabras está bien escrita?',
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: 'Fíjate en la h, en la b/v y en las tildes. Una sola letra cambiada ya la vuelve incorrecta.',
    steps: [
      'Lee las cuatro opciones despacio, letra por letra.',
      'Descarta las que cambien una consonante que suena igual (b/v, s/c/z).',
      `Regla que aplica aquí: ${item.why}`
    ]
  };
}

function sinonimoRound(d) {
  const item = pick(SYNONYMS);
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

function antonimoRound() {
  const item = pick(ANTONYMS);
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

function oracionRound() {
  const palabras = pick(ORACIONES);
  return build({
    prompt: 'Ordena las palabras para formar una oración correcta.',
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

function tildeRound() {
  const item = pick(TILDES);
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

function conectorRound() {
  const item = pick(CONECTORES);
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

function figuraRound() {
  const item = pick(FIGURAS);
  return {
    kind: 'choice',
    prompt: item.q,
    answer: item.ok,
    options: choices(item.ok, item.bad),
    hint: item.hint,
    steps: [
      'Lee la frase y pregúntate si lo que dice puede ser literal.',
      'Si compara con "como", es símil; si dice que una cosa es otra, metáfora.',
      `Pista de Robin: ${item.hint}`
    ]
  };
}

// ---- Ciencias --------------------------------------------------------------

const SCIENCE = {
  1: [
    { q: '¿Cuál de estos está vivo?', ok: 'Un árbol', bad: ['Una piedra', 'Una silla', 'Un lápiz'], hint: 'Lo que está vivo crece, come o respira.' },
    { q: '¿Qué necesitan las plantas para crecer?', ok: 'Agua y luz del sol', bad: ['Arena y viento', 'Solo piedras', 'Oscuridad'], hint: 'Piensa en lo que le das a una planta en casa.' },
    { q: '¿Dónde vive un pez?', ok: 'En el agua', bad: ['En el aire', 'Bajo la tierra', 'En el fuego'], hint: 'Fíjate cómo respira: tiene branquias, no pulmones.' }
  ],
  2: [
    { q: '¿Cómo se llama el paso del agua de líquido a gas?', ok: 'Evaporación', bad: ['Condensación', 'Solidificación', 'Filtración'], hint: 'Es lo que pasa cuando hierve el agua y sube el vapor.' },
    { q: '¿Qué órgano bombea la sangre por todo el cuerpo?', ok: 'El corazón', bad: ['El pulmón', 'El hígado', 'El estómago'], hint: 'Es el que late y puedes escuchar en el pecho.' },
    { q: '¿Qué parte de la planta absorbe el agua del suelo?', ok: 'La raíz', bad: ['La hoja', 'El tallo', 'La flor'], hint: 'Es la parte que no se ve, la que está enterrada.' }
  ],
  3: [
    { q: '¿Qué gas usan las plantas en la fotosíntesis?', ok: 'Dióxido de carbono', bad: ['Oxígeno', 'Nitrógeno', 'Hidrógeno'], hint: 'Es el gas que nosotros soltamos al exhalar.' },
    { q: '¿Cuál es la unidad básica de todos los seres vivos?', ok: 'La célula', bad: ['El átomo', 'El tejido', 'La molécula'], hint: 'Es lo más pequeño que todavía está vivo por sí mismo.' },
    { q: 'Si empujas algo y no se mueve, ¿qué fuerza lo frena contra el suelo?', ok: 'La fricción', bad: ['La gravedad', 'El magnetismo', 'La inercia'], hint: 'Piensa por qué cuesta más arrastrar una caja sobre alfombra que sobre hielo.' }
  ],
  4: [
    { q: 'En F = m·a, si la masa se duplica y la fuerza no cambia, ¿qué pasa con la aceleración?', ok: 'Se reduce a la mitad', bad: ['Se duplica', 'No cambia', 'Se hace cuatro veces mayor'], hint: 'Despeja a = F/m y mira qué le pasa al cociente cuando el de abajo crece.' },
    { q: '¿Qué enlace se forma cuando dos átomos comparten electrones?', ok: 'Covalente', bad: ['Iónico', 'Metálico', 'Puente de hidrógeno'], hint: 'Compartir, no ceder. El que cede electrones es el otro tipo.' },
    { q: '¿En qué fase de la mitosis se alinean los cromosomas en el centro de la célula?', ok: 'Metafase', bad: ['Profase', 'Anafase', 'Telofase'], hint: 'El prefijo "meta" te dice que va justo en medio del proceso.' }
  ]
};

// Las fusiones: el laboratorio de verdad. Hay un frasco vacío y un montón de
// ingredientes, y hay que meter los DOS que dan lo que se pide. El orden da
// igual (sodio con cloro es lo mismo que cloro con sodio), así que el reto es
// saber qué reacciona con qué, no en qué orden se escribe.
const FUSIONES = {
  1: [
    { sale: 'lodo', con: ['tierra', 'agua'], sobran: ['piedra', 'hoja', 'aire'], pista: 'Piensa en lo que se hace en el patio cuando llueve.' },
    { sale: 'una planta', con: ['semilla', 'agua'], sobran: ['piedra', 'arena', 'hielo'], pista: 'Algo que se siembra más algo que se riega.' },
    { sale: 'un charco congelado', con: ['agua', 'frío'], sobran: ['fuego', 'viento', 'tierra'], pista: '¿Qué le tiene que pasar al agua para ponerse dura?' },
    { sale: 'humo', con: ['fuego', 'madera'], sobran: ['agua', 'hielo', 'arena'], pista: 'Lo que sube de una fogata.' }
  ],
  2: [
    { sale: 'vapor de agua', con: ['agua', 'calor'], sobran: ['frío', 'sal', 'tierra'], pista: 'Es lo que sale de la olla cuando hierve.' },
    { sale: 'agua líquida', con: ['hielo', 'calor'], sobran: ['frío', 'vapor', 'aire'], pista: 'Fusión se llama justo a este cambio de estado.' },
    { sale: 'agua salada', con: ['agua', 'sal'], sobran: ['aceite', 'arena', 'azúcar'], pista: 'Una se disuelve en la otra y ya no se ve.' },
    { sale: 'oxígeno (fotosíntesis)', con: ['luz del sol', 'dióxido de carbono'], sobran: ['oxígeno', 'nitrógeno', 'oscuridad'], pista: 'La planta necesita luz y el gas que nosotros exhalamos.' }
  ],
  3: [
    { sale: 'agua (H₂O)', con: ['hidrógeno', 'oxígeno'], sobran: ['carbono', 'nitrógeno', 'sodio'], pista: 'La fórmula te dice los dos elementos: H y O.' },
    { sale: 'sal de mesa (NaCl)', con: ['sodio', 'cloro'], sobran: ['potasio', 'oxígeno', 'calcio'], pista: 'Na y Cl. Uno cede un electrón y el otro lo toma.' },
    { sale: 'dióxido de carbono (CO₂)', con: ['carbono', 'oxígeno'], sobran: ['hidrógeno', 'azufre', 'hierro'], pista: 'C y O: lo que sueltas al exhalar.' },
    { sale: 'óxido de hierro (herrumbre)', con: ['hierro', 'oxígeno'], sobran: ['cloro', 'sodio', 'nitrógeno'], pista: 'Es lo que le pasa a un clavo mojado con el tiempo.' }
  ],
  4: [
    { sale: 'una sal y agua', con: ['un ácido', 'una base'], sobran: ['un metal noble', 'un gas inerte', 'agua destilada'], pista: 'Se llama reacción de neutralización.' },
    { sale: 'amoníaco (NH₃)', con: ['nitrógeno', 'hidrógeno'], sobran: ['oxígeno', 'cloro', 'carbono'], pista: 'N y H, en el proceso de Haber-Bosch.' },
    { sale: 'un enlace covalente', con: ['dos no metales', 'electrones compartidos'], sobran: ['un metal', 'electrones cedidos', 'un ion'], pista: 'Compartir, no ceder: eso es lo covalente.' },
    { sale: 'un enlace iónico', con: ['un metal', 'un no metal'], sobran: ['dos no metales', 'dos metales', 'electrones compartidos'], pista: 'Uno cede electrones del todo y el otro los queda.' }
  ]
};

function fusionRound(d) {
  const item = pick(FUSIONES[Math.min(4, Math.max(1, d))]);
  return build({
    prompt: `Fusión: mete en el frasco los DOS ingredientes que dan ${item.sale}.`,
    lead: 'El orden da igual. Sobran tres ingredientes que no sirven aquí.',
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
  if (Math.random() < 0.55) return fusionRound(d);

  const item = pick(SCIENCE[Math.min(4, Math.max(1, d))]);
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

const SOCIAL = {
  1: [
    { q: '¿Quién nos ayuda cuando hay un incendio?', ok: 'Los bomberos', bad: ['El panadero', 'El cartero', 'El pintor'], hint: 'Piensa en quién llega en el camión rojo.' },
    { q: '¿Cómo se llama el lugar donde vives con tu familia?', ok: 'El hogar', bad: ['La escuela', 'El parque', 'El mercado'], hint: 'Es el lugar donde duermes cada noche.' }
  ],
  2: [
    { q: '¿Qué instrumento sirve para orientarse y señala siempre al norte?', ok: 'La brújula', bad: ['El reloj', 'El termómetro', 'La regla'], hint: 'Tiene una aguja imantada que gira sola.' },
    { q: '¿Cómo se llama el mapa que muestra montañas y ríos?', ok: 'Mapa físico', bad: ['Mapa político', 'Mapa del metro', 'Mapa del clima'], hint: 'Físico viene del terreno mismo, no de las fronteras.' }
  ],
  3: [
    { q: 'De estos hechos, ¿cuál ocurrió primero?', ok: 'La independencia de Centroamérica (1821)', bad: ['La Segunda Guerra Mundial (1939)', 'La llegada del hombre a la Luna (1969)', 'La caída del Muro de Berlín (1989)'], hint: 'Mira solo los años y busca el número más pequeño.' },
    { q: '¿Qué es una democracia?', ok: 'Un sistema donde el pueblo elige a sus gobernantes', bad: ['Un sistema donde manda una sola familia', 'Un sistema sin leyes', 'Un sistema donde manda el ejército'], hint: 'La palabra viene del griego: demos = pueblo, kratos = poder.' }
  ],
  4: [
    { q: '¿Cuál es la función principal del poder legislativo?', ok: 'Crear y aprobar las leyes', bad: ['Aplicar las leyes', 'Juzgar los delitos', 'Dirigir el ejército'], hint: 'La palabra "legislar" ya te da casi toda la respuesta.' },
    { q: 'Que haya inflación alta significa que...', ok: 'El dinero pierde poder de compra', bad: ['Los precios bajan', 'Sube el ahorro', 'Baja el desempleo siempre'], hint: 'Si todo cuesta más, ¿qué le pasa al mismo billete de ayer?' }
  ]
};

function socialRound(d) {
  const item = pick(SOCIAL[Math.min(4, Math.max(1, d))]);
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

const ENGLISH = {
  1: [
    { q: '¿Cómo se dice «perro» en inglés?', ok: 'dog', bad: ['cat', 'cow', 'bird'] },
    { q: '¿Cómo se dice «rojo» en inglés?', ok: 'red', bad: ['blue', 'green', 'black'] },
    { q: '¿Cómo se dice «casa» en inglés?', ok: 'house', bad: ['horse', 'mouse', 'chair'] }
  ],
  2: [
    { q: 'Completa: «I ___ a student.»', ok: 'am', bad: ['is', 'are', 'be'] },
    { q: '¿Cómo se dice «mañana» (el día siguiente)?', ok: 'tomorrow', bad: ['morning', 'today', 'yesterday'] },
    { q: 'Completa: «She ___ to school every day.»', ok: 'goes', bad: ['go', 'going', 'gone'] }
  ],
  3: [
    { q: 'Completa: «If it rains, we ___ stay home.»', ok: 'will', bad: ['would', 'were', 'are'] },
    { q: '¿Cuál es el pasado de «buy»?', ok: 'bought', bad: ['buyed', 'bught', 'binded'] },
    { q: 'Completa: «I have lived here ___ 2019.»', ok: 'since', bad: ['for', 'during', 'ago'] }
  ],
  4: [
    { q: 'Completa: «If I ___ more time, I would travel.»', ok: 'had', bad: ['have', 'will have', 'would have'] },
    { q: 'Completa en voz pasiva: «The report ___ by the team yesterday.»', ok: 'was written', bad: ['wrote', 'is writing', 'has wrote'] },
    { q: '¿Qué significa el phrasal verb «to give up»?', ok: 'rendirse', bad: ['regalar', 'levantarse', 'subir'] }
  ]
};

const ENGLISH_HINTS = {
  1: 'Di la palabra en voz alta. Muchas se parecen bastante al español.',
  2: 'Mira quién hace la acción: I → am, he/she/it → is, y al verbo se le agrega -s.',
  3: 'Fíjate en el tiempo que pide la frase: pasado, futuro o presente perfecto.',
  4: 'Revisa la estructura completa: condicional, voz pasiva o phrasal verb.'
};

// Spelling bee. Las palabras suben de dificultad con el nivel, y cada una trae
// el detalle que la hace caer en un concurso de verdad.
const SPELLING_BEE = {
  1: [
    { es: 'gato', en: 'cat', ojo: 'Tres letras y empieza con el sonido /k/, pero se escribe con c.' },
    { es: 'libro', en: 'book', ojo: 'Lleva dos oes juntas.' },
    { es: 'azul', en: 'blue', ojo: 'Termina en -ue, y esa e no suena.' },
    { es: 'árbol', en: 'tree', ojo: 'Doble e al final.' },
    { es: 'pez', en: 'fish', ojo: 'El sonido /sh/ se escribe con s y h juntas.' }
  ],
  2: [
    { es: 'escuela', en: 'school', ojo: 'Empieza con sch, aunque suene /sk/.' },
    { es: 'amigo', en: 'friend', ojo: 'Lleva una i que no se oye: fr-i-end.' },
    { es: 'jueves', en: 'thursday', ojo: 'Th al principio y una r después de u.' },
    { es: 'naranja', en: 'orange', ojo: 'Termina en -ge, no en -ch.' },
    { es: 'porque', en: 'because', ojo: 'Termina en -ause, con esa e final muda.' }
  ],
  3: [
    { es: 'hermoso', en: 'beautiful', ojo: 'Tres vocales seguidas al principio: b-e-a-u.' },
    { es: 'necesario', en: 'necessary', ojo: 'Una c y dos eses. Es la que más se falla.' },
    { es: 'gobierno', en: 'government', ojo: 'Lleva una n en medio que casi no se pronuncia: govern-ment.' },
    { es: 'recibir', en: 'receive', ojo: 'Después de c va ei, no ie.' },
    { es: 'separado', en: 'separate', ojo: 'La del medio es una a, no una e.' }
  ],
  4: [
    { es: 'conciencia', en: 'conscience', ojo: 'Lleva sc en medio: con-sci-ence.' },
    { es: 'vergonzoso', en: 'embarrassed', ojo: 'Dos erres y dos eses. Las dos dobles.' },
    { es: 'suceso', en: 'occurrence', ojo: 'Dos ces y dos erres.' },
    { es: 'emprendedor', en: 'entrepreneur', ojo: 'Viene del francés y se escribe tal cual: entre-pre-neur.' },
    { es: 'rítmico', en: 'rhythm', ojo: 'Solo tiene una vocal visible: la y hace de vocal.' }
  ]
};

function spellingBeeRound(d) {
  const item = pick(SPELLING_BEE[Math.min(4, Math.max(1, d))]);
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

  const item = pick(ENGLISH[level]);
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
// obras. Antes solo había dos retos (mezclar colores y seguir la escala) y se
// repetían a la tercera partida. Ahora son siete y salen al azar.

const COLOR_MIX = [
  { a: 'azul', b: 'amarillo', ok: 'verde', bad: ['morado', 'naranja', 'café'] },
  { a: 'rojo', b: 'amarillo', ok: 'naranja', bad: ['verde', 'morado', 'gris'] },
  { a: 'rojo', b: 'azul', ok: 'morado', bad: ['verde', 'naranja', 'rosa'] }
];

const NOTE_SEQ = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];

// Acordes mayores, para armar juntando sus tres notas. El orden da igual.
const ACORDES = [
  { nombre: 'do mayor', notas: ['do', 'mi', 'sol'], sobran: ['re', 'fa', 'la'] },
  { nombre: 'fa mayor', notas: ['fa', 'la', 'do'], sobran: ['mi', 'sol', 'si'] },
  { nombre: 'sol mayor', notas: ['sol', 'si', 're'], sobran: ['do', 'fa', 'la'] },
  { nombre: 're menor', notas: ['re', 'fa', 'la'], sobran: ['do', 'mi', 'si'] }
];

const INSTRUMENTOS = [
  { q: '¿A qué familia pertenece el violín?', ok: 'Cuerda', bad: ['Viento', 'Percusión', 'Teclado'], hint: 'Suena porque el arco frota unos hilos tensados.' },
  { q: '¿A qué familia pertenece la trompeta?', ok: 'Viento', bad: ['Cuerda', 'Percusión', 'Cuerda frotada'], hint: 'Suena porque soplas aire dentro.' },
  { q: '¿A qué familia pertenece el timbal?', ok: 'Percusión', bad: ['Viento', 'Cuerda', 'Teclado'], hint: 'Suena porque lo golpeas.' },
  { q: '¿Qué instrumento es a la vez de cuerda y de percusión?', ok: 'El piano', bad: ['La guitarra', 'El arpa', 'El violonchelo'], hint: 'Tiene cuerdas dentro, pero unos martillos las golpean.' }
];

const FIGURAS_MUSICALES = [
  { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una negra?', ok: '1 tiempo', bad: ['2 tiempos', '4 tiempos', 'medio tiempo'], hint: 'Cada figura dura la mitad que la anterior: redonda, blanca, negra.' },
  { q: 'Si una redonda dura 4 tiempos, ¿cuánto dura una blanca?', ok: '2 tiempos', bad: ['1 tiempo', '4 tiempos', '8 tiempos'], hint: 'La blanca es la mitad de la redonda.' },
  { q: '¿Cuántas corcheas caben en una negra?', ok: '2', bad: ['4', '1', '8'], hint: 'La corchea dura la mitad que la negra.' }
];

const COLOR_TEORIA = [
  { q: '¿Cuáles son los tres colores primarios?', ok: 'Rojo, azul y amarillo', bad: ['Verde, naranja y morado', 'Blanco, negro y gris', 'Rojo, verde y azul'], hint: 'Son los que no se pueden obtener mezclando otros.' },
  { q: '¿Qué color es complementario del rojo?', ok: 'Verde', bad: ['Azul', 'Naranja', 'Morado'], hint: 'Está justo enfrente en la rueda de color.' },
  { q: '¿Qué pasa si mezclas un color con su complementario?', ok: 'Se apaga y tira a gris', bad: ['Se vuelve más brillante', 'No cambia nada', 'Se vuelve primario'], hint: 'Los opuestos de la rueda se neutralizan entre sí.' },
  { q: 'Los colores cálidos son…', ok: 'Rojo, naranja y amarillo', bad: ['Azul, verde y morado', 'Blanco y negro', 'Solo el rojo'], hint: 'Piensa en el fuego y el sol.' }
];

const OBRAS = [
  { q: '¿Quién pintó «La noche estrellada»?', ok: 'Vincent van Gogh', bad: ['Pablo Picasso', 'Claude Monet', 'Salvador Dalí'], hint: 'Un pintor neerlandés de pinceladas gruesas y arremolinadas.' },
  { q: '¿A qué movimiento pertenece «Las señoritas de Avignon», de Picasso?', ok: 'Cubismo', bad: ['Impresionismo', 'Surrealismo', 'Romanticismo'], hint: 'Descompone las figuras en planos con esquinas.' },
  { q: '«Los relojes blandos» de Dalí pertenecen al…', ok: 'Surrealismo', bad: ['Cubismo', 'Realismo', 'Barroco'], hint: 'Pinta cosas imposibles, como de un sueño.' },
  { q: '¿Qué buscaban los impresionistas como Monet?', ok: 'Captar la luz de un instante', bad: ['Copiar la realidad al detalle', 'Pintar solo temas religiosos', 'Usar únicamente blanco y negro'], hint: 'El nombre viene de un cuadro suyo: «Impresión, sol naciente».' }
];

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

function artPregunta(lista) {
  const item = pick(lista);
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
      artMezcla,
      artEscalaArmada,
      () => artEscala(d),
      () => artPregunta(INSTRUMENTOS)
    ])();
  }
  return pick([
    () => artEscala(d),
    artAcorde,
    artEscalaArmada,
    () => artPregunta(INSTRUMENTOS),
    () => artPregunta(FIGURAS_MUSICALES),
    () => artPregunta(COLOR_TEORIA),
    () => artPregunta(OBRAS)
  ])();
}

// ---- Programación ----------------------------------------------------------
// La materia nueva. Se aprende a programar leyendo y ordenando código, no
// eligiendo entre cuatro botones, así que casi todos los retos son de armar:
// se ordenan los pasos de un algoritmo, las líneas de un programa o las piezas
// de una condición. Los pocos de opción múltiple son para "¿qué imprime esto?",
// que es lo único que sí se contesta con un valor.

const ALGORITMOS = {
  1: [
    { que: 'lavarte los dientes', pasos: ['Tomar el cepillo', 'Ponerle pasta', 'Cepillar los dientes', 'Enjuagarse la boca'] },
    { que: 'hacer un sándwich', pasos: ['Sacar el pan', 'Poner el relleno', 'Tapar con la otra rebanada', 'Comérselo'] },
    { que: 'salir de casa', pasos: ['Ponerse los zapatos', 'Tomar la mochila', 'Abrir la puerta', 'Cerrar con llave'] }
  ],
  2: [
    { que: 'sembrar una planta', pasos: ['Hacer un hoyo en la tierra', 'Poner la semilla dentro', 'Taparla con tierra', 'Regarla con agua'] },
    { que: 'buscar un libro en la biblioteca', pasos: ['Buscar el título en el catálogo', 'Anotar en qué estante está', 'Ir a ese estante', 'Tomar el libro'] }
  ]
};

// Programas cortos en pseudocódigo, para ordenar línea por línea.
const PROGRAMAS = {
  3: [
    {
      que: 'sumar los números del 1 al 5',
      lineas: ['total = 0', 'para i desde 1 hasta 5', '    total = total + i', 'mostrar total'],
      pista: 'Una variable se crea ANTES de usarla, y el resultado se muestra al final, cuando ya está completo.'
    },
    {
      que: 'decir si alguien es mayor de edad',
      lineas: ['edad = pedirNumero()', 'si edad >= 18', '    mostrar "mayor"', 'si no', '    mostrar "menor"'],
      pista: 'Primero se consigue el dato, después se pregunta por él. No puedes comparar algo que todavía no existe.'
    }
  ],
  4: [
    {
      que: 'encontrar el número más grande de una lista',
      lineas: ['mayor = lista[0]', 'para cada n en lista', '    si n > mayor', '        mayor = n', 'mostrar mayor'],
      pista: 'Se empieza suponiendo que el primero es el mayor, y se va corrigiendo al recorrer el resto.'
    },
    {
      que: 'contar cuántas veces aparece una letra',
      lineas: ['cuenta = 0', 'para cada letra en palabra', '    si letra == buscada', '        cuenta = cuenta + 1', 'mostrar cuenta'],
      pista: 'El contador arranca en cero fuera del bucle; si lo pones dentro, se reinicia en cada vuelta.'
    }
  ]
};

const CODIGO_SALIDA = {
  2: [
    { code: 'x = 3\ny = 4\nmostrar x + y', ok: '7', bad: ['34', '12', '1'], hint: 'El signo + entre dos números los suma; no los pega uno al lado del otro.' },
    { code: 'contador = 0\ncontador = contador + 2\ncontador = contador + 2\nmostrar contador', ok: '4', bad: ['2', '0', '22'], hint: 'Cada línea reemplaza el valor anterior. Ve anotando cuánto vale después de cada una.' }
  ],
  3: [
    { code: 'total = 0\npara i desde 1 hasta 4\n    total = total + i\nmostrar total', ok: '10', bad: ['4', '24', '0'], hint: 'Da la vuelta cuatro veces: 1, luego 1+2, luego 1+2+3…' },
    { code: 'palabra = "robin"\nmostrar largo(palabra)', ok: '5', bad: ['4', '6', 'robin'], hint: 'Cuenta las letras una por una, incluida la última.' },
    { code: 'x = 10\nsi x > 5\n    mostrar "grande"\nsi no\n    mostrar "chico"', ok: 'grande', bad: ['chico', '10', 'nada'], hint: '¿Es cierto que 10 es mayor que 5? Solo se ejecuta la rama que sea verdadera.' }
  ],
  4: [
    { code: 'lista = [3, 1, 4, 1, 5]\nmostrar largo(lista)', ok: '5', bad: ['4', '14', '3'], hint: 'Cuenta los elementos, aunque alguno se repita: el 1 aparece dos veces y cuenta dos veces.' },
    { code: 'x = 7\nmostrar x % 2', ok: '1', bad: ['3', '3.5', '0'], hint: 'El % da el RESTO de la división, no el resultado.' },
    { code: 'total = 1\npara i desde 1 hasta 4\n    total = total * i\nmostrar total', ok: '24', bad: ['10', '4', '0'], hint: 'Es un producto, no una suma: 1·1·2·3·4.' }
  ]
};

const CODIGO_CONCEPTO = {
  3: [
    { q: '¿Para qué sirve un bucle (un "para" o un "mientras")?', ok: 'Repetir instrucciones sin escribirlas muchas veces', bad: ['Guardar un dato', 'Decidir entre dos caminos', 'Terminar el programa'], hint: 'Si tienes que hacer lo mismo 100 veces, ¿lo escribes 100 veces?' },
    { q: '¿Qué es una variable?', ok: 'Un nombre que guarda un valor', bad: ['Una orden que se repite', 'Un error del programa', 'Un tipo de bucle'], hint: 'Es como una caja con etiqueta: guardas algo y luego lo pides por su nombre.' },
    { q: 'Si un bucle nunca cambia su condición, ¿qué pasa?', ok: 'Se repite para siempre', bad: ['Se salta el bucle', 'Da error de sintaxis', 'Se ejecuta una sola vez'], hint: 'Si la puerta de salida nunca se abre, no se sale.' }
  ],
  4: [
    { q: '¿Qué hace una función?', ok: 'Agrupa pasos con un nombre para poder reutilizarlos', bad: ['Guarda un solo número', 'Repite siempre lo mismo sin cambiar', 'Borra las variables'], hint: 'Le das un nombre a un bloque de trabajo y lo llamas cuando lo necesitas.' },
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
      'Las líneas con sangría van dentro del bucle o del "si" que tienen justo arriba.',
      `Pista de Robin: ${item.pista}`
    ]
  });
}

function salidaRound(d) {
  const item = pick(CODIGO_SALIDA[Math.min(4, Math.max(2, d))]);
  return {
    kind: 'choice',
    prompt: `¿Qué muestra este programa?\n\n${item.code}`,
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

function codeRound(d) {
  // Antes de saber leer código hay que saber ordenar pasos: los dos niveles
  // de abajo juegan solo a eso, sin una sola línea de programa.
  if (d <= 1) return algoritmoRound(d);
  if (d === 2) return Math.random() < 0.6 ? algoritmoRound(d) : salidaRound(d);
  return pick([programaRound, salidaRound, conceptoRound, programaRound])(d);
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
    blurb: 'Ordena los pasos, arma el programa y averigua qué imprime. Sin escribir una línea desde cero.',
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

// Compara sin castigar por mayúsculas, acentos o espacios de más: el reto es
// de la materia, no de teclear exacto.
function normalize(text) {
  return String(text == null ? '' : text)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// Un reto de armar llega como arreglo de piezas; los otros dos, como texto.
//
// Cuando el orden da igual (juntar sodio y cloro) se comparan los dos montones
// ordenados alfabéticamente, no la cadena: de lo contrario "cloro, sodio"
// contaría como error cuando es exactamente la misma mezcla.
function isCorrect(secret, submitted) {
  if (Array.isArray(submitted)) {
    const esperadas = (secret.answerPieces || []).map(normalize);
    const puestas = submitted.map(normalize);
    if (puestas.length !== esperadas.length) return false;

    if (secret.unordered) {
      const a = puestas.slice().sort();
      const b = esperadas.slice().sort();
      return a.every((pieza, i) => pieza === b[i]);
    }
    return puestas.every((pieza, i) => pieza === esperadas[i]);
  }
  return normalize(secret.answer) === normalize(submitted);
}

module.exports = {
  GAMES, GAME_IDS, catalog, gameCard, getGame,
  buildRound, isCorrect, difficultyFor, difficultyForAge, normalize, LEVEL_DIFFICULTY
};
