# AI Teacher — Tareas

> Fase 3 de SDD. Cada tarea es pequeña, verificable y trazable a requisitos. Ejecútalas **en orden** y marca `[x]` al terminar.

## Cómo trabajar cada tarea con Claude Code

1. Abre una sesión nueva en la raíz del proyecto: `claude`.
2. Entra en **modo plan** (`Shift+Tab` hasta ver *plan mode*) y pega el prompt de la tarea. Revisa el plan que propone antes de aprobarlo; ahí es donde validas lo que la IA va a hacer.
3. Aprueba, deja que implemente y revisa el diff.
4. Corre la **Verificación** tú mismo. Si falla, no avances.
5. `git commit -m "T<n>: <título>"` y `/clear` antes de la siguiente tarea (ahorra cupo: el contexto viejo no se vuelve a enviar).

Todos los prompts asumen que Claude Code puede leer `specs/`. Empiezan con "Lee requirements.md y design.md" para anclarlo a la spec.

---

## Fase 0 — Entorno (manual, sin IA)

- [x] **T0.1 Instalar herramientas.** En PowerShell:
  ```powershell
  winget install Git.Git
  winget install OpenJS.NodeJS.LTS
  winget install Obsidian.Obsidian
  irm https://claude.ai/install.ps1 | iex
  ```
  **Verificación:** `git --version`, `node -v` (≥ 20) y `claude --version` responden en una terminal nueva.

- [ ] **T0.2 Blindar el costo (RC-01).**
  1. En PowerShell: `echo $env:ANTHROPIC_API_KEY` debe salir **vacío**. Si no, quítala de *Variables de entorno* de Windows. Con esa variable definida, Claude Code cobra por API en vez de usar tu plan.
  2. En https://claude.ai/settings/usage deja **extra usage desactivado**: al llegar al límite, Claude Code se detiene en vez de cobrar.
  3. Si instalaste pi: borra `~/.pi/agent/auth.json` (en WSL) para que no quede una sesión que facture aparte.

  **Verificación:** `claude` → login con tu cuenta Pro → `/status` muestra autenticación por suscripción, no API key.

- [x] **T0.3 Crear el proyecto.**
  ```powershell
  mkdir C:\dev\ai-teacher; cd C:\dev\ai-teacher
  git init
  mkdir specs\ai-teacher, notas, viz, .learn
  ```
  Copia `requirements.md`, `design.md` y `tasks.md` a `specs\ai-teacher\`. Crea `.gitignore` con `.learn/` y `node_modules/`. Abre la carpeta como vault en Obsidian.

  **Verificación:** Obsidian muestra `specs/design.md` con el diagrama Mermaid renderizado.

---

## Fase 1 — Spikes (validar supuestos del diseño)

Un spike responde una pregunta; no produce código final. Guarda cada hallazgo en `specs/ai-teacher/spikes.md`.

- [ ] **S1 Límites de AskUserQuestion** (valida 4.3)
  > Prompt: *"Usa AskUserQuestion para hacerme 1 pregunta con 4 opciones. Luego dime qué límites tiene esa herramienta (preguntas por llamada, opciones por pregunta, si agrega 'Other' automáticamente, largo del header). Anota los hallazgos en specs/spikes.md."*

  **Verificación:** `spikes.md` tiene los límites. Si el máximo es 4 opciones, confirmar formato "3 reales + No sé". Si difiere, actualizar `design.md` 4.3 **antes** de seguir.

- [ ] **S2 Formato del transcript** (valida 4.5)
  > Prompt: *"Tras esta respuesta, usa AskUserQuestion una vez. Luego busca el transcript .jsonl de esta sesión en ~/.claude/projects/, y documenta en spikes.md: cómo se ven las entradas de usuario, texto del asistente, tool_use de AskUserQuestion y su tool_result (con ejemplos reducidos)."*

  **Verificación:** `spikes.md` tiene un ejemplo real de cada tipo de entrada.

- [ ] **S3 Hook Stop en Windows** (valida ADR-02, 4.5)
  > Prompt: *"Crea un hook Stop temporal en .claude/settings.json que ejecute `node -e` y escriba la hora y el transcript_path recibido por stdin en .learn/hook-test.txt. No toques nada más."*

  Reinicia Claude Code, manda un mensaje. **Verificación:** `.learn/hook-test.txt` existe con una ruta válida. Luego elimina el hook de prueba.

- [ ] **S4 Subagente mira un PNG** (valida 4.7)
  > Prompt: *"Crea un subagente temporal en .claude/agents/png-test.md con tools Read y model sonnet, cuya tarea sea leer una imagen y describirla. Úsalo sobre cualquier PNG de C:\Windows\Web\Wallpaper y muéstrame su descripción."*

  **Verificación:** la descripción corresponde a la imagen real. Borra `png-test.md`.

---

## Fase 2 — Núcleo de enseñanza

- [ ] **T1 CLAUDE.md** — RF-09, RC-04, RF-27
  > Prompt: *"Lee requirements.md y design.md (sección 4.1 y 4.8). Crea CLAUDE.md en la raíz con: mi perfil (Diego, ingeniero de software junior, analista de arquitectura TI, C#/.NET y web, bases sólidas de álgebra lineal, probabilidad y cálculo), idioma español obligatorio, la regla de usar siempre la skill teach al explicar o enseñar, y la sección 'Configuración del tutor' con researcher: on y visuales: off por ahora. Máximo 40 líneas."*

  **Verificación:** `claude` → "¿quién soy y en qué idioma me hablas?" responde con tu perfil en español.

- [ ] **T2 Skill `teach`** — RF-01…08, RF-13
  > Prompt: *"Descarga https://raw.githubusercontent.com/amosblomqvist/learn/main/skills/teach/SKILL.md. Créala en .claude/skills/teach/SKILL.md traducida fielmente al español, siguiendo design.md 4.2: 'él' → 'Diego'; ask_user_question → AskUserQuestion; subagent researcher → subagente researcher vía la herramienta Agent; conserva íntegra la sección de construcción de opciones de quiz. Deja un marcador '## Protocolo de quiz (pendiente T3)' y '## Modo ahorro (pendiente T6)'. No resumas: la traducción debe conservar todos los matices."*

  **Verificación:** compara lado a lado con el original: mismas secciones, mismas reglas (bracketing de piso/techo, esperar aprobación del plan, ciclo de 4 pasos). Prueba: "Enséñame qué es una derivada" → empieza con Probe, **no** explicando.

---

## Fase 3 — Quiz

- [ ] **T3.1 Comandos `quiz-commit` / `quiz-grade`** — RF-11, RF-12, RNF-05
  > Prompt: *"Lee design.md 4.3. Crea .claude/scripts/md-log.mjs (Node, ESM, sin dependencias) con solo dos subcomandos por ahora: quiz-commit --id --correct --explanation (append a .learn/quiz-key.jsonl) y quiz-grade --id --answer (imprime ✓ o ✗ o NO_SE, la correcta y la explicación; error claro si el id no existe). Añade tests con node:test en .claude/scripts/md-log.test.mjs."*

  **Verificación:** `node --test .claude/scripts/` pasa. Prueba manual: commit + grade con acierto, fallo y "No sé".

- [ ] **T3.2 Protocolo en la skill + permisos**
  > Prompt: *"Reemplaza el marcador '## Protocolo de quiz' en la skill teach con el protocolo de design.md 4.3 (comprometer → preguntar con AskUserQuestion incluyendo 'No sé' → calificar con el script y transmitir el resultado tal cual). Agrega a .claude/settings.json el permiso para Bash(node .claude/scripts/md-log.mjs:*)."*

  **Verificación:** "Hazme un quiz de 3 preguntas sobre Big-O". Revisa: (a) cada pregunta tiene "No sé", (b) `.learn/quiz-key.jsonl` tiene la clave **antes** de que respondas, (c) el feedback coincide con la salida del script, (d) la posición de la correcta varía, (e) no te pide permiso para correr el script.

---

## Fase 4 — md-log

- [ ] **T4.1 `link` / `unlink` / `render`** — RF-15…18, RNF-05
  > Prompt: *"Lee design.md 4.5 y specs/spikes.md (formato del transcript). Añade a md-log.mjs los subcomandos link <ruta>, unlink y render (lee JSON por stdin, regenera el .md completo desde transcript_path, escritura atómica). Incluye usuario, texto del asistente y bloques AskUserQuestion; excluye tool calls, tool results y cualquier quiz-commit. Ignora tipos de entrada desconocidos sin fallar. Tests con un transcript de ejemplo en fixtures/."*

  **Verificación:** `node --test` pasa, incluido un test que asegura que la respuesta correcta nunca aparece antes del bloque de respuesta.

- [ ] **T4.2 Skills `/md-log`, `/md-unlog` y hook**
  > Prompt: *"Crea .claude/skills/md-log/SKILL.md y md-unlog/SKILL.md con disable-model-invocation: true, que ejecuten los subcomandos link \"$ARGUMENTS\" y unlink. Registra el hook Stop de design.md 4.5 en .claude/settings.json."*

  **Verificación:** reinicia Claude Code. Conversa un poco → `/md-log notas/prueba.md` → otro mensaje → el `.md` aparece en Obsidian **con el historial previo**. `/md-unlog` → nuevos mensajes ya no se agregan. Sesión nueva vinculada a la **misma** nota → se agrega un segundo bloque sin borrar el primero (ADR-08).

- [ ] **T4.3 Cuaderno de estudio** — RNF-06
  > Prompt: *"Lee design.md 4.9. Añade a md-log.mjs el subcomando notebook (resumen compacto de notas/_cuaderno.md o 'Cuaderno vacío'), con tests. Registra el hook SessionStart. Agrega a la skill teach la sección 'Cuaderno' con los tres momentos de escritura y el flujo de retomar un tema."*

  **Verificación:** con un `_cuaderno.md` de ejemplo, abrir `claude` → el tutor menciona el tema en curso y el próximo nodo sin que se lo pidas.

---

## Fase 5 — Researcher

- [ ] **T5 Subagente `researcher`** — RF-19…22
  > Prompt: *"Descarga https://raw.githubusercontent.com/amosblomqvist/learn/main/agents/researcher.md. Recréalo en .claude/agents/researcher.md según design.md 4.6: frontmatter de Claude Code (tools: WebSearch, WebFetch; model: haiku; description que empiece con 'Use this agent to…'), cuerpo traducido al español conservando el formato de salida."*

  **Verificación:** "Usa el researcher para verificar en qué año se publicó el RFC de TCP". Devuelve Resumen/Hallazgos/Fuentes/Vacíos con enlaces reales. En el Plan de una clase, el tutor lo invoca antes de dibujar el grafo.

---

## Fase 6 — Visuales

- [ ] **T6.1 `render.mjs`** — RF-25
  > Prompt: *"Lee design.md 4.7. Crea package.json con @mermaid-js/mermaid-cli y @resvg/resvg-js, y .claude/scripts/render.mjs con los modos mermaid y svg, preview en .learn/preview.png y --save <slug> a viz/viz-<slug>-<timestamp>.png imprimiendo filename: y path:. Soporta PUPPETEER_EXECUTABLE_PATH. Errores de sintaxis de Mermaid deben imprimirse legibles, no como stack trace."*

  **Verificación:** `npm install`, luego renderiza un `.mmd` y un `.svg` de prueba, con y sin `--save`. Los PNG se ven bien.

- [ ] **T6.2 Makers** — RF-24, RF-25
  > Prompt: *"Descarga agents/mermaid-maker.md y agents/svg-maker.md del repo amosblomqvist/learn. Recréalos en .claude/agents/ según design.md 4.7: tools Read, Write, Edit, Bash; model sonnet; cambia las herramientas write_*/render_* por escribir la fuente en .learn/ + node .claude/scripts/render.mjs + Read del PNG. Conserva intacto el ciclo 'verificar mirando' y el bloque RESULT. Agrega el permiso Bash(node .claude/scripts/render.mjs:*)."*

  **Verificación:** "Usa mermaid-maker: graph TD, 'paquete' arriba, flechas a 'orden' y 'retransmisión', ambas a 'flujo confiable'". Devuelve `RESULT` con un archivo que existe en `viz/` y es correcto.

- [ ] **T6.3 Skill `visualize` + modo ahorro** — RF-23, RF-26, RF-27
  > Prompt: *"Descarga skills/visualize/SKILL.md del repo original y recréala en .claude/skills/visualize/SKILL.md traducida, cambiando la invocación a subagentes vía Agent. Reemplaza el marcador '## Modo ahorro' de la skill teach con design.md 4.8. En CLAUDE.md pon visuales: on."*

  **Verificación:** en una clase de geometría o grafos aparece `![[viz-...png|500]]` y se renderiza en Obsidian. Con `visuales: off`, no se invocan makers.

---

## Fase 7 — Cierre

- [ ] **T7.1 settings.json final** — RC-05
  > Prompt: *"Revisa .claude/settings.json: modelo por defecto sonnet, hook Stop, permisos de los dos scripts y nada más. Explícame cada línea."*

- [ ] **T7.2 README** — RNF-01
  > Prompt: *"Escribe README.md: qué es, requisitos, instalación en Windows (resume Fase 0), uso diario (/md-log, pedir un tema, modo ahorro), y solución de problemas (API key, Chromium, hook que no corre)."*

- [ ] **T7.3 Prueba de aceptación E2E** — Criterios globales 1–4 de `requirements.md`
  Manual, sin prompt. Sesión completa: `/md-log notas/tcp.md` → "Enséñame cómo funciona TCP". Recorre la lista de criterios y anota el resultado en `spikes.md`. Repite con `researcher: off` y `visuales: off`.

  **Verificación:** los 4 criterios pasan, y https://claude.ai/settings/usage no muestra extra usage.

---

## Trazabilidad

| Requisito | Tareas |
|---|---|
| RC-01 | T0.2, T7.3 |
| RC-02 | T0.1, S3 |
| RF-01…08 | T2 |
| RF-09 | T1 |
| RF-10…14 | S1, T3.1, T3.2 |
| RF-15…18 | S2, S3, T4.1, T4.2 |
| RF-19…22 | T5 |
| RF-23…26 | S4, T6.1, T6.2, T6.3 |
| RF-27 | T1, T6.3 |
| RNF-01 | T7.2 |
| RNF-05 | T3.1, T4.1 |
| RNF-06 | T4.3 |
