# ai-tutor

Tutor personal en la terminal, construido sobre **Claude Code**. Enseña cualquier tema buscando **comprensión, no memorización**: parte de verdades incondicionales, muestra cómo se podría haber descubierto cada paso, mide tu nivel real con quizzes calificados y deja cada clase escrita en markdown, lista para leer en Obsidian.

Es una recreación de [`amosblomqvist/learn`](https://github.com/amosblomqvist/learn) (hecho para el harness *pi*) adaptada para funcionar **solo con el plan Claude Pro**, en Windows nativo y en español. El porqué y el cómo están en [`specs/ai-teacher/`](specs/ai-teacher/).

> **¿Cómo se usa día a día?** → [MANUAL.md](MANUAL.md)

## Requisitos

| Herramienta | Para qué |
|---|---|
| Claude Code (con login de tu plan Pro) | Todo el tutor |
| Git for Windows | Claude Code ejecuta los hooks con Git Bash |
| Node.js ≥ 20 | Scripts de quiz, registro en markdown y render de diagramas |
| Google Chrome o Microsoft Edge | Render de diagramas Mermaid (se usa el navegador instalado) |
| Obsidian | Leer las clases con LaTeX, Mermaid e imágenes |

## Instalación (Windows, ~15 min)

1. **Herramientas** (PowerShell):
   ```powershell
   winget install Git.Git
   winget install OpenJS.NodeJS.LTS
   winget install Obsidian.Obsidian
   irm https://claude.ai/install.ps1 | iex
   ```
2. **Proteger el costo ($0 extra):**
   - `echo $env:ANTHROPIC_API_KEY` debe salir **vacío**. Si la variable existe, Claude Code cobra por API en lugar de usar tu plan: bórrala en *Variables de entorno* de Windows.
   - En <https://claude.ai/settings/usage> deja **extra usage desactivado**: al llegar al límite, Claude Code se detiene en vez de cobrar.
3. **Clonar e instalar dependencias:**
   ```powershell
   git clone https://github.com/D1egoSebastian/ai-tutor.git
   cd ai-tutor
   npm install
   npm test
   ```
   `npm install` **no** descarga Chromium (usa tu Chrome/Edge, ver ADR-10). `npm test` debe terminar sin fallos.
4. **Primer arranque:** en esa carpeta ejecuta `claude`, inicia sesión con tu cuenta Pro y **acepta el diálogo de confianza** del proyecto. Sin ese paso, Claude Code ignora los permisos preaprobados y te pedirá confirmar cada script. Con `/status` comprueba que la autenticación es por suscripción, no por API key.
5. **Obsidian:** *Open folder as vault* → elige la carpeta `ai-tutor`.

## Estructura

```
ai-tutor/
├── CLAUDE.md                 perfil, idioma, precedencia y flags del tutor
├── MANUAL.md                 guía de uso diario
├── .claude/
│   ├── settings.json         modelo sonnet, permisos y hooks (Stop, SessionStart)
│   ├── skills/               teach · visualize · md-log · md-unlog
│   ├── agents/               researcher (haiku) · mermaid-maker · svg-maker (sonnet)
│   └── scripts/              md-log.mjs (quiz, registro, cuaderno) · render.mjs (diagramas)
├── notas/                    tus clases + _cuaderno.md (progreso)
├── viz/                      diagramas PNG publicados
├── .learn/                   estado interno, ignorado por git (claves de quiz, vínculos)
└── specs/ai-teacher/         requisitos, diseño, tareas y spikes (SDD)
```

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Aparece consumo en *extra usage* o cobro por API | `ANTHROPIC_API_KEY` definida | Bórrala de las variables de entorno (usuario **y** sistema) y reinicia la terminal |
| Te pide permiso para cada `node .claude/scripts/...` | No aceptaste el diálogo de confianza del proyecto | Cierra y abre `claude` en la carpeta y acéptalo |
| La nota `.md` no se actualiza | El hook `Stop` no corre, o la sesión no está vinculada | Revisa `/hooks` en una terminal interactiva; ejecuta `/md-log notas/<tema>.md`; mira `.learn/md-log-error.log` |
| Error al renderizar Mermaid ("Failed to launch the browser process") | No se encontró un navegador que arranque | Instala Chrome, o define `PUPPETEER_EXECUTABLE_PATH` con la ruta a `chrome.exe` / `msedge.exe` |
| El tutor responde como "arquitecto" u orquestador | Tus instrucciones globales (`~/.claude/CLAUDE.md`) compiten con el rol de tutor | `CLAUDE.md` del proyecto declara precedencia; si persiste, recuérdale "eres el tutor, usa la skill teach" |
| Se agota el cupo a mitad de clase | Subagentes caros (~86k tokens por llamada) | Usa el modo ahorro (ver MANUAL) |

## Desarrollo

- Tests: `npm test` (Node `node:test`, sin dependencias de test).
- Metodología: SDD. Cada cambio empieza en `specs/ai-teacher/` y se traza a un requisito (`RF-xx`, `RNF-xx`, `RC-xx`).
