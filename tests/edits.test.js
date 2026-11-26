import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, describeChanges, quotesIn } from '../src/shared/edits.js';

const P = [
  'The city council voted on Tuesday to approve the new housing plan after a long debate.',
  '“We have no intention of raising rents for existing tenants,” said the deputy mayor, Ana Ruiz.',
  'Opponents said the plan would push longtime residents out of the neighborhood within five years.',
  'The vote was 7 to 2, with two members absent, and the plan takes effect in March.',
];
const snap = (over = {}) => ({ headline: 'Council approves housing plan', description: 'A long debate ends.', byline: 'Jo Lee', modified: '2026-11-01T10:00:00Z', paragraphs: P, ...over });

test('an unchanged story has no changes, even with different quote marks and spacing', () => {
  const again = snap({ paragraphs: P.map((p) => p.replace(/[“”]/g, '"').replace(/ /g, '  ')) });
  const cmp = compareSnapshots(snap(), again);
  assert.equal(cmp.readable, true);
  assert.deepEqual(cmp.changes, []);
  assert.equal(describeChanges(cmp), 'No changes.');
});

test('a quiet edit: headline, an edited paragraph, a removed quote, and the updated date left alone', () => {
  const edited = [P[0], P[2].replace('within five years', 'over time'), P[3]];
  const cmp = compareSnapshots(snap(), snap({ headline: 'Council passes housing plan', paragraphs: edited }));
  assert.equal(cmp.readable, true);
  assert.equal(cmp.stealth, true);
  assert.deepEqual(cmp.changes.find((c) => c.field === 'headline'), { field: 'headline', before: 'Council approves housing plan', after: 'Council passes housing plan' });
  const body = cmp.changes.find((c) => c.field === 'body');
  assert.equal(body.edited.length, 1);
  assert.match(body.edited[0].after, /over time/);
  assert.equal(body.removed.length, 1);
  assert.deepEqual(cmp.changes.find((c) => c.field === 'quotes').removed, ['We have no intention of raising rents for existing tenants,']);
  assert.match(describeChanges(cmp), /^Changed: the headline, 2 paragraphs and 1 quote removed\. The page’s updated date didn’t move\.$/);
});

test('an edit the page dates is not called stealth', () => {
  const cmp = compareSnapshots(snap(), snap({ headline: 'Council passes plan', modified: '2026-11-02T09:00:00Z' }));
  assert.equal(cmp.stealth, false);
  assert.equal(cmp.dateMoved, true);
});

test('a paywall or a redesign is not reported as edits', () => {
  assert.equal(compareSnapshots(snap(), snap({ paragraphs: [P[0]] })).readable, false);
  const other = ['Subscribe now to keep reading our journalism, from just one dollar a week.', 'Already a subscriber? Sign in to continue reading this story today.', 'Our newsletters bring you the best of the week in your inbox, every Sunday.'];
  assert.equal(compareSnapshots(snap(), snap({ paragraphs: other })).readable, false);
});

test('quotes of twenty characters or more are found', () => {
  assert.deepEqual(quotesIn(['He said "yes" and then “this is a long enough quote to keep.”']), ['this is a long enough quote to keep.']);
});
