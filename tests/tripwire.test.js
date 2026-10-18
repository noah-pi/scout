import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROTECTED, ageInDays, editDistance, findLookalike, hasPunycode, registeredAt, registrableDomain, skeleton,
} from '../src/shared/tripwire.js';

test('registrableDomain handles plain and multi-part suffixes', () => {
  assert.equal(registrableDomain('www.paypal.com'), 'paypal.com');
  assert.equal(registrableDomain('shop.amazon.co.uk'), 'amazon.co.uk');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('paypal-login.github.io'), 'paypal-login.github.io');
  assert.equal(registrableDomain('news.bbc.co.uk.'), 'bbc.co.uk');
});

test('skeleton folds look-alike characters', () => {
  assert.equal(skeleton('rnicrosoft'), skeleton('microsoft'));
  assert.equal(skeleton('paypa1'), skeleton('paypal'));
  assert.equal(skeleton('аpple'), skeleton('apple')); // Cyrillic а
});

test('editDistance', () => {
  assert.equal(editDistance('chase', 'chase'), 0);
  assert.equal(editDistance('amazon', 'amazom'), 1);
  assert.equal(editDistance('', 'abc'), 3);
});

test('findLookalike flags imitations and leaves the real sites alone', () => {
  assert.equal(findLookalike('www.paypal.com', DEFAULT_PROTECTED), null);
  assert.equal(findLookalike('signin.apple.com', DEFAULT_PROTECTED), null);
  assert.equal(findLookalike('nytimes.com', DEFAULT_PROTECTED), null);
  assert.deepEqual(findLookalike('paypa1.com', DEFAULT_PROTECTED), { kind: 'confusable', target: 'paypal.com' });
  assert.deepEqual(findLookalike('amazom.com', DEFAULT_PROTECTED), { kind: 'typo', target: 'amazon.com' });
  assert.deepEqual(findLookalike('paypal.com.secure-login.io', DEFAULT_PROTECTED), { kind: 'brand-in-subdomain', target: 'paypal.com' });
  assert.deepEqual(findLookalike('www.amazon.co.uk', DEFAULT_PROTECTED), { kind: 'other-suffix', target: 'amazon.com' });
  assert.deepEqual(findLookalike('paypal-login.github.io', DEFAULT_PROTECTED), { kind: 'brand-in-name', target: 'paypal.com' });
  assert.deepEqual(findLookalike('secure-chase.net', DEFAULT_PROTECTED), { kind: 'brand-in-name', target: 'chase.com' });
  assert.equal(findLookalike('s3.amazonaws.com', DEFAULT_PROTECTED), null);
  assert.equal(findLookalike('chasebank-fan-club.org', DEFAULT_PROTECTED), null);
});

test('hasPunycode', () => {
  assert.equal(hasPunycode('xn--pple-43d.com'), true);
  assert.equal(hasPunycode('apple.com'), false);
});

test('registeredAt reads the RDAP registration event', () => {
  const rdap = { events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2026-10-01T00:00:00Z' }] };
  assert.equal(registeredAt(rdap), '2026-10-01T00:00:00Z');
  assert.equal(registeredAt({}), null);
  assert.equal(ageInDays('2026-10-01T00:00:00Z', Date.parse('2026-10-11T00:00:00Z')), 10);
});
