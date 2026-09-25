---
name: visualize
description: "Agrega un visual correcto y mínimo a una clase — un diagrama o una figura geométrica — que se renderiza inline en el log de Obsidian. Úsala cuando una idea es genuinamente más clara como imagen: un grafo de dependencias, un sistema/flujo, una secuencia, una máquina de estados, un árbol, una comparación, o algo espacial/geométrico (geometría de coordenadas, recta numérica, vectores, una gráfica, una disposición física). Delega la autoría+render a un subagente maker que verifica la imagen mirándola, y luego tú embebes el archivo devuelto."
---

# Visualize

Una imagen se gana su lugar solo cuando muestra algo que las palabras no pueden — forma, estructura, dirección, relación, geometría. Esta skill produce UNA imagen así, garantiza que sea **correcta** (el maker la renderiza y la mira antes de devolverla), y la coloca en la clase para que se renderice inline en el archivo `md-log` de Obsidian.

Tú eres el **director creativo**. Decides la idea exacta y la destilas a sus menos elementos que la sostienen. Un **subagente maker** hace la autoría, el render, la verificación visual y el guardado, y luego devuelve un nombre de archivo. Tú embebes ese nombre de archivo en tu respuesta.

## Cuándo visualizar (y cuándo no)

Este sistema de enseñanza construye un **grafo de dependencias en la cabeza del que aprende** — axiomas en la raíz, hechos derivados colgando de ellos. Un visual es poderoso exactamente cuando hace visible esa estructura (o una geometría). Recurre a uno cuando:

- La idea es una **estructura o relación**: dependencias, un sistema con partes y flechas, un flujo/pipeline, una secuencia de intercambios, una máquina de estados, un árbol/jerarquía, una comparación, una contención (qué está adentro vs. afuera).
- La idea es **espacial o geométrica**: geometría de coordenadas, una recta numérica, vectores, la forma de una función, una disposición física.

NO visualices cuando la prosa o una sola ecuación ya lo transmite. Un diagrama decorativo que solo repite la frase de al lado agrega ruido y una oportunidad de estar equivocado. Ante la duda, no lo hagas — falta un visual es más barato que uno falso.

## Elige el maker

Dos makers, en `.claude/agents/`:

- **`mermaid-maker`** — visuales estructurales/relacionales: grafos de dependencias, diagramas de flujo, diagramas de secuencia/estado/ER/clases, árboles, mindmaps, líneas de tiempo. Es el default y encaja directo con la pedagogía de grafo de dependencias.
- **`svg-maker`** — visuales espaciales/geométricos que Mermaid no puede maquetar: coordenadas exactas, figuras de geometría, rectas numéricas, vectores, gráficas, formas personalizadas.

Regla de dedo pulgar: si es *nodos-y-aristas / relaciones*, usa mermaid-maker. Si es *posiciones-y-formas / geometría*, usa svg-maker.

## Cuidado con el costo (spike S4)

Cada llamada a un maker es un subagente completo — el spike S4 midió que una sola lectura de imagen con `Read` consume **~86k tokens**, sobre todo por su propio system prompt. Eso es caro contra el cupo del plan Pro (RC-05). Por eso: UN diagrama por idea como máximo, y solo cuando la prosa genuinamente no basta — nunca uses un visual "porque sí" o para decorar.

## Redacta bien el brief para el maker: una idea, los menos elementos

El fallo más común es **amontonar** — cada etiqueta de más hace el dibujo más difícil de leer Y más difícil de maquetar bien. Antes de redactar el brief, poda hasta los menos elementos que sostienen la idea, y para cada uno pregúntate: *"si borro esto, ¿la idea sigue siendo clara?"* Si sí, bórralo.

Dale al maker el concepto Y los elementos concretos que quieres — no un tema vago, y no una lista larga de requisitos.

- MAL: "haz un diagrama de cómo funciona TCP"
- BIEN: "graph TD: un nodo 'paquete' arriba; flechas hacia abajo a 'orden' y 'retransmisión ante pérdida'; ambas flechas bajan hacia 'flujo confiable'. Sin título. Muestra que la confiabilidad se construye DESDE los paquetes, no al lado de ellos."

Conserva la idea intacta pero confía en que el maker la componga; si tu brief lista más de ~5–7 elementos, recórtalo primero.

## Invoca

Despacha al maker con la herramienta `Agent`:

```
Agent(subagent_type="mermaid-maker", prompt="<tu brief mínimo y concreto>")
```
```
Agent(subagent_type="svg-maker", prompt="<tu brief mínimo y concreto>")
```

El maker escribe la fuente, la renderiza a PNG, **mira el PNG e itera hasta que sea correcto y limpio**, la publica en la bóveda con un nombre de archivo único, y devuelve:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <ruta absoluta>/viz/viz-<slug>-<timestamp>.png
```

Si devuelve `RESULT: NONE`, no pudo hacer una imagen correcta del brief — simplifica, replantea, o decide que el visual no vale la pena, y **sigue en prosa**. Nunca autores ni inventes un diagrama tú mismo — la corrección depende del ciclo render-e-inspecciona del maker.

## Respeta el modo ahorro

Si `CLAUDE.md` tiene `visuales: off` en la sección "Configuración del tutor", **nunca invoques un maker** — enseña completamente en prosa (y LaTeX para matemáticas). No lo menciones como una limitación; simplemente no lo hagas.

## Embébela en la clase

Coloca el embed directamente en tu respuesta de enseñanza, usando el embed de wikilink de Obsidian con el **filename** devuelto (no la ruta completa) y un ancho de despliegue:

```
![[viz-<slug>-<timestamp>.png|500]]
```

Eso es todo. El hook de `md-log` refleja tu texto de respuesta tal cual en el `.md` vinculado, y Obsidian resuelve el embed por nombre de archivo en cualquier parte de la bóveda (el maker guarda en la carpeta `viz` del proyecto, que está dentro de la bóveda) — así que se renderiza inline en la clase automáticamente. El ancho `|500` es un buen default; usa uno mayor para diagramas densos. Presenta el visual en una frase y luego deja que cargue la idea — no vuelvas a narrar cada elemento en prosa.

## Por qué esto es confiable

- El maker nunca devuelve una imagen que no haya **mirado**, así que "se renderiza bien pero dice algo falso" se atrapa antes de llegar al que aprende.
- El embed en PNG significa que **lo que el maker verificó es pixel-idéntico a lo que el que aprende ve** — sin desvío de re-render.
- Los nombres de archivo únicos mantienen sin ambigüedad la resolución de embeds por nombre de archivo de Obsidian.

> Los makers renderizan a través de `.claude/scripts/render.mjs` del proyecto (Mermaid vía `@mermaid-js/mermaid-cli` + el navegador Edge/Chrome instalado; SVG vía `@resvg/resvg-js`). Tú no renderizas nada tú mismo — solo redactas el brief para el maker y embebes el nombre de archivo que devuelve.
