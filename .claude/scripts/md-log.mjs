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
    const entry = JSON.parse(line);
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
