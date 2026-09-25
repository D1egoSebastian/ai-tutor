// Tests for render.mjs (T6.1 — mermaid|svg -> PNG renderer).
// Run with: node --test .claude/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  UsageError,
  RenderError,
  slugify,
  timestampSuffix,
  buildSavedFilename,
  EDGE_CANDIDATES,
  chromeCandidates,
  resolveBrowserCandidates,
  isBrowserLaunchFailure,
  renderMermaidFile,
  parseArgs,
  shortErrorMessage,
  renderSvgBuffer,
  publishRender,
} from "./render.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIR, "render.mjs");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TINY_VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';

const VALID_MERMAID = "graph TD; A-->B";
const INVALID_MERMAID = "graph TD\n  A -->\n  ][not valid mermaid syntax][";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-tutor-render-root-"));
}

function writeFixture(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ---------- slugify ----------

test("slugify lowercases, replaces non-alphanumerics with dashes, trims edges", () => {
  assert.equal(slugify("TCP Reliable Stream!"), "tcp-reliable-stream");
  assert.equal(slugify("  --Already-Kebab--  "), "already-kebab");
  assert.equal(slugify("a___b   c"), "a-b-c");
  assert.equal(slugify(""), "");
});

// ---------- timestampSuffix ----------

test("timestampSuffix formats YYYYMMDD-HHmmss in UTC, deterministic across timezones", () => {
  const date = new Date(Date.UTC(2026, 8, 25, 14, 5, 9)); // 2026-09-25T14:05:09Z
  assert.equal(timestampSuffix(date), "20260925-140509");
});

// ---------- buildSavedFilename ----------

test("buildSavedFilename composes viz-<slug>-<timestamp>.png", () => {
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(buildSavedFilename({ slug: "TCP Flow", date }), "viz-tcp-flow-20260102-030405.png");
});

test("buildSavedFilename falls back to 'viz' when the slug collapses to nothing", () => {
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(buildSavedFilename({ slug: "!!!", date }), "viz-viz-20260102-030405.png");
});

// ---------- parseArgs ----------

test("parseArgs accepts mermaid mode without --save", () => {
  assert.deepEqual(parseArgs(["mermaid", "in.mmd"]), { mode: "mermaid", inputPath: "in.mmd", save: null });
});

test("parseArgs accepts svg mode with --save <slug>", () => {
  assert.deepEqual(parseArgs(["svg", "in.svg", "--save", "my-slug"]), {
    mode: "svg",
    inputPath: "in.svg",
    save: "my-slug",
  });
});

test("parseArgs throws UsageError on a missing mode", () => {
  assert.throws(() => parseArgs([]), UsageError);
});

test("parseArgs throws UsageError on an unknown mode", () => {
  assert.throws(() => parseArgs(["png", "in.png"]), UsageError);
});

test("parseArgs throws UsageError on a missing input path", () => {
  assert.throws(() => parseArgs(["mermaid"]), UsageError);
});

test("parseArgs throws UsageError when --save has no value", () => {
  assert.throws(() => parseArgs(["svg", "in.svg", "--save"]), UsageError);
});

test("parseArgs throws UsageError on an unrecognized extra argument", () => {
  assert.throws(() => parseArgs(["svg", "in.svg", "--bogus"]), UsageError);
});

// ---------- resolveBrowserCandidates ----------
//
// Chrome is ordered before Edge (design.md ADR-10): the (x86) Edge stub launcher installed on
// this machine is detected fine but does not actually launch under Puppeteer (the process exits
// 0 without ever opening the DevTools port), while Chrome launches reliably. Putting Chrome first
// means auto-discovery works out of the box here without needing PUPPETEER_EXECUTABLE_PATH.

test("resolveBrowserCandidates puts PUPPETEER_EXECUTABLE_PATH first, regardless of what exists on disk", () => {
  const env = { PUPPETEER_EXECUTABLE_PATH: "D:\\custom\\browser.exe", LOCALAPPDATA: "C:\\Users\\diego\\AppData\\Local" };
  const chromeProgramFiles = chromeCandidates(env)[0];
  const candidates = resolveBrowserCandidates({ env, exists: (p) => p === chromeProgramFiles });
  assert.deepEqual(candidates, ["D:\\custom\\browser.exe", chromeProgramFiles]);
});

test("resolveBrowserCandidates lists every existing Chrome candidate before every existing Edge candidate", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\diego\\AppData\\Local" };
  const [chromeProgramFiles, chromeLocalAppData] = chromeCandidates(env);
  const candidates = resolveBrowserCandidates({
    env,
    exists: (p) => p === chromeProgramFiles || p === chromeLocalAppData || p === EDGE_CANDIDATES[0],
  });
  assert.deepEqual(candidates, [chromeProgramFiles, chromeLocalAppData, EDGE_CANDIDATES[0]]);
});

test("resolveBrowserCandidates skips missing candidates without breaking the order", () => {
  const env = {};
  const candidates = resolveBrowserCandidates({ env, exists: (p) => p === EDGE_CANDIDATES[1] });
  assert.deepEqual(candidates, [EDGE_CANDIDATES[1]]);
});

test("resolveBrowserCandidates returns an empty list when nothing exists and there is no env override", () => {
  assert.deepEqual(resolveBrowserCandidates({ env: {}, exists: () => false }), []);
});

// ---------- isBrowserLaunchFailure ----------

test("isBrowserLaunchFailure recognizes Puppeteer's launch-failure signature", () => {
  const err = new Error(
    "Failed to launch the browser process:  Code: 0\n\nstderr:\n\nTROUBLESHOOTING: https://pptr.dev/troubleshooting"
  );
  assert.ok(isBrowserLaunchFailure(err));
});

test("isBrowserLaunchFailure returns false for a real Mermaid syntax error", () => {
  const err = new Error("Parse error on line 3:\ngraph TD\n    ^\nExpecting 'SEMI', got 'PS'");
  assert.ok(!isBrowserLaunchFailure(err));
});

// ---------- renderMermaidFile retry-across-candidates (injected renderOnce) ----------

test("renderMermaidFile throws a clear RenderError when the candidate list is empty", async () => {
  await assert.rejects(
    () => renderMermaidFile({ inputPath: "in.mmd", outputPath: "out.png", candidates: [] }),
    (err) => {
      assert.ok(err instanceof RenderError);
      assert.match(err.message, /Edge/);
      assert.match(err.message, /Chrome/);
      assert.match(err.message, /PUPPETEER_EXECUTABLE_PATH/);
      return true;
    }
  );
});

test("renderMermaidFile moves to the next candidate on a browser-launch failure", async () => {
  const calls = [];
  const renderOnce = async ({ executablePath }) => {
    calls.push(executablePath);
    if (executablePath === "candidate-1") {
      throw new Error("Failed to launch the browser process:  Code: 0");
    }
  };
  const outputPath = await renderMermaidFile({
    inputPath: "in.mmd",
    outputPath: "out.png",
    candidates: ["candidate-1", "candidate-2"],
    renderOnce,
  });
  assert.equal(outputPath, "out.png");
  assert.deepEqual(calls, ["candidate-1", "candidate-2"]);
});

test("renderMermaidFile does NOT retry the next candidate on a real Mermaid syntax error", async () => {
  const calls = [];
  const renderOnce = async ({ executablePath }) => {
    calls.push(executablePath);
    throw new Error("Parse error on line 3:\ngraph TD\n    ^\nExpecting 'SEMI', got 'PS'");
  };
  await assert.rejects(
    () =>
      renderMermaidFile({
        inputPath: "in.mmd",
        outputPath: "out.png",
        candidates: ["candidate-1", "candidate-2"],
        renderOnce,
      }),
    (err) => {
      assert.ok(err instanceof RenderError);
      assert.match(err.message, /Parse error on line 3/);
      return true;
    }
  );
  assert.deepEqual(calls, ["candidate-1"]);
});

test("renderMermaidFile reports every tried candidate when all of them fail to launch", async () => {
  const renderOnce = async () => {
    throw new Error("Failed to launch the browser process:  Code: 0");
  };
  await assert.rejects(
    () =>
      renderMermaidFile({
        inputPath: "in.mmd",
        outputPath: "out.png",
        candidates: ["candidate-1", "candidate-2"],
        renderOnce,
      }),
    (err) => {
      assert.ok(err instanceof RenderError);
      assert.match(err.message, /candidate-1/);
      assert.match(err.message, /candidate-2/);
      assert.match(err.message, /PUPPETEER_EXECUTABLE_PATH/);
      return true;
    }
  );
});

// ---------- shortErrorMessage ----------

test("shortErrorMessage drops stack-frame lines and caps the output", () => {
  const err = new Error(
    [
      "Parse error on line 3:",
      "graph TD",
      "    ^",
      "Expecting 'SEMI', got 'PS'",
      "    at Object.parse (/node_modules/mermaid/dist/mermaid.js:1:1)",
      "    at eval (eval at <anonymous>)",
    ].join("\n")
  );
  const short = shortErrorMessage(err);
  assert.match(short, /Parse error on line 3/);
  assert.doesNotMatch(short, /at Object\.parse/);
  assert.doesNotMatch(short, /at eval/);
});

test("shortErrorMessage accepts a plain string", () => {
  assert.equal(shortErrorMessage("just one line"), "just one line");
});

test("shortErrorMessage caps to maxLines", () => {
  const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const short = shortErrorMessage(long, { maxLines: 3 });
  assert.equal(short.split("\n").length, 3);
});

// ---------- renderSvgBuffer (real render) ----------

test("renderSvgBuffer renders a tiny valid SVG to a PNG buffer", () => {
  const png = renderSvgBuffer({ svgSource: TINY_VALID_SVG });
  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
});

test("renderSvgBuffer throws a readable RenderError on invalid SVG", () => {
  assert.throws(
    () => renderSvgBuffer({ svgSource: "this is not an svg document at all" }),
    (err) => {
      assert.ok(err instanceof RenderError);
      assert.ok(err.message.length > 0);
      assert.ok(err.message.split("\n").length <= 10, "error message should stay short/readable");
      return true;
    }
  );
});

// ---------- publishRender ----------

test("publishRender without --save returns the preview path unchanged", () => {
  const root = makeTempRoot();
  const previewPath = writeFixture(root, ".learn/preview.png", "fake-png-bytes");
  const result = publishRender({ root, previewPath, save: null });
  assert.equal(result.kind, "preview");
  assert.equal(result.path, previewPath);
});

test("publishRender with --save copies the preview into viz/ with a timestamped filename", () => {
  const root = makeTempRoot();
  const previewPath = writeFixture(root, ".learn/preview.png", "fake-png-bytes");
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  const result = publishRender({ root, previewPath, save: "TCP Flow", now: () => date });
  assert.equal(result.kind, "saved");
  assert.equal(result.filename, "viz-tcp-flow-20260102-030405.png");
  assert.equal(fs.readFileSync(result.path, "utf8"), "fake-png-bytes");
  assert.ok(result.path.startsWith(path.join(root, "viz")));
});

// ---------- CLI-level (spawned process) ----------

test("CLI: missing arguments exit 2 with a usage message", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/i);
});

test("CLI: svg mode without --save writes .learn/preview.png and prints its path", () => {
  const tmpRoot = makeTempRoot();
  const svgPath = writeFixture(tmpRoot, "src/sample.svg", TINY_VALID_SVG);
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "svg", svgPath], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^preview: /);

  const previewPath = path.join(tmpRoot, ".learn", "preview.png");
  assert.ok(fs.existsSync(previewPath));
  const bytes = fs.readFileSync(previewPath);
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE));
});

test("CLI: svg mode with --save <slug> publishes into viz/ and prints filename + path", () => {
  const tmpRoot = makeTempRoot();
  const svgPath = writeFixture(tmpRoot, "src/sample.svg", TINY_VALID_SVG);
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "svg", svgPath, "--save", "cli-test-slug"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^filename: viz-cli-test-slug-\d{8}-\d{6}\.png\n/);
  assert.match(result.stdout, /\npath: .+viz-cli-test-slug-\d{8}-\d{6}\.png\n?$/);

  const vizDir = path.join(tmpRoot, "viz");
  const files = fs.readdirSync(vizDir).filter((f) => f.startsWith("viz-cli-test-slug-"));
  assert.equal(files.length, 1);
});

test("CLI: invalid SVG exits 1 with a short readable error, no stack trace dump", () => {
  const tmpRoot = makeTempRoot();
  const svgPath = writeFixture(tmpRoot, "src/broken.svg", "not an svg document");
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "svg", svgPath], { encoding: "utf8", env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^error: /);
  assert.ok(result.stderr.split("\n").length <= 10);
});

test("CLI: missing input file exits 1 with a clear error", () => {
  const tmpRoot = makeTempRoot();
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "svg", path.join(tmpRoot, "nope.svg")], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not found/i);
});

// ---------- Mermaid (real render, skipped only when NO candidate browser exists at all) ----------
//
// render.mjs now tries every resolved candidate in order and moves on when one fails to *launch*
// (see renderMermaidFile above), so as long as Chrome or Edge is installed anywhere in the
// resolution order, these run for real — no PUPPETEER_EXECUTABLE_PATH override needed.

function hasAnyCandidateBrowser() {
  return resolveBrowserCandidates().length > 0;
}

test("CLI: mermaid mode renders a real diagram and publishes it (integration)", (t) => {
  if (!hasAnyCandidateBrowser()) {
    t.skip("no Chrome/Edge found on this machine and PUPPETEER_EXECUTABLE_PATH is not set");
    return;
  }

  const tmpRoot = makeTempRoot();
  const mmdPath = writeFixture(tmpRoot, "src/sample.mmd", VALID_MERMAID);
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };
  delete env.PUPPETEER_EXECUTABLE_PATH; // exercise real auto-discovery, no override

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "mermaid", mmdPath, "--save", "quick-test"], {
    encoding: "utf8",
    env,
    timeout: 60_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^filename: viz-quick-test-\d{8}-\d{6}\.png\n/);

  const vizDir = path.join(tmpRoot, "viz");
  const files = fs.readdirSync(vizDir).filter((f) => f.startsWith("viz-quick-test-"));
  assert.equal(files.length, 1);
  const bytes = fs.readFileSync(path.join(vizDir, files[0]));
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE));
});

test("CLI: mermaid mode with invalid syntax exits 1 with a short readable error (integration)", (t) => {
  if (!hasAnyCandidateBrowser()) {
    t.skip("no Chrome/Edge found on this machine and PUPPETEER_EXECUTABLE_PATH is not set");
    return;
  }

  const tmpRoot = makeTempRoot();
  const mmdPath = writeFixture(tmpRoot, "src/broken.mmd", INVALID_MERMAID);
  const env = { ...process.env, AI_TUTOR_ROOT: tmpRoot };
  delete env.PUPPETEER_EXECUTABLE_PATH;

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "mermaid", mmdPath], {
    encoding: "utf8",
    env,
    timeout: 60_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^error: /);
  assert.ok(result.stderr.split("\n").length <= 10, "mermaid syntax error should be short, not a stack dump");
});
