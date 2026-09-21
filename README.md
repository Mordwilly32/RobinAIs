# roboRobin

Un asistente escolar con dos caminos: una **cuenta personal** con organizador de
tareas, o una **plataforma escolar completa** —dirección, profesorado,
estudiantes y familias— en la que se entra con códigos y no con invitaciones por
correo.

Node + Express por detrás, HTML y JavaScript sin frameworks por delante. Se
puede leer entero.

```bash
npm install
npm start          # http://localhost:3000
```

Así, sin configurar nada, guarda todo en `data/db.json` y no habla con nadie.

---

## Dónde se guarda todo

roboRobin tiene un solo interruptor, y es si existen o no dos variables de
entorno:

| | Sin configurar | Con Supabase |
|---|---|---|
| Base de datos | `data/db.json`, en esta computadora | Postgres en Supabase |
| Se enciende con | nada | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| Director de fábrica | sí, `admin@roborobin.local` | **no**, lo crea quien inscribe la primera escuela |
| Para qué sirve | probar, enseñar, una escuela en una sola computadora | varias personas, desde donde sea |

El resto del programa no se entera de cuál de las dos está puesta: todo pasa por
[`src/store.js`](src/store.js).

**Para poner la base en Supabase y el sitio en línea, la guía paso a paso está
en [`docs/supabase.md`](docs/supabase.md).**

---

## Lo que nunca se guarda en el servidor

Tres cosas se quedan fuera de la base de datos **a propósito**, y conviene
saberlo antes de desplegar nada:

### Las caras del pase de lista

La foto de reconocimiento de cada estudiante y la huella de 128 números que
face-api saca de ella viven en **IndexedDB, en el navegador de la tablet donde
se pasa lista** — ver [`public/js/face-vault.js`](public/js/face-vault.js).

Son datos biométricos de menores de edad. El reconocimiento ya corre entero en
el navegador, así que la foto solo hace falta donde está la cámara; subirla a un
servidor añadiría toda la responsabilidad de custodiarla sin mejorar nada. Al
servidor solo llega el id de a quién se reconoció.

*En la práctica:* la lista de caras es del aparato, no de la cuenta. Si se
cambia de tablet, hay que volver a tomarlas.

### Las fotos de perfil

Mismo motivo: también son caras. Viven en el `localStorage` de cada quien.

*En la práctica:* tu foto la ves tú, en el navegador donde la pusiste. En las
listas del profesorado y de la dirección todo el mundo sale con el muñequito
gris. Si prefieres lo contrario, se cambia en una línea:
[`docs/supabase.md`](docs/supabase.md#las-fotos-de-perfil) explica cuál.

### La clave de la API de Anthropic

Es una variable de entorno del servidor (`ANTHROPIC_API_KEY`), no un dato de
nadie. No está en la base, ni en Supabase, ni en este repositorio. Sin ella
Robin funciona igual en su modo local: entiende «recuérdame el martes», lista
pendientes y tacha tareas — lo que no hace es conversar.

---

## Cómo está armado

```
server.js            arranque: sesiones, estáticos, rutas, apagado ordenado
routes/              una ruta por tema: auth, users, schools, classes,
                     activities, attendance, family, ai, games, plans, codes…
src/
  db.js              toda la base en memoria; cada cambio llama a save()
  store.js           qué hay debajo de save(): archivo o Supabase
  permissions.js     quién puede con quién
  plans.js           los planes y el margen diario de Robin
  games.js           los minijuegos
public/              las pantallas. Sin framework, sin paso de compilación
  js/face-vault.js   las caras, en el navegador y en ningún otro lado
loading/             la animación de espera, en un solo sitio
supabase/migrations/ el esquema, para pegar en el SQL Editor
web/ + tools/        la versión de GitHub Pages: el servidor dentro de la pestaña
scripts/             probar, subir a Supabase, y la prueba del guardado
```

### Un detalle que importa si vas a desplegar

roboRobin trabaja con **toda la base en memoria** y la vuelca a Supabase. Eso lo
hace muy rápido y muy simple de leer, y tiene un precio: **una sola instancia**.
Dos serían dos memorias distintas creyendo cada una que la suya es la buena.

El [`render.yaml`](render.yaml) ya lo deja fijado en `numInstances: 1`. Para una
escuela, o para varias, sobra de largo.

---

## Comandos

```bash
npm start                          arranca
npm run supabase:probar            ¿llego a Supabase? ¿están las tablas?
npm run supabase:subir             se lleva data/db.json a Supabase
npm run supabase:subir -- --reemplazar   borra antes lo que hubiera arriba
npm run supabase:prueba            prueba el guardado sin tocar la red
node tools/build-pages.js          rearma la versión de GitHub Pages
```

---

## La versión de GitHub Pages

En `gh-pages/` hay una copia del sitio **sin servidor**: los mismos archivos de
`src/` y `routes/` corriendo dentro de la pestaña, con `fs` imitado y la base de
datos en memoria. Se puede tocar todo y no se guarda nada; al cerrar la pestaña
no queda rastro.

Sirve para enseñar roboRobin sin instalar nada. No sirve para una escuela de
verdad.

---

## Licencia

MIT.
