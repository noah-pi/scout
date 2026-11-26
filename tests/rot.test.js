import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STALE_MISSES, expectations, recordVisit, staleRules } from '../src/shared/rot.js';
import { validateRules } from '../src/shared/pagerules.js';

const rules = validateRules(JSON.parse(readFileSync(new URL('../data/page-rules.json', import.meta.url), 'utf8')));
const DAY = 86_400_000;

test('only rules written for a site are expected to match there', () => {
  assert.deepEqual(expectations(rules, 'www.youtube.com', '/').map((e) => e.key), ['shorts']);
  assert.deepEqual(expectations(rules, 'www.example.com', '/'), []);
  assert.ok(expectations(rules, 'www.google.com', '/search').some((e) => e.key === 'aiOverviews'));
  assert.ok(!expectations(rules, 'www.google.com', '/maps').some((e) => e.key === 'aiOverviews'));
  assert.ok(expectations(rules, 'old.reddit.com', '/r/x/comments/1/t/').some((e) => e.key === 'census-reddit'));
  assert.ok(!expectations(rules, 'www.example.com', '/').some((e) => e.key === 'chat'), 'a rule for every site says nothing when it misses');
});

test('a rule goes stale only after many misses over two weeks, and one hit clears it', () => {
  const t0 = Date.UTC(2026, 10, 1);
  let h = {};
  for (let i = 0; i < STALE_MISSES; i++) h = recordVisit(h, 'shorts', 'Hide YouTube Shorts', false, t0 + i * 3_600_000);
  assert.deepEqual(staleRules(h, t0 + 2 * DAY), [], 'not two weeks yet');
  assert.equal(staleRules(h, t0 + 15 * DAY)[0].key, 'shorts');
  h = recordVisit(h, 'shorts', 'Hide YouTube Shorts', true, t0 + 15 * DAY);
  assert.deepEqual(staleRules(h, t0 + 16 * DAY), []);
});
