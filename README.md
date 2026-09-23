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
en [`docs/supabase.md`](docs/supabase.md).** Para ponerle un dominio propio,
[`docs/dominio.md`](docs/dominio.md).

---

## Crear cuenta

Las cuentas nacen encendidas. Hubo un tiempo en que quien se apuntaba por su
cuenta esperaba un código de seis cifras por correo; dependía de un proveedor
de correo que hay que pagar y mantener, y lo que pasaba en la práctica era
gente que no podía entrar a su propia cuenta porque el correo no le llegaba.

En los cuatro caminos —personal, familia, con código de ingreso e inscribir una
escuela— se piden **cuándo naciste** y **de qué país eres**. La edad no se
pregunta: sale de la fecha, se dice en voz alta debajo de la casilla mientras
se escribe, y se vuelve a calcular cada vez que se mira — un número tecleado a
mano se queda viejo al día siguiente del cumpleaños. Los 222 países están en
[`public/js/paises.js`](public/js/paises.js).

---

## La demostración que se cuenta sola

`Ctrl + Alt + Shift + T`, **solo en la portada**: el logo baja, el héroe se
arma, los cuatro pasos de «¿Cómo funciona?» salen uno detrás de otro como un
camino, las materias hacen pop una por una, la conversación con Robin se cuenta
despacio y al final se queda en «¿Listo para aprender con Robin?». Después
vuelve arriba y empieza otra vez, hasta que alguien pulse `Esc`.

Para una exposición con la pantalla de fondo, o para grabar la portada entera
sin ir tocando la rueda del ratón. No tiene ni una animación propia: dispara en
orden las que ya tiene la portada, así que lo que enseña es siempre lo que hay.
Ver [`public/js/cine.js`](public/js/cine.js).

---

## La consola de demostración

`Ctrl + Alt + Shift + R` desde cualquier pantalla abre una consola que deja
entrar a cualquier cuenta con un clic y fabricar escuelas de mentira. No es una
función del producto: no aparece en ningún menú y **es de una sola cuenta**.

Se abre de dos maneras y no hay una tercera:

- estar dentro con la cuenta dueña (`RR_CONSOLA_DUENO`), o
- escribir la contraseña de la consola (`RR_CONSOLA_CLAVE`).

Sin ninguna de las dos, lo único que se dibuja es un candado: la lista de
cuentas no llega a existir en la pantalla. Con `RR_DEV_CONSOLE=0` la consola no
existe en absoluto — sus rutas contestan 404. Ver [`routes/dev.js`](routes/dev.js).

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

### Las fotos de perfil (estas sí se guardan)

Las fotos de perfil son la excepción, y antes no lo eran. Se guardan en
**Supabase Storage**, en el bucket `fotos-perfil` que el servidor crea solo la
primera vez; en la ficha de la cuenta queda `profilePicUrl`, que es la
dirección y no la imagen.

*En la práctica:* tu foto te sigue a cualquier navegador y a cualquier
aparato, y en las listas del profesorado y de la dirección la gente sale con
su cara. Las que ya estaban guardadas en un navegador se suben solas la
próxima vez que esa persona entre.

*Por qué Storage y no una columna:* la base entera se carga en memoria y se
compara campo por campo en cada guardado. Una imagen en base64 dentro de la
ficha sería cargar todas las fotos de todo el mundo en RAM para siempre. Ver
[`src/fotos.js`](src/fotos.js).

### La clave de la API de Anthropic

Es una variable de entorno del servidor (`ANTHROPIC_API_KEY`), no un dato de
nadie. No está en la base, ni en Supabase, ni en este repositorio. Sin ella
Robin funciona igual en su modo local: entiende «recuérdame el martes», lista
pendientes y tacha tareas — lo que no hace es conversar.

---

## Las direcciones

```
/                     la portada
/entrar               entrar
/registro             crear cuenta o inscribir escuela
/dashboard/:id        el panel de esa cuenta
/guia                 la guía
/terminos             términos, privacidad y aviso
```

Las de antes (`/login.html`, `/dashboard-teacher.html`…) contestan un 301 a la
nueva, así que un enlace guardado hace meses no se rompe. Quien las resuelve es
[`routes/paginas.js`](routes/paginas.js).

Sobre el id de `/dashboard/:id`: está para que la dirección diga de quién es el
panel, no para decidir nada. Quien manda es la sesión — si el id no es el tuyo,
el servidor te devuelve al tuyo, y los datos de la pantalla los sirve `/api/…`
mirando la sesión y no la barra de direcciones. Cambiar el número a mano no
enseña nada de nadie.

---

## Cómo está armado

```
server.js            arranque: sesiones, estáticos, rutas, apagado ordenado
routes/
  paginas.js         las direcciones de las pantallas y las mudanzas de las viejas
  …                  una ruta por tema: auth, users, schools, classes,
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

`node tools/build-pages.js` arma en `gh-pages/` una copia del sitio **sin
servidor**: los mismos archivos de `src/` y `routes/` corriendo dentro de la
pestaña, con `fs` imitado y la base de datos en memoria. Se puede tocar todo y
no se guarda nada; al cerrar la pestaña no queda rastro.

Esa carpeta no está en el repositorio a propósito: la vuelve a armar GitHub
Actions en cada push y la publica sola (ver
[`.github/workflows/static.yml`](.github/workflows/static.yml)).

Sirve para enseñar roboRobin sin instalar nada. No sirve para una escuela de
verdad.

---

## Licencia

MIT.
