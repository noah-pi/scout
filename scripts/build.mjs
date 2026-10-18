// Bundles the npm dependencies into dist/, which the extension loads directly.
// Offline; run after `npm install` or after bumping a dependency.
import { copyFileSync } from 'node:fs';
import { build } from 'esbuild';

const shared = { bundle: true, minify: true, legalComments: 'inline', logLevel: 'info', target: 'chrome138' };

await Promise.all([
  // Content script: Chrome can't load ES modules there, so it ships as an IIFE.
  build({ ...shared, entryPoints: ['src/content/consent.js'], outfile: 'dist/consent.js', format: 'iife' }),
  // Service-worker side of autoconsent: the main-world snippets and rule filter.
  build({ ...shared, entryPoints: ['src/background/consent-lib.js'], outfile: 'dist/consent-lib.js', format: 'esm' }),
  // Public Suffix List lookups, shared by the worker and the unit tests.
  build({ ...shared, entryPoints: ['tldts'], outfile: 'dist/tldts.js', format: 'esm' }),
]);

copyFileSync('node_modules/@duckduckgo/autoconsent/rules/compact-rules.json', 'dist/consent-rules.json');
