# roboRobin

Asistente con dos caminos: cuenta personal con organizador de tareas, o plataforma escolar completa (dirección, profesorado, estudiantes y familias) con códigos de ingreso.

Node + Express (`server.js`, `routes/`, `src/`, `public/`). Arranca con `npm start`.

## Dónde se guarda

Toda la base vive en memoria en `src/db.js`; cada cambio llama a `save()`. Qué
hay debajo de ese `save()` lo decide `src/store.js`: `data/db.json` si no hay
nada configurado, o Postgres en Supabase si existen `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`. Guía: `docs/supabase.md`.

Como la base está en memoria, **una sola instancia** (ver `render.yaml`).

Tres cosas NO se guardan en el servidor a propósito: las caras del pase de lista
y las fotos de perfil (viven en el navegador, ver `public/js/face-vault.js` y
`rrFotoPropia()` en `public/js/api.js`) y la clave de Anthropic (variable de
entorno). La lista está en `CAMPOS_QUE_NO_SUBEN`, en `src/store.js`.

## Agent skills

### Issue tracker

Los issues viven como markdown en `.scratch/<feature-slug>/` dentro del repo. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulario canónico por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` y `docs/adr/` en la raíz. Ver `docs/agents/domain.md`.
