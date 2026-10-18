import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerIndex, trackerFor } from '../src/shared/trackers.js';
import { compactEntities, parseUBlacklist, splitEasyPrivacy } from '../scripts/update-lists.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('every ruleset the manifest names exists and has unique ids', () => {
  const manifest = read('../manifest.json');
  for (const { path } of manifest.declarative_net_request.rule_resources) {
    const ids = read(`../${path}`).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, path);
  }
});

test('the ledger rulesets only block, and allow rules live apart', () => {
  for (const list of ['easyprivacy', 'easylist']) {
    assert.ok(read(`../rules/${list}.json`).every((r) => r.action.type === 'block'), list);
    assert.ok(read(`../rules/${list}-allow.json`).every((r) => r.action.type === 'allow'), list);
  }
});

test('regex rules stay well under Chrome\'s limit', () => {
  const manifest = read('../manifest.json');
  const regex = manifest.declarative_net_request.rule_resources.flatMap(({ path }) => read(`../${path}`)).filter((r) => r.condition.regexFilter);
  assert.ok(regex.length <= 10, `${regex.length} regex rules`);
  assert.ok(regex.every((r) => r.condition.regexFilter.length < 2000));
});

test('parseUBlacklist reads match patterns and regexes', () => {
  assert.deepEqual(parseUBlacklist('# c\n*://*.slop.ai/*\n*://plain.com/*\n/pinterest.+\\/bot/\n'), { domains: ['plain.com', 'slop.ai'], patterns: ['pinterest.+\\/bot'] });
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
