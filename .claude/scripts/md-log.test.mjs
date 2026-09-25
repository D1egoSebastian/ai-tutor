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

import { commitQuiz, gradeQuiz, normalizeAnswer, runQuizCommit, runQuizGrade } from "./md-log.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIR, "md-log.mjs");

function makeTempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-md-log-"));
  return path.join(dir, ".learn");
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
