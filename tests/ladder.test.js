import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, DISMISS_MUTE_AFTER } from '../src/shared/ladder.js';
import { makeTrustRecord, trustStillValid } from '../src/shared/trust.js';

const hard = { kind: 'new-domain', severity: 'hard', text: '' };
const soft = { kind: 'young-domain', severity: 'soft', text: '' };

test('nothing at stake and nothing flagged stays quiet', () => {
  assert.deepEqual(assess({}), { level: 'quiet', escalate: null, notes: [] });
});

test('a hard flag on a payment page stops', () => {
  assert.equal(assess({ stakes: { payment: true }, flags: [hard] }).level, 'stop');
});

test('a hard flag without stakes is a note', () => {
  assert.equal(assess({ flags: [hard] }).level, 'note');
});

test('one-time codes and recovery phrases count as high stakes', () => {
  assert.equal(assess({ stakes: { otp: true }, flags: [hard] }).level, 'stop');
  assert.equal(assess({ stakes: { seed: true }, flags: [soft] }).escalate, 'tier3');
});

test('soft flags alone stay quiet until stakes rise', () => {
  assert.equal(assess({ flags: [soft] }).level, 'quiet');
  assert.equal(assess({ stakes: { password: true }, flags: [soft] }).level, 'note');
});

test('escalates only in the uncertain middle', () => {
  assert.equal(assess({ stakes: { password: true }, flags: [soft] }).escalate, 'tier3');
  assert.equal(assess({ stakes: { password: true }, flags: [hard, soft] }).escalate, null);
  assert.equal(assess({ stakes: { password: true } }).escalate, null);
  assert.equal(assess({ flags: [soft] }).escalate, null);
});

test('info flags never move the badge or escalate', () => {
  const info = { kind: 'fingerprinting', severity: 'info', text: '' };
  const result = assess({ stakes: { password: true }, flags: [info] });
  assert.equal(result.level, 'quiet');
  assert.equal(result.escalate, null);
  assert.deepEqual(result.notes, [info]);
});

test('dismissals mute soft flags but never hard ones', () => {
  const dismissals = { 'young-domain': DISMISS_MUTE_AFTER, 'new-domain': 99 };
  assert.equal(assess({ stakes: { payment: true }, flags: [soft], dismissals }).level, 'quiet');
  assert.equal(assess({ stakes: { payment: true }, flags: [hard], dismissals }).level, 'stop');
});

test('trust lapses when the domain is re-registered or expires', () => {
  const now = Date.parse('2026-10-18T00:00:00Z');
  const record = makeTrustRecord('example.com', '2001-01-01T00:00:00Z', now);
  assert.equal(trustStillValid(record, '2001-01-01T00:00:00Z', now), true);
  assert.equal(trustStillValid(record, '2026-09-30T00:00:00Z', now), false);
  assert.equal(trustStillValid(record, null, now), true);
  assert.equal(trustStillValid(record, null, now + 400 * 86_400_000), false);
  assert.equal(trustStillValid(undefined, null, now), false);
});
