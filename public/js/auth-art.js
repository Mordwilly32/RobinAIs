// public/js/auth-art.js
// El lado ilustrado de entrar y crear cuenta.
//
// Cada recarga trae una escena distinta. Son dibujos vectoriales guardados en
// /images/escenas: pesan poco, se ven nítidos a cualquier tamaño y no dependen
// de ningún servicio de terceros.
//
// Cada escena viaja con su frase. No son frases de relleno: cada una dice algo
// cierto sobre el producto, así que quien está escribiendo su contraseña se
// entera de paso de para qué sirve esto.

const RR_AUTH_SCENES = [
  {
    src: '/images/escenas/aula.svg',
    quote: 'Una escuela entera en una sola pantalla.',
    foot: 'Dirección, profesorado y estudiantado, cada uno con lo suyo.'
  },
  {
    src: '/images/escenas/biblioteca.svg',
    quote: 'Robin no te da la respuesta. Te enseña a encontrarla.',
    foot: 'Con el estudiantado siempre guía, nunca resuelve.'
  },
  {
    src: '/images/escenas/patio.svg',
    quote: 'Siete minijuegos, uno por materia.',
    foot: 'La dificultad sube con tu nivel, pero todos se pueden ganar.'
  },
  {
    src: '/images/escenas/laboratorio.svg',
    quote: 'Pregunta sin miedo a equivocarte.',
    foot: 'Equivocarse es la parte del método donde se aprende.'
  },
  {
    src: '/images/escenas/escritorio.svg',
    quote: 'Dile «recuérdame entregar el informe el viernes».',
    foot: 'Robin lo apunta con fecha, sin que toques un formulario.'
  },
  {
    src: '/images/escenas/pasillo.svg',
    quote: 'Lo tuyo es tuyo.',
    foot: 'Tus conversaciones y tu lista de pendientes no las ve tu profesorado ni la dirección.'
  }
];

// Dibuja el panel ilustrado. Se elige una escena al azar, pero nunca la misma
// dos veces seguidas: repetirla justo al recargar delataría el truco.
function rrMountAuthArt(container) {
  const anterior = sessionStorage.getItem('rr-escena');
  let opciones = RR_AUTH_SCENES.filter(s => s.src !== anterior);
  if (!opciones.length) opciones = RR_AUTH_SCENES;

  const escena = opciones[Math.floor(Math.random() * opciones.length)];
  try { sessionStorage.setItem('rr-escena', escena.src); } catch { /* modo privado */ }

  container.innerHTML = `
    <img class="rr-auth-art-img" src="${escena.src}" alt="" aria-hidden="true" />
    <div class="rr-auth-quote">
      <p>${escena.quote}</p>
      <small>${escena.foot}</small>
    </div>`;
  rrWireMascotLife();
}

document.addEventListener('DOMContentLoaded', () => {
  const art = document.getElementById('authArt');
  if (art) rrMountAuthArt(art);
});
