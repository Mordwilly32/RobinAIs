# 🐦 roboRobin

Un asistente que corre **100 % en tu computadora**, con dos caminos:

- **Cuenta personal** — para cualquiera. Robin te ayuda a organizar tus tareas y tu día a día.
- **Escuela** — el director inscribe la escuela y reparte **dos códigos de ingreso**: uno para estudiantes y otro para profesores. El código decide el rol de quien lo usa.

Nada se sube a la nube. Todo (cuentas, contraseñas encriptadas, escuelas, códigos, tareas, avisos e historial del chat) vive en un solo archivo local: `data/db.json`, que se crea solo la primera vez que arrancas el servidor. Toda la interfaz está en español.

---

## ✅ Requisitos

Solo **Node.js 18 o más nuevo**. Si no lo tienes: descarga la versión **LTS** en https://nodejs.org, instálala, y comprueba en una terminal:

```
node -v
npm -v
```

## 🚀 Cómo arrancarlo

```
cd ruta/donde/esta/roboRobin
npm install      (solo la primera vez; descarga 3 paquetes livianos)
npm start
```

Abre http://localhost:3000. Para detenerlo, `Ctrl + C` en la terminal.

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

Repártelos: quien se registre con `EST-…` entra como **estudiante**, quien lo haga con `PRO-…` entra como **profesor**. Nadie elige su propio rol, y el rol tampoco se puede forzar desde el navegador: lo decide el servidor a partir del código.

Los códigos se vuelven a ver (y a generar de nuevo) desde el panel del director → **Códigos de ingreso**. Al generar uno nuevo, el anterior deja de servir al instante: eso es lo que se hace si un código se filtró.

### 3. Tengo un código (estudiante o profesor)
Escribes el código, roboRobin te muestra a qué escuela te vas a unir y con qué rol, y luego pides tus datos. Los estudiantes eligen además su nivel (Parvularia, Primaria, Secundaria, Bachillerato) y su grado.

### Cuenta de director por defecto

La primera vez que corre el servidor se crea:

- **Correo:** `admin@roborobin.local`
- **Contraseña:** `Admin123!`

⚠️ **Cámbiala de inmediato** desde *Mi perfil*. Esta cuenta empieza sin escuela: puede inscribir la suya desde *Códigos de ingreso*, y mientras no tenga una, ve todas las cuentas del sistema (útil para administrar la instalación).

### Datos de exposición

Para presentar el proyecto sin tener que crear todo a mano, hay un script que deja la base de datos con una escuela inventada, sus dos códigos, clases, avisos y pendientes:

```bash
node scripts/seed-demo.js
```

**Borra lo que haya** y siembra un elenco 100 % ficticio (correos `@demo.local`, un dominio que no existe). Imprime en la terminal los dos códigos de ingreso y esta lista de cuentas:

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Director | `admin@roborobin.local` | `Admin123!` |
| Profesora | `profesora@demo.local` | `Demo123!` |
| Profesor | `profesor@demo.local` | `Demo123!` |
| Estudiante | `estudiante@demo.local` | `Demo123!` |
| Cuenta personal | `personal@demo.local` | `Demo123!` |

Vuelve a correrlo cuando quieras limpiar lo que el público haya escrito durante la exposición. **Nunca lo corras sobre datos que quieras conservar.**

---

## 🤖 Robin, el asistente

Robin vive a pantalla completa en las cuentas personales y como burbuja flotante en los paneles de escuela. Entiende órdenes sobre tus pendientes **sin necesidad de internet ni de ninguna clave**:

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
2. Pégala en `config.json` → `"anthropicApiKey"`
3. Reinicia el servidor

```json
{
  "anthropicApiKey": "tu-api-key-aqui",
  "aiModel": "claude-sonnet-5",
  "sessionSecret": "cambia-esto-por-algo-secreto"
}
```

Las órdenes sobre tareas se siguen resolviendo localmente, así que el organizador funciona igual con o sin clave. Usar tu propia key sí tiene costo por uso según la tarifa de Anthropic; el modo local no cuesta nada.

---

## 🏫 Qué hace cada rol

**Director:** ve el resumen de su escuela, genera y regenera los dos códigos, renombra la escuela, crea/edita/desactiva/borra cuentas y publica avisos. Solo ve las cuentas y avisos de **su** escuela.

**Profesor:** publica avisos por nivel, crea clases (públicas o privadas con código), invita estudiantes por su ID (`STU-00002`), publica actividades que notifican a todo el grupo, y consulta la lista de estudiantes.

**Estudiante:** ve los avisos de su nivel, se une a clases, recibe notificaciones e invitaciones, y tiene su propia lista de pendientes privada.

**Cuenta personal:** chat con Robin, organizador de tareas e historial. No ve nada de ninguna escuela.

Estudiantes y profesores tienen también su lista de pendientes privada: ni el director ni nadie más la ve.

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

```
roboRobin/
  data/db.json     ← cuentas, escuelas, códigos, tareas, avisos, clases, chats
  config.json      ← clave opcional de la API y secreto de sesión
```

- No hay base de datos externa que instalar (nada de MySQL ni MongoDB).
- Nada sale a internet, salvo las preguntas al asistente *solo si* configuraste tu propia API key.
- **Respaldo:** copia `data/db.json` a otro lado.
- **Empezar de cero:** detén el servidor y borra `data/db.json`. Al arrancar de nuevo se crea uno limpio con el director por defecto. (O corre `node scripts/seed-demo.js`, que además siembra los datos de exposición.)
- Si vienes de una versión anterior, tus datos se migran solos al arrancar: las cuentas que ya existían se agrupan en una escuela llamada «Mi Escuela» y la terminal te imprime sus dos códigos nuevos.

---

## 🧱 Estructura del proyecto

```
roboRobin/
  server.js                  → servidor Express
  config.json                → API key opcional + secreto de sesión
  images/                    → los bocetos originales de Robin, fotografiados en papel
  scripts/seed-demo.js       → deja la base de datos lista para exponer
  scripts/sketch2png.py      → convierte los bocetos en PNG de línea transparente
  src/db.js                  → toda la base de datos local (JSON) y su migración
  src/auth.js                → protección de rutas por sesión y por rol
  routes/auth.js             → registro (personal / escuela / código), login, logout
  routes/schools.js          → la escuela del director y sus dos códigos
  routes/users.js            → perfil propio, lista de estudiantes, cuentas (director)
  routes/tasks.js            → organizador de pendientes
  routes/ai.js               → Robin: intenciones de tareas + respuestas
  routes/announcements.js    → avisos por nivel
  routes/classes.js          → clases, invitaciones, miembros
  routes/activities.js       → actividades dentro de una clase
  public/
    index.html               → portada (diseño de la exposición)
    terminos.html            → términos: deja claro que todo el contenido es ficticio
    404.html                 → página de error (404 / 401 / 403 / 500)
    login.html / register.html
    dashboard-personal.html  → espacio con Robin + pendientes
    dashboard-student.html
    dashboard-teacher.html
    dashboard-admin.html
    images/robin.png         → Robin a color: el de siempre
    images/robin/*.png       → el elenco a lápiz (ghost, mailman, talking, happy, sad, idle, error)
    css/style.css            → sistema de diseño de la aplicación
    css/landing.css          → portada, términos y página de error
    js/
      api.js                 → fetch, avisos flotantes, utilidades
      mascot.js              → la mascota, sus poses, los estados vacíos y el confeti
      landing.js             → animaciones de la portada
      chat.js                → lógica de chat compartida
      tasks-panel.js         → panel de pendientes reutilizable
      sidebar.js             → barra lateral y navegación
      personal.js / student.js / teacher.js / admin.js / register.js / login.js
```

---

## 🚧 Errores: siempre una página, nunca un salto silencioso

Cuando algo no existe o no corresponde, roboRobin **muestra la página de error en la misma dirección**, en lugar de mandarte a otro lado sin explicar:

| Situación | Qué pasa |
| --- | --- |
| Dirección que no existe (`/loquesea`) | Página **404** con estado HTTP 404 real; la dirección equivocada se queda en la barra |
| Panel sin haber iniciado sesión | Página **401** «Necesitas iniciar sesión», con botón para entrar |
| Panel de otro rol (un estudiante abriendo el del director) | Página **403** «Esta página no es para tu cuenta» |
| Error interno del servidor | Página **500** explicando que el fallo fue del servidor |
| Llamadas a `/api/...` | Siguen respondiendo **JSON**, porque las consume el código, no una persona |

Los errores de formulario (contraseña incorrecta, código que no existe) **no** mandan a la página de error: se muestran en el propio formulario, que es donde hay que corregirlos.

---

## 📢 Sobre el contenido de la portada

La portada está hecha para una exposición, así que incluye cifras, precios y testimonios **inventados** («+50,000 estudiantes», «$99/mes», «200 escuelas aliadas»). Para que nadie se confunda:

- Debajo de las cifras y de los precios hay una nota que dice que son de demostración.
- `terminos.html` explica punto por punto qué es falso y qué es real, y aclara que **no se cobra nada**.
- El botón «?» de la esquina lleva directo a ese aviso.

---

## 🔒 Notas honestas sobre seguridad

Está pensado para correr **local**, en tu máquina o en un servidor privado de la escuela. Antes de exponerlo a internet abierto deberías:

- Cambiar `sessionSecret` en `config.json` por algo único.
- Servirlo detrás de HTTPS (por ejemplo Nginx con certificado SSL).
- Considerar una base de datos más robusta si la escuela crece a cientos de usuarios simultáneos.

Los códigos de ingreso son de 4 caracteres para poder dictarlos en voz alta: son cómodos, no son un secreto criptográfico. Si sospechas que uno se filtró, genéralo de nuevo desde el panel — es un clic. 🐦
