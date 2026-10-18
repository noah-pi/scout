import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const FAKE = `<!doctype html><title>Designer Bags Outlet</title>
<script type="application/ld+json">{"@type":"Product","name":"Bag"}</script>
<h1>Clearance: -85% today only</h1><p>Gucci bag -90%. Prada bag -80%. Wallets -75%.</p>
<img src="/norton-secured.png" alt="Norton Secured">
<p>Payment by bank transfer or Bitcoin.</p><button>Add to cart</button>
<input autocomplete="cc-number">`;

const REAL = `<!doctype html><title>Corner Bookshop</title>
<script type="application/ld+json">{"@type":"Product","name":"Novel"}</script>
<p>Summer sale: 20% off fiction.</p><button>Add to cart</button>
<a href="https://www.trustedshops.com/buyerrating/info_X.html"><img alt="Trusted Shops"></a>
<p>We accept Visa, Mastercard and PayPal.</p>
<footer><a href="/impressum">Impressum</a> <a href="/returns">Returns</a> <a href="mailto:hi@bookshop.example">Contact</a></footer>`;

let server, browser;
before(async () => {
  server = await startServer({ '/fake': FAKE, '/real': REAL });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('a shop with every warning sign gets the fake-shop flag and stops at the card field', async () => {
  await visit(browser.context, `http://designer-outlet.example.shop:${server.port}/fake`, 3500);
  const state = await browser.ext.tabState();
  const kinds = state.flags.map((f) => f.kind);
  for (const k of ['shop:no-contact', 'shop:unlinked-seal', 'shop:risky-payment', 'shop:steep-discounts', 'fake-shop']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.equal(state.level, 'stop');
});

test('a legitimate shop stays quiet and triggers no outside lookup', async () => {
  const before = (await browser.ext.panel((await browser.ext.tabState()).tabId)).receipts.length;
  await visit(browser.context, `http://bookshop.example.de:${server.port}/real`, 3500);
  const state = await browser.ext.tabState();
  assert.deepEqual(state.flags.filter((f) => f.kind.startsWith('shop:') || f.kind === 'fake-shop'), []);
  assert.equal(state.level, 'quiet');
  const after = (await browser.ext.panel(state.tabId)).receipts.length;
  assert.equal(after, before, 'no domain-age lookup for a clean shop');
});
