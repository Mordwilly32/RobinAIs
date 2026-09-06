# roboRobin

Asistente 100% local con dos caminos: cuenta personal con organizador de tareas, o plataforma escolar completa (director, profesores y estudiantes) con códigos de ingreso.

Node + Express (`server.js`, `routes/`, `src/`, `public/`). Arranca con `npm start`.

## Agent skills

### Issue tracker

Los issues viven como markdown en `.scratch/<feature-slug>/` dentro del repo (este repo no tiene remote git). Ver `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulario canónico por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` y `docs/adr/` en la raíz. Ver `docs/agents/domain.md`.
