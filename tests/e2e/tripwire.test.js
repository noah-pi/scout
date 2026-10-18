import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const LOGIN = `<!doctype html><title>Sign in</title><form><input name="u"><input type="password" name="p"></form>
<canvas id="c"></canvas><script>c.toDataURL()</script>`;

let server, browser;
before(async () => {
  server = await startServer({ '/login': LOGIN });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

for (const [host, level, kind] of [
  ['paypa1.com', 'stop', 'lookalike:confusable'],
  ['paypal-login.github.io', 'stop', 'lookalike:brand-in-name'],
  ['www.nytimes.com', 'quiet', null],
]) {
  test(`${host} login page is ${level}`, async () => {
    const page = await visit(browser.context, `http://${host}:${server.port}/login`);
    const state = await browser.ext.tabState();
    assert.equal(state.host, host);
    assert.deepEqual(state.stakes, { password: true, payment: false });
    assert.equal(state.level, level);
    if (kind) assert.ok(state.flags.some((f) => f.kind === kind), JSON.stringify(state.flags));
    await page.close();
  });
}
