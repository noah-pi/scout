import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { ownerIndex, trackerFor } from '../src/shared/trackers.js';
import { listForRule } from '../src/shared/rulesets.js';
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

test('splitEasyPrivacy keeps redirects Scout has a stand-in for and drops header rewrites', () => {
  const rules = ['block', 'allow', 'modifyHeaders'].map((type, id) => ({ id, action: { type }, condition: {} }));
  rules.push({ id: 7, action: { type: 'redirect', redirect: { extensionPath: '/web_accessible_resources/noop.js' } }, condition: {} });
  rules.push({ id: 8, action: { type: 'redirect', redirect: { extensionPath: '/web_accessible_resources/missing.js' } }, condition: {} });
  const { block, allow, redirect } = splitEasyPrivacy(rules, ['noop.js']);
  assert.deepEqual([block.length, allow.length, redirect.map((r) => r.id)], [1, 1, [7]]);
});

test('every redirect points at a stand-in file Scout ships, and the folder is web-accessible', () => {
  const manifest = read('../manifest.json');
  const redirects = manifest.declarative_net_request.rule_resources.flatMap(({ path }) => read(`../${path}`)).filter((r) => r.action.type === 'redirect' && r.action.redirect.extensionPath);
  assert.ok(redirects.length >= 10, `${redirects.length} redirects`);
  for (const r of redirects) assert.ok(existsSync(new URL(`..${r.action.redirect.extensionPath}`, import.meta.url)), r.action.redirect.extensionPath);
  assert.ok(manifest.web_accessible_resources.some((w) => w.resources.includes('web_accessible_resources/*') && w.use_dynamic_url));
});

test('listForRule counts blocks and stand-ins, and nothing else', () => {
  assert.equal(listForRule({ rulesetId: 'easyprivacy', ruleId: 9 }), 'trackers');
  assert.equal(listForRule({ rulesetId: 'easylist-redirect', ruleId: 9 }), 'ads');
  assert.equal(listForRule({ rulesetId: 'surrogates', ruleId: 1 }), 'trackers');
  assert.equal(listForRule({ rulesetId: 'surrogates', ruleId: 101 }), 'ads');
  assert.equal(listForRule({ rulesetId: '_dynamic', ruleId: 20_000 }), 'trackers');
  assert.equal(listForRule({ rulesetId: 'easyprivacy-allow', ruleId: 9 }), null);
  assert.equal(listForRule({ rulesetId: 'gpc', ruleId: 1 }), null);
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

test('package.json and the manifest carry the same version', () => {
  assert.equal(read('../package.json').version, read('../manifest.json').version);
});
