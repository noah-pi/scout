// Calm layer and AI-label filter on pages shaped like the real sites, plus
// the daily rules refresh (with a broken selector that must fail alone).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, startServer, visit } from './harness.js';

const YOUTUBE = `<!doctype html><title>YouTube</title>
<ytd-rich-item-renderer id="v1"><a href="/watch?v=a">A real video</a></ytd-rich-item-renderer>
<ytd-rich-item-renderer id="v2"><a href="/watch?v=b">Cat rescue</a><span class="badge">Altered or synthetic content</span></ytd-rich-item-renderer>
<ytd-reel-shelf-renderer id="shorts">Shorts</ytd-reel-shelf-renderer>`;
const INSTAGRAM = `<!doctype html><title>Instagram</title>
<article id="p1"><header>friend</header><p>Beach day</p></article>
<article id="p2"><header>artacct <span>AI info</span></header><p>Dreamy castle</p></article>`;
const GOOGLE = `<!doctype html><title>q - Google Search</title><div id="rso">
<div id="ai" data-hveid="1"><h1>AI Overview</h1><p>A generated summary.</p></div>
<div id="r1" data-hveid="2"><a href="https://example.org"><h3>Result</h3></a></div></div>`;
const NEWS = `<!doctype html><title>News</title><div id="intercom-container">chat</div><p class="annoying">Promo strip</p>
<video id="v" muted autoplay loop src="data:video/mp4;base64,"></video>`;

const bundled = JSON.parse(readFileSync(new URL('../../data/page-rules.json', import.meta.url), 'utf8'));
const updated = { ...bundled, version: bundled.version + 1, updated: '2099-01-01', calm: { ...bundled.calm, chat: { ...bundled.calm.chat, selectors: ['p:::broken', ...bundled.calm.chat.selectors, '.annoying'] } } };

let server, browser;
before(async () => {
  server = await startServer({
    '/yt': YOUTUBE,
    '/ig': INSTAGRAM,
    '/search': GOOGLE,
    '/news': NEWS,
    '/rules.json': () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(updated) }),
  });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const shown = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, getComputedStyle(document.getElementById(id)).display !== 'none'])), ids);

test('YouTube: Shorts gone, the AI-labeled video folded, the rest untouched', async () => {
  const page = await visit(browser.context, `http://www.youtube.com:${server.port}/yt`, 2000);
  assert.deepEqual(await shown(page, ['v1', 'v2', 'shorts']), { v1: true, v2: false, shorts: false });
  assert.match(await page.textContent('.scout-calm-note'), /YouTube labels this post as made with AI/);
  await page.click('.scout-calm-note');
  assert.equal((await shown(page, ['v2'])).v2, true);
});

test('Instagram: posts carrying "AI info" fold', async () => {
  const page = await visit(browser.context, `http://www.instagram.com:${server.port}/ig`, 2000);
  assert.deepEqual(await shown(page, ['p1', 'p2']), { p1: true, p2: false });
  assert.equal((await browser.ext.tabState()).calm.aiFolded, 1);
});

test("Google: the AI Overview block folds, results stay", async () => {
  const page = await visit(browser.context, `http://www.google.co.uk:${server.port}/search`, 2000);
  assert.deepEqual(await shown(page, ['ai', 'r1']), { ai: false, r1: true });
});

test('any site: chat bubble hidden, autoplaying video paused', async () => {
  const page = await visit(browser.context, `http://news.example.com:${server.port}/news`, 2000);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('intercom-container')).display), 'none');
  assert.equal(await page.evaluate(() => document.getElementById('v').autoplay), false);
});

test('a remote rules update applies, and a broken selector fails alone', async () => {
  await browser.probe.evaluate((url) => chrome.storage.local.set({ pageRulesUrl: url }), `http://raw.example:${server.port}/rules.json`);
  const res = await browser.ext.send({ type: 'refreshPageRules' });
  assert.deepEqual(res.value, { ok: true, updated: '2099-01-01' });
  const page = await visit(browser.context, `http://news.example.com:${server.port}/news`, 2000);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.annoying')).display), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('intercom-container')).display), 'none');
  const { receipts } = await browser.ext.panel((await browser.ext.tabState()).tabId);
  assert.ok(receipts.some((r) => r.reason === 'Daily page-rules refresh'));
});

test('switching a calm rule off takes effect on the next load', async () => {
  await browser.ext.send({ type: 'saveShields', changes: { calm: { shorts: false } } });
  const page = await visit(browser.context, `http://www.youtube.com:${server.port}/yt`, 1500);
  assert.equal((await shown(page, ['shorts'])).shorts, true);
});
