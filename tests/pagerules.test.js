import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labelMatcher, siteMatches, validateRules } from '../src/shared/pagerules.js';

const bundled = JSON.parse(readFileSync(new URL('../data/page-rules.json', import.meta.url), 'utf8'));

test('the bundled rules validate without losing anything', () => {
  const v = validateRules(bundled);
  assert.deepEqual(Object.keys(v.calm), Object.keys(bundled.calm));
  for (const [k, rule] of Object.entries(bundled.calm)) assert.equal(v.calm[k].selectors.length, (rule.selectors ?? []).length, k);
  assert.deepEqual(Object.keys(v.aiLabels.platforms), ['YouTube', 'Instagram', 'Facebook', 'Threads', 'TikTok', 'Pinterest']);
});

test('validation rejects junk and drops what it cannot use', () => {
  assert.throws(() => validateRules({}), /bad version/);
  assert.throws(() => validateRules({ version: '2' }), /bad version/);
  const v = validateRules(
    { version: 2, calm: { 'bad key!': {}, ok: { sites: ['*'], selectors: ['.a', '', 'x'.repeat(400), '<<<'], behavior: 'rm -rf' } }, aiLabels: { texts: ['AI info', 42], platforms: { Nope: { sites: [] , container: 'article' } } } },
    (s) => s !== '<<<',
  );
  assert.deepEqual(Object.keys(v.calm), ['ok']);
  assert.deepEqual(v.calm.ok.selectors, ['.a']);
  assert.equal(v.calm.ok.behavior, undefined);
  assert.deepEqual(v.aiLabels.texts, ['AI info']);
  assert.deepEqual(v.aiLabels.platforms, {});
});

test('site patterns', () => {
  assert.ok(siteMatches('youtube.com', 'www.youtube.com'));
  assert.ok(siteMatches('youtube.com', 'm.youtube.com'));
  assert.ok(!siteMatches('youtube.com', 'notyoutube.com'));
  assert.ok(siteMatches('google.*', 'www.google.com'));
  assert.ok(siteMatches('google.*', 'www.google.co.uk'));
  assert.ok(siteMatches('google.*', 'www.google.de'));
  assert.ok(!siteMatches('google.*', 'google.evil.example'));
  assert.ok(siteMatches('*', 'anything.example'));
});

test('labels match whole short text only', () => {
  const m = labelMatcher(['AI info', 'Altered or synthetic content']);
  assert.ok(m('AI info'));
  assert.ok(m('  ai   INFO '));
  assert.ok(m('Altered or synthetic content'));
  assert.ok(!m('More AI info about this topic'));
  assert.ok(!m(''));
});
