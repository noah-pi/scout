import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRules } from '../scripts/build-rules.mjs';
import { trackerFor } from '../src/shared/trackers.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('rules/trackers.json is in sync with the tracker map', () => {
  assert.deepEqual(read('../rules/trackers.json'), buildRules(), 'run npm run build:rules');
});

test('every ruleset the manifest names exists and has unique ids', () => {
  const manifest = read('../manifest.json');
  for (const { path } of manifest.declarative_net_request.rule_resources) {
    const ids = read(`../${path}`).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, path);
  }
});

test('trackerFor walks up to the listed domain', () => {
  assert.equal(trackerFor('px.ads.criteo.com').company, 'Criteo');
  assert.equal(trackerFor('www.google-analytics.com').domain, 'google-analytics.com');
  assert.equal(trackerFor('example.com'), null);
});
