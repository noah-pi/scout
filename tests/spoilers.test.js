import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatcher, buildSpoilerRequest, normalizeEntry, parseSpoilerResults, passageKey } from '../src/shared/spoilers.js';

const watchlist = [
  { title: 'Severance', watched: 'S2E3', aliases: 'Lumon, Mark Scout' },
  { title: 'The Bear', watched: '' },
];

test('normalizeEntry trims, splits aliases and drops duplicates of the title', () => {
  assert.deepEqual(normalizeEntry({ title: ' Dune ', aliases: 'dune, Arrakis,, Paul Atreides ' }), { title: 'Dune', watched: '', aliases: ['Arrakis', 'Paul Atreides'] });
});

test('matcher finds titles and aliases as whole words, in any case', () => {
  const m = buildMatcher(watchlist);
  assert.deepEqual(m.find('What happens to MARK SCOUT at lumon this week'), ['Severance']);
  assert.deepEqual(m.find('The Bear and Severance both return'), ['The Bear', 'Severance']);
  assert.deepEqual(m.find('A bearded man; unbearable severances'), []);
  assert.equal(buildMatcher([]), null);
  assert.equal(buildMatcher([{ title: ' ' }]), null);
});

test('passageKey is stable and depends on text and shows', () => {
  assert.equal(passageKey('abc', ['A']), passageKey('abc', ['A']));
  assert.notEqual(passageKey('abc', ['A']), passageKey('abd', ['A']));
  assert.notEqual(passageKey('abc', ['A']), passageKey('abc', ['B']));
});

test('request carries progress, redacted capped passages, low effort, structured output', () => {
  const req = buildSpoilerRequest('claude-haiku-5-5', [{ id: 'p1', text: `Email me at a@b.co ${'x'.repeat(2000)}`, titles: ['Severance'] }], watchlist);
  const body = JSON.parse(req.messages[0].content);
  assert.equal(body.watched_so_far.Severance, 'S2E3');
  assert.match(body.watched_so_far['The Bear'], /not specified/);
  assert.ok(body.passages[0].text.startsWith('Email me at [email]'));
  assert.ok(body.passages[0].text.length <= 700);
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.model, 'claude-haiku-5-5');
});

test('results default to hidden when missing, refused or malformed', () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"results":[{"id":"p1","spoiler":false},{"id":"zz","spoiler":false}]}' }] };
  assert.deepEqual(parseSpoilerResults(ok, ['p1', 'p2']), { p1: false, p2: true });
  assert.deepEqual(parseSpoilerResults({ stop_reason: 'refusal', content: [] }, ['p1']), { p1: true });
  assert.deepEqual(parseSpoilerResults({ content: [{ type: 'text', text: 'nope' }] }, ['p1']), { p1: true });
});

test('a bare mention is told apart from a passage', () => {
  const m = buildMatcher([{ title: 'Severance', aliases: 'Lumon' }]);
  assert.ok(m.mentionOnly('Severance'));
  assert.ok(m.mentionOnly('Severance Season 2'));
  assert.ok(m.mentionOnly('#Lumon · Severance'));
  assert.ok(!m.mentionOnly('Ms. Casey dies in the Severance finale'));
  assert.ok(!m.mentionOnly('Severance season three starts filming in March'));
});
