// src/robin-guardia.js
// ---------------------------------------------------------------------------
// Lo que Robin no hace, en un solo archivo.
//
// Tres reglas, y las tres se comprueban en el servidor porque las tres tienen
// que cumplirse igual con clave de API y sin ella:
//
//   1. NUNCA da la respuesta. Ni de un ejercicio, ni de una traducción, ni de
//      un examen, ni «solo para comprobar». Se mira lo que se le pide ANTES de
//      llamar a la API y se mira lo que contesta DESPUÉS: el prompt es una
//      petición, no una garantía, y en la exposición se vio que un modelo
//      servicial acaba soltando la respuesta de inglés con la mejor intención
//      del mundo.
//   2. Solo habla de estudio. Si le preguntan por trends, futbolistas o
//      videojuegos, no contesta eso: devuelve la conversación al reto que hay
//      en pantalla o a lo último que sí venía a cuento.
//   3. Las groserías se tapan. Las de quien escribe y las de quien contesta.
//
// Por qué aquí y no dentro de routes/ai.js: son reglas del producto, no del
// transporte. Las usa el chat, las usa la ayuda con una asignación y las usa
// la caja de preguntar de los minijuegos, y las tres tienen que decir lo
// mismo. Un archivo aparte también se puede leer de corrido para saber qué
// tiene prohibido Robin, que es la pregunta que hace todo el mundo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Normalizar
// ---------------------------------------------------------------------------
// Todo lo de aquí abajo compara palabras, y una palabra llega de mil formas:
// «MATEMÁTICAS», «matematicas», «Mátematícas», «m4tematicas». Se compara
// siempre sobre el texto ya aplanado — minúsculas, sin acentos y con los
// números que se usan como letras devueltos a su letra — para que una regla no
// se caiga porque alguien escribió sin tildes.

function aplanar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's');
}

// ---------------------------------------------------------------------------
// 3. Las groserías
// ---------------------------------------------------------------------------
// La lista es corta a propósito y solo trae lo que no tiene otro significado.
// Nada de «concha», «polla», «zorra» ni «bicho»: son marisco, gallina, animal
// y, en media Centroamérica, niño. Taparlas dejaría la clase de biología
// llena de asteriscos, que es peor que la palabrota.
//
// Se buscan por RAÍZ, no por palabra exacta: «putas», «putazo» y «putísimo»
// salen todos de «put».

const GROSERIAS = [
  'put', 'mierd', 'pendej', 'cabron', 'ching', 'verga', 'pinch',
  'culer', 'joder', 'jodet', 'gilipoll', 'maricon', 'marica',
  'imbecil', 'estupid', 'idiot', 'tarad', 'pelotud', 'bolud', 'carajo',
  'hijueput', 'hijodeput', 'malparid', 'gonorrea', 'cerot', 'culia',
  'mamaguev', 'mamaverg', 'chupam',
  'fuck', 'shit', 'bitch', 'asshole', 'dumbass', 'bastard', 'whore',
  'slut', 'retard', 'faggot', 'nigg', 'cunt', 'dickhead'
];

// Una palabra suelta del texto, con sus letras y nada más. El grupo de letras
// se escribe a mano (y no con \w) para que las tildes cuenten como parte de la
// palabra: sin eso, «pendejó» se partiría en dos y se escaparía.
const PALABRA_RE = /[A-Za-zÀ-ÿ0-9@$_'-]+/g;

function esGroseria(palabra) {
  const limpia = aplanar(palabra).replace(/[^a-z]/g, '');
  if (limpia.length < 3) return false;
  return GROSERIAS.some(raiz => limpia.startsWith(raiz));
}

// Tapa las groserías y dice si había alguna.
//
// Se tapan con asteriscos dejando la primera letra: así quien lo lee sabe que
// ahí había una palabra y no un error de la pantalla, y quien la escribió se
// ve corregido sin que se le repita lo que dijo.
function censurar(texto) {
  let hubo = false;
  const salida = String(texto || '').replace(PALABRA_RE, (palabra) => {
    if (!esGroseria(palabra)) return palabra;
    hubo = true;
    return palabra[0] + '*'.repeat(Math.max(2, palabra.length - 1));
  });
  return { texto: salida, hubo };
}

// Lo que Robin dice cuando le hablan mal. No regaña ni suelta un sermón: lo
// nombra en una línea y sigue con lo que se estaba haciendo, que es lo que
// hace un adulto que no quiere convertirlo en el tema de la tarde.
const POR_GROSERIA = [
  'Esa palabra la dejamos fuera y seguimos, que lo otro sí importa.',
  'Sin groserías nos entendemos igual de bien. ¿Por dónde íbamos?',
  'Eso no hace falta para estudiar. Cuéntamelo otra vez y te ayudo.'
];

function porGroseria() {
  return POR_GROSERIA[Math.floor(Math.random() * POR_GROSERIA.length)];
}

// ---------------------------------------------------------------------------
// 1. Nunca da la respuesta
// ---------------------------------------------------------------------------
// Lo que se pide se mira por partes, porque «dame la respuesta» es solo la
// forma más obvia de pedirla. Las otras son las que fallaron en la exposición:
// una frase en inglés para traducir, un hueco para rellenar, cuatro opciones
// con su a) b) c) d), o una cuenta pelada sin verbo ninguno.

const PEDIR = '(?:dame|dime|dimelo|cu[aá]l\\s+es|cu[aá]les\\s+son|necesito|p[aá]same|escr[ií]beme|h[aá]zme(?:lo|la)?|m[aá]ndame|ay[uú]dame\\s+con|contesta(?:me)?|resp[oó]nde(?:me)?)';

// A. Piden la respuesta llamándola por su nombre.
const PIDE_RESPUESTA_RE = new RegExp(
  '\\b' + PEDIR + '\\b[^?.!¿¡]{0,60}\\b(?:la\\s+|el\\s+|las\\s+|los\\s+)?' +
  '(?:respuestas?|resultados?|soluci[oó]n|soluciones|answers?|tarea\\s+(?:hecha|resuelta|completa))\\b',
  'i'
);

// B. Verbos que ya son «hazlo tú por mí». Aquí no hace falta que digan la
//    palabra respuesta: el verbo ya la está pidiendo.
const PIDE_RESOLVER_RE = /\b(?:resu[eé]lve(?:me)?(?:lo|la|las|los)?|resolver(?:me|lo|la)?|calc[uú]la(?:me)?(?:lo|la)?|calcular(?:me|lo)?|simplifica|factoriza|deriva|integra|despeja|desarr[oó]lla(?:me)?|cu[aá]nto\s+(?:es|da|vale|mide|queda|sale|suma)|a\s+cu[aá]nto\s+(?:es|equivale)|qu[eé]\s+(?:da|sale)\b)/i;

// C. Que lo escriba él: el ensayo, el resumen, el informe, la redacción.
const PIDE_HACERLO_RE = /\b(?:h[aá]zme|hazme|hacer(?:me)?|me\s+(?:haces|escribes|redactas)|puedes?\s+(?:hacer|escribir|redactar|resumir)(?:me)?|escr[ií]be(?:me)?|red[aá]cta(?:me)?|res[uú]me(?:me)?|inv[eé]ntame)\s+(?:un[ao]?\s+|el\s+|la\s+|mi\s+|los\s+|las\s+)?(?:tarea|deber|ensayo|resumen|res[uú]men|informe|reporte|trabajo|composici[oó]n|redacci[oó]n|carta|poema|cuento|c[oó]digo|programa|conclusi[oó]n|introducci[oó]n|an[aá]lisis)\b/i;

// D. Traducir. Es la que se escapó en la exposición: «¿cómo se dice tortuga en
//    inglés?» no lleva la palabra respuesta, no lleva verbo de resolver, y aun
//    así es exactamente la respuesta de un ejercicio de inglés.
const PIDE_TRADUCIR_RE = /\b(?:trad[uú]ce(?:me)?(?:lo|la|las|los)?|traducir(?:me|lo|la)?|traducci[oó]n\s+de|translate|c[oó]mo\s+se\s+(?:dice|escribe|traduce)|qu[eé]\s+significa\b[^?.!]{0,40}\ben\s+(?:ingl[eé]s|espa[nñ]ol|franc[eé]s)|how\s+do\s+you\s+say|what\s+does\b[^?.!]{0,40}\bmean|en\s+ingl[eé]s\s*[:?])/i;

// E. Conjugar, declinar, analizar: la respuesta de un ejercicio de lengua.
const PIDE_CONJUGAR_RE = /\b(?:conjuga(?:me)?|conjugar|declina|analiza\s+(?:sint[aá]ctica|morfol[oó]gica|gramatical)|an[aá]lisis\s+sint[aá]ctico|separa\s+en\s+s[ií]labas|clasifica\s+(?:estas?|las|los)\s+palabras?)\b/i;

// F. Sin verbo ninguno: la forma del propio ejercicio, pegada tal cual.
//
//    · un hueco para rellenar            «The cat ___ on the mat»
//    · cuatro opciones                   «a) 3  b) 5  c) 7  d) 9»
//    · «verdadero o falso»
//    · una cuenta pelada                 «(3x+2)(x-5)=»  «12 x 8»
//    · el enunciado numerado de un libro «5. Escribe el resultado de…»
const HUECO_RE = /_{3,}|\.{4,}\s*$/;
const OPCIONES_RE = /(?:^|\s)a\s*[)\].-]\s*\S[\s\S]{0,140}?(?:^|\s)b\s*[)\].-]\s*\S/i;
const VERDADERO_FALSO_RE = /\b(?:verdadero\s+o\s+falso|true\s+or\s+false|v\s*\/\s*f)\b/i;
const CUENTA_PELADA_RE = /^[\s(]*[-+]?\s*[\dxyzXYZπ(][\d\s.,xyzXYZ^√πe()+\-*/·:÷=]{3,}$/;
const EJERCICIO_NUMERADO_RE = /^\s*(?:ejercicio\s+)?\d{1,2}\s*[).:-]\s+\S/i;

// «Total: dame la respuesta», dicho de todas las formas que existen.
function pideLaRespuesta(texto) {
  const t = String(texto || '');
  if (!t.trim()) return false;

  if (PIDE_RESPUESTA_RE.test(t)) return true;
  if (PIDE_RESOLVER_RE.test(t)) return true;
  if (PIDE_HACERLO_RE.test(t)) return true;
  if (PIDE_TRADUCIR_RE.test(t)) return true;
  if (PIDE_CONJUGAR_RE.test(t)) return true;

  if (HUECO_RE.test(t)) return true;
  if (OPCIONES_RE.test(t)) return true;
  if (VERDADERO_FALSO_RE.test(t)) return true;
  if (EJERCICIO_NUMERADO_RE.test(t)) return true;

  // La cuenta pelada se mide sobre el texto sin el saludo de delante: «hola,
  // 3x+2=» sigue siendo una cuenta pelada.
  const sinCortesia = t.replace(/^[\s¿¡]*(?:hola|hey|oye|profe|robin)[\s,.:]*/i, '').trim();
  if (CUENTA_PELADA_RE.test(sinCortesia)) return true;

  return false;
}

// Lo que contesta en vez de la respuesta. Son varias para que no suene a
// grabación cuando alguien insiste tres veces seguidas.
const DEVOLUCIONES = [
  'Esa te la vas a saber tú mejor que yo en cinco minutos. Dime qué parte entiendes ya y seguimos desde ahí.',
  'La respuesta te la dejo a ti, que es la parte que cuenta. Cuéntame cómo la empezarías y te digo si vas bien.',
  'Si te la doy, mañana en el examen no me vas a tener al lado. Vamos por partes: ¿qué te están pidiendo exactamente?',
  'No te la voy a dar hecha, pero sí te acompaño. ¿Qué datos ya tienes y cuál es el que te falta?',
  'Eso lo sacamos juntos, no te lo saco yo. Escríbeme tu primer paso, aunque no estés seguro.',
  'Hasta ahí te llevo; el último tramo es tuyo. ¿Qué crees que sigue después de lo que ya tienes?'
];

function devolucion() {
  return DEVOLUCIONES[Math.floor(Math.random() * DEVOLUCIONES.length)];
}

// ---- Y lo mismo, pero mirando lo que Robin ya contestó ---------------------
//
// El prompt PIDE que no dé la respuesta; esto COMPRUEBA que no la dio. Hacen
// falta los dos: el prompt es una petición a un modelo que quiere ayudar, y en
// la exposición ganó el querer ayudar.
//
// No se tira la respuesta entera: se quitan las FRASES que cantan el resultado
// y se deja el resto, que suele ser la explicación buena. Si de la poda no
// queda nada que valga, entonces sí se cambia por una devolución.

const CANTA_RESULTADO = [
  // «la respuesta es …», «el resultado sería …», «la traducción es …»
  /\b(?:la\s+respuesta|el\s+resultado|la\s+soluci[oó]n|el\s+total|la\s+traducci[oó]n)\b[^.!?\n]{0,24}\b(?:es|ser[ií]a|da|queda|equivale)\b/i,
  /\bthe\s+answer\s+is\b/i,
  // «se dice "turtle"», «en inglés es "turtle"», «se traduce como …»
  /\b(?:se\s+(?:dice|escribe|traduce)|en\s+ingl[eé]s\s+(?:es|ser[ií]a|se\s+dice)|en\s+espa[nñ]ol\s+(?:es|ser[ií]a|se\s+dice))\b/i,
  // «por lo tanto x = 4», «entonces da 37»
  /\b(?:por\s+(?:lo\s+)?tanto|entonces|as[ií]\s+que|en\s+conclusi[oó]n|finalmente)\b[^.!?\n]{0,60}[=:]\s*-?\d/i,
  // una igualdad ya resuelta: «x = 4», «= 37.5», «y = -2»
  /(?:^|[\s(])[a-z]?\s*=\s*-?\d+(?:[.,]\d+)?\s*(?:$|[\s.,;)])/i,
  // el número final con su unidad, que es la respuesta de media clase de mates
  /\b(?:queda(?:n)?|son|mide(?:n)?|vale(?:n)?|da(?:n)?|resulta(?:n)?)\s+-?\d+(?:[.,]\d+)?\s*(?:cm|mm|km|kg|ml|min|°|%|m|g|l|s|h|grados|metros|litros|gramos)\b/i
];

// Una frase, con su signo final. El corte es por punto, exclamación,
// interrogación o salto de línea, y el signo se queda pegado: si no, la
// respuesta podada saldría sin puntuación y se leería como un telegrama.
function enFrases(texto) {
  return String(texto || '').split(/(?<=[.!?\n])\s*/).filter(f => f.trim());
}

// ¿Esta frase canta el resultado? Una pregunta de vuelta no cuenta nunca, por
// mucho número que lleve: «¿y si en vez de 4 fuera 8?» es justo lo que Robin
// tiene que decir.
function cantaResultado(frase) {
  if (/\?\s*$/.test(frase.trim())) return false;
  return CANTA_RESULTADO.some(re => re.test(frase));
}

// Poda la respuesta de Robin. Devuelve el texto ya limpio y si hubo que tocar
// algo, que es lo que routes/ai.js apunta en el registro para poder mirar
// después cuántas veces se le fue la mano.
function podarRespuesta(texto) {
  const frases = enFrases(texto);
  if (!frases.length) return { texto: String(texto || ''), podada: false };

  const quedan = frases.filter(f => !cantaResultado(f));
  if (quedan.length === frases.length) return { texto: String(texto), podada: false };

  const resto = quedan.join(' ').replace(/\s{2,}/g, ' ').trim();

  // Si de la poda queda un cabo suelto —una línea, o nada— la explicación se
  // había ido con el resultado: mejor una devolución entera que media frase
  // que no lleva a ninguna parte.
  if (resto.length < 60) return { texto: devolucion(), podada: true };

  return {
    texto: resto + '\n\nEl número final lo pones tú: dime qué te sale y lo revisamos.',
    podada: true
  };
}

// ---------------------------------------------------------------------------
// 2. Solo de estudio
// ---------------------------------------------------------------------------
// Robin no es un buscador ni alguien con quien matar el rato. Si le preguntan
// por lo de moda en TikTok, por un futbolista o por cómo conseguir skins, no
// contesta eso: devuelve la conversación a donde estaba.
//
// Cómo se decide, y por qué en este orden:
//
//   1. Si la frase trae una SEÑAL DE ESTUDIO, pasa. Y pasa aunque además
//      traiga una palabra de las de fuera: «analiza el impacto económico del
//      mundial» es un trabajo de sociales, no una charla de fútbol, y
//      bloquearlo sería el peor de los dos fallos posibles.
//   2. Si no trae ninguna y sí trae una palabra de FUERA, se desvía.
//   3. Si no trae ninguna de las dos, pasa. Lo que no se reconoce se atiende:
//      una lista de palabras nunca va a cubrir todo lo que se estudia, y
//      callarle a alguien por no reconocer su tema es peor que contestar de
//      más.

const SENIALES_ESTUDIO = [
  // Las materias
  'matematica', 'matematicas', 'mate', 'algebra', 'aritmetica', 'geometria',
  'trigonometria', 'calculo', 'estadistica', 'fraccion', 'fracciones',
  'ecuacion', 'ecuaciones', 'numero', 'numeros', 'multiplicacion', 'division',
  'suma', 'resta', 'porcentaje', 'teorema', 'angulo', 'triangulo',
  'ciencia', 'ciencias', 'biologia', 'quimica', 'fisica', 'celula', 'celulas',
  'atomo', 'molecula', 'fotosintesis', 'ecosistema', 'gravedad', 'energia',
  'experimento', 'anatomia', 'genetica', 'evolucion', 'planeta',
  'lenguaje', 'gramatica', 'ortografia', 'sintaxis', 'sujeto', 'predicado',
  'verbo', 'sustantivo', 'adjetivo', 'literatura', 'poema', 'metafora',
  'historia', 'geografia', 'sociales', 'civica', 'independencia', 'revolucion',
  'colonia', 'imperio', 'constitucion', 'democracia', 'continente', 'mapa',
  'ingles', 'english', 'frances', 'idioma', 'vocabulario', 'pronunciacion',
  'programacion', 'codigo', 'algoritmo', 'variable', 'funcion', 'bucle',
  'arte', 'musica', 'dibujo', 'educacion fisica',
  // Lo de la escuela
  'escuela', 'colegio', 'clase', 'clases', 'materia', 'materias', 'profesor',
  'profesora', 'maestro', 'maestra', 'tarea', 'tareas', 'deber', 'examen',
  'prueba', 'nota', 'notas', 'calificacion', 'grado', 'bachillerato',
  'universidad', 'cuaderno', 'libro', 'leccion', 'apunte', 'apuntes',
  'horario', 'proyecto', 'exposicion', 'ensayo', 'investigacion',
  // Lo de aprender
  'estudiar', 'estudio', 'aprender', 'aprendo', 'entender', 'entiendo',
  'explica', 'explicame', 'explicar', 'ensename', 'ensenar', 'repasar',
  'repaso', 'practicar', 'ejercicio', 'ejercicios', 'concepto', 'definicion',
  'ejemplo', 'como funciona', 'para que sirve', 'diferencia entre', 'resumen',
  'no entiendo', 'me cuesta', 'me trabo', 'duda', 'dudas', 'pista',
  // Lo de organizarse, que es la otra mitad de para qué existe Robin
  'recuerdame', 'recordar', 'apunta', 'anota', 'pendiente', 'pendientes',
  'agenda', 'organiza', 'organizar', 'planificar', 'entregar', 'fecha',
  // El reto que hay en pantalla
  'reto', 'nivel', 'minijuego', 'minijuegos', 'racha'
];

const TEMAS_DE_FUERA = [
  // Redes y lo de moda
  'tiktok', 'tik tok', 'trend', 'trends', 'trending', 'viral', 'reel', 'reels',
  'meme', 'memes', 'instagram', 'insta', 'snapchat', 'twitter', 'facebook',
  'seguidores', 'followers', 'hashtag', 'influencer', 'youtuber', 'streamer',
  'fyp',
  // Videojuegos
  'fortnite', 'minecraft', 'roblox', 'free fire', 'valorant',
  'league of legends', 'gta', 'call of duty', 'among us', 'brawl stars',
  'clash royale', 'fifa', 'skin', 'skins', 'pavos', 'v-bucks', 'vbucks',
  'robux', 'gemas gratis', 'hackear', 'mod menu',
  // Famosos y entretenimiento
  'netflix', 'anime', 'k-pop', 'kpop', 'bts', 'blackpink', 'taylor swift',
  'bad bunny', 'cantante', 'famoso', 'famosa', 'celebridad', 'farandula',
  'chisme', 'chismes', 'telenovela', 'reggaeton', 'tiktoker',
  // Deportes como espectáculo
  'messi', 'cristiano ronaldo', 'neymar', 'mbappe', 'real madrid', 'champions',
  'nba', 'quien gano el partido', 'liga mx',
  // Dinero fácil
  'bitcoin', 'cripto', 'criptomoneda', 'nft', 'forex', 'apostar', 'apuesta',
  'casino', 'ruleta', 'loteria', 'dinero facil', 'hacerme rico',
  // Lo personal que no es suyo
  'novia', 'novio', 'ligar', 'conquistar a', 'mi crush', 'declararme',
  // Pasar el rato con Robin
  'cuentame un chiste', 'un chiste', 'chistes', 'adivinanza',
  'eres humano', 'eres real', 'que opinas de', 'que modelo eres',
  'eres chatgpt', 'eres claude', 'eres una ia'
];

// ¿Aparece alguna de estas claves en el texto? Se compara sobre el texto
// aplanado y con los signos convertidos en espacios, y con un espacio pegado a
// cada lado: así «mate» no se dispara dentro de «matemáticamente» ni «skin»
// dentro de «skinner», que es como una lista de palabras empieza a mentir.
function trae(texto, lista) {
  const t = ' ' + aplanar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s{2,}/g, ' ').trim() + ' ';
  return lista.some(clave => t.includes(' ' + aplanar(clave) + ' '));
}

// Un saludo, un «gracias» o un «ya está» no son un tema: son el pegamento de
// cualquier conversación y no se desvían nunca.
const CORTESIA_RE = /^[\s¿¡]*(?:hola|holi|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|oye|qu[eé]\s+tal|c[oó]mo\s+est[aá]s|gracias|muchas\s+gracias|ok|okay|vale|listo|ya|s[ií]|no|adi[oó]s|chao|hasta\s+luego|bye|thanks|perd[oó]n|disculpa)[\s!.,¡?]*$/i;

function fueraDeTema(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (CORTESIA_RE.test(t)) return false;
  if (trae(t, SENIALES_ESTUDIO)) return false;
  return trae(t, TEMAS_DE_FUERA);
}

// El desvío. No es un «no puedo hablar de eso» a secas: es cambiar de tema,
// que es lo que se pidió. Y se cambia a algo concreto —el reto que hay delante
// o lo último que sí venía a cuento— porque «pregúntame de estudio» no le da a
// nadie nada que escribir.
function desvio({ juego, anterior } = {}) {
  if (juego) {
    return `De eso no hablo, pero de "${juego}" sí. ¿Qué parte del reto se te está atravesando?`;
  }
  if (anterior) {
    const limpio = String(anterior).trim().replace(/\s+/g, ' ');
    const corto = limpio.length > 70 ? limpio.slice(0, 70) + '…' : limpio;
    return `Eso se sale de lo mío. Volvamos a lo de antes, que ahí sí te sirvo: «${corto}». ¿Seguimos por ahí?`;
  }
  return 'De eso no sé nada, y tampoco me toca. Yo soy para estudiar y para organizarte: dime una materia, un tema que no te cuadre o algo que quieras que te apunte.';
}

module.exports = {
  aplanar,
  censurar,
  porGroseria,
  POR_GROSERIA,
  pideLaRespuesta,
  devolucion,
  DEVOLUCIONES,
  podarRespuesta,
  fueraDeTema,
  desvio
};
