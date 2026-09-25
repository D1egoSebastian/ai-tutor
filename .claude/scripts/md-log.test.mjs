// Tests for md-log.mjs (T3.1 — quiz-commit / quiz-grade).
// Run with: node --test .claude/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";

import {
  commitQuiz,
  gradeQuiz,
  normalizeAnswer,
  runQuizCommit,
  runQuizGrade,
  normalizeNotePath,
  link,
  runLink,
  runUnlink,
  readState,
  writeState,
  writeFileAtomic,
  readJsonlLines,
  renderSessionBlock,
  upsertSessionBlock,
  runRender,
  parseNotebook,
  summarizeNotebook,
  runNotebook,
} from "./md-log.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIR, "md-log.mjs");
const FIXTURES_DIR = path.join(SCRIPT_DIR, "fixtures");
const TRANSCRIPT_FIXTURE = path.join(FIXTURES_DIR, "session-basic.jsonl");
const CUADERNO_FIXTURE = path.join(FIXTURES_DIR, "cuaderno-sample.md");

function makeTempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-md-log-"));
  return path.join(dir, ".learn");
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-root-"));
}

function stdinFrom(text) {
  return Readable.from([Buffer.from(text, "utf8")]);
}

// ---------- normalizeAnswer ----------

test("normalizeAnswer trims, collapses whitespace, lowercases and NFC-normalizes", () => {
  assert.equal(normalizeAnswer("  Ack   Number  "), "ack number");
  assert.equal(normalizeAnswer("No Sé"), "no sé".toLowerCase());
});

// ---------- commitQuiz / gradeQuiz (pure core) ----------

test("commitQuiz then gradeQuiz with the correct answer returns ✓", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-01", correct: "Sequence number", explanation: "Orders bytes on the wire." });

  const graded = gradeQuiz({ stateDir, id: "tcp-01", answer: "Sequence number" });
  assert.equal(graded.result, "✓");
  assert.equal(graded.correct, "Sequence number");
  assert.equal(graded.explanation, "Orders bytes on the wire.");
});

test("gradeQuiz with a wrong answer returns ✗", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-02", correct: "Sliding window", explanation: "Controls in-flight bytes." });

  const graded = gradeQuiz({ stateDir, id: "tcp-02", answer: "Checksum" });
  assert.equal(graded.result, "✗");
});

test("gradeQuiz treats 'No sé' (with accent) as NO_SE", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-03", correct: "ACK", explanation: "Acknowledges receipt." });

  const graded = gradeQuiz({ stateDir, id: "tcp-03", answer: "No Sé" });
  assert.equal(graded.result, "NO_SE");
});

test("gradeQuiz treats 'no se' (without accent) as NO_SE", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-04", correct: "ACK", explanation: "Acknowledges receipt." });

  const graded = gradeQuiz({ stateDir, id: "tcp-04", answer: "no se" });
  assert.equal(graded.result, "NO_SE");
});

test("gradeQuiz treats free-text 'Other' answers (not correct, not no-se) as ✗", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-05", correct: "Sliding window", explanation: "Controls in-flight bytes." });

  const graded = gradeQuiz({ stateDir, id: "tcp-05", answer: "I think it has to do with routing tables" });
  assert.equal(graded.result, "✗");
});

test("gradeQuiz normalizes case and inner whitespace before comparing", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-06", correct: "Three-way   handshake", explanation: "SYN, SYN-ACK, ACK." });

  const graded = gradeQuiz({ stateDir, id: "tcp-06", answer: "  three-way handshake  " });
  assert.equal(graded.result, "✓");
});

test("commitQuiz rejects a duplicate id (RF-12: key cannot change after committing)", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-07", correct: "ACK", explanation: "Acknowledges receipt." });

  assert.throws(
    () => commitQuiz({ stateDir, id: "tcp-07", correct: "SYN", explanation: "Different key now." }),
    /already committed/
  );
});

test("gradeQuiz rejects an unknown id with a clear error", () => {
  const stateDir = makeTempStateDir();
  assert.throws(() => gradeQuiz({ stateDir, id: "does-not-exist", answer: "anything" }), /unknown quiz id: does-not-exist/);
});

test("gradeQuiz still grades a valid id when quiz-key.jsonl contains a malformed line", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "ok-01", correct: "ACK", explanation: "Acknowledges receipt." });
  fs.appendFileSync(path.join(stateDir, "quiz-key.jsonl"), "{this is not valid json\n", "utf8");

  const graded = gradeQuiz({ stateDir, id: "ok-01", answer: "ACK" });
  assert.equal(graded.result, "✓");
});

test("gradeQuiz ignores a partial trailing line in quiz-key.jsonl (e.g. a crash mid-write)", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "ok-02", correct: "SYN", explanation: "Starts the handshake." });
  fs.appendFileSync(path.join(stateDir, "quiz-key.jsonl"), '{"id":"partial","correct":"X"', "utf8");

  const graded = gradeQuiz({ stateDir, id: "ok-02", answer: "SYN" });
  assert.equal(graded.result, "✓");
  assert.throws(() => gradeQuiz({ stateDir, id: "partial", answer: "X" }), /unknown quiz id: partial/);
});

// ---------- runQuizCommit / runQuizGrade (CLI-layer, flag parsing) ----------

test("runQuizCommit output never contains the committed correct label (RNF-05)", async () => {
  const stateDir = makeTempStateDir();
  const output = await runQuizCommit({
    args: ["--id", "tcp-08", "--correct", "SECRET-LABEL", "--explanation", "some explanation text"],
    stateDir,
  });

  assert.match(output, /^committed: tcp-08/);
  assert.doesNotMatch(output, /SECRET-LABEL/);
});

test("runQuizCommit --stdin preserves LaTeX '$x^2$' and a single quote verbatim", async () => {
  const stateDir = makeTempStateDir();
  const payload = JSON.stringify({
    id: "math-01",
    correct: "$x^2$",
    explanation: "It's the square function.",
  });

  const output = await runQuizCommit({ args: ["--stdin"], stateDir, stdin: stdinFrom(payload) });
  assert.match(output, /^committed: math-01/);

  const graded = gradeQuiz({ stateDir, id: "math-01", answer: "$x^2$" });
  assert.equal(graded.result, "✓");
  assert.equal(graded.correct, "$x^2$");
  assert.equal(graded.explanation, "It's the square function.");
});

test("runQuizCommit throws a usage error when a required flag is missing", async () => {
  const stateDir = makeTempStateDir();
  await assert.rejects(
    () => runQuizCommit({ args: ["--id", "tcp-09", "--correct", "ACK"], stateDir }),
    /requires --id, --correct and --explanation/
  );
});

test("runQuizGrade formats result/correct/explanation on three lines", () => {
  const stateDir = makeTempStateDir();
  commitQuiz({ stateDir, id: "tcp-10", correct: "ACK", explanation: "Acknowledges receipt." });

  const output = runQuizGrade({ args: ["--id", "tcp-10", "--answer", "ACK"], stateDir });
  assert.equal(output, "result: ✓\ncorrect: ACK\nexplanation: Acknowledges receipt.\n");
});

// ---------- CLI-level (spawned process) ----------

test("CLI: unknown subcommand prints usage on stderr and exits 2", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "bogus-subcommand"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/i);
});

test("CLI: quiz-commit then quiz-grade round trip via AI_TUTOR_ROOT override", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const commit = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "quiz-commit", "--id", "cli-01", "--correct", "Right Answer", "--explanation", "Because reasons."],
    { encoding: "utf8", env }
  );
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stdout, /^committed: cli-01/);
  assert.doesNotMatch(commit.stdout, /Right Answer/);

  const grade = spawnSync(process.execPath, [SCRIPT_PATH, "quiz-grade", "--id", "cli-01", "--answer", "Right Answer"], {
    encoding: "utf8",
    env,
  });
  assert.equal(grade.status, 0, grade.stderr);
  assert.equal(grade.stdout, "result: ✓\ncorrect: Right Answer\nexplanation: Because reasons.\n");

  const keyFile = fs.readFileSync(path.join(tmpRoot, ".learn", "quiz-key.jsonl"), "utf8");
  assert.match(keyFile, /"id":"cli-01"/);
});

test("CLI: quiz-grade on unknown id exits 1 with a clear error", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "quiz-grade", "--id", "nope", "--answer", "x"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown quiz id: nope/);
});

// ============================================================================
// T4.1 — link / unlink / render
// ============================================================================

// ---------- normalizeNotePath ----------

test("normalizeNotePath appends .md when missing", () => {
  const root = makeTempRoot();
  assert.equal(normalizeNotePath(root, "notas/tcp"), "notas/tcp.md");
});

test("normalizeNotePath keeps .md when already present", () => {
  const root = makeTempRoot();
  assert.equal(normalizeNotePath(root, "notas/tcp.md"), "notas/tcp.md");
});

test("normalizeNotePath normalizes backslashes to forward slashes", () => {
  const root = makeTempRoot();
  assert.equal(normalizeNotePath(root, "notas\\tcp.md"), "notas/tcp.md");
});

test("normalizeNotePath rejects a path that resolves outside the project root", () => {
  const root = makeTempRoot();
  assert.throws(() => normalizeNotePath(root, "../outside.md"), /outside the project root/);
});

test("normalizeNotePath rejects an absolute path outside the project root", () => {
  const root = makeTempRoot();
  const outside = path.join(os.tmpdir(), "definitely-not-the-project", "note.md");
  assert.throws(() => normalizeNotePath(root, outside), /outside the project root/);
});

// ---------- link / unlink (state.json) ----------

test("link sets pending in state.json to the normalized path", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const normalized = link({ root, stateDir, inputPath: "notas/tcp" });
  assert.equal(normalized, "notas/tcp.md");

  const state = readState(stateDir);
  assert.equal(state.pending.path, "notas/tcp.md");
  assert.ok(state.pending.at);
});

test("runLink prints 'linked (pending): <path>'", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const output = runLink({ args: ["notas/tcp"], root, stateDir });
  assert.equal(output, "linked (pending): notas/tcp.md\n");
});

test("runUnlink sets pending to UNLINK and prints 'unlink requested'", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const output = runUnlink({ stateDir });
  assert.equal(output, "unlink requested\n");

  const state = readState(stateDir);
  assert.equal(state.pending.path, "UNLINK");
  assert.ok(state.pending.at);
});

// ---------- link / unlink with explicit --session (race fix, ADR-08) ----------

test("link with a real session id writes directly to links[session] and does not touch pending", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const normalized = link({ root, stateDir, inputPath: "notas/tcp", session: "sess-real-123" });
  assert.equal(normalized, "notas/tcp.md");

  const state = readState(stateDir);
  assert.equal(state.links["sess-real-123"], "notas/tcp.md");
  assert.equal(state.pending, null);
});

test("link with an unexpanded placeholder session id ($ARGUMENTS-style) falls back to pending", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", session: "${CLAUDE_SESSION_ID}" });

  const state = readState(stateDir);
  assert.equal(state.pending.path, "notas/tcp.md");
  assert.ok(state.pending.at);
  assert.deepEqual(state.links, {});
});

test("link with an empty session id falls back to pending", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", session: "" });

  const state = readState(stateDir);
  assert.equal(state.pending.path, "notas/tcp.md");
});

test("two links with explicit real session ids before any render do not cross (no shared pending race)", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", session: "sess-A" });
  link({ root, stateDir, inputPath: "notas/derivadas", session: "sess-B" });

  const state = readState(stateDir);
  assert.equal(state.links["sess-A"], "notas/tcp.md");
  assert.equal(state.links["sess-B"], "notas/derivadas.md");
  assert.equal(state.pending, null);
});

test("runLink prints a session-scoped message when a real session id is given", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const output = runLink({ args: ["notas/tcp", "--session", "sess-real-123"], root, stateDir });
  assert.equal(output, "linked: notas/tcp.md (session sess-real-123)\n");

  const state = readState(stateDir);
  assert.equal(state.links["sess-real-123"], "notas/tcp.md");
});

test("runLink falls back to the pending message when --session is a placeholder", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  const output = runLink({ args: ["notas/tcp", "--session", "${CLAUDE_SESSION_ID}"], root, stateDir });
  assert.equal(output, "linked (pending): notas/tcp.md\n");
});

test("runUnlink with a real session id deletes links[session] directly and does not touch pending", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", session: "sess-real-123" });
  const output = runUnlink({ args: ["--session", "sess-real-123"], stateDir });
  assert.equal(output, "unlinked: session sess-real-123\n");

  const state = readState(stateDir);
  assert.equal(state.links["sess-real-123"], undefined);
  assert.equal(state.pending, null);
});

test("runRender ignores a pending link older than 10 minutes", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", now: () => new Date("2026-01-01T00:00:00Z") });

  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-stale", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:15:00Z"), // 15 minutes later — stale
  });

  const state = readState(stateDir);
  assert.equal(state.links["sess-stale"], undefined);
  assert.equal(fs.existsSync(path.join(root, "notas")), false);
});

test("runRender still applies a pending link within the 10-minute window", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp", now: () => new Date("2026-01-01T00:00:00Z") });

  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-fresh", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:09:59Z"), // just under 10 minutes later
  });

  const state = readState(stateDir);
  assert.equal(state.links["sess-fresh"], "notas/tcp.md");
});

test("runRender still applies an old plain-string pending (backward compatibility)", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  writeState(stateDir, { pending: "notas/tcp.md", links: {} });

  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-legacy", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  const state = readState(stateDir);
  assert.equal(state.links["sess-legacy"], "notas/tcp.md");
});

// ---------- renderSessionBlock (pure transcript -> markdown block) ----------

test("renderSessionBlock produces the expected block from the S2 fixture transcript", () => {
  const lines = readJsonlLines(TRANSCRIPT_FIXTURE);
  const block = renderSessionBlock({ sessionId: "sess-fixture-1", lines, now: () => new Date("2026-01-01T00:00:00Z") });

  assert.match(block, /^<!-- md-log:session sess-fixture-1 start -->/);
  assert.match(block, /<!-- md-log:session sess-fixture-1 end -->$/);
  assert.match(block, /## Sesión 2026-09-25/);
  assert.match(block, /\*\*Diego:\*\* Enseñame cómo funciona TCP/);
  assert.match(
    block,
    /\*\*Opciones:\*\* Número de secuencia · Suma de verificación · Puerto de origen · No sé/
  );
  assert.match(block, /\*\*Respuesta:\*\* Número de secuencia/);
  // consecutive assistant text blocks after the quiz feedback are merged with a blank line
  assert.match(
    block,
    /¡Correcto! El número de secuencia asegura el orden de los bytes en el flujo\.\n\nCon eso ya tenemos el primer nodo/
  );
});

test("renderSessionBlock excludes thinking, tool calls, tool results, skill expansions and slash commands", () => {
  const lines = readJsonlLines(TRANSCRIPT_FIXTURE);
  const block = renderSessionBlock({ sessionId: "sess-fixture-1", lines, now: () => new Date() });

  assert.doesNotMatch(block, /Voy a planear la sesión/); // thinking
  assert.doesNotMatch(block, /Bash/);
  assert.doesNotMatch(block, /cuerpo expandido de la skill/); // isMeta
  assert.doesNotMatch(block, /<command-name>/);
  assert.doesNotMatch(block, /committed: tcp-01/); // tool_result
});

test("RNF-05: rendered note never leaks the committed correct label, and never contains the commit command", () => {
  const lines = readJsonlLines(TRANSCRIPT_FIXTURE);
  const block = renderSessionBlock({ sessionId: "sess-fixture-1", lines, now: () => new Date() });

  assert.doesNotMatch(block, /SECRET-CORRECT-LABEL/);
  assert.doesNotMatch(block, /quiz-commit/);

  const respuestaIndex = block.indexOf("**Respuesta:**");
  assert.ok(respuestaIndex > -1);
  const before = block.slice(0, respuestaIndex);
  assert.doesNotMatch(before, /SECRET-CORRECT-LABEL/);
});

test("renderSessionBlock joins a multiSelect array answer with ', '", () => {
  const lines = [
    {
      type: "assistant",
      isSidechain: false,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_multi",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "¿Qué temas repasamos hoy?",
                  options: [{ label: "TCP" }, { label: "UDP" }, { label: "DNS" }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_multi", content: "..." }] },
      toolUseResult: { answers: { "¿Qué temas repasamos hoy?": ["TCP", "DNS"] } },
    },
  ];

  const block = renderSessionBlock({ sessionId: "s1", lines, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.match(block, /\*\*Respuesta:\*\* TCP, DNS/);
});

test("renderSessionBlock leaves a comma-containing string answer unchanged", () => {
  const lines = [
    {
      type: "assistant",
      isSidechain: false,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_str",
            name: "AskUserQuestion",
            input: {
              questions: [{ question: "¿Cuál es tu respuesta?", options: [{ label: "A" }, { label: "B" }] }],
            },
          },
        ],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_str", content: "..." }] },
      toolUseResult: { answers: { "¿Cuál es tu respuesta?": "A, B and something else" } },
    },
  ];

  const block = renderSessionBlock({ sessionId: "s1", lines, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.match(block, /\*\*Respuesta:\*\* A, B and something else/);
});

// ---------- upsertSessionBlock (marker replace/append, preserving outside content) ----------

test("upsertSessionBlock appends the block to an empty file", () => {
  const block = "<!-- md-log:session s1 start -->\nhello\n<!-- md-log:session s1 end -->";
  const result = upsertSessionBlock({ existingContent: "", sessionId: "s1", block });
  assert.equal(result, `${block}\n`);
});

test("upsertSessionBlock replaces an existing block for the same session, preserving surrounding text", () => {
  const oldBlock = "<!-- md-log:session s1 start -->\nold content\n<!-- md-log:session s1 end -->";
  const newBlock = "<!-- md-log:session s1 start -->\nnew content\n<!-- md-log:session s1 end -->";
  const existing = `# My note\n\nmanual text before\n\n${oldBlock}\n\nmanual text after\n`;

  const result = upsertSessionBlock({ existingContent: existing, sessionId: "s1", block: newBlock });

  assert.match(result, /# My note/);
  assert.match(result, /manual text before/);
  assert.match(result, /manual text after/);
  assert.match(result, /new content/);
  assert.doesNotMatch(result, /old content/);
});

test("upsertSessionBlock appends a second session's block without touching the first", () => {
  const blockA = "<!-- md-log:session sess-A start -->\nA content\n<!-- md-log:session sess-A end -->";
  const blockB = "<!-- md-log:session sess-B start -->\nB content\n<!-- md-log:session sess-B end -->";
  const existing = `${blockA}\n`;

  const result = upsertSessionBlock({ existingContent: existing, sessionId: "sess-B", block: blockB });

  assert.match(result, /A content/);
  assert.match(result, /B content/);
});

test("upsertSessionBlock removes a duplicate block for the same session, ending with exactly one", () => {
  const oldBlock1 = "<!-- md-log:session s1 start -->\nfirst old\n<!-- md-log:session s1 end -->";
  const oldBlock2 = "<!-- md-log:session s1 start -->\nsecond old (duplicate bug)\n<!-- md-log:session s1 end -->";
  const newBlock = "<!-- md-log:session s1 start -->\nnew content\n<!-- md-log:session s1 end -->";
  const existing = `${oldBlock1}\n\n${oldBlock2}\n`;

  const result = upsertSessionBlock({ existingContent: existing, sessionId: "s1", block: newBlock });

  const occurrences = result.split("<!-- md-log:session s1 start -->").length - 1;
  assert.equal(occurrences, 1);
  assert.match(result, /new content/);
  assert.doesNotMatch(result, /first old/);
  assert.doesNotMatch(result, /second old \(duplicate bug\)/);
});

test("upsertSessionBlock preserves an interleaved different-session block byte-for-byte while deduping", () => {
  const s1Old1 = "<!-- md-log:session s1 start -->\nold 1\n<!-- md-log:session s1 end -->";
  const s2Block = "<!-- md-log:session s2 start -->\nS2 UNTOUCHED\n<!-- md-log:session s2 end -->";
  const s1Old2 = "<!-- md-log:session s1 start -->\nold 2\n<!-- md-log:session s1 end -->";
  const newS1 = "<!-- md-log:session s1 start -->\nnew 1\n<!-- md-log:session s1 end -->";
  const existing = `${s1Old1}\n\n${s2Block}\n\n${s1Old2}\n`;

  const result = upsertSessionBlock({ existingContent: existing, sessionId: "s1", block: newS1 });

  assert.ok(result.includes(s2Block), "s2 block must be preserved byte-for-byte");
  const occurrences = result.split("<!-- md-log:session s1 start -->").length - 1;
  assert.equal(occurrences, 1);
});

test("upsertSessionBlock dedupes and correctly escapes a session id with regex-special characters", () => {
  const sessionId = "a.b*c+d?(e)[f]";
  const start = `<!-- md-log:session ${sessionId} start -->`;
  const end = `<!-- md-log:session ${sessionId} end -->`;
  const old1 = `${start}\nold 1\n${end}`;
  const old2 = `${start}\nold 2\n${end}`;
  const newBlock = `${start}\nnew\n${end}`;
  const existing = `${old1}\n\n${old2}\n`;

  const result = upsertSessionBlock({ existingContent: existing, sessionId, block: newBlock });

  const occurrences = result.split(start).length - 1;
  assert.equal(occurrences, 1);
  assert.match(result, /\nnew\n/);
  assert.doesNotMatch(result, /old 1/);
  assert.doesNotMatch(result, /old 2/);
});

// ---------- runRender (integration: stdin hook JSON -> state.json + note file) ----------

function stdinJson(obj) {
  return stdinFrom(JSON.stringify(obj));
}

test("runRender applies pending link, then renders the session block into the note", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  const notePath = path.join(root, "notas", "tcp.md");
  const content = fs.readFileSync(notePath, "utf8");
  assert.match(content, /<!-- md-log:session sess-A start -->/);
  assert.match(content, /\*\*Diego:\*\* Enseñame cómo funciona TCP/);

  const state = readState(stateDir);
  assert.equal(state.pending, null);
  assert.equal(state.links["sess-A"], "notas/tcp.md");
});

test("runRender is idempotent: rendering twice produces an identical file", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  const notePath = path.join(root, "notas", "tcp.md");
  const firstContent = fs.readFileSync(notePath, "utf8");

  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  const secondContent = fs.readFileSync(notePath, "utf8");

  assert.equal(firstContent, secondContent);
});

test("runRender: two sessions linked to the same note produce two blocks; re-rendering one leaves the other untouched", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");
  const notePath = path.join(root, "notas", "tcp.md");

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-B", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  let content = fs.readFileSync(notePath, "utf8");
  assert.match(content, /<!-- md-log:session sess-A start -->/);
  assert.match(content, /<!-- md-log:session sess-B start -->/);

  const sessBBlockBefore = content.slice(content.indexOf("<!-- md-log:session sess-B start -->"));

  // Re-render only sess-A (no new link call needed — it is already stored).
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  content = fs.readFileSync(notePath, "utf8");
  const sessBBlockAfter = content.slice(content.indexOf("<!-- md-log:session sess-B start -->"));
  assert.equal(sessBBlockBefore, sessBBlockAfter);
});

test("runRender preserves manual content outside the session markers byte-for-byte", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");
  const notePath = path.join(root, "notas", "tcp.md");

  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, "---\ntags: [tcp]\n---\n\n# TCP\n\nNotas manuales de Diego.\n", "utf8");

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-A", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  const content = fs.readFileSync(notePath, "utf8");
  assert.match(content, /tags: \[tcp\]/);
  assert.match(content, /Notas manuales de Diego\./);
  assert.match(content, /<!-- md-log:session sess-A start -->/);
});

test("runRender: unlink stops writing, and the previous block stays intact", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");
  const notePath = path.join(root, "notas", "tcp.md");

  link({ root, stateDir, inputPath: "notas/tcp" });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-C", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  const contentAfterLink = fs.readFileSync(notePath, "utf8");

  runUnlink({ stateDir });
  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-C", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  const contentAfterUnlink = fs.readFileSync(notePath, "utf8");

  assert.equal(contentAfterLink, contentAfterUnlink);

  const state = readState(stateDir);
  assert.equal(state.links["sess-C"], undefined);
});

test("runRender exits without creating a note file when the session has no link", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  await runRender({
    stateDir,
    root,
    stdin: stdinJson({ session_id: "sess-no-link", transcript_path: TRANSCRIPT_FIXTURE }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  assert.equal(fs.existsSync(path.join(root, "notas")), false);
});

test("runRender never throws on broken stdin JSON", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");

  await assert.doesNotReject(() =>
    runRender({ stateDir, root, stdin: stdinFrom("{not valid json"), now: () => new Date() })
  );
});

test("readState returns defaults without throwing when state.json is corrupt (pinning existing tolerant behavior)", () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "state.json"), "{this is not valid json", "utf8");

  assert.doesNotThrow(() => readState(stateDir));
  const state = readState(stateDir);
  assert.deepEqual(state, { pending: null, links: {} });
});

test("renderSessionBlock renders only the text block when user content mixes an image and a text block (pinning existing tolerant behavior)", () => {
  const lines = [
    {
      type: "user",
      isSidechain: false,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAAAAAA" } },
          { type: "text", text: "Mira este diagrama que dibujé" },
        ],
      },
    },
  ];

  const block = renderSessionBlock({ sessionId: "s1", lines, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.match(block, /\*\*Diego:\*\* Mira este diagrama que dibujé/);
  assert.doesNotMatch(block, /base64/);
  assert.doesNotMatch(block, /image\/png/);
});

test("runRender never crashes when the note target path is unwritable (e.g. a directory), and logs the error", async () => {
  const root = makeTempRoot();
  const stateDir = path.join(root, ".learn");
  const notePath = path.join(root, "notas", "tcp.md");

  // Make the target path a directory so writing the note fails.
  fs.mkdirSync(notePath, { recursive: true });

  link({ root, stateDir, inputPath: "notas/tcp" });
  await assert.doesNotReject(() =>
    runRender({
      stateDir,
      root,
      stdin: stdinJson({ session_id: "sess-fail", transcript_path: TRANSCRIPT_FIXTURE }),
      now: () => new Date("2026-01-01T00:00:00Z"),
    })
  );

  const errorLog = fs.readFileSync(path.join(stateDir, "md-log-error.log"), "utf8");
  assert.match(errorLog, /render:/);
});

test("writeFileAtomic removes the temp file and rethrows when the rename fails (injected rename function)", () => {
  const root = makeTempRoot();
  const filePath = path.join(root, "notas", "tcp.md");
  const failingRename = () => {
    throw new Error("simulated rename failure");
  };

  assert.throws(
    () => writeFileAtomic(filePath, "content", { renameFn: failingRename }),
    /simulated rename failure/
  );

  const dirEntries = fs.readdirSync(path.join(root, "notas"));
  assert.deepEqual(dirEntries, [], "no leftover .tmp file after a failed rename");
});

// ---------- CLI-level (spawned process) ----------

test("CLI: link on a path traversal attempt exits 1", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "link", "../outside.md"], { encoding: "utf8", env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the project root/);
});

test("CLI: render with malformed stdin JSON exits 0 and logs the error", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "render"], {
    encoding: "utf8",
    env,
    input: "{this is not json",
  });
  assert.equal(result.status, 0);

  const errorLog = fs.readFileSync(path.join(tmpRoot, ".learn", "md-log-error.log"), "utf8");
  assert.match(errorLog, /render:/);
});

test("CLI: link then render round trip via AI_TUTOR_ROOT writes the note file", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const linkResult = spawnSync(process.execPath, [SCRIPT_PATH, "link", "notas/cli-note"], { encoding: "utf8", env });
  assert.equal(linkResult.status, 0, linkResult.stderr);
  assert.equal(linkResult.stdout, "linked (pending): notas/cli-note.md\n");

  const renderResult = spawnSync(process.execPath, [SCRIPT_PATH, "render"], {
    encoding: "utf8",
    env,
    input: JSON.stringify({ session_id: "cli-sess", transcript_path: TRANSCRIPT_FIXTURE }),
  });
  assert.equal(renderResult.status, 0, renderResult.stderr);

  const noteContent = fs.readFileSync(path.join(tmpRoot, "notas", "cli-note.md"), "utf8");
  assert.match(noteContent, /<!-- md-log:session cli-sess start -->/);
});

// ============================================================================
// T4.3 — notebook (study notebook, RNF-06)
// ============================================================================

test("parseNotebook / summarizeNotebook produce the expected compact summary from the sample cuaderno", () => {
  const content = fs.readFileSync(CUADERNO_FIXTURE, "utf8");
  const summary = summarizeNotebook(content);

  const expected = [
    "Cuaderno de estudio (notas/_cuaderno.md):",
    "- TCP — en curso, última sesión 2026-09-25 — 1/3 nodos — próximo: Números de secuencia — nota: [[tcp]]",
    "- Derivadas — en curso, última sesión 2026-09-20 — 1/3 nodos — próximo: Regla del producto — nota: [[derivadas]]",
    "Completados: Límites.",
    "Si Diego no pide algo concreto, ofrécele retomar el tema en curso.",
    "",
  ].join("\n");

  assert.equal(summary, expected);
});

test("summarizeNotebook falls back to the first unchecked item when there is no ← próximo marker", () => {
  const content = fs.readFileSync(CUADERNO_FIXTURE, "utf8");
  const summary = summarizeNotebook(content);
  assert.match(summary, /Derivadas.*próximo: Regla del producto/);
});

test("summarizeNotebook returns the empty message for an empty notebook", () => {
  assert.equal(summarizeNotebook(""), "Cuaderno de estudio: vacío (todavía no hay temas).\n");
});

test("summarizeNotebook is tolerant of odd/malformed content and never throws", () => {
  assert.doesNotThrow(() => summarizeNotebook("garbage\n### not a topic heading\n- [x] orphan item"));
  assert.equal(
    summarizeNotebook("garbage\n### not a topic heading\n- [x] orphan item"),
    "Cuaderno de estudio: vacío (todavía no hay temas).\n"
  );
});

test("runNotebook prints the empty message when notas/_cuaderno.md is missing", () => {
  const root = makeTempRoot();
  const output = runNotebook({ root });
  assert.equal(output, "Cuaderno de estudio: vacío (todavía no hay temas).\n");
});

test("runNotebook reads notas/_cuaderno.md from the project root", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "notas"), { recursive: true });
  fs.copyFileSync(CUADERNO_FIXTURE, path.join(root, "notas", "_cuaderno.md"));

  const output = runNotebook({ root });
  assert.match(output, /^Cuaderno de estudio \(notas\/_cuaderno\.md\):/);
  assert.match(output, /TCP/);
});

test("CLI: notebook subcommand prints the summary and exits 0", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-cli-"));
  fs.mkdirSync(path.join(tmpRoot, "notas"), { recursive: true });
  fs.copyFileSync(CUADERNO_FIXTURE, path.join(tmpRoot, "notas", "_cuaderno.md"));
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "notebook"], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cuaderno de estudio \(notas\/_cuaderno\.md\):/);
  assert.match(result.stdout, /TCP/);
});
