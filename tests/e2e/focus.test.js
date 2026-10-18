// The stakes check fires the moment you click into a sensitive field, even
// when the form appears late; recovery-phrase pages stop on their own.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

// A sign-in popup that appears 2 s after load, with no password field: an
// email box and a one-time code.
const LATE = `<!doctype html><title>Account</title><button id="open">Sign in</button>
<script>setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<dialog open><label for="c">Verification code</label><input id="c" autocomplete="one-time-code"></dialog>'); }, 2000);</script>`;
const SEED = `<!doctype html><title>Claim your airdrop</title><h1>Connect wallet</h1>
<label for="s">Enter your 12-word recovery phrase</label><textarea id="s"></textarea>`;

let server, browser;
before(async () => {
  server = await startServer({ '/late': LATE, '/claim': SEED });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('focusing a late one-time-code field raises the stakes immediately', async () => {
  const page = await visit(browser.context, `http://accounts.example.org:${server.port}/late`, 500);
  assert.equal((await browser.ext.tabState()).stakes?.otp ?? false, false);
  await page.waitForSelector('#c');
  await page.focus('#c');
  await page.waitForTimeout(400);
  assert.equal((await browser.ext.tabState()).stakes.otp, true);
});

test('a page asking for a recovery phrase stops on its own', async () => {
  await visit(browser.context, `http://claim-airdrop.example.xyz:${server.port}/claim`, 2500);
  const state = await browser.ext.tabState();
  assert.equal(state.stakes.seed, true);
  assert.ok(state.flags.some((f) => f.kind === 'seed-phrase' && f.severity === 'hard'));
  assert.equal(state.level, 'stop');
});
