# Manual de uso — ai-tutor

Guía práctica para Diego. La instalación está en el [README](README.md); aquí está cómo **estudiar** con el tutor.

---

## 1. La idea en un minuto

El tutor no te suelta explicaciones. Sigue siempre tres fases:

| Fase | Qué pasa | Qué haces tú |
|---|---|---|
| **1. Probe** | Te hace quizzes para encontrar el *borde* de lo que sabes (algo que aciertas y algo que fallas en cada hilo del tema) y te pregunta qué quieres lograr | Responde con honestidad. Usa **"No sé"** cuando no sepas: adivinar le da un mapa falso |
| **2. Plan** | Te muestra el enfoque y un **mapa de dependencias** (Mermaid): de las verdades incondicionales hasta tu objetivo | **Apruébalo o pide cambios.** No enseña nada hasta que digas que sí |
| **3. Teach** | Recorre el mapa nodo por nodo: *motivar → establecer → conectar → verificar (quiz)* | Si fallas la verificación, repara ese nodo antes de seguir. Es normal |

Dos principios lo guían todo:
- **Verdades incondicionales primero:** construye sobre hechos que aceptas sin matices.
- **"¿Cómo pude haberlo descubierto?":** cada paso se motiva, no se impone.

---

## 2. Tu primera clase, paso a paso

1. Abre una terminal en la carpeta del proyecto y ejecuta:
   ```powershell
   claude
   ```
2. Vincula la clase a una nota (recomendado **antes** de empezar, aunque también funciona después):
   ```
   /md-log notas/tcp.md
   ```
3. Pide el tema en lenguaje natural:
   ```
   Enséñame cómo funciona TCP
   ```
4. Responde los quizzes del Probe (aparecen como un selector de opciones).
5. Responde las preguntas sobre tu objetivo. No tienen respuesta correcta: sé concreto ("quiero entender por qué TCP garantiza el orden, no memorizar el header").
6. Revisa el plan y el mapa. Aprueba o pide ajustes.
7. Aprende nodo por nodo. Abre `notas/tcp.md` en Obsidian cuando quieras releer.

> **Tip:** una clase por sesión. Cuando cambies de tema, cierra y abre `claude` (o usa `/clear`): el contexto viejo no se vuelve a enviar y ahorras cupo.

---

## 3. Los quizzes

- Cada pregunta tiene **3 opciones + "No sé"**. La posición de la correcta cambia.
- La respuesta correcta se **fija antes** de que respondas (queda guardada en `.learn/quiz-key.jsonl`) y un script califica. El tutor no puede cambiarla después ni "darte por buena" una respuesta a medias.
- Tras responder ves **✓ / ✗ / No sé**, la respuesta correcta y la explicación.
- El selector siempre trae una opción **"Other"** para escribir texto libre. Úsala si quieres, pero se califica como ✗ salvo que escribas exactamente la opción correcta. Para explicar tu razonamiento, mejor escríbelo como mensaje normal después.
- "No sé" **no es un fracaso**: es la información más útil que le puedes dar al tutor.

---

## 4. Tus notas en Obsidian

| Comando | Efecto |
|---|---|
| `/md-log notas/<tema>.md` | Vincula **esta sesión** a esa nota. Incluye todo lo anterior de la sesión (backfill) |
| `/md-unlog` | Deja de registrar esta sesión. Lo ya escrito se conserva |

Cómo funciona:
- La nota se reescribe **al final de cada respuesta** del tutor (no en vivo, mientras escribe).
- Se registra solo lo legible: tus mensajes, la prosa del tutor y los bloques de pregunta/opciones/respuesta. Nunca comandos, archivos leídos ni la clave del quiz antes de que respondas.
- Cada sesión escribe su propio bloque, delimitado por comentarios invisibles `<!-- md-log:session ... -->`. Si retomas el tema otro día con la misma nota, se agrega un bloque nuevo **sin borrar** el anterior.
- ✅ Puedes escribir tus propios apuntes **fuera** de esos bloques (arriba, abajo o entre sesiones): se respetan.
- ⚠️ No edites **dentro** de un bloque de sesión: se regenera y tus cambios se perderían.
- LaTeX (`$...$`), Mermaid y las imágenes `![[viz-....png|500]]` se ven directamente en Obsidian.

---

## 5. Retomar otro día: el cuaderno

`notas/_cuaderno.md` es tu **índice de estudio**. El tutor lo mantiene solo:
- al aprobar un plan crea el tema con los nodos del mapa como checklist;
- al pasar la verificación de un nodo lo marca `[x]` y mueve `← próximo`;
- al cerrar o pausar actualiza el estado y la fecha.

Cuando abres `claude`, un hook le pasa al tutor el resumen del cuaderno, así que te ofrecerá seguir donde quedaste:

> "La última vez quedamos en TCP → números de secuencia (1/3 nodos). ¿Seguimos?"

Si aceptas:
1. Vincula la **misma** nota: `/md-log notas/tcp.md`.
2. El tutor se salta Probe y Plan (ya aprobados).
3. Hace un quiz corto de repaso del último nodo completado y continúa.

Para pausar bien una clase dile algo como *"pausemos aquí"*: así actualiza el cuaderno antes de que cierres.

---

## 6. Modo ahorro (cupo del plan Pro)

El límite del plan Pro es por ventana de 5 horas y se comparte con claude.ai. Lo más caro son los **subagentes**: cada llamada cuesta del orden de **~86k tokens** solo en arrancar.

Edita la sección *Configuración del tutor* de [CLAUDE.md](CLAUDE.md):

```
- researcher: on        # on | off | solo-plan
- visuales: on          # on | off
```

| Situación | researcher | visuales |
|---|---|---|
| Tema nuevo donde la precisión importa (historia, ciencia, especificaciones) | `on` | `on` |
| Sesión larga o cupo justo | `solo-plan` | `off` |
| Repaso de algo que ya dominas bastante | `off` | `off` |
| Tema muy visual (geometría, grafos, vectores) | `solo-plan` | `on` |

- Con `researcher: off`, el tutor marca con **⚠️** lo que enseñe sin verificar.
- Con `visuales: off`, enseña en prosa y LaTeX; el mapa del Plan sigue apareciendo porque es texto Mermaid, no una imagen generada.
- Los cambios en `CLAUDE.md` se aplican en la **siguiente** sesión.

---

## 7. Verificación de hechos (researcher)

Cuando el tutor duda de un hecho, nombre, fecha, fórmula o definición, consulta al subagente `researcher`, que busca en la web y devuelve un informe con fuentes. Si esa verificación corrige algo que el tutor iba a decir, te lo dirá explícitamente.

Puedes pedirlo tú también:
```
Verifica con el researcher en qué año se publicó RFC 793
```

Límite a tener en cuenta: el researcher corre en Haiku para ahorrar cupo. Es rápido y cita fuentes, pero puede pasar por alto matices (en las pruebas afirmó "sin vacíos" sin mencionar que hubo una especificación de TCP anterior, RFC 675). Si algo es crítico, pídele al tutor que lo revise más a fondo.

---

## 8. Diagramas

Cuando una idea es más clara como imagen, el tutor delega **un** diagrama:
- `mermaid-maker` para relaciones (grafos, flujos, secuencias, estados).
- `svg-maker` para lo espacial (geometría, vectores, rectas numéricas, gráficas).

El maker dibuja, **mira la imagen**, corrige hasta que esté bien, la guarda en `viz/` y el tutor la inserta en la clase. Si no logra un diagrama correcto, sigue en prosa.

También puedes pedirlo: *"hazme un diagrama de la ventana deslizante"*.

---

## 9. Chuleta

| Quiero… | Hago… |
|---|---|
| Empezar un tema | `claude` → `/md-log notas/<tema>.md` → "Enséñame …" |
| Retomar un tema | `claude` → aceptar la oferta del tutor → `/md-log notas/<tema>.md` |
| Ir más rápido o más despacio | Díselo: "más socrático", "más directo", "estoy cansado, explícamelo" |
| Saltar algo que ya sé | "Eso ya lo domino, pregúntame para comprobarlo" |
| Pausar | "Pausemos aquí" |
| Dejar de registrar | `/md-unlog` |
| Ahorrar cupo | `CLAUDE.md` → `researcher: solo-plan`, `visuales: off` |
| Ver mi progreso | Abrir `notas/_cuaderno.md` en Obsidian |
| Ver cuánto cupo llevo | <https://claude.ai/settings/usage> |

---

## 10. Pendiente de validar por ti (prueba de aceptación T7.3)

Todo lo automatizable está probado (103 tests + pruebas reales de hooks, registro, researcher y diagramas). Estas comprobaciones requieren una sesión interactiva tuya:

- [ ] Abrir `claude` en el proyecto y **aceptar el diálogo de confianza**.
- [ ] `/md-log notas/tcp.md` → "Enséñame cómo funciona TCP": ves quizzes de Probe → pregunta de objetivo → plan con Mermaid → espera tu aprobación → nodos con quiz.
- [ ] Los quizzes **no piden permiso** para correr el script y cada uno trae "No sé".
- [ ] `notas/tcp.md` se ve bien en Obsidian (LaTeX, Mermaid e imágenes de `viz/`).
- [ ] `notas/_cuaderno.md` tiene el tema con su checklist; al reabrir `claude`, el tutor te ofrece retomarlo.
- [ ] Repetir con `researcher: off` y `visuales: off`: sigue enseñando sin errores y marca ⚠️.
- [ ] <https://claude.ai/settings/usage> no muestra *extra usage*.

Si algo falla, anota qué pasó en `specs/ai-teacher/spikes.md` (sección T7.3) y lo corregimos siguiendo SDD: primero la spec, después el código.
