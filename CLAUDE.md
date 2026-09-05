# roboRobin

Asistente con dos caminos: cuenta personal con organizador de tareas, o plataforma escolar completa (director, profesores y estudiantes) con códigos de ingreso.

Sitio estatico (`public/`) sobre Supabase: Postgres con RLS, Supabase Auth y dos Edge Functions (`supabase/`). No hay backend propio.

- `npm start` levanta `scripts/servir.mjs`, un servidor estatico solo para desarrollo.
- `public/js/api.js` es la unica puerta de salida del navegador: conserva la forma `rrApi('/api/...')` de la version con Express, pero por dentro habla con Supabase. Si agregas una ruta, agregala ahi.
- Los permisos NO se aplican en JavaScript: viven en las politicas RLS de `supabase/migrations/`. Cualquier regla nueva de quien-ve-que va ahi.
- `supabase db push` aplica el esquema; `npm run functions:deploy` publica las funciones.

## Agent skills

### Issue tracker

Los issues viven como markdown en `.scratch/<feature-slug>/` dentro del repo. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulario canónico por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` y `docs/adr/` en la raíz. Ver `docs/agents/domain.md`.
