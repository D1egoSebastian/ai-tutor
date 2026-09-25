#!/usr/bin/env node
// render.mjs — Mermaid/SVG -> PNG renderer for the visualize makers (T6.1, design.md 4.7).
//
//   node .claude/scripts/render.mjs mermaid <in.mmd> [--save <slug>]
//   node .claude/scripts/render.mjs svg <in.svg> [--save <slug>]
//
// Node >= 20, ESM. Runtime deps: @mermaid-js/mermaid-cli, @resvg/resvg-js.
// Same "pure function + thin CLI wrapper" shape as md-log.mjs, so each piece
// (slug, timestamp, browser resolution, arg parsing, error formatting) stays
// independently unit-testable without touching a real browser or disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as renderMermaidCli } from "@mermaid-js/mermaid-cli";
import { Resvg } from "@resvg/resvg-js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Bad CLI usage (missing/unknown args). Exit code 2. */
export class UsageError extends Error {}

/** A render failure: invalid diagram source, missing input, or no usable browser. Exit code 1. */
export class RenderError extends Error {}

// ---------------------------------------------------------------------------
// Project root / output dirs — same convention as md-log.mjs
// ---------------------------------------------------------------------------

/**
 * Resolves the project root from THIS SCRIPT's location, never from cwd:
 *   <root>/.claude/scripts/render.mjs -> <root>
 * AI_TUTOR_ROOT overrides this for tests, same as md-log.mjs.
 */
export function resolveProjectRoot() {
  if (process.env.AI_TUTOR_ROOT) {
    return process.env.AI_TUTOR_ROOT;
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..", "..");
}

/** `<root>/.learn` (preview) and `<root>/viz` (published) output locations. */
export function resolveDirs(root) {
  const learnDir = path.join(root, ".learn");
  const vizDir = path.join(root, "viz");
  return { learnDir, vizDir, previewPath: path.join(learnDir, "preview.png") };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Slug + timestamped filename (--save <slug>)
// ---------------------------------------------------------------------------

/** Lowercase, a-z0-9-, collapses runs of separators, strips leading/trailing dashes. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/** UTC-based `YYYYMMDD-HHmmss`, deterministic regardless of the machine's local timezone. */
export function timestampSuffix(date = new Date()) {
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

/** `viz-<slug>-<timestamp>.png`. Falls back to "viz" if the slug collapses to nothing (e.g. "!!!"). */
export function buildSavedFilename({ slug, date = new Date() }) {
  const clean = slugify(slug) || "viz";
  return `viz-${clean}-${timestampSuffix(date)}.png`;
}

// ---------------------------------------------------------------------------
// Browser resolution (Mermaid rendering needs a Chromium-family browser)
// ---------------------------------------------------------------------------

export const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/** Chrome candidates depend on %LOCALAPPDATA%, so they're built from `env` rather than hardcoded. */
export function chromeCandidates(env) {
  const candidates = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return candidates;
}

const NO_BROWSER_MESSAGE =
  "No browser found to render Mermaid diagrams. Install Microsoft Edge or Google Chrome, " +
  "or set the PUPPETEER_EXECUTABLE_PATH environment variable to point at the executable.";

/**
 * Resolution order: PUPPETEER_EXECUTABLE_PATH -> every existing Chrome candidate -> every
 * existing Edge candidate. Chrome is ordered before Edge (design.md ADR-10): the installed
 * `(x86)` Edge stub launcher is detected fine but does not actually launch under Puppeteer here
 * (the process exits 0 without ever opening the DevTools port), while Chrome launches reliably.
 *
 * Returns an ORDERED LIST, not a single path — `renderMermaidFile` below tries each one in turn
 * and only moves to the next on an actual browser-*launch* failure, so a bad/incompatible
 * installation earlier in the list doesn't block a working one later in the list.
 *
 * Pure aside from the injectable `exists` check, so it's unit-testable without touching disk or
 * depending on what's actually installed on the machine running the tests.
 */
export function resolveBrowserCandidates({ env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [];
  if (env.PUPPETEER_EXECUTABLE_PATH && env.PUPPETEER_EXECUTABLE_PATH.trim().length > 0) {
    candidates.push(env.PUPPETEER_EXECUTABLE_PATH);
  }
  for (const candidate of chromeCandidates(env)) {
    if (exists(candidate)) candidates.push(candidate);
  }
  for (const candidate of EDGE_CANDIDATES) {
    if (exists(candidate)) candidates.push(candidate);
  }
  return candidates;
}

const BROWSER_LAUNCH_FAILURE_PATTERN = /Failed to launch the browser process/;

/**
 * Distinguishes "this candidate's browser process never launched" (safe to retry the next
 * candidate) from a real Mermaid authoring error like a syntax mistake (must NOT be retried —
 * retrying would just repeat the same syntax error against every remaining candidate and hide
 * the actual problem behind a confusing "all candidates failed" message).
 */
export function isBrowserLaunchFailure(err) {
  const message = err instanceof Error ? err.message || String(err) : String(err);
  return BROWSER_LAUNCH_FAILURE_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// Error message formatting — short and readable, no stack trace dump
// ---------------------------------------------------------------------------

/**
 * Reduces an Error (or raw string) to a few readable lines: drops stack-frame
 * lines (`at ...`) and caps the result, so a Mermaid/SVG syntax error prints
 * as a short, readable message instead of a wall of internal stack trace.
 */
export function shortErrorMessage(err, { maxLines = 6 } = {}) {
  const raw = err instanceof Error ? err.message || String(err) : String(err);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^at\s/.test(line));
  return lines.slice(0, maxLines).join("\n") || "Unknown error.";
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const MODES = new Set(["mermaid", "svg"]);

/** Parses `<mermaid|svg> <input-file> [--save <slug>]`. Throws UsageError on any malformed shape. */
export function parseArgs(argv) {
  const [mode, inputPath, ...rest] = argv;
  if (!mode || !MODES.has(mode)) {
    throw new UsageError(`render.mjs requires a mode of "mermaid" or "svg" (got: ${mode ?? "<none>"})`);
  }
  if (!inputPath) {
    throw new UsageError("render.mjs requires an input file path");
  }

  let save = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--save") {
      save = rest[i + 1];
      i++;
      if (!save) throw new UsageError("--save requires a slug argument");
    } else {
      throw new UsageError(`unknown argument: ${rest[i]}`);
    }
  }

  return { mode, inputPath, save };
}

// ---------------------------------------------------------------------------
// SVG -> PNG (via @resvg/resvg-js)
// ---------------------------------------------------------------------------

const DEFAULT_SVG_FIT_WIDTH = 1200;

/** Renders SVG source to a PNG Buffer: white background, fit to `fitWidth`, system fonts loaded so text renders. */
export function renderSvgBuffer({ svgSource, fitWidth = DEFAULT_SVG_FIT_WIDTH } = {}) {
  let resvg;
  try {
    resvg = new Resvg(svgSource, {
      background: "white",
      fitTo: { mode: "width", value: fitWidth },
      font: { loadSystemFonts: true },
    });
  } catch (err) {
    throw new RenderError(`Invalid SVG: ${shortErrorMessage(err)}`);
  }

  let rendered;
  try {
    rendered = resvg.render();
  } catch (err) {
    throw new RenderError(`Invalid SVG: ${shortErrorMessage(err)}`);
  }
  return rendered.asPng();
}

/** Reads `inputPath`, renders it to a PNG, and writes it to `outputPath`. Returns `outputPath`. */
export function renderSvgFile({ inputPath, outputPath, fitWidth }) {
  let svgSource;
  try {
    svgSource = fs.readFileSync(inputPath, "utf8");
  } catch (err) {
    throw new RenderError(`Could not read SVG input "${inputPath}": ${err.message}`);
  }
  const png = renderSvgBuffer({ svgSource, fitWidth });
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, png);
  return outputPath;
}

// ---------------------------------------------------------------------------
// Mermaid -> PNG (via @mermaid-js/mermaid-cli's programmatic `run`)
// ---------------------------------------------------------------------------

const MERMAID_SCALE = 2; // crisp output, ~ "-s 2" on the mmdc CLI

/** Renders a `.mmd` file to a PNG at `outputPath` using ONE specific browser executable. */
export async function renderMermaidOnce({ inputPath, outputPath, executablePath }) {
  ensureDir(path.dirname(outputPath));
  await renderMermaidCli(inputPath, outputPath, {
    puppeteerConfig: {
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    },
    quiet: true,
    outputFormat: "png",
    parseMMDOptions: {
      backgroundColor: "white",
      viewport: { width: 800, height: 600, deviceScaleFactor: MERMAID_SCALE },
      mermaidConfig: {},
    },
  });
  return outputPath;
}

/**
 * Renders a `.mmd` file to a PNG at `outputPath`, trying each of `candidates` in order.
 *
 * - Empty `candidates` (nothing installed, no PUPPETEER_EXECUTABLE_PATH): RenderError right away.
 * - A candidate whose browser process fails to *launch* (see `isBrowserLaunchFailure`) is skipped
 *   in favor of the next one — a broken/incompatible installation earlier in the list must not
 *   block a working one later in the list.
 * - A candidate that launches but hits a real Mermaid authoring error (bad syntax) is surfaced
 *   immediately, WITHOUT retrying — retrying would just repeat the same syntax error against
 *   every remaining candidate and bury the actual problem under "all candidates failed".
 *
 * `renderOnce` is injectable so this retry/skip logic is unit-testable without a real browser.
 */
export async function renderMermaidFile({ inputPath, outputPath, candidates, renderOnce = renderMermaidOnce }) {
  if (!candidates || candidates.length === 0) {
    throw new RenderError(NO_BROWSER_MESSAGE);
  }

  const failedLaunches = [];
  for (const executablePath of candidates) {
    try {
      await renderOnce({ inputPath, outputPath, executablePath });
      return outputPath;
    } catch (err) {
      if (!isBrowserLaunchFailure(err)) {
        throw new RenderError(`Invalid Mermaid diagram: ${shortErrorMessage(err)}`);
      }
      failedLaunches.push(executablePath);
    }
  }

  throw new RenderError(
    [
      "Could not launch any browser to render Mermaid. Tried:",
      ...failedLaunches.map((p) => `  - ${p}`),
      "Set the PUPPETEER_EXECUTABLE_PATH environment variable to a working Chrome/Edge executable.",
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Publish: preview-only, or copy into viz/ with a timestamped filename
// ---------------------------------------------------------------------------

/**
 * Without `save`, the caller already has everything it needs at `previewPath`.
 * With `save`, copies the preview into `<root>/viz/viz-<slug>-<timestamp>.png`.
 */
export function publishRender({ root, previewPath, save, now = () => new Date(), copyFn = fs.copyFileSync }) {
  if (!save) {
    return { kind: "preview", path: previewPath };
  }
  const { vizDir } = resolveDirs(root);
  ensureDir(vizDir);
  const filename = buildSavedFilename({ slug: save, date: now() });
  const dest = path.join(vizDir, filename);
  copyFn(previewPath, dest);
  return { kind: "saved", filename, path: dest };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function printUsage() {
  process.stderr.write(
    [
      "Usage: render.mjs <mermaid|svg> <input-file> [--save <slug>]",
      "",
      "  node .claude/scripts/render.mjs mermaid <in.mmd> [--save <slug>]",
      "  node .claude/scripts/render.mjs svg <in.svg> [--save <slug>]",
      "",
    ].join("\n")
  );
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n`);
      printUsage();
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  const { mode, inputPath, save } = parsed;
  const root = resolveProjectRoot();
  const { learnDir, previewPath } = resolveDirs(root);

  try {
    ensureDir(learnDir);

    if (!fs.existsSync(inputPath)) {
      throw new RenderError(`Input file not found: ${inputPath}`);
    }

    if (mode === "mermaid") {
      const candidates = resolveBrowserCandidates();
      await renderMermaidFile({ inputPath, outputPath: previewPath, candidates });
    } else {
      renderSvgFile({ inputPath, outputPath: previewPath });
    }

    const result = publishRender({ root, previewPath, save });
    if (result.kind === "preview") {
      process.stdout.write(`preview: ${path.resolve(result.path)}\n`);
    } else {
      process.stdout.write(`filename: ${result.filename}\npath: ${path.resolve(result.path)}\n`);
    }
  } catch (err) {
    if (err instanceof RenderError) {
      process.stderr.write(`error: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${shortErrorMessage(err)}\n`);
    }
    process.exitCode = 1;
  }
}

// Guard so importing this module (e.g. from tests) never runs the CLI.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
