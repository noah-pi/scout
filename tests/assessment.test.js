import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidence, buildRequest, costOf, nanoFlags, pageFlags, parseVerdict, redact, verdictFlags,
} from '../src/shared/assessment.js';
import { DEFAULT_PROTECTED } from '../src/shared/tripwire.js';

const state = {
  host: 'login.paypa1-secure.com',
  registeredAt: '2026-10-10T00:00:00Z',
  stakes: { password: true, payment: false },
  flags: [
    { kind: 'young-domain', severity: 'soft', text: 'Domain registered 8 days ago.' },
    { kind: 'fingerprinting', severity: 'info', text: 'This page fingerprinted your browser.' },
  ],
};

test('redact strips emails and long numbers', () => {
  assert.equal(redact('Mail jane.doe+x@mail.example.com or call +1 (212) 555-0100'), 'Mail [email] or call [number]');
  assert.equal(redact('Card 4111 1111 1111 1111 exp 12/29'), 'Card [number] exp 12/29');
});

test('evidence carries extracted fields only, and page text only when deep', () => {
  const page = { title: 'Log in to your account', headings: ['Verify now'], labels: ['Email'], formHosts: ['collector.example'], text: 'body text' };
  const evidence = buildEvidence(state, page);
  assert.deepEqual(evidence.asks_for, ['password']);
  assert.deepEqual(evidence.local_signals, ['Domain registered 8 days ago.']);
  assert.equal(evidence.page_text, undefined);
  assert.equal(buildEvidence(state, page, { deep: true }).page_text, 'body text');
  const judged = { ...state, flags: [...state.flags, { kind: 'Claude:likely_scam', severity: 'hard', text: 'Claude: likely a scam.' }, { kind: 'nano:brand-mismatch', severity: 'soft', text: 'On-device model: …' }] };
  assert.deepEqual(buildEvidence(judged, page).local_signals, ['Domain registered 8 days ago.']);
});

test('requests use structured output, fallbacks where supported, and effort by tier', () => {
  const quick = buildRequest('claude-opus-5-5', {});
  assert.equal(quick.output_config.effort, 'low');
  assert.equal(quick.output_config.format.type, 'json_schema');
  assert.equal(quick.fallbacks, 'default');
  assert.deepEqual(quick.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(!('thinking' in quick), 'Opus 5.5 thinking is always on; no thinking param');

  const deep = buildRequest('claude-opus-5-5', {}, { deep: true });
  assert.equal(deep.output_config.effort, 'high');
  assert.ok(deep.output_config.format.schema.required.includes('summary'));

  const haiku = buildRequest('claude-haiku-5-5', {});
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.betas, undefined);
});

test('parseVerdict handles text, refusals and junk', () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"verdict":"likely_scam","impersonating":"PayPal","reasons":["a","b","c","d"]}' }] };
  assert.deepEqual(parseVerdict(ok), { verdict: 'likely_scam', impersonating: 'PayPal', reasons: ['a', 'b', 'c'] });
  assert.deepEqual(parseVerdict({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), { declined: 'cyber' });
  assert.deepEqual(parseVerdict({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nope' }] }), { declined: 'unparseable' });
  assert.deepEqual(parseVerdict({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdict":"maybe"}' }] }), { declined: 'unparseable' });
});

test('verdicts only ever add suspicion', () => {
  assert.equal(verdictFlags({ verdict: 'likely_scam', impersonating: 'PayPal', reasons: [] }, 'Claude')[0].severity, 'hard');
  assert.equal(verdictFlags({ verdict: 'unclear', reasons: [] }, 'Claude')[0].severity, 'soft');
  assert.equal(verdictFlags({ verdict: 'likely_safe', reasons: [] }, 'Claude')[0].severity, 'info');
  assert.equal(verdictFlags({ declined: 'cyber' }, 'Claude')[0].severity, 'info');
});

test('pageFlags spots brand claims and forms that post elsewhere', () => {
  const flags = pageFlags('paypa1-secure.com', { title: 'PayPal: Log in', formHosts: ['collector.ru'] }, DEFAULT_PROTECTED);
  assert.deepEqual(flags.map((f) => f.kind), ['brand-mention', 'form-elsewhere']);
  assert.deepEqual(pageFlags('paypal.com', { title: 'PayPal: Log in', formHosts: ['paypal.com'] }, DEFAULT_PROTECTED), []);
  assert.deepEqual(pageFlags('nytimes.com', { title: 'Log in', headings: ['Subscribe'] }, DEFAULT_PROTECTED), []);
  assert.deepEqual(pageFlags('shop.example', { title: 'Checkout', hiddenPrompt: true }, DEFAULT_PROTECTED).map((f) => f.kind), ['hidden-ai-text']);
});

test('nanoFlags treats a brand that fits the domain as info', () => {
  assert.equal(nanoFlags('Chase', 'chase.com')[0].severity, 'info');
  assert.equal(nanoFlags('Wells Fargo', 'secure-verify.net')[0].severity, 'soft');
  assert.deepEqual(nanoFlags(null, 'example.com'), []);
});

test('costOf prices usage per model', () => {
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), 6);
  assert.equal(costOf('unknown', { input_tokens: 5 }), 0);
});
