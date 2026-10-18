import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerIndex, trackerFor } from '../src/shared/trackers.js';
import { compactEntities, splitEasyPrivacy } from '../scripts/update-lists.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('every ruleset the manifest names exists, has unique ids and no regex rules', () => {
  const manifest = read('../manifest.json');
  for (const { path } of manifest.declarative_net_request.rule_resources) {
    const rules = read(`../${path}`);
    const ids = rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, path);
    assert.ok(rules.every((r) => !r.condition.regexFilter), `${path} has regex rules`);
  }
});

test('the ledger ruleset only blocks, and allow rules live apart', () => {
  assert.ok(read('../rules/easyprivacy.json').every((r) => r.action.type === 'block'));
  assert.ok(read('../rules/easyprivacy-allow.json').every((r) => r.action.type === 'allow'));
});

test('splitEasyPrivacy drops redirects and header rewrites', () => {
  const rules = ['block', 'allow', 'redirect', 'modifyHeaders'].map((type, id) => ({ id, action: { type }, condition: {} }));
  const { block, allow } = splitEasyPrivacy(rules);
  assert.deepEqual([block.length, allow.length], [1, 1]);
});

test('compactEntities keeps named owners with domains', () => {
  const out = compactEntities({ 'Acme Inc.': { displayName: 'Acme', properties: ['b.com', 'a.com', 'a.com'] }, Empty: { properties: [] } });
  assert.deepEqual(out, [['Acme', ['a.com', 'b.com']]]);
});

test('trackerFor names the company behind a host', () => {
  const owners = ownerIndex(read('../data/entities.json'));
  assert.equal(trackerFor('www.google-analytics.com', owners).company, 'Google');
  assert.equal(trackerFor('px.ads.criteo.com', owners).company, 'Criteo');
  assert.deepEqual(trackerFor('cdn.unknown-tracker.example', owners), { domain: 'unknown-tracker.example', company: 'unknown-tracker.example' });
});
