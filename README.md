# 🐦 roboRobin

Un asistente con dos caminos:

- **Cuenta personal** — para cualquiera. Robin te ayuda a organizar tus tareas y tu día a día.
- **Escuela** — el director inscribe la escuela y reparte **dos códigos de ingreso**: uno para estudiantes y otro para profesores. El código decide el rol de quien lo usa.

El sitio es HTML, CSS y JavaScript sin compilar. Los datos, las cuentas y las funciones viven en **Supabase**: Postgres con Row Level Security guarda todo, Supabase Auth maneja contraseñas y sesiones, y dos Edge Functions hacen lo que no puede hacerse desde el navegador. No hay servidor propio que mantener. Toda la interfaz está en español.

> **¿Vienes de la versión anterior?** Hasta la v1 roboRobin corría 100 % local con Express y un `data/db.json`. La v2 movió todo eso a Supabase. El historial de git conserva la versión local en el primer commit.

---

## ✅ Requisitos

- **Node.js 20.6 o más nuevo** (solo para el servidor de desarrollo y el sembrado). https://nodejs.org
- Una cuenta gratuita en **Supabase**. https://supabase.com
- La **CLI de Supabase**, para aplicar el esquema y publicar las funciones:

```bash
npm install -g supabase     # o: scoop install supabase / brew install supabase/tap/supabase
supabase --version
```

---

## 🚀 Puesta en marcha

### 1. Crea el proyecto en Supabase

En https://supabase.com/dashboard → **New project**. Anota la contraseña de la base de datos; la CLI te la va a pedir.

### 2. Apaga la confirmación por correo

**Authentication → Sign In / Providers → Email → desactiva «Confirm email».**

Este paso no es opcional: un estudiante puede registrarse con el código de su escuela y **sin correo propio**, y entonces su cuenta usa un correo interno que nadie puede abrir. Si Supabase exige confirmar el correo, esas cuentas no podrían entrar nunca.

### 3. Aplica el esquema

```bash
supabase login
supabase link --project-ref TU-REF-DE-PROYECTO
supabase db push
```

Eso crea las tablas, las políticas de seguridad, las funciones y los disparadores que están en `supabase/migrations/`.

### 4. Publica las funciones

```bash
supabase functions deploy robin
supabase functions deploy admin-usuarios
```

(o `npm run functions:deploy`, que hace las dos.)

### 5. Apunta el sitio a tu proyecto

Copia la URL y la clave **anon** desde *Project Settings → API*, y pégalas en `public/js/supabase-config.js`:

```js
window.RR_SUPABASE = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'eyJhbGciOi...'
};
```

La clave `anon` está pensada para ser pública: viaja en cada visita. Lo que protege tus datos no es esconderla, sino las políticas de seguridad del esquema. **La clave `service_role` es otra cosa: se salta todas las reglas y nunca debe ir aquí ni subirse a GitHub.** (`supabase-config.js` avisa y se detiene si detecta que pegaste la equivocada.)

### 6. Arranca

```bash
npm install
npm start
```

Abre http://localhost:3000. Para detenerlo, `Ctrl + C`.

> `npm start` levanta un servidor estático de 60 líneas (`scripts/servir.mjs`) que solo entrega los archivos de `public/`. No es un backend: es para poder abrir el sitio en el navegador mientras trabajas.

### 7. Publícalo (opcional)

`public/` es un sitio estático: sirve cualquier hosting (Netlify, Vercel, GitHub Pages, Cloudflare Pages, Supabase Storage). Sube esa carpeta y listo. Configura el 404 del hosting para que apunte a `404.html`, y en la Edge Function pon el secreto `SITIO_PERMITIDO` con la dirección de tu sitio para acotar quién puede llamarla.

---

## 👤 Los tres caminos al crear una cuenta

Al entrar a **Crear cuenta** se elige uno de tres:

### 1. Cuenta personal
Solo nombre, correo y contraseña. Entras directo a tu espacio con Robin: chat a la izquierda, lista de pendientes a la derecha.

### 2. Inscribir mi escuela (director)
Escribes el nombre de la escuela y tus datos. Al terminar ves tus **dos códigos**, por ejemplo:

```
Para estudiantes   EST-4K7Q
Para profesores    PRO-9XB2
```

Repártelos: quien se registre con `EST-…` entra como **estudiante**, quien lo haga con `PRO-…` entra como **profesor**. Nadie elige su propio rol, y el rol tampoco se puede forzar desde el navegador: lo decide un disparador dentro de la base de datos a partir del código.

Los códigos se vuelven a ver (y a generar de nuevo) desde el panel del director → **Códigos de ingreso**. Al generar uno nuevo, el anterior deja de servir al instante: eso es lo que se hace si un código se filtró.

### 3. Tengo un código (estudiante o profesor)
Escribes el código, roboRobin te muestra a qué escuela te vas a unir y con qué rol, y luego pide tus datos. Los estudiantes eligen además su nivel (Parvularia, Primaria, Secundaria, Bachillerato) y su grado.

Un estudiante puede registrarse **sin correo**. En ese caso recibe un **ID de estudiante** (`STU-00001`) y entra con él en lugar del correo.

### No hay cuenta de director por defecto

En la versión local existía `admin@roborobin.local / Admin123!` sembrada de fábrica. Ya no: una contraseña conocida escrita en un README público es una puerta abierta. **El primer director es quien inscribe la primera escuela** desde *Crear cuenta → Inscribir mi escuela*.

### Datos de exposición

Para presentar el proyecto sin crear todo a mano, hay un script que deja el proyecto con una escuela inventada, sus dos códigos, clases, avisos y pendientes:

```bash
cp .env.example .env      # y pega ahí la URL y la clave service_role
npm run seed
```

**Borra todas las cuentas que haya** y siembra un elenco 100 % ficticio (correos `@demo.local`, un dominio que no existe). Imprime en la terminal los dos códigos de ingreso y esta lista de cuentas:

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Director | `admin@roborobin.local` | `Demo123!` |
| Profesora | `profesora@demo.local` | `Demo123!` |
| Profesor | `profesor@demo.local` | `Demo123!` |
| Estudiante | `estudiante@demo.local` | `Demo123!` |
| Cuenta personal | `personal@demo.local` | `Demo123!` |

Vuelve a correrlo cuando quieras limpiar lo que el público haya escrito durante la exposición. **Nunca lo corras sobre datos que quieras conservar.**

---

## 🤖 Robin, el asistente

Robin vive a pantalla completa en las cuentas personales y como burbuja flotante en los paneles de escuela. Entiende órdenes sobre tus pendientes **sin necesidad de ninguna clave de IA**:

| Le escribes | Qué hace |
| --- | --- |
| «recuérdame llamar al banco mañana» | Crea la tarea con fecha para mañana |
| «apunta terminar el reporte urgente» | La crea y la marca como urgente |
| «nueva tarea: pagar el recibo en 3 días» | Calcula la fecha |
| «¿qué tengo hoy?» / «mis pendientes» | Te lee la lista |
| «ya terminé comprar leche» | La tacha |

Entiende *hoy*, *mañana*, *pasado mañana*, los días de la semana, *en N días*, *la próxima semana* y fechas como *12/05*. El resto de preguntas (estudio, materias, organización) las responde con su base local de consejos.

### Conectar Claude (opcional)

Si quieres que las preguntas abiertas las conteste Claude de verdad:

1. Crea una API key en https://console.anthropic.com
2. Guárdala como secreto de la función (no en el repositorio, no en el navegador):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set AI_MODEL=claude-sonnet-5      # opcional
supabase functions deploy robin
```

Las órdenes sobre tareas se siguen resolviendo dentro de la función, así que el organizador funciona igual con o sin clave. Usar tu propia key sí tiene costo por uso según la tarifa de Anthropic; el modo local no cuesta nada.

---

## 🏫 Qué hace cada rol

**Director:** ve el resumen de su escuela, genera y regenera los dos códigos, renombra la escuela, crea/edita/desactiva/borra cuentas y publica avisos. Solo ve las cuentas y avisos de **su** escuela.

**Profesor:** publica avisos por nivel, crea clases (públicas o privadas con código), invita estudiantes por su ID (`STU-00002`), publica actividades que notifican a todo el grupo, y consulta la lista de estudiantes.

**Estudiante:** ve los avisos de su nivel, se une a clases, recibe notificaciones e invitaciones, y tiene su propia lista de pendientes privada.

**Cuenta personal:** chat con Robin, organizador de tareas e historial. No ve nada de ninguna escuela.

Estudiantes y profesores tienen también su lista de pendientes privada: ni el director ni nadie más la ve.

---

## 🔐 Cómo se aplican esas reglas

No las aplica el JavaScript del navegador — ese se puede modificar desde las herramientas de desarrollo. Las aplica **Postgres**, en cada consulta, con Row Level Security:

| Regla | Cómo se garantiza |
| --- | --- |
| Nadie ve datos de otra escuela | Cada política compara contra `private.my_school_id()` |
| Los códigos de ingreso solo los ve el director | Viven en `school_codes`, una tabla aparte con su propia política |
| Nadie se asciende a director | Un disparador congela `role`, `school_id` y `status` en cualquier edición del propio perfil |
| El rol lo decide el código, no quien se registra | `handle_new_user()` resuelve el código dentro de la base de datos |
| Un estudiante solo ve los avisos de su nivel | La política de `announcements` filtra por `private.my_level()` |
| Una cuenta suspendida pierde todo el acceso | `my_role()` no devuelve nada si `status <> 'active'` |
| La clave de Anthropic no llega al navegador | Vive como secreto de la Edge Function `robin` |
| La clave `service_role` no llega al navegador | Solo la usa `admin-usuarios`, y el sitio comprueba que la clave configurada sea `anon` |

Todo eso está en `supabase/migrations/`, comentado línea por línea.

---

## 🎨 Identidad visual

- Rojo petirrojo (`#E23A1B`), tinta carbón (`#14100E`) y blanco cálido, con azul huevo y dorado como acentos.
- La mascota es el dibujo de `public/images/robin.png` y está viva por CSS: respira, flota, se espabila al pasar el mouse y brinca con chispas al hacer clic. Ese Robin a color es el de siempre: el logo, el héroe y la cara del chat. No se sustituye nunca.
- Alrededor de él vive **el elenco dibujado a lápiz**, en `public/images/robin/`. Son los bocetos originales en papel de la carpeta `images/`, recortados a línea sobre fondo transparente. Cada uno tiene su momento y no se usa fuera de él:

  | Pose | Cuándo aparece |
  | --- | --- |
  | `ghost` | No hay nada que dar: listas vacías, sin avisos, sin resultados. |
  | `mailman` | Llegó correo: avisos de la escuela, invitaciones, notificaciones. |
  | `talking` | Robin está explicando: el chat, el «escribiendo…», las pistas. |
  | `happy` | Salió bien: terminaste todo, entraste, creaste la cuenta. |
  | `sad` | Salió mal: contraseña incorrecta, formulario rechazado, error al cargar. |
  | `idle` | Esperando, sin nada que hacer todavía. |
  | `error` | Solo en la página 404/500: Robin estrellado contra la pantalla. |

  En el código se piden con `data-rr-mascot data-pose="ghost"` en el HTML, o con `rrRobin('ghost')`, `rrEmptyState({pose, title, text})` y `rrRobinSays({pose, text})` desde JavaScript (`public/js/mascot.js`). **Regla de tamaño:** los bocetos solo se usan a 90 px o más; por debajo de eso el trazo a lápiz se apaga y va el Robin a color.
- Los siete bocetos originales, tal como se fotografiaron, siguen en `images/`. `scripts/sketch2png.py` es el que los convierte (aplana la luz del papel, saca el fondo, recorta y entinta); solo hace falta correrlo si se agrega o se redibuja alguna pose.
- El avance escolar se representa como las etapas de un petirrojo: 🥚 Parvularia → 🐣 Primaria → 🪶 Secundaria → 🕊️ Bachillerato.
- Todo respeta `prefers-reduced-motion`: quien tenga las animaciones desactivadas en su sistema ve la interfaz quieta.

---

## 🗂️ Dónde se guarda todo

En tu proyecto de Supabase, en estas tablas:

| Tabla | Qué guarda |
| --- | --- |
| `profiles` | Las cuentas (nombre, rol, escuela, nivel, ID de estudiante). La contraseña la guarda Supabase Auth, aparte y encriptada. |
| `schools` / `school_codes` | Las escuelas y sus dos códigos de ingreso, separados a propósito |
| `tasks` | El organizador personal |
| `classes` / `class_members` | Clases y quién está en cada una |
| `activities` | Actividades publicadas dentro de una clase |
| `announcements` | Avisos de la escuela, por nivel |
| `notifications` | Invitaciones y avisos de actividad nueva |
| `ai_logs` | Historial del chat con Robin (se poda a las últimas 200 por persona) |

- **Respaldo:** `supabase db dump -f respaldo.sql`, o desde el panel → *Database → Backups*.
- **Empezar de cero:** `supabase db reset` (en local) o vuelve a correr `npm run seed`.

---

## 🧱 Estructura del proyecto

```
roboRobin/
  supabase/
    config.toml                          → configuración del proyecto para la CLI
    migrations/
      ..._esquema_inicial.sql            → tablas e índices
      ..._funciones_y_seguridad.sql      → RLS, funciones y disparadores
    functions/
      robin/                             → el asistente: intenciones de tareas + Claude
      admin-usuarios/                    → crear/editar/borrar cuentas (director)
      _shared/cors.ts
  scripts/
    servir.mjs                           → servidor estático para trabajar en local
    seed-demo.mjs                        → deja el proyecto listo para exponer
    sketch2png.py                        → convierte los bocetos en PNG de línea transparente
  images/                                → los bocetos originales de Robin, fotografiados en papel
  public/
    index.html                           → portada (diseño de la exposición)
    terminos.html                        → términos: deja claro que todo el contenido es ficticio
    404.html                             → página de error (404 / 401 / 403 / 500)
    login.html / register.html
    dashboard-personal.html              → espacio con Robin + pendientes
    dashboard-student.html
    dashboard-teacher.html
    dashboard-admin.html
    images/robin.png                     → Robin a color: el de siempre
    images/robin/*.png                   → el elenco a lápiz
    css/style.css                        → sistema de diseño de la aplicación
    css/landing.css                      → portada, términos y página de error
    js/
      supabase-config.js                 → a qué proyecto apunta el sitio
      api.js                             → toda la conversación con Supabase
      mascot.js                          → la mascota, sus poses, los estados vacíos y el confeti
      landing.js                         → animaciones de la portada
      chat.js                            → lógica de chat compartida
      tasks-panel.js                     → panel de pendientes reutilizable
      sidebar.js                         → barra lateral y navegación
      personal.js / student.js / teacher.js / admin.js / register.js / login.js
```

`api.js` es la única puerta de salida del navegador. Conserva la forma que tenía cuando había un servidor propio (`rrApi('/api/tasks', { method, body })`), pero por dentro habla con Supabase. Por eso las pantallas no cambiaron al migrar.

---

## 🚧 Errores: siempre una página, nunca un salto silencioso

Cuando algo no existe o no corresponde, roboRobin **muestra la página de error en la misma dirección**, en lugar de mandarte a otro lado sin explicar:

| Situación | Qué pasa |
| --- | --- |
| Dirección que no existe (`/loquesea`) | Página **404** con estado HTTP 404 real; la dirección equivocada se queda en la barra |
| Panel sin haber iniciado sesión | Página **401** «Necesitas iniciar sesión», con botón para entrar |
| Panel de otro rol (un estudiante abriendo el del director) | Página **403** «Esta página no es para tu cuenta» |
| Operación rechazada por la base de datos | El mensaje aparece en el propio formulario, en español |

Los errores de formulario (contraseña incorrecta, código que no existe) **no** mandan a la página de error: se muestran en el propio formulario, que es donde hay que corregirlos.

---

## 📢 Sobre el contenido de la portada

La portada está hecha para una exposición, así que incluye cifras, precios y testimonios **inventados** («+50,000 estudiantes», «$99/mes», «200 escuelas aliadas»). Para que nadie se confunda:

- Debajo de las cifras y de los precios hay una nota que dice que son de demostración.
- `terminos.html` explica punto por punto qué es falso y qué es real, y aclara que **no se cobra nada**.
- El botón «?» de la esquina lleva directo a ese aviso.

---

## 🔒 Notas honestas sobre seguridad

Lo que sí está resuelto: las contraseñas las guarda Supabase Auth (nunca las vemos), el aislamiento entre escuelas lo aplica la base de datos y no el navegador, y ninguna clave privilegiada llega al cliente.

Lo que conviene tener presente:

- Los códigos de ingreso son de 4 caracteres para poder dictarlos en voz alta: son cómodos, no son un secreto criptográfico. Si sospechas que uno se filtró, genéralo de nuevo desde el panel — es un clic.
- Las fotos de perfil se guardan como texto dentro de la fila del perfil. Funciona para imágenes pequeñas; si van a subirse fotos grandes, lo correcto es mover eso a Supabase Storage.
- Pon el secreto `SITIO_PERMITIDO` en las Edge Functions con la dirección de tu sitio antes de publicarlo. Mientras esté en `*`, cualquier página puede llamarlas (necesitando igualmente una sesión válida).
- Este proyecto nació como trabajo de exposición. Antes de usarlo con datos reales de menores de edad, revisa qué exige la ley de tu país sobre datos de estudiantes. 🐦
