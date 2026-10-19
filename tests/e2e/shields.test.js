// Pause, the extension audit, the session-only key, and the tabbed panel.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

// The tracker is served by the test server itself (plain http on its port),
// so a request that gets through is visible in server.seen.
const PAGE = (port) => `<!doctype html><title>Shop</title><script src="http://www.google-analytics.com:${port}/analytics.js"></script>
<div id="onetrust-banner-sdk"><button id="onetrust-reject-all-handler" onclick="window.choice='reject';this.parentNode.style.display='none'">Reject all</button></div>`;

let server, browser;
before(async () => {
  server = await startServer({ '/': () => ({ headers: { 'content-type': 'text/html' }, body: PAGE(server.port) }), '/analytics.js': '' });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('pausing a site lets its requests through and skips the cookie banner, then resumes', async () => {
  const url = `http://www.breaky.co.uk:${server.port}/`;
  await visit(browser.context, url, 2500);
  let state = await browser.ext.tabState();
  assert.equal(Object.keys(state.trackers).length, 1);

  const res = await browser.ext.send({ type: 'togglePause', tabId: state.tabId });
  assert.deepEqual(res.value.paused, ['breaky.co.uk']);
  const page = await visit(browser.context, url, 1500);
  // Wait for the request itself rather than a fixed time: CI runs every
  // browser file at once and page loads there can be slow.
  for (let i = 0; i < 40 && !server.seen.some((r) => r.url === '/analytics.js'); i++) await page.waitForTimeout(250);
  assert.ok(server.seen.some((r) => r.url === '/analytics.js'), 'the tracker request reached the network');
  state = await browser.ext.tabState();
  assert.equal(Object.keys(state.trackers).length, 0, 'nothing blocked while paused');
  assert.equal(await page.evaluate(() => window.choice), undefined, 'banner left alone');

  await browser.ext.send({ type: 'togglePause', tabId: state.tabId });
  const again = await visit(browser.context, url, 1500);
  // Blocked-request events reach the ledger asynchronously; wait for it.
  for (let i = 0; i < 20 && !Object.keys((await browser.ext.tabState()).trackers).length; i++) await again.waitForTimeout(250);
  assert.equal(Object.keys((await browser.ext.tabState()).trackers).length, 1);
});

test('a session-only key never touches local storage', async () => {
  await browser.ext.send({ type: 'saveSettings', changes: { apiKey: 'sk-ant-session', keyInSession: true } });
  const local = await browser.probe.evaluate(() => chrome.storage.local.get('settings'));
  assert.equal(local.settings.apiKey, '');
  const session = await browser.probe.evaluate(() => chrome.storage.session.get('apiKey'));
  assert.equal(session.apiKey, 'sk-ant-session');
  const { tabId } = await browser.ext.tabState();
  assert.equal((await browser.ext.panel(tabId)).settings.hasKey, true);
});

test('the panel opens on tabs and the audit runs', async () => {
  const { tabId } = await browser.ext.tabState();
  const panel = await browser.ext.panel(tabId);
  assert.ok(Array.isArray(panel.extensions));
  const visible = await browser.probe.evaluate(() => [...document.querySelectorAll('main[data-panel]')].filter((m) => !m.hidden).map((m) => m.dataset.panel));
  assert.deepEqual(visible, ['page']);
  await browser.probe.click('button[data-tab="shields"]');
  const now = await browser.probe.evaluate(() => [...document.querySelectorAll('main[data-panel]')].filter((m) => !m.hidden).map((m) => m.dataset.panel));
  assert.deepEqual(now, ['shields']);
});
