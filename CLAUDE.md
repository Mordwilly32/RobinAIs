# roboRobin

Asistente con dos caminos: cuenta personal con organizador de tareas, o plataforma escolar completa (dirección, profesorado, estudiantes y familias) con códigos de ingreso.

Node + Express (`server.js`, `routes/`, `src/`, `public/`). Arranca con `npm start`.

## Dónde se guarda

Toda la base vive en memoria en `src/db.js`; cada cambio llama a `save()`. Qué
hay debajo de ese `save()` lo decide `src/store.js`: `data/db.json` si no hay
nada configurado, o Postgres en Supabase si existen `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`. Guía: `docs/supabase.md`.

Como la base está en memoria, **una sola instancia** (ver `render.yaml`).

Dos cosas NO se guardan en el servidor a propósito: las caras del pase de lista
(viven en el navegador, ver `public/js/face-vault.js`) y la clave de Anthropic
(variable de entorno o `config.json`; ver `src/llave.js`). La lista está en
`CAMPOS_QUE_NO_SUBEN`, en `src/store.js`.

Con `RR_SOLO_LOCAL=1` la base es `data/db.json` aunque el `.env` traiga las dos
variables de Supabase: sirve para trabajar en localhost sin tocar la de la nube.

Las fotos de perfil sí se guardan, pero en Supabase Storage (bucket
`fotos-perfil`, que el servidor crea solo) y no en una fila: en la ficha queda
`profilePicUrl`. Una imagen en base64 dentro de la base cargaría todas las
fotos en memoria. Ver `src/fotos.js`.

## Qué no hace Robin

Tres reglas, todas en `src/robin-guardia.js` y todas comprobadas en el
servidor, con clave de API y sin ella:

1. **Nunca da la respuesta.** Ni de un ejercicio, ni de una traducción, ni de
   un examen. Se mira lo que se pide antes de llamar a la API y lo que el
   modelo contesta antes de que salga a la pantalla (`podarRespuesta`). Lo
   segundo es lo que faltaba: el prompt es una petición, no un candado.
   Excepción: el profesorado, que pide material para enseñar.
2. **Solo habla de estudio.** Lo que no viene a cuento no se contesta: se
   cambia el tema al minijuego que hay abierto o a la última pregunta buena.
3. **Las groserías se tapan**, las de quien escribe y las de quien contesta.

Cada regla marca su burbuja en el chat (`.tutor`, `.guardia`, `.respeto`), para
que no se lea como un «no sé».

## Pantallas de una sola cosa

`/-/robinAI` y `/-/minijuegos` abren el panel de siempre en modo enfocado: sin
barra lateral, sin las demás secciones y sin puerta de salida desde dentro.
Para dejar una pantalla puesta en una exposición o una tablet en el aula. Ver
`public/js/enfoque.js` y las rutas en `routes/paginas.js`.

## Dos atajos de teclado

Ninguno de los dos aparece en ningún menú; tres modificadores a la vez no se
pulsan sin querer.

- `Ctrl + Alt + Shift + R` — la consola de demostración: subir el tamaño del
  texto de Robin y de los minijuegos (bloque «La lupa», variable `--rr-lupa`,
  se guarda en el navegador), entrar a cualquier cuenta con un clic, fabricar
  escuelas de mentira y poner la llave de la API de Anthropic sin reiniciar
  (bloque «La llave de Robin»; se guarda en `config.json` y solo se puede desde
  localhost). Es de UNA cuenta (`RR_CONSOLA_DUENO`) o de quien sepa la
  contraseña (`RR_CONSOLA_CLAVE`); sin ninguna de las dos solo se dibuja un
  candado. Ver `routes/dev.js`, `src/llave.js` y `public/js/consola.js`.
- `Ctrl + Alt + Shift + T` — solo en la portada: la demostración que se cuenta
  sola, para una exposición o una grabación. No trae animaciones propias:
  dispara en orden las que ya tiene la portada. Lo único suyo es el encuadre —
  cada parada se enseña entera, encogiendo la sección si no cabe en la
  ventana (`plantar()`). Ver `public/js/cine.js`.

## Crear cuenta

Las cuentas nacen encendidas: no hay códigos por correo ni proveedor de correo
que mantener. En los cuatro caminos se piden la fecha de nacimiento y el país
(`public/js/paises.js`); la edad no se pregunta, se deriva de la fecha cada vez
que se mira (`edadDe()` en `src/db.js`).

## Agent skills

### Issue tracker

Los issues viven como markdown en `.scratch/<feature-slug>/` dentro del repo. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulario canónico por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` y `docs/adr/` en la raíz. Ver `docs/agents/domain.md`.
