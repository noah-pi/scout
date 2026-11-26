// IP-logging links and research mode.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

let server, browser, port;
const url = (host, path) => `http://${host}:${port}${path}`;
const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await fn()) return true;
  return Boolean(await fn());
};

before(async () => {
  server = await startServer({
    '/abc123': '<!doctype html><title>Logged</title><p>gotcha</p>',
    '/reading': () => ({ headers: { 'content-type': 'text/html' }, body: `<!doctype html><title>Reading</title><img src="${url('cdn.other-site.example', '/pixel.gif')}"><img src="/same.gif">` }),
    '/pixel.gif': '',
    '/same.gif': '',
  });
  port = server.port;
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('an IP-logging link stops on Scout\'s page before it loads, and opens only if you insist', async () => {
  const page = await visit(browser.context, url('grabify.link', '/abc123'), 1500);
  assert.match(page.url(), /^chrome-extension:\/\/[a-p]{32}\/src\/stop\/stop\.html#http:\/\/grabify\.link:\d+\/abc123$/);
  assert.ok(!server.seen.some((r) => r.url === '/abc123'), 'the logger never heard from the browser');
  assert.match(await page.textContent('#what'), /Grabify/);
  await page.click('#open');
  assert.ok(await until(() => server.seen.some((r) => r.url === '/abc123')), 'opened on request');
  await page.waitForLoadState();
  assert.equal(await page.title(), 'Logged');
  const activity = (await browser.ext.send({ type: 'getActivity' })).value;
  assert.ok(activity.some((a) => a.kind === 'ip-logger' && /Stopped/.test(a.text)));
  // The site stays allowed for the session.
  const again = await visit(browser.context, url('grabify.link', '/abc123'), 800);
  assert.equal(await again.title(), 'Logged');
});

test('research mode changes Chrome settings, drops the cross-site Referer, defends fingerprints everywhere, and undoes it all', async () => {
  const webrtc = () => browser.probe.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({}));
  const before = (await webrtc()).value;
  await browser.ext.send({ type: 'saveShields', changes: { research: true } });
  assert.ok(await until(async () => (await webrtc()).value === 'disable_non_proxied_udp'));
  assert.equal((await browser.probe.evaluate(() => chrome.privacy.network.networkPredictionEnabled.get({}))).value, false);
  assert.ok(await until(async () => (await browser.probe.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['scout-farble'] })))[0]?.matches.includes('<all_urls>')));
  const panel = await browser.ext.panel(0);
  assert.equal(panel.guards.forgetOnClose, true, 'sites are forgotten on close');
  assert.equal(panel.research.webrtc.ours, true);

  await visit(browser.context, url('www.reading.example', '/reading'), 1500);
  const pixel = server.seen.findLast((r) => r.url === '/pixel.gif');
  assert.equal(pixel.headers.referer, undefined, 'no Referer to another site');
  assert.ok(server.seen.findLast((r) => r.url === '/same.gif').headers.referer, 'same-site requests keep it');

  await browser.ext.send({ type: 'saveShields', changes: { research: false } });
  assert.ok(await until(async () => (await webrtc()).value === before), 'WebRTC handed back');
  assert.ok(await until(async () => !(await browser.probe.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['scout-farble'] }))).length));
  const rules = await browser.probe.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(!rules.some((r) => r.id === 20_200));
});
