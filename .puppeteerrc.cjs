// Puppeteer config (used transitively by @mermaid-js/mermaid-cli).
//
// ADR-10 (design.md section 5): skip Puppeteer's own Chromium download and
// reuse the Edge/Chrome already installed on Windows instead. render.mjs
// resolves the actual executable path  (PUPPETEER_EXECUTABLE_PATH -> Chrome -> Edge,
// retrying the next one on launch failure) and passes it explicitly to mermaid-cli's puppeteerConfig, so this
// file only needs to stop the ~200MB download during `npm install`.
/** @type {import('puppeteer').Configuration} */
module.exports = {
  skipDownload: true,
};
