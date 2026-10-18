import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThreadRequest, busiestWindow, creationCluster, duplicateClusters, isDefaultName, jaccard, parseThreadVerdict, shingles, summarize, threadEvidence,
} from '../src/shared/census.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T12:00:00Z');
const PITCH = 'Honestly I switched to NovaVPN last month and my speeds doubled, best decision I made this year';

const comments = [
  { id: 'c1', author: 'Brisk_Otter_4821', text: PITCH, at: NOW - 50 * 60_000 },
  { id: 'c2', author: 'Quiet_Lamp_1188', text: `${PITCH}!`, at: NOW - 48 * 60_000 },
  { id: 'c3', author: 'Amber_Field_7730', text: 'honestly i switched to NovaVPN last month and my speeds doubled, best decision i made all year', at: NOW - 47 * 60_000 },
  { id: 'c4', author: 'longtime_reader', text: 'Has anyone compared these against a plain WireGuard setup on a cheap VPS? I trust that more.', at: NOW - 30 * 60_000 },
  { id: 'c5', author: 'Brisk_Otter_4821', text: PITCH, at: NOW - 20 * 60_000 },
  { id: 'c6', author: 'mkt', text: 'short', at: NOW - 10 * 60_000 },
];

test('shingles and jaccard', () => {
  assert.equal(shingles('a b c d').size, 2);
  assert.equal(jaccard(shingles(PITCH), shingles(PITCH)), 1);
  assert.equal(jaccard(new Set(), shingles(PITCH)), 0);
});

test('duplicate clusters need different authors and enough words', () => {
  const clusters = duplicateClusters(comments);
  assert.equal(clusters.length, 1);
  assert.deepEqual([...clusters[0]].sort(), ['c1', 'c2', 'c3', 'c5']);
  assert.deepEqual(duplicateClusters([{ id: 'x', author: 'a', text: PITCH }, { id: 'y', author: 'a', text: PITCH }]), [], 'one author repeating isn’t coordination');
});

test('generated usernames', () => {
  assert.ok(isDefaultName('Brisk_Otter_4821'));
  assert.ok(isDefaultName('QuietLamp1188'));
  assert.ok(!isDefaultName('longtime_reader'));
  assert.ok(!isDefaultName(undefined));
});

test('busiest window counts distinct authors', () => {
  assert.equal(busiestWindow(comments).authors, 3);
  assert.equal(busiestWindow([{ author: 'a' }]).authors, 0);
});

test('creation cluster finds accounts made the same week', () => {
  const profiles = { a: { created: NOW - 40 * DAY }, b: { created: NOW - 38 * DAY }, c: { created: NOW - 36 * DAY }, d: { created: NOW - 900 * DAY } };
  assert.deepEqual(creationCluster(profiles), ['a', 'b', 'c']);
});

test('summary stays quiet on an ordinary thread', () => {
  const normal = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, author: `reader${i}`, text: `Different take number ${i} on the topic with its own wording entirely ${i * 7}`, at: NOW - i * 3_600_000 }));
  assert.equal(summarize(normal, {}, NOW).level, 'none');
});

test('summary adds up wording, youth and same-week creation', () => {
  const profiles = {
    Brisk_Otter_4821: { created: NOW - 20 * DAY, karma: 3 },
    Quiet_Lamp_1188: { created: NOW - 19 * DAY, karma: 1 },
    Amber_Field_7730: { created: NOW - 18 * DAY, karma: 5 },
    longtime_reader: { created: NOW - 3000 * DAY, karma: 40000 },
    mkt: { created: NOW - 17 * DAY, karma: 2 },
  };
  const report = summarize(comments, profiles, NOW);
  assert.equal(report.level, 'notable');
  assert.equal(report.checked, 5);
  assert.ok(report.notes.some((n) => n.includes('near-identical')));
  assert.ok(report.notes.some((n) => n.includes('under 60 days')));
  assert.ok(report.notes.some((n) => n.includes('same week')));
});

test('evidence pseudonymizes authors and redacts text', () => {
  const report = summarize(comments, {}, NOW);
  const ev = threadEvidence({ subreddit: 'r/vpn', title: 'Best VPN? email me x@y.co' }, comments, {}, report, NOW);
  assert.equal(ev.title, 'Best VPN? email me [email]');
  assert.deepEqual(ev.comments.map((c) => c.author), ['A1', 'A2', 'A3', 'A4', 'A1', 'A5']);
  assert.ok(!JSON.stringify(ev).includes('Brisk_Otter'));
  assert.equal(ev.comments[0].similar_wording_group, 1);
  assert.equal(ev.comments[3].similar_wording_group, null);
});

test('thread request uses high effort, structured output and fallbacks on Opus', () => {
  const req = buildThreadRequest('claude-opus-5-5', {});
  assert.equal(req.output_config.effort, 'high');
  assert.equal(req.fallbacks, 'default');
  assert.equal(buildThreadRequest('claude-haiku-5-5', {}).fallbacks, undefined);
});

test('parseThreadVerdict', () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"coordination":"strong","summary":"s","patterns":["a","b","c","d","e"]}' }] };
  assert.deepEqual(parseThreadVerdict(ok), { coordination: 'strong', summary: 's', patterns: ['a', 'b', 'c', 'd'] });
  assert.deepEqual(parseThreadVerdict({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }), { declined: 'cyber' });
});
