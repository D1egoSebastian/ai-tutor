#!/usr/bin/env node
// md-log.mjs — small CLI dispatcher for the AI Teacher quiz protocol.
//
// Currently implements: quiz-commit, quiz-grade (T3.1).
// Phase 4 adds: link, unlink, render, notebook — as additional cases in the
// `main` dispatcher below, reusing the same "pure function + thin CLI
// wrapper" shape so each subcommand stays independently unit-testable.
//
// Node >= 20, ESM, zero runtime dependencies. Runs on Windows via Git Bash.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Bad CLI usage (missing/invalid flags, unknown subcommand). Exit code 2. */
export class UsageError extends Error {}

/** A quiz-key operation that is refused by protocol rules. Exit code 1. */
export class QuizProtocolError extends Error {}

// ---------------------------------------------------------------------------
// Project root / state dir resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the project root from THIS SCRIPT's location, never from cwd:
 *   <root>/.claude/scripts/md-log.mjs -> <root>
 * This keeps the CLI correct regardless of where it is invoked from
 * (e.g. a Stop/SessionStart hook running with a different cwd).
 *
 * AI_TUTOR_ROOT env var overrides this resolution. It exists ONLY for
 * tests, so a CLI-level test can point the script at a temp directory
 * instead of mutating the real project's `.learn/` state.
 */
export function resolveProjectRoot() {
  if (process.env.AI_TUTOR_ROOT) {
    return process.env.AI_TUTOR_ROOT;
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..", "..");
}

/** Internal state dir: <root>/.learn/ */
export function resolveStateDir(root) {
  return path.join(root, ".learn");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function quizKeyPath(stateDir) {
  return path.join(stateDir, "quiz-key.jsonl");
}

function statePath(stateDir) {
  return path.join(stateDir, "state.json");
}

function errorLogPath(stateDir) {
  return path.join(stateDir, "md-log-error.log");
}

/**
 * Writes `content` to `filePath` atomically: write to a temp file in the
 * same directory, then rename. Rename is atomic on the same filesystem, so
 * a reader (Obsidian) never observes a half-written file.
 *
 * If the rename fails (e.g. the target path is a directory, or a permission
 * error), the temp file is removed before the error is rethrown — a failed
 * write must never leak a stray `.tmp` file next to the note.
 * `renameFn` is injectable for tests.
 */
export function writeFileAtomic(filePath, content, { renameFn = fs.renameSync } = {}) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content, "utf8");
  try {
    renameFn(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup — ignore a secondary failure here.
    }
    throw err;
  }
}

/**
 * Appends an error line to `<stateDir>/md-log-error.log`. Never throws:
 * this is the last-resort error channel for the Stop/SessionStart hooks,
 * which must never break Claude Code even if logging itself fails.
 */
function logError(stateDir, message) {
  try {
    ensureDir(stateDir);
    fs.appendFileSync(errorLogPath(stateDir), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Swallow — logging must never throw.
  }
  process.stderr.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// Answer normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes an answer/label for comparison: Unicode NFC, trim, collapse
 * inner whitespace, lowercase. Used for both quiz-grade comparisons and the
 * "no sé" / "no se" special case.
 */
export function normalizeAnswer(text) {
  return String(text).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const NO_SE_VARIANTS = new Set(["no sé", "no se"]);

// ---------------------------------------------------------------------------
// quiz-key.jsonl storage
// ---------------------------------------------------------------------------

function readQuizKeys(stateDir) {
  const filePath = quizKeyPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const keys = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // Malformed or partial trailing line (e.g. a crash mid-write) — skip
      // it rather than breaking grading for every other committed id.
      continue;
    }
    keys.set(entry.id, entry);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Core operations — pure aside from explicit fs access via stateDir
// ---------------------------------------------------------------------------

/**
 * Appends a committed quiz key to `<stateDir>/quiz-key.jsonl`.
 * Refuses to overwrite an existing id (RF-12: the key cannot change after
 * committing).
 */
export function commitQuiz({ stateDir, id, correct, explanation }) {
  if (!id || !correct || !explanation) {
    throw new UsageError(
      "quiz-commit requires --id, --correct and --explanation (or --stdin with a JSON object containing those keys)"
    );
  }

  const existing = readQuizKeys(stateDir);
  if (existing.has(id)) {
    throw new QuizProtocolError(`quiz id already committed: ${id}`);
  }

  ensureDir(stateDir);
  const entry = { id, correct, explanation, committedAt: new Date().toISOString() };
  fs.appendFileSync(quizKeyPath(stateDir), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

/**
 * Grades an answer against the committed key. Never mutates the key.
 * Returns { result: "✓" | "✗" | "NO_SE", correct, explanation }.
 */
export function gradeQuiz({ stateDir, id, answer }) {
  if (!id || answer === undefined || answer === null) {
    throw new UsageError("quiz-grade requires --id and --answer");
  }

  const existing = readQuizKeys(stateDir);
  const entry = existing.get(id);
  if (!entry) {
    throw new QuizProtocolError(`unknown quiz id: ${id}`);
  }

  const normalizedAnswer = normalizeAnswer(answer);
  let result;
  if (NO_SE_VARIANTS.has(normalizedAnswer)) {
    result = "NO_SE";
  } else if (normalizedAnswer === normalizeAnswer(entry.correct)) {
    result = "✓";
  } else {
    result = "✗";
  }

  return { result, correct: entry.correct, explanation: entry.explanation };
}

// ---------------------------------------------------------------------------
// state.json (link / unlink / render) — T4.1, RF-15…18
// ---------------------------------------------------------------------------

/**
 * Normalizes a user-supplied note path into a project-relative POSIX path:
 *  - backslashes -> forward slashes (Windows input is common: /md-log notas\tcp.md)
 *  - resolved relative to `root`; absolute paths (Windows drive letters included)
 *    are accepted as long as they resolve *inside* `root`
 *  - `.md` is appended when the path doesn't already end with it
 * Throws a plain Error (mapped to exit 1 by the CLI dispatcher) when the
 * resolved path escapes the project root — never silently write outside it.
 */
export function normalizeNotePath(root, inputPath) {
  if (!inputPath || typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new UsageError("link requires a non-empty path");
  }

  const slashed = inputPath.replace(/\\/g, "/").trim();
  const rootResolved = path.resolve(root);
  const absolute = path.resolve(rootResolved, slashed);
  const relative = path.relative(rootResolved, absolute);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path resolves outside the project root: ${inputPath}`);
  }

  let posixPath = relative.split(path.sep).join("/");
  if (!posixPath.toLowerCase().endsWith(".md")) {
    posixPath += ".md";
  }
  return posixPath;
}

/**
 * Whether `id` is usable as a real session id for the direct link/unlink
 * path. Rejects absent/empty ids and unexpanded template placeholders (e.g.
 * a literal `${CLAUDE_SESSION_ID}` when the caller's substitution failed) so
 * callers safely fall back to the `pending` flow instead of writing a link
 * under a bogus key.
 */
export function isUsableSessionId(id) {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("$")) return false;
  if (trimmed.includes("{")) return false;
  return true;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Age (ms) of a `pending` entry relative to `now()`. The legacy plain-string
 * form (written by pre-ADR-08 versions, no `at` field) is always treated as
 * age 0 — never expired — for backward compatibility.
 */
function pendingAgeMs(pending, now) {
  if (!pending || typeof pending !== "object" || !pending.at) return 0;
  const at = new Date(pending.at).getTime();
  if (Number.isNaN(at)) return 0;
  return now().getTime() - at;
}

function isPendingExpired(pending, now) {
  return pendingAgeMs(pending, now) > PENDING_TTL_MS;
}

/** Reads `<stateDir>/state.json`. Tolerant: missing/corrupt file -> default shape. */
export function readState(stateDir) {
  const filePath = statePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return { pending: null, links: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      pending: parsed && "pending" in parsed ? parsed.pending : null,
      links: parsed && parsed.links && typeof parsed.links === "object" ? parsed.links : {},
    };
  } catch {
    return { pending: null, links: {} };
  }
}

/** Writes `<stateDir>/state.json` atomically. */
export function writeState(stateDir, state) {
  ensureDir(stateDir);
  writeFileAtomic(statePath(stateDir), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * `link <path>`: with a real `session` id, writes `links[session]` directly
 * (ADR-08 fix — no shared mutable state between concurrent sessions). Without
 * a usable id (absent, or an unexpanded `${CLAUDE_SESSION_ID}` placeholder),
 * falls back to storing `{ path, at }` in `pending`, consumed by the next
 * `render` for *that* session (see `runRender`).
 */
export function link({ root, stateDir, inputPath, session, now = () => new Date() }) {
  const normalized = normalizeNotePath(root, inputPath);
  const state = readState(stateDir);
  if (isUsableSessionId(session)) {
    state.links[session] = normalized;
  } else {
    state.pending = { path: normalized, at: now().toISOString() };
  }
  writeState(stateDir, state);
  return normalized;
}

/** CLI wrapper for `link`. `args[0]` is the raw path argument; `--session <id>` is optional. */
export function runLink({ args, root, stateDir, now }) {
  const inputPath = args[0];
  const { session } = parseFlags(args);
  const normalized = link({ root, stateDir, inputPath, session, now });
  if (isUsableSessionId(session)) {
    return `linked: ${normalized} (session ${session})\n`;
  }
  return `linked (pending): ${normalized}\n`;
}

/**
 * CLI wrapper for `unlink`. With a real `session` id, deletes `links[session]`
 * directly. Otherwise marks `pending: { path: "UNLINK", at }`, consumed by
 * the next `render` for that session.
 */
export function runUnlink({ args = [], stateDir, now = () => new Date() }) {
  const { session } = parseFlags(args);
  const state = readState(stateDir);
  if (isUsableSessionId(session)) {
    delete state.links[session];
    writeState(stateDir, state);
    return `unlinked: session ${session}\n`;
  }
  state.pending = { path: "UNLINK", at: now().toISOString() };
  writeState(stateDir, state);
  return "unlink requested\n";
}

// ---------------------------------------------------------------------------
// Transcript parsing (render) — T4.1, spikes.md S2
// ---------------------------------------------------------------------------

/** Reads a `.jsonl` transcript into an array of parsed objects. Malformed lines are skipped. */
export function readJsonlLines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Malformed line — skip without failing (spikes.md S2).
    }
  }
  return parsed;
}

const USER_EXCLUDED_PREFIXES = ["<command-name>", "<local-command-", "<system-reminder>"];

function isExcludedUserText(text) {
  return USER_EXCLUDED_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function textFromContentBlocks(content) {
  const texts = content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text);
  return texts.length ? texts.join("\n\n") : null;
}

/**
 * Pre-scans every line for AskUserQuestion `tool_result` lines, building a
 * map `tool_use_id -> answers` (from `toolUseResult.answers`, keyed by
 * question text). Needed because the answer can arrive on a line *after*
 * the tool_use line that asked the question (spikes.md S2).
 */
function buildAskAnswersMap(lines) {
  const map = new Map();
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const answers = line.toolUseResult && line.toolUseResult.answers;
    const content = line.message && line.message.content;
    if (!answers || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === "tool_result" && block.tool_use_id) {
        map.set(block.tool_use_id, answers);
      }
    }
  }
  return map;
}

function pushOrMergeText(items, kind, text, timestamp) {
  const last = items[items.length - 1];
  if (last && last.kind === kind) {
    last.text += `\n\n${text}`;
  } else {
    items.push({ kind, text, timestamp });
  }
}

/**
 * Walks the parsed transcript lines and returns the ordered list of
 * "included" render items (user messages, assistant prose, AskUserQuestion
 * blocks), applying every inclusion/exclusion rule from spikes.md S2.
 */
function extractItems(lines) {
  const askAnswers = buildAskAnswersMap(lines);
  const items = [];

  for (const line of lines) {
    if (!line || typeof line !== "object") continue;

    if (line.type === "user") {
      if (line.isMeta === true || line.isSidechain === true || line.isCompactSummary === true) continue;

      const content = line.message && line.message.content;
      let text = null;

      if (typeof content === "string") {
        if (isExcludedUserText(content)) continue;
        text = content;
      } else if (Array.isArray(content)) {
        const hasNonToolResultBlock = content.some((block) => block && block.type !== "tool_result");
        if (!hasNonToolResultBlock) continue; // tool_result-only line (handled via askAnswers)
        text = textFromContentBlocks(content);
        if (text && isExcludedUserText(text)) continue;
      }

      if (!text) continue;
      pushOrMergeText(items, "user", text, line.timestamp);
      continue;
    }

    if (line.type === "assistant") {
      if (line.isSidechain === true) continue;
      const content = line.message && line.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;

        if (block.type === "text" && typeof block.text === "string") {
          pushOrMergeText(items, "assistant", block.text, line.timestamp);
          continue;
        }

        if (block.type === "tool_use" && block.name === "AskUserQuestion") {
          const questions = Array.isArray(block.input && block.input.questions) ? block.input.questions : [];
          const answersByQuestion = askAnswers.get(block.id) || null;
          items.push({
            kind: "ask",
            timestamp: line.timestamp,
            questions: questions.map((q) => ({
              question: q.question,
              options: Array.isArray(q.options) ? q.options.map((o) => o.label) : [],
              answer: answersByQuestion ? answersByQuestion[q.question] : undefined,
            })),
          });
          continue;
        }

        // thinking, every other tool_use, everything else -> excluded silently.
      }
      continue;
    }

    // Non user/assistant top-level types (attachment, file-history-snapshot, ...) -> skip.
  }

  return items;
}

/** Formats an AskUserQuestion answer: `multiSelect` answers arrive as an array — join with ", ". */
function formatAnswer(answer) {
  if (answer === undefined || answer === null) return "_(pendiente)_";
  if (Array.isArray(answer)) return answer.join(", ");
  return answer;
}

function renderQuestionBlock(q) {
  const options = q.options.join(" · ");
  const answer = formatAnswer(q.answer);
  return [`> **Pregunta:** ${q.question}`, `> **Opciones:** ${options}`, `> **Respuesta:** ${answer}`].join("\n");
}

function renderItem(item) {
  if (item.kind === "user") return `**Diego:** ${item.text}`;
  if (item.kind === "assistant") return item.text;
  if (item.kind === "ask") return item.questions.map(renderQuestionBlock).join("\n\n");
  return "";
}

function resolveSessionDate(items, now) {
  for (const item of items) {
    if (item.timestamp) {
      const parsed = new Date(item.timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }
  return now().toISOString().slice(0, 10);
}

const SESSION_START = (sessionId) => `<!-- md-log:session ${sessionId} start -->`;
const SESSION_END = (sessionId) => `<!-- md-log:session ${sessionId} end -->`;

/**
 * Renders the full `<!-- md-log:session ... -->` block for one session from
 * its already-parsed transcript lines. Pure function: no filesystem access.
 */
export function renderSessionBlock({ sessionId, lines, now = () => new Date() }) {
  const items = extractItems(lines);
  const date = resolveSessionDate(items, now);
  const body = [`## Sesión ${date}`, ...items.map(renderItem)].join("\n\n");
  return [SESSION_START(sessionId), body, SESSION_END(sessionId)].join("\n");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces this session's block in `existingContent` if present, else
 * appends it at the end. Everything outside the markers is preserved
 * byte-for-byte (ADR-08: one note, many session blocks).
 *
 * Tolerant of a corrupted note with more than one block for the same
 * session (e.g. left over from a bug, or a manual edit): the FIRST
 * occurrence is replaced with the fresh block and every other occurrence
 * (plus one immediately-following blank-line separator, if any) is dropped,
 * so the note always ends with exactly one block per session. The session
 * id is matched literally — `escapeRegExp` runs over the full marker string,
 * so regex-special characters inside the id can never corrupt the pattern.
 */
export function upsertSessionBlock({ existingContent, sessionId, block }) {
  const pattern = new RegExp(
    `${escapeRegExp(SESSION_START(sessionId))}[\\s\\S]*?${escapeRegExp(SESSION_END(sessionId))}`,
    "g"
  );
  const matches = [...existingContent.matchAll(pattern)];

  if (matches.length > 0) {
    let result = "";
    let cursor = 0;
    matches.forEach((match, index) => {
      const start = match.index;
      const end = start + match[0].length;
      result += existingContent.slice(cursor, start);
      if (index === 0) {
        result += block;
        cursor = end;
      } else {
        // Duplicate block for this session — drop it, swallowing one
        // adjacent blank-line separator so we don't leave a double gap.
        cursor = existingContent.startsWith("\n\n", end) ? end + 2 : end;
      }
    });
    result += existingContent.slice(cursor);
    return result;
  }

  if (existingContent.length === 0) {
    return `${block}\n`;
  }
  const separator = existingContent.endsWith("\n\n") ? "" : existingContent.endsWith("\n") ? "\n" : "\n\n";
  return `${existingContent}${separator}${block}\n`;
}

/**
 * `render`: the Stop hook entry point. Reads the hook's JSON from stdin,
 * applies `pending` to `links[session_id]`, and (if the session has a link)
 * regenerates only that session's block in the linked note.
 *
 * ADR-04: never breaks Claude Code. Every failure path logs to
 * `.learn/md-log-error.log` and returns normally (the CLI dispatcher always
 * exits 0 for this subcommand).
 */
export async function runRender({ stateDir, root, stdin = process.stdin, now = () => new Date() }) {
  let hookInput;
  try {
    const raw = await readStream(stdin);
    hookInput = JSON.parse(raw);
  } catch (err) {
    logError(stateDir, `render: could not parse hook stdin JSON: ${err.message}`);
    return;
  }

  try {
    const sessionId = hookInput && hookInput.session_id;
    const transcriptPath = hookInput && hookInput.transcript_path;

    if (!sessionId || typeof sessionId !== "string") {
      logError(stateDir, "render: hook input is missing session_id");
      return;
    }

    const state = readState(stateDir);
    if (!isPendingExpired(state.pending, now)) {
      const pendingPath =
        state.pending && typeof state.pending === "object" ? state.pending.path : state.pending;
      if (pendingPath === "UNLINK") {
        delete state.links[sessionId];
      } else if (typeof pendingPath === "string" && pendingPath.length > 0) {
        state.links[sessionId] = pendingPath;
      }
    }
    state.pending = null;
    writeState(stateDir, state);

    const notePath = state.links[sessionId];
    if (!notePath) {
      return; // No link for this session — exit quietly.
    }

    const lines = readJsonlLines(transcriptPath);
    const block = renderSessionBlock({ sessionId, lines, now });

    const absoluteNotePath = path.resolve(root, notePath);
    const existingContent = fs.existsSync(absoluteNotePath) ? fs.readFileSync(absoluteNotePath, "utf8") : "";
    const updated = upsertSessionBlock({ existingContent, sessionId, block });
    writeFileAtomic(absoluteNotePath, updated);
  } catch (err) {
    logError(stateDir, `render: ${err.stack || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Study notebook (notebook) — T4.3, RNF-06, design.md 4.9
// ---------------------------------------------------------------------------

/**
 * Parses `notas/_cuaderno.md` into a list of topics. Tolerant by design:
 * unrecognized lines are ignored, never thrown on.
 */
export function parseNotebook(content) {
  if (typeof content !== "string" || content.trim().length === 0) {
    return { topics: [] };
  }

  const topics = [];
  let current = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    const heading = /^##\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      if (current) topics.push(current);
      current = { name: heading[1].trim(), note: null, estado: null, ultimaSesion: null, items: [] };
      continue;
    }

    if (!current) continue;

    const noteMatch = /Nota:\s*(\S+)/.exec(line);
    if (noteMatch && !current.note) {
      current.note = noteMatch[1];
    }

    const estadoMatch = /Estado:\s*([^·]+?)(?:\s*·|$)/.exec(line);
    if (estadoMatch) {
      current.estado = estadoMatch[1].trim();
    }

    const sesionMatch = /\u00daltima sesi\u00f3n:\s*([^\s·]+)/.exec(line);
    if (sesionMatch) {
      current.ultimaSesion = sesionMatch[1].trim();
    }

    const checklist = /^-\s*\[( |x|X)\]\s*(.+)$/.exec(line);
    if (checklist) {
      const done = checklist[1].toLowerCase() === "x";
      const isNext = /\u2190\s*pr\u00f3ximo/.test(checklist[2]);
      const text = checklist[2].replace(/\u2190\s*pr\u00f3ximo/g, "").trim();
      current.items.push({ done, text, isNext });
    }
  }
  if (current) topics.push(current);

  return { topics };
}

/**
 * Builds the compact context summary printed by the `SessionStart` hook
 * (design.md 4.9). Never throws: any parsing problem falls back to the
 * "empty notebook" message.
 */
export function summarizeNotebook(content) {
  let topics;
  try {
    topics = parseNotebook(content).topics;
  } catch {
    topics = [];
  }

  if (!topics || topics.length === 0) {
    return "Cuaderno de estudio: vac\u00edo (todav\u00eda no hay temas).\n";
  }

  const inProgress = [];
  const completed = [];

  for (const topic of topics) {
    const estado = (topic.estado || "").trim();
    if (estado.toLowerCase() === "completado") {
      completed.push(topic.name);
      continue;
    }

    const total = topic.items.length;
    const done = topic.items.filter((item) => item.done).length;
    const next = topic.items.find((item) => item.isNext) || topic.items.find((item) => !item.done);

    let line = `${topic.name} — ${estado || "en curso"}, \u00faltima sesi\u00f3n ${topic.ultimaSesion || "?"} — ${done}/${total} nodos`;
    if (next) line += ` — pr\u00f3ximo: ${next.text}`;
    if (topic.note) line += ` — nota: ${topic.note}`;
    inProgress.push(`- ${line}`);
  }

  if (inProgress.length === 0 && completed.length === 0) {
    return "Cuaderno de estudio: vac\u00edo (todav\u00eda no hay temas).\n";
  }

  const out = ["Cuaderno de estudio (notas/_cuaderno.md):", ...inProgress];
  if (completed.length > 0) {
    out.push(`Completados: ${completed.join(", ")}.`);
  }
  if (inProgress.length > 0) {
    out.push("Si Diego no pide algo concreto, ofr\u00e9cele retomar el tema en curso.");
  }
  return `${out.join("\n")}\n`;
}

/** `notebook`: the SessionStart hook entry point. Never throws — always exits 0. */
export function runNotebook({ root }) {
  const notebookPath = path.join(root, "notas", "_cuaderno.md");
  let content = "";
  try {
    if (fs.existsSync(notebookPath)) {
      content = fs.readFileSync(notebookPath, "utf8");
    }
  } catch {
    content = "";
  }

  try {
    return summarizeNotebook(content);
  } catch {
    return "Cuaderno de estudio: vac\u00edo (todav\u00eda no hay temas).\n";
  }
}

// ---------------------------------------------------------------------------
// CLI-layer helpers
// ---------------------------------------------------------------------------

/** Minimal `--flag value` / `--boolean-flag` parser. No external deps. */
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8");
}

/**
 * Runs `quiz-commit`. Supports flags (--id/--correct/--explanation) and
 * --stdin (reads a JSON object {"id","correct","explanation"} from stdin).
 * The --stdin path is the safe way to pass text containing `$` (LaTeX) or a
 * single quote from a Bash heredoc, without shell interpolation risk.
 * Returns the stdout string. NEVER includes the correct label (RNF-05).
 */
export async function runQuizCommit({ args, stateDir, stdin = process.stdin }) {
  const flags = parseFlags(args);

  let id, correct, explanation;
  if (flags.stdin) {
    const raw = await readStream(stdin);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new UsageError("quiz-commit --stdin expects a valid JSON object with id, correct and explanation");
    }
    ({ id, correct, explanation } = parsed);
  } else {
    ({ id, correct, explanation } = flags);
  }

  commitQuiz({ stateDir, id, correct, explanation });
  return `committed: ${id}\n`;
}

/**
 * Runs `quiz-grade`. Returns the stdout string:
 *   result: ✓|✗|NO_SE
 *   correct: <label>
 *   explanation: <text>
 */
export function runQuizGrade({ args, stateDir }) {
  const flags = parseFlags(args);
  const { id, answer } = flags;
  const { result, correct, explanation } = gradeQuiz({ stateDir, id, answer });
  return `result: ${result}\ncorrect: ${correct}\nexplanation: ${explanation}\n`;
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function printUsage() {
  process.stderr.write(
    [
      "Usage: md-log.mjs <subcommand> [options]",
      "",
      "Subcommands:",
      "  quiz-commit --id <qid> --correct <label> --explanation <text>",
      "  quiz-commit --stdin                 (reads {id,correct,explanation} JSON from stdin)",
      "  quiz-grade  --id <qid> --answer <label>",
      "  link <path> [--session <id>]        (links directly by session id, or sets pending if id is absent/placeholder)",
      "  unlink [--session <id>]              (unlinks directly by session id, or sets pending unlink)",
      "  render                              (Stop hook: reads hook JSON from stdin)",
      "  notebook                            (SessionStart hook: prints notas/_cuaderno.md summary)",
      "",
    ].join("\n")
  );
}

export async function main(argv = process.argv.slice(2)) {
  const [subcommand, ...rest] = argv;
  const root = resolveProjectRoot();
  const stateDir = resolveStateDir(root);

  try {
    switch (subcommand) {
      case "quiz-commit": {
        const output = await runQuizCommit({ args: rest, stateDir });
        process.stdout.write(output);
        return;
      }
      case "quiz-grade": {
        const output = runQuizGrade({ args: rest, stateDir });
        process.stdout.write(output);
        return;
      }
      case "link": {
        const output = runLink({ args: rest, root, stateDir });
        process.stdout.write(output);
        return;
      }
      case "unlink": {
        const output = runUnlink({ args: rest, stateDir });
        process.stdout.write(output);
        return;
      }
      case "render": {
        // The Stop hook must never break Claude Code: runRender traps every
        // error internally (logs + stderr) and always resolves normally, so
        // this subcommand always exits 0.
        await runRender({ stateDir, root, stdin: process.stdin });
        return;
      }
      case "notebook": {
        // Same contract as render: SessionStart must never fail the session.
        try {
          process.stdout.write(runNotebook({ root }));
        } catch (err) {
          logError(stateDir, `notebook: ${err.stack || err.message}`);
        }
        return;
      }
      default: {
        printUsage();
        process.exitCode = 2;
        return;
      }
    }
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  }
}

// Guard so importing this module (e.g. from tests) never runs the CLI.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
