import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, startServer, visit } from './harness.js';

const slopSite = JSON.parse(readFileSync(new URL('../../data/ai-sites.json', import.meta.url))).domains[0];

// Shaped like a results page: each result is a block with one destination,
// one of them through a Google-style /url?q= redirect.
const RESULTS = `<!doctype html><title>results</title><div id="rso">
<div class="g" id="r1"><a href="https://en.wikipedia.org/wiki/Lighthouse"><h3>Lighthouse - Wikipedia</h3></a><span>A tower with a light.</span></div>
<div class="g" id="r2"><a href="/url?q=https://www.${slopSite}/lighthouse-ideas&sa=U"><h3>50 AI lighthouse pictures</h3></a><span>Generated images.</span></div>
<div class="g" id="r3"><a href="https://www.nps.gov/lighthouses"><h3>Lighthouses (NPS)</h3></a><span>Visit.</span></div>
</div>`;

let server, browser;
before(async () => {
  server = await startServer({ '/search': RESULTS });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('folds results from AI-heavy sites and reveals them on click', async () => {
  const page = await visit(browser.context, `http://duckduckgo.com:${server.port}/search?q=lighthouse`, 2500);
  const visible = () => page.evaluate(() => ['r1', 'r2', 'r3'].map((id) => getComputedStyle(document.getElementById(id)).display !== 'none'));
  assert.deepEqual(await visible(), [true, false, true]);
  assert.match(await page.textContent('.scout-slop-note'), new RegExp(slopSite.replace('.', '\\.')));
  assert.equal((await browser.ext.tabState()).slopHidden, 1);
  await page.click('.scout-slop-note');
  assert.deepEqual(await visible(), [true, true, true]);
});
