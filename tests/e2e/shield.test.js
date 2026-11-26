import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const NEWS = `<!doctype html><title>News</title>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<script src="https://static.hotjar.com/c/hotjar-1.js"></script>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px">
  We use cookies. <button id="onetrust-accept-btn-handler" onclick="window.choice='accept'">Accept</button>
  <button id="onetrust-reject-all-handler" onclick="window.choice='reject';this.parentNode.style.display='none'">Reject all</button>
</div><canvas id="c"></canvas><script>c.toDataURL(); window.gpc = navigator.globalPrivacyControl;
  // Scout serves a stand-in for analytics.js, so code that calls ga() keeps working.
  window.gaWorks = typeof window.ga === 'function' && (ga('send', 'pageview'), true);</script>`;

let server, browser;
before(async () => {
  server = await startServer({ '/news': NEWS });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('blocks trackers, names their owners, rejects the cookie banner, sends GPC', async () => {
  const page = await visit(browser.context, `http://www.example-news.com:${server.port}/news`, 5000);
  assert.equal(await page.evaluate(() => window.choice), 'reject');
  assert.equal(await page.evaluate(() => window.gpc), true);
  assert.equal(server.seen.find((r) => r.url === '/news').headers['sec-gpc'], '1');
  assert.equal(await page.evaluate(() => window.gaWorks), true, 'the analytics stand-in loaded');

  const state = await browser.ext.tabState();
  assert.equal(state.consent.cmp, 'Onetrust');
  assert.deepEqual(Object.values(state.trackers).map((t) => t.company).sort(), ['Facebook', 'Google', 'Hotjar']);
  assert.ok(state.fingerprinting.includes('canvas'));
  assert.equal(state.level, 'quiet');

  const panel = await browser.ext.panel(state.tabId);
  assert.equal(panel.blocked, 3, "Chrome's own count matches");
});

test('a block Chrome never reports as a rule match is still counted', async () => {
  // Rule-match events are ignored here, as when Chrome drops them; webRequest
  // sees the blocked requests, and Scout asks Chrome which of its rules matched.
  await browser.probe.evaluate(() => chrome.storage.local.set({ testWitnessOnly: true }));
  try {
    await visit(browser.context, `http://www.witness-news.com:${server.port}/news`, 4000);
    const state = Object.values(await browser.ext.session()).find((v) => v?.host === 'www.witness-news.com');
    assert.deepEqual(Object.values(state.trackers).map((t) => t.company).sort(), ['Facebook', 'Google', 'Hotjar']);
  } finally {
    await browser.probe.evaluate(() => chrome.storage.local.remove('testWitnessOnly'));
  }
});
