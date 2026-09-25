# AI Teacher — Spikes

> Phase 1 of `tasks.md`. Each spike answers one design assumption. Run on 2026-09-25, Claude Code 2.1.280, Windows 11, Node v24.18.0.

## S1 — `AskUserQuestion` limits (validates design 4.3)

Source: the tool's own input schema, plus a real call in the session that built this project.

| Limit | Value |
|---|---|
| Questions per call | 1–4 |
| Options per question | 2–4 |
| `header` | max 12 characters (shown as a chip) |
| Free text | an **"Other"** option is always added automatically; the user can type anything |
| Multi-select | optional (`multiSelect: true`) |
| Extras | per-option `description`; optional `preview` |

**Decision:** quiz format stays **3 real options + "No sé"** (4 total).

**Consequence for grading:** because "Other" always exists, the user can answer free text. `quiz-grade` must treat any answer that is not the committed correct label and not "No sé" as `✗` (the free text is still shown in the log).

## S2 — Transcript format (validates design 4.5)

Location: `~/.claude/projects/<project-path-with-dashes>/<session_id>.jsonl`. One JSON object per line. Each assistant **content block** is its own line (text, thinking and each tool_use are separate lines sharing `message.id`).

Many line types are not conversation and must be ignored: `attachment`, `bridge-session`, `queue-operation`, `last-prompt`, `custom-title`, `file-history-snapshot`, `file-history-delta`, `agent-name`, `atis-latch`, … The parser must **skip unknown types**.

Reduced real examples:

```jsonc
// User message typed by the user
{"type":"user","isSidechain":false,"message":{"role":"user","content":"Te doy contexto, he encontrado..."}}

// Assistant prose
{"type":"assistant","isSidechain":false,"message":{"id":"msg_011C...","role":"assistant","content":[{"type":"text","text":"Voy a empezar leyendo tus specs..."}]}}

// Assistant thinking (exclude)
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}

// Tool call (exclude unless AskUserQuestion)
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01Py...","name":"Bash","input":{"command":"..."}}]}}

// AskUserQuestion call
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01Fb...","name":"AskUserQuestion",
  "input":{"questions":[{"question":"¿Dónde creo el proyecto nuevo...?","header":"Ubicación","multiSelect":false,
    "options":[{"label":"AI Learning\\ai-tutor (Recomendado)","description":"..."},{"label":"Dentro de .pi","description":"..."}]}]}}]}}

// AskUserQuestion result — use the structured `toolUseResult.answers` (question text -> chosen label)
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_01Fb...",
  "content":"Your questions have been answered: \"¿Dónde...?\"=\"AI Learning\\ai-tutor (Recomendado)\". ..."}]},
 "toolUseResult":{"questions":[...],"answers":{"¿Dónde creo el proyecto nuevo...?":"AI Learning\\ai-tutor (Recomendado)"}}}
```

User-role lines that are **not** typed by the user (exclude):

| Shape | Meaning |
|---|---|
| `"isMeta": true` | skill body expansion, image captions, system nudges |
| content starts with `<command-name>` | slash command invocation (e.g. `/md-log notas/x.md`) |
| content starts with `<local-command-` | local command caveat / stdout |
| `"isSidechain": true` | subagent traffic |
| `"isCompactSummary": true` | compaction summary |
| content array made only of `tool_result` blocks | tool output (except AskUserQuestion answers, rendered from `toolUseResult`) |

## S3 — Hooks on Windows (validates ADR-02, design 4.5 and 4.9)

Tested with headless `claude -p --model haiku` in a throwaway project.

| Check | Result |
|---|---|
| `Stop` hook runs on native Windows (Git Bash) | ✓ |
| `$CLAUDE_PROJECT_DIR` expands in the command | ✓ (`C:/Users/...` with forward slashes) |
| Stop stdin fields | `session_id`, `transcript_path` (Windows backslashes), `cwd`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `permission_mode`, … |
| Transcript already contains the final assistant text when `Stop` fires | ✓ (`last_assistant_message` == last text in the `.jsonl`) |
| `SessionStart` hook stdout is injected into the model context | ✓ (model repeated a keyword printed only by the hook) |
| Inline `node -e "..."` with nested quotes | ✗ silently fails — **always call a script file** |

Recommended hook command form: `node "$CLAUDE_PROJECT_DIR/.claude/scripts/md-log.mjs" render`.

## S4 — Subagent reads a PNG (validates design 4.7)

A Sonnet subagent with only `Read` described `.pi/assets/thumbnail.png` correctly (π logo, arrows, quiz with ✗ on option 3 and ✓ on option 4, "Incorrect.", "D'Alembert + trig identity."). ✓

**Cost finding (RC-05):** that single-read subagent consumed **~86k tokens**, mostly its own system prompt. Each maker/researcher call is expensive in Pro quota. This supports `visuales: off` as a sensible default for long sessions and one diagram per idea max.
