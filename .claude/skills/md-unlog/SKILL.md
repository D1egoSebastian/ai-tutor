---
name: md-unlog
description: Desvincula esta sesión de la nota: deja de registrar el historial automáticamente.
disable-model-invocation: true
---

Ejecuta exactamente esto, sin modificarlo:

```bash
node .claude/scripts/md-log.mjs unlink --session '${CLAUDE_SESSION_ID}'
```

Después dile a Diego, en una sola línea, que esta sesión dejó de registrarse. Nada más.
