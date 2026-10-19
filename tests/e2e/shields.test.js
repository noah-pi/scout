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
  // One tab on the site at a time, found by host; ledger events arrive
  // asynchronously, so counts are waited for rather than slept on.
  const site = async () => Object.entries(await browser.ext.session()).find(([k, v]) => k.startsWith('tab:') && v?.host === 'www.breaky.co.uk');
  const trackers = async () => Object.keys((await site())?.[1]?.trackers ?? {}).length;
  const until = async (fn) => {
    for (let i = 0; i < 30 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 200));
    return fn();
  };

  let page = await visit(browser.context, url, 1500);
  if (!(await until(async () => (await trackers()) === 1))) {
    const matched = await browser.probe.evaluate(() => chrome.declarativeNetRequest.getMatchedRules({}));
    assert.fail(`blocked before pausing; state ${JSON.stringify((await site())?.[1])}; matched ${JSON.stringify(matched.rulesMatchedInfo.map((m) => [m.tabId, m.rule.rulesetId]))}`);
  }
  const tabId = Number((await site())[0].slice(4));
  const res = await browser.ext.send({ type: 'togglePause', tabId });
  assert.deepEqual(res.value.paused, ['breaky.co.uk']);
  await page.close();

  page = await visit(browser.context, url, 1500);
  assert.ok(await until(() => server.seen.some((r) => r.url === '/analytics.js')), 'the tracker request reached the network');
  assert.equal(await trackers(), 0, 'nothing blocked while paused');
  assert.equal(await page.evaluate(() => window.choice), undefined, 'banner left alone');
  const pausedTab = Number((await site())[0].slice(4));
  await browser.ext.send({ type: 'togglePause', tabId: pausedTab });
  await page.close();

  const hits = server.seen.filter((r) => r.url === '/analytics.js').length;
  await visit(browser.context, url, 1500);
  if (!(await until(async () => (await trackers()) === 1))) {
    const matched = await browser.probe.evaluate(() => chrome.declarativeNetRequest.getMatchedRules({}));
    const rules = await browser.probe.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.fail(`blocked again after resuming; analytics hits ${hits} -> ${server.seen.filter((r) => r.url === '/analytics.js').length}; rules ${rules.map((r) => r.id)}; matched ${JSON.stringify(matched.rulesMatchedInfo.map((m) => [m.tabId, m.rule.rulesetId, m.rule.ruleId]))}; tabs ${JSON.stringify(Object.entries(await browser.ext.session()).filter(([k]) => k.startsWith('tab:')).map(([k, v]) => [k, v.host, Object.keys(v.trackers ?? {}).length]))}`);
  }
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
