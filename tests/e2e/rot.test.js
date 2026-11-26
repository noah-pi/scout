// Page rules that stop matching: the nightly canary's page check, and the
// in-browser record of rules that keep missing on their own sites.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { launch, startServer, visit } from './harness.js';
import { CHECKS, probe } from '../../scripts/rule-canary.mjs';

const AIO = '<!doctype html><title>q - Search</title><div id="rso"><div data-hveid="1"><h2>AI Overview</h2><p>The sky is blue because…</p></div><div data-hveid="2"><a href="/r"><h3>Result</h3></a></div></div>';
const PLAIN = '<!doctype html><title>q - Search</title><div id="rso"><div data-hveid="2"><a href="/r"><h3>Result</h3></a></div></div>';

let server, port, browser;
before(async () => {
  server = await startServer({ '/search': (req) => ({ headers: { 'content-type': 'text/html' }, body: req.url.includes('aio') ? AIO : PLAIN }), '/captcha': 'Our systems have detected unusual traffic from your computer network.' });
  port = server.port;
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('the canary tells a matching rule from a missing one and from a page that blocked it', async () => {
  const plain = await chromium.launch({ executablePath: process.env.SCOUT_CHROMIUM || undefined, args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
  try {
    const page = await plain.newPage();
    const check = CHECKS.find((c) => c.key === 'aiOverviews');
    const at = (url) => ({ ...check, url, wait: 300 });
    assert.equal((await probe(page, at(`http://www.google.com:${port}/search?q=aio`))).result, 'ok');
    assert.equal((await probe(page, at(`http://www.google.com:${port}/search?q=sky`))).result, 'missing');
    assert.equal((await probe(page, at(`http://www.google.com:${port}/captcha`))).result, 'blocked');
    assert.equal((await probe(page, at(`http://www.google.com:${port}/nothing`))).result, 'blocked');
  } finally {
    await plain.close();
  }
});

test('a rule that misses on its own site is counted, a hit clears it, and a stale rule reaches the panel', async () => {
  browser = await launch();
  const health = async () => (await browser.probe.evaluate(() => chrome.storage.local.get('ruleHealth'))).ruleHealth ?? {};
  const until = async (fn) => {
    for (let i = 0; i < 60 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 250));
    return fn();
  };
  await visit(browser.context, `http://www.google.com:${port}/search?q=sky`, 500);
  assert.ok(await until(async () => (await health()).aiOverviews?.misses === 1), JSON.stringify(await health()));
  await visit(browser.context, `http://www.google.com:${port}/search?q=aio`, 500);
  assert.ok(await until(async () => (await health()).aiOverviews?.misses === 0 && (await health()).aiOverviews?.lastHit));

  const old = Date.now() - 20 * 86_400_000;
  await browser.probe.evaluate((old) => chrome.storage.local.set({ ruleHealth: { shorts: { label: 'Hide YouTube Shorts', since: old, visits: 12, misses: 12, lastHit: old, lastVisit: Date.now() } } }), old);
  const panel = await browser.ext.panel(0);
  assert.deepEqual(panel.rot.map((r) => r.key), ['shorts']);
});
