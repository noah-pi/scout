import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOP, shopFlags } from '../src/shared/shops.js';

const legit = { isShop: true, legalLinks: 4, contact: true, seals: [{ name: 'Trusted Shops', linked: true }], text: 'Pay with PayPal, Visa or Klarna', discounts: [20, 30] };
const fake = { isShop: true, legalLinks: 0, contact: false, seals: [{ name: 'Norton Secured', linked: false }], text: 'Payment by bank transfer or Bitcoin only', discounts: [80, 85, 90, 75] };

test('shop detection is multilingual', () => {
  for (const s of ['Add to cart', 'In den Warenkorb', 'Ajouter au panier', 'カートに入れる']) assert.ok(SHOP.test(s), s);
  assert.ok(!SHOP.test('Read more'));
});

test('a legitimate shop raises nothing', () => {
  assert.deepEqual(shopFlags(legit, 3000), []);
  assert.deepEqual(shopFlags({ ...fake, isShop: false }), []);
});

test('the full fake-shop pattern is a hard flag', () => {
  const flags = shopFlags(fake, 20);
  assert.deepEqual(flags.map((f) => f.kind), ['shop:no-contact', 'shop:unlinked-seal', 'shop:risky-payment', 'shop:steep-discounts', 'fake-shop']);
  assert.equal(flags.at(-1).severity, 'hard');
  assert.match(flags.at(-1).text, /20 days old/);
});

test('two signs need a young domain (or risky payment) to become a hard flag', () => {
  const two = { ...legit, legalLinks: 0, contact: false, seals: [{ name: 'Norton', linked: false }] };
  assert.ok(!shopFlags(two, 3000).some((f) => f.kind === 'fake-shop'));
  assert.ok(shopFlags(two, 40).some((f) => f.kind === 'fake-shop'));
  assert.ok(!shopFlags(two, null).some((f) => f.kind === 'fake-shop'));
});
