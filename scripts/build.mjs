// Bundles the npm dependencies into dist/, which the extension loads directly.
// Offline; run after `npm install` or after bumping a dependency.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const shared = { bundle: true, minify: true, legalComments: 'inline', logLevel: 'info', target: 'chrome138' };

await Promise.all([
  // Content script: Chrome can't load ES modules there, so it ships as an IIFE.
  build({ ...shared, entryPoints: ['src/content/consent.js'], outfile: 'dist/consent.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['src/content/spoilers.js'], outfile: 'dist/spoilers.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['src/content/reddit.js'], outfile: 'dist/reddit.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['src/content/slop.js'], outfile: 'dist/slop.js', format: 'iife' }),
  // Service-worker side of autoconsent: the main-world snippets and rule filter.
  build({ ...shared, entryPoints: ['src/background/consent-lib.js'], outfile: 'dist/consent-lib.js', format: 'esm' }),
  // C2PA reading, loaded only by the offscreen document.
  build({ ...shared, entryPoints: ['src/offscreen/c2pa-entry.js'], outfile: 'dist/c2pa.js', format: 'esm' }),
  // The Anthropic SDK, loaded only by the offscreen document.
  build({ ...shared, entryPoints: ['src/offscreen/anthropic-entry.js'], outfile: 'dist/anthropic.js', format: 'esm' }),
  // Public Suffix List lookups, shared by the worker and the unit tests.
  build({ ...shared, entryPoints: ['tldts'], outfile: 'dist/tldts.js', format: 'esm' }),
]);

copyFileSync('node_modules/@duckduckgo/autoconsent/rules/compact-rules.json', 'dist/consent-rules.json');
// c2pa-web normally starts its worker from a blob URL, which extension pages
// may not do; ship the worker and WASM as files instead.
mkdirSync('dist/c2pa', { recursive: true });
copyFileSync('node_modules/@contentauth/c2pa-web/dist/c2pa_worker.js', 'dist/c2pa/c2pa_worker.js');
copyFileSync('node_modules/@contentauth/c2pa-web/dist/resources/c2pa_bg.wasm', 'dist/c2pa/c2pa_bg.wasm');
