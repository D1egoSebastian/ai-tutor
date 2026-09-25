# AI Teacher — Requisitos (Spec)

> Fase 1 de SDD. Define **qué** debe hacer el sistema, no cómo. Todo requisito tiene ID para trazarlo en `design.md` y `tasks.md`.

## 1. Contexto y decisión de origen

El proyecto original [`amosblomqvist/learn`](https://github.com/amosblomqvist/learn) es una configuración para **pi**, un harness de terceros. Desde abril 2026, Anthropic cobra el uso de Claude en harnesses de terceros como *extra usage* (por token), fuera del plan. Por eso **no es viable con el plan Pro de $20 sin gastos extra**.

**Decisión:** recrear el sistema sobre **Claude Code**, que sí está incluido en el plan Pro y consume del mismo cupo que claude.ai. Se conserva la filosofía pedagógica del original y se reemplaza toda la infraestructura propia de pi por capacidades nativas de Claude Code.

## 2. Objetivo

Un tutor personal en la terminal que enseña cualquier tema buscando **comprensión, no memorización**: parte de verdades incondicionales, muestra cómo se podría haber descubierto cada paso, mide el nivel real con quizzes y deja cada clase escrita en un markdown legible en Obsidian.

## 3. Restricciones (no negociables)

| ID | Restricción |
|---|---|
| RC-01 | Costo adicional **$0**: solo el plan Claude Pro. Sin API keys, sin OpenRouter, sin extra usage, sin servicios de búsqueda de pago. |
| RC-02 | Funciona en **Windows nativo** (PowerShell + Git for Windows). Sin WSL, sin tmux. |
| RC-03 | Toda la IA corre dentro de **Claude Code** autenticado con la suscripción. |
| RC-04 | Idioma de enseñanza: **español**. |
| RC-05 | Uso eficiente del cupo Pro (límite por ventana de 5 h compartido con claude.ai): las piezas costosas deben poder apagarse. |

## 4. Requisitos funcionales

### Enseñanza (núcleo)

| ID | Requisito |
|---|---|
| RF-01 | CUANDO pida aprender un tema, EL SISTEMA DEBE ejecutar siempre las fases **Probe → Plan → Teach**, en ese orden. |
| RF-02 | EL SISTEMA DEBE aplicar el Principio i: construir desde **verdades incondicionales** (hechos aceptables sin matices), distinguiendo "verdad incondicional" de "axioma". |
| RF-03 | EL SISTEMA DEBE aplicar el Principio ii: cada paso derivado se **motiva** ("¿cómo pude haberlo descubierto?"), eligiendo modo socrático o expositivo según el tema y mi energía. |
| RF-04 | En Probe, EL SISTEMA DEBE mapear el **borde** de mi conocimiento por cada hilo relevante, con piso (algo que acierto) y techo (algo que fallo), usando búsqueda binaria de dificultad. No avanza con todo correcto ni con un solo error. |
| RF-05 | En Probe, EL SISTEMA DEBE preguntarme mi **objetivo de aprendizaje** con preguntas sin respuesta correcta hasta volverlo concreto. |
| RF-06 | En Plan, EL SISTEMA DEBE presentar el enfoque en prosa + un **mapa de dependencias Mermaid** (raíces = verdades incondicionales, sumidero = mi objetivo) y **esperar mi aprobación** antes de enseñar. |
| RF-07 | En Teach, EL SISTEMA DEBE recorrer el mapa nodo por nodo con el ciclo **Motivar → Establecer → Conectar → Verificar (quiz)**. Si fallo la verificación, repara el nodo antes de seguir. |
| RF-08 | EL SISTEMA DEBE escribir matemáticas en **LaTeX** (`$...$`, `$$...$$`). |
| RF-09 | EL SISTEMA DEBE conocer mi perfil (ingeniero junior, C#/.NET, web, bases matemáticas universitarias) para no empezar el Probe desde cero en temas donde ya tengo base. |

### Quiz

| ID | Requisito |
|---|---|
| RF-10 | EL SISTEMA DEBE hacer preguntas **calificables** de opción múltiple con UI seleccionable, incluyendo siempre la opción **"No sé"**. |
| RF-11 | Tras mi respuesta, EL SISTEMA DEBE mostrar **✓/✗, la respuesta correcta y la explicación**. |
| RF-12 | EL SISTEMA DEBE fijar la respuesta correcta **antes** de que yo responda, sin mostrármela, y calificar contra ella (no puede cambiarla después). |
| RF-13 | EL SISTEMA DEBE construir opciones parejas: sin justificación dentro de ninguna opción, distractores derivados de errores reales con la misma estructura, sin negritas asimétricas. |
| RF-14 | Las preguntas **sin** respuesta correcta (preferencias, rumbo) DEBEN ir por un canal distinto al quiz. |

### Registro en markdown (md-log)

| ID | Requisito |
|---|---|
| RF-15 | CUANDO ejecute `/md-log <ruta>`, EL SISTEMA DEBE vincular ese `.md` a la sesión e incluir el historial previo (backfill). |
| RF-16 | EL SISTEMA DEBE reflejar en el `.md` solo lo legible: mis mensajes, la prosa del tutor y los bloques de pregunta/respuesta. Omite lecturas de archivos, bash, etc. |
| RF-17 | El `.md` se actualiza **automáticamente** al final de cada respuesta, sin que el tutor tenga que acordarse. |
| RF-18 | CUANDO ejecute `/md-unlog`, EL SISTEMA DEBE dejar de registrar. |

### Verificación de hechos (researcher)

| ID | Requisito |
|---|---|
| RF-19 | CUANDO el tutor tenga la mínima duda sobre un hecho, nombre, fecha, fórmula o definición, DEBE verificarlo con un **subagente researcher** antes de enseñarlo. |
| RF-20 | En Plan, EL SISTEMA DEBE mapear el tema con el researcher antes de dibujar el grafo. |
| RF-21 | El researcher DEBE devolver un informe con Resumen, Hallazgos con fuentes, Fuentes (conservadas/descartadas) y Vacíos. |
| RF-22 | Si una verificación corrige algo que el tutor iba a decir, DEBE decirlo explícitamente. |

### Visualizaciones

| ID | Requisito |
|---|---|
| RF-23 | CUANDO una idea sea más clara como imagen (estructura o geometría), EL SISTEMA DEBE delegar UN diagrama a un subagente maker. Si la prosa basta, no dibuja. |
| RF-24 | `mermaid-maker` para relaciones (grafos, flujos, secuencias); `svg-maker` para lo espacial (geometría, vectores, rectas numéricas, gráficas). |
| RF-25 | El maker DEBE renderizar a PNG, **mirar la imagen**, iterar hasta que sea correcta, guardarla en `viz/` con nombre único y devolver el nombre, o `NONE` si no puede. |
| RF-26 | El tutor DEBE embeber la imagen como `![[viz-<slug>-<timestamp>.png|500]]`. |

### Configuración

| ID | Requisito |
|---|---|
| RF-27 | EL SISTEMA DEBE permitir activar/desactivar researcher y visuales para ahorrar cupo (RC-05). |

## 5. Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | Instalación reproducible desde cero en Windows en menos de 30 min siguiendo un README. |
| RNF-02 | Todo el sistema vive en la carpeta `.claude/` del proyecto (portable; se puede copiar a otro proyecto). |
| RNF-03 | Los scripts auxiliares usan **Node.js** (una sola dependencia de runtime, necesaria también para Mermaid). |
| RNF-04 | Los scripts no hacen llamadas de red salvo la instalación de paquetes npm. |
| RNF-05 | El log markdown nunca contiene la respuesta correcta de un quiz antes de que yo responda. |
| RNF-06 | El sistema debe de funcionar como un cuaderno para que el usuario tenga en cuenta lo que ha estado estudiando y donde seguir, evitando confusion del usuario al ejecutar el sistema y no encontrar nada. |

## 6. Fuera de alcance (v1)

Repetición espaciada, múltiples usuarios, interfaz web, sincronización del vault, generación de audio.

## 7. Criterios de aceptación globales

1. Con `ANTHROPIC_API_KEY` sin definir y *extra usage* desactivado, una sesión completa de enseñanza funciona y el consumo aparece solo en el cupo del plan.
2. "Enséñame cómo funciona TCP" produce: quizzes de Probe → pregunta de objetivo → plan con Mermaid → espera aprobación → nodos con quiz.
3. El `.md` vinculado se ve correcto en Obsidian, con LaTeX, Mermaid e imágenes de `viz/`.
4. Con researcher y visuales desactivados, el tutor sigue enseñando sin errores.
