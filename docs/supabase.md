# Poner roboRobin en línea, con la base de datos en Supabase

Guía de principio a fin. Son cuatro ratos: crear el proyecto, crear las tablas,
llevarte lo que ya tienes, y desplegar. Media hora larga la primera vez.

Si algo no cuadra, casi siempre es una de dos: la clave que copiaste era la que
no era, o el proyecto de Supabase está dormido.

---

## Antes de empezar: el reparto

| Qué                                        | Dónde vive                    |
|--------------------------------------------|-------------------------------|
| El código                                   | GitHub                        |
| Cuentas, escuelas, códigos, tareas, clases, avisos, asistencia, conversaciones con Robin | Supabase (Postgres) |
| Las caras del pase de lista y su huella     | El navegador de la tablet     |
| Las fotos de perfil                         | El navegador de cada quien    |
| La clave de la API de Anthropic             | Variable de entorno del servidor |
| El servidor que junta todo                  | Render (o Railway, o Fly)     |

Las tres últimas filas son a propósito y están explicadas en
[Qué no se guarda en Supabase](#qué-no-se-guarda-en-supabase), al final.

---

## 1. Crear el proyecto de Supabase

1. Entra a **[supabase.com](https://supabase.com)** → *Start your project*. Se
   puede entrar con la cuenta de GitHub.
2. *New project*:
   - **Name**: `roborobin`
   - **Database Password**: dale a *Generate a password* y **guárdala en tu
     gestor de contraseñas**. roboRobin no la usa, pero es la única llave para
     entrar a la base por fuera y Supabase no te la vuelve a enseñar.
   - **Region**: la más cercana a tu escuela. Desde El Salvador, `East US
     (North Virginia)`. Esto no se puede cambiar después sin crear otro
     proyecto, así que piénsalo dos segundos.
   - **Plan**: Free.
3. Tarda un par de minutos en levantarse. Espera a que el puntito de arriba se
   ponga verde.

## 2. Copiar las dos llaves

Panel del proyecto → **Project Settings** (la rueda dentada, abajo a la
izquierda) → **API**.

Copia dos cosas:

- **Project URL** — algo como `https://abcdefghijkl.supabase.co`
- **service_role** — la clave larga que está debajo de `anon public`, escondida
  tras un *Reveal*.

> **Cuidado con la service_role.** Se salta todas las reglas de seguridad de la
> base a propósito, porque es el servidor de roboRobin quien decide quién ve
> qué. Quien la tenga, tiene la base entera.
>
> - Nunca va en el navegador.
> - Nunca va en el repositorio, que es público.
> - Nunca la pegues en un chat, ni en el mío.
>
> Si se te escapa: misma pantalla, botón **Reset service key**, y la vieja deja
> de servir al momento.
>
> La `anon` no la necesitas. roboRobin no habla con Supabase desde el navegador.

## 3. Crear las tablas

1. En el panel, **SQL Editor** (el icono `>_`) → *New query*.
2. Abre el archivo
   [`supabase/migrations/20260921120000_esquema_roborobin.sql`](../supabase/migrations/20260921120000_esquema_roborobin.sql)
   de este repositorio, cópialo **entero** y pégalo ahí.
3. **Run**. Debe decir *Success. No rows returned*.

Se puede correr otra vez sin romper nada: todo va con `IF NOT EXISTS`.

Para comprobarlo, **Table Editor**: deben aparecer catorce tablas empezando por
`rr_`. Estarán vacías y con un candadito (`RLS enabled`), que es justo lo que se
busca: sin políticas, RLS significa *no pasa nadie*, y la única que entra es la
service_role.

## 4. Probar la conexión desde tu computadora

En la carpeta del proyecto:

```bash
cp .env.example .env
```

Abre `.env` y rellena las dos primeras:

```
SUPABASE_URL=https://abcdefghijkl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

Y comprueba:

```bash
npm install
npm run supabase:probar
```

Tiene que salir la lista de las catorce tablas con un `✓` y `0 filas`. Si sale
`no existe`, el paso 3 no llegó a correr. Si se queja de la llave, copiaste la
`anon`.

## 5. Llevarte lo que ya tienes

Si ya usaste roboRobin en esta computadora, tus datos están en `data/db.json`.
Para subirlos:

```bash
npm run supabase:subir
```

Te dirá cuántas filas quedaron en cada tabla, y cuántas imágenes se quedaron en
tierra — las caras y las fotos de perfil, que no suben. Tu `data/db.json` no se
toca: sigue ahí, intacto.

Si te equivocas y quieres empezar de cero: `npm run supabase:subir -- --reemplazar`
borra antes lo que hubiera arriba. **No pregunta.**

Ahora arranca:

```bash
npm start
```

Debe decir `Base de datos: supabase`. Si dice `archivo`, el `.env` no se está
leyendo.

## 6. Desplegar

GitHub sirve páginas, pero no sabe correr un servidor de Node, y roboRobin tiene
uno detrás: sesiones, permisos, la conexión con Claude. El repositorio vive en
GitHub; lo que corre, en otro lado.

**Render**, que es gratis y lee el `render.yaml` que ya está en el repositorio:

1. [render.com](https://render.com) → entra con GitHub.
2. **New** → **Blueprint**.
3. Elige el repositorio `RobinAIs`. Render encuentra el `render.yaml` solo.
4. Te va a pedir tres valores por pantalla:
   - `SUPABASE_URL` — el Project URL del paso 2.
   - `SUPABASE_SERVICE_ROLE_KEY` — la service_role del paso 2.
   - `ANTHROPIC_API_KEY` — opcional. Sin ella Robin funciona en modo local:
     entiende «recuérdame el martes», lista pendientes y tacha tareas, pero no
     conversa.

   `SESSION_SECRET` no te la pide: se la inventa Render.
5. **Apply**. El primer despliegue tarda unos minutos.

Cuando termine te da una dirección tipo `https://roborobin.onrender.com`. Ábrela,
inscribe tu escuela, y esa primera cuenta es la de dirección.

> **Lo que hay que saber del plan gratis de Render:** el servicio se duerme a los
> 15 minutos sin visitas, y la primera visita después tarda unos 40 segundos en
> despertarlo. Además, al dormirse se cierran todas las sesiones y hay que
> volver a entrar. Para una escuela de verdad, el plan de 7 dólares al mes quita
> las dos cosas.

---

## Qué no se guarda en Supabase

### Las caras

La foto de reconocimiento del pase de lista y la huella de 128 números que
face-api saca de ella **no salen del navegador**. Viven en IndexedDB, en la
tablet o la computadora donde se pasa lista. Ver
[`public/js/face-vault.js`](../public/js/face-vault.js).

Son datos biométricos de menores de edad. Guardarlos en un servidor obliga a
responder por ellos —quién los ve, cuánto duran, qué pasa si alguien entra— y no
mejora nada: el reconocimiento ya corre entero en el navegador, así que la foto
solo hace falta donde está la cámara. Al servidor solo llega el id de a quién se
reconoció.

**Lo que eso significa en la práctica:** la lista de caras es del aparato, no de
la cuenta. Si siempre se pasa lista desde la misma tablet, se monta una vez al
principio del año y ya. Si se cambia de aparato, o alguien borra los datos del
navegador, hay que volver a tomarlas.

### Las fotos de perfil

Mismo criterio, misma razón: también son caras. Viven en el `localStorage` del
navegador de cada quien, con la llave `roborobin.miFoto.<id>`.

**Lo que eso significa en la práctica:** tu foto la ves tú, y solo en el
navegador donde la pusiste. En la lista del profesor o en la de la dirección,
todo el mundo sale con el muñequito gris.

Si prefieres lo contrario —que las fotos de perfil sí se guarden y todos se
vean— se quita `'profilePic'` de `CAMPOS_QUE_NO_SUBEN` en
[`src/store.js`](../src/store.js) y se borra el bloque de `rrFotoPropia()` en
[`public/js/api.js`](../public/js/api.js). Las caras del pase de lista son otra
cosa y esas conviene dejarlas donde están.

### La clave de la API de Anthropic

Es una variable de entorno del servidor (`ANTHROPIC_API_KEY`), no un dato de
nadie. No está en la base, no está en Supabase y no está en el repositorio: una
clave de API paga con tu tarjeta, y no tiene por qué vivir donde viven los datos
de la escuela.

La clave que cada persona se pone en su pantalla de configuración sí se guarda
en su ficha, porque es suya y la puso ella a sabiendas.

---

## El límite del plan gratis de Supabase

Lo importante primero: **lo que te va a pasar antes que nada no es llenar el
disco, es que el proyecto se duerma.**

| Qué                     | Plan gratis        | Plan Pro (25 USD/mes) |
|-------------------------|--------------------|-----------------------|
| Base de datos           | **500 MB**         | 8 GB, y luego se paga por GB |
| Tráfico de salida       | 5 GB al mes        | 250 GB al mes         |
| Archivos (Storage)      | 1 GB               | 100 GB                |
| Proyectos activos       | 2                  | sin límite            |
| **Pausa por inactividad** | **a los 7 días sin uso** | nunca           |
| Copias de seguridad     | no                 | diarias, 7 días       |

*(Supabase cambia estos números de vez en cuando; lo de arriba es lo que había
al escribir esto. El vigente está en supabase.com/pricing.)*

### Los 500 MB, en escuelas

roboRobin sin caras guarda texto, y el texto pesa poquísimo. Con cuentas de unos
600 bytes:

| | Cuentas | Peso |
|---|---|---|
| Una escuela mediana | 500 | ~0,3 MB |
| Diez escuelas | 5 000 | ~3 MB |
| Cien escuelas | 50 000 | ~30 MB |

Las cuentas no son el problema ni de lejos. **Lo que crece son las
conversaciones con Robin**, porque se guardan enteras y no paran:

- Una conversación normal: 2–5 KB.
- 500 estudiantes × 3 conversaciones a la semana × 40 semanas ≈ **300 MB al
  año**.

Ahí sí se ven los 500 MB, y en un curso. Dos maneras de que no pase:

- `pruneChatHistory()` ya existe en [`src/db.js`](../src/db.js): recorta las
  conversaciones viejas.
- El pase de lista, que es lo que más filas hace (una por estudiante y por día),
  pesa nada: 500 estudiantes × 200 días son 100 000 filas de unos 150 bytes,
  **15 MB al año**.

Y la cuenta que ya no hace falta hacer: **si las fotos se guardaran**, a 25 KB
cada una, 500 estudiantes con foto de cara y foto de perfil serían **25 MB** — el
5 % del plan gratis entero en imágenes. Por eso se quedan en el navegador.

### Cómo mirar cuánto llevas

Panel de Supabase → **Reports** → **Database**. O desde el SQL Editor:

```sql
select
  relname as tabla,
  pg_size_pretty(pg_total_relation_size(relid)) as peso,
  n_live_tup as filas
from pg_stat_user_tables
where relname like 'rr_%'
order by pg_total_relation_size(relid) desc;
```

### La pausa a los 7 días

Es lo primero con lo que vas a chocar, y no tiene nada que ver con el espacio: un
proyecto gratis que pasa **7 días seguidos sin una sola consulta** se duerme, y
hay que entrar al panel a despertarlo a mano. Los datos no se pierden, pero el
sitio no contesta mientras tanto.

En vacaciones escolares, eso pasa seguro. Dos salidas:

- Despertarlo a mano desde el panel cuando toque volver.
- El plan Pro, que no se duerme, y que además trae copias de seguridad diarias
  —que para una escuela de verdad importan más que el espacio.

---

## Cuando algo falla

**`npm start` dice `Base de datos: archivo` y yo quería Supabase.**
No está leyendo el `.env`. Comprueba que se llama `.env` a secas (no
`.env.txt`), que está en la raíz, y que las dos variables tienen valor.

**`No se pudo leer la base de datos de Supabase`.**
Tres sospechosos: la llave no es la de ese proyecto, la URL tiene una errata, o
el proyecto está dormido. `npm run supabase:probar` te dice cuál.

**Arranca, pero no aparece nadie.**
La base está vacía y roboRobin no inventa un director de fábrica cuando guarda
en Supabase, a propósito: una contraseña escrita en un README público no es una
cuenta, es una puerta abierta. Inscribe tu escuela desde la pantalla de registro
y esa primera cuenta es la de dirección. O corre `npm run supabase:subir` para
llevarte las que ya tenías.

**Las fotos de los estudiantes desaparecieron.**
Están en el navegador donde se tomaron, y ese navegador no es este. Es lo
esperado; mira [Qué no se guarda en Supabase](#qué-no-se-guarda-en-supabase).

**Se guardó algo y al recargar no está.**
roboRobin sube los cambios agrupados, un instante después de hacerlos. Si el
servidor se murió de golpe en ese instante —no apagado, muerto— se pierde ese
último parpadeo. Mira los registros de Render: si sale
`No se pudo guardar en Supabase`, ahí está el motivo de verdad.
