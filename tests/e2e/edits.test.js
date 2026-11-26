// Watched stories and the earliest archived copy.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

let server, browser, port;
const url = (host, path) => `http://${host}:${port}${path}`;

const PARAS = [
  'The city council voted on Tuesday to approve the new housing plan after a long debate.',
  '“We have no intention of raising rents for existing tenants,” said the deputy mayor, Ana Ruiz.',
  'Opponents said the plan would push longtime residents out of the neighborhood within five years.',
  'The vote was 7 to 2, with two members absent, and the plan takes effect in March.',
];
const story = (headline, paras) => `<!doctype html><html><head><title>${headline}</title>
  <meta property="og:title" content="${headline}"><meta name="author" content="Jo Lee">
  <meta property="article:modified_time" content="2026-11-01T10:00:00Z"></head>
  <body><nav><p>Home · World · Politics · Business · Opinion · Sports · Culture · Food</p></nav>
  <article><h1>${headline}</h1>${paras.map((p) => `<p>${p}</p>`).join('')}</article></body></html>`;
let version = story('Council approves housing plan', PARAS);

before(async () => {
  server = await startServer({
    '/story': () => ({ headers: { 'content-type': 'text/html' }, body: version }),
    '/cdx/search/cdx': () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify([['timestamp', 'original'], ['20190312080000', url('news.example', '/story')]]) }),
    '/web/*': () => ({ headers: { 'content-type': 'text/html' }, body: story('Council to vote on housing plan', [PARAS[0].replace('voted on Tuesday to approve', 'will vote on Tuesday on'), ...PARAS.slice(1)]) }),
  });
  port = server.port;
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('a watched story that changes quietly is caught: headline, paragraph, quote, and the date left alone', async () => {
  const page = await visit(browser.context, url('news.example', '/story'), 800);
  const tabId = Number(Object.entries(await browser.ext.session()).find(([, v]) => v?.host === 'news.example')[0].slice(4));
  let res = await browser.ext.send({ type: 'watchStory', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.value[0].title, 'Council approves housing plan');
  assert.equal((await browser.ext.panel(tabId)).watching, true);

  // Unchanged: nothing to report.
  res = await browser.ext.send({ type: 'checkWatched', force: true });
  assert.deepEqual(res.value[0].changes, []);

  version = story('Council passes housing plan', [PARAS[0], PARAS[2].replace('within five years', 'over time'), PARAS[3]]);
  res = await browser.ext.send({ type: 'checkWatched', force: true });
  const [w] = res.value;
  assert.equal(w.changes.length, 1, JSON.stringify(w));
  const [change] = w.changes;
  assert.equal(change.stealth, true);
  assert.deepEqual(change.changes.map((c) => c.field), ['headline', 'body', 'quotes']);
  assert.equal(w.title, 'Council passes housing plan');
  // The activity log is written in batches.
  let logged = false;
  for (let i = 0; i < 20 && !logged; i++, await page.waitForTimeout(150)) logged = (await browser.ext.send({ type: 'getActivity' })).value.some((a) => a.kind === 'edit' && /updated date didn’t move/.test(a.text));
  assert.ok(logged, 'logged as an unadmitted edit');
  await page.close();
});

test('changes since the earliest archived copy', async () => {
  await browser.probe.evaluate((base) => chrome.storage.local.set({ archiveBase: base }), `http://web.archive.org:${port}`);
  version = story('Council approves housing plan', PARAS);
  await visit(browser.context, url('news.example', '/story'), 800);
  const tabId = Number(Object.entries(await browser.ext.session()).filter(([, v]) => v?.host === 'news.example').at(-1)[0].slice(4));
  const res = await browser.ext.send({ type: 'compareEarliest', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.value.found, true);
  assert.equal(res.value.at, '2019-03-12T08:00:00Z');
  assert.deepEqual(res.value.changes.map((c) => c.field), ['headline', 'body']);
  assert.ok(server.seen.some((r) => r.url.startsWith('/web/20190312080000id_/')), 'fetched the original, not the archive’s wrapper');
  await browser.probe.evaluate(() => chrome.storage.local.remove('archiveBase'));
});
