---
name: md-log
description: Vincula esta sesión a una nota .md para que el historial se registre en ella automáticamente.
disable-model-invocation: true
argument-hint: <ruta.md>
---

Ejecuta exactamente esto, sin modificarlo:

```bash
node .claude/scripts/md-log.mjs link '$ARGUMENTS'
```

Después dile a Diego, en una sola línea, que la nota se (re)escribirá al final de este turno, incluyendo el historial previo de la sesión. Nada más.
