import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolicyRequest, parsePolicy, policyLinks } from '../src/shared/fineprint.js';
import { linkFindings } from '../src/shared/links.js';

test('policyLinks prefers link text, resolves relative URLs, privacy first', () => {
  const links = [
    { text: 'Blog', href: '/blog' },
    { text: 'Terms of Service', href: '/legal/terms' },
    { text: 'Privacy', href: '/legal/privacy' },
    { text: 'Datenschutzerklärung', href: '/de/ds' },
    { text: 'Read about our privacy-first newsletter, which is great and long', href: '/news' },
  ];
  assert.deepEqual(policyLinks(links, 'https://shop.example/checkout'), ['https://shop.example/legal/privacy', 'https://shop.example/legal/terms']);
  assert.deepEqual(policyLinks([{ text: '利用規約', href: 'https://ex.jp/kiyaku' }], 'https://ex.jp/'), ['https://ex.jp/kiyaku']);
  assert.deepEqual(policyLinks([{ text: 'Privacy', href: 'javascript:void(0)' }], 'https://a.b/'), []);
});

const docs = [{ url: 'https://shop.example/privacy', text: 'We may sell your personal information to advertising partners. Contact privacy@shop.example. You can opt out at any time.' }];

test('policy request redacts and uses structured output', () => {
  const req = buildPolicyRequest('claude-haiku-5-5', 'shop.example', docs);
  assert.ok(req.messages[0].content.includes('[email]'));
  assert.ok(!req.messages[0].content.includes('privacy@shop.example'));
  assert.equal(req.output_config.format.type, 'json_schema');
});

test('quotes are checked against the real text', () => {
  const out = {
    summary: 'They sell data.',
    points: [
      { topic: 'sells_or_shares', verdict: 'bad', text: 'They sell your data.', quote: 'We may sell your personal information to advertising partners.' },
      { topic: 'opt_out', verdict: 'good', text: 'You can opt out.', quote: 'You may opt out by mailing a notarized letter.' },
    ],
  };
  const parsed = parsePolicy({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }, docs);
  assert.deepEqual(parsed.points.map((p) => p.verified), [true, false]);
  assert.deepEqual(parsePolicy({ stop_reason: 'refusal', stop_details: { category: 'x' } }, docs), { declined: 'x' });
});

test('link findings', () => {
  assert.deepEqual(linkFindings('https://www.nytimes.com/section').findings, []);
  const sneaky = linkFindings('http://paypal.com@203.0.113.9/login');
  assert.ok(sneaky.findings.some((f) => f.severity === 'hard' && /hides its real destination/.test(f.text)));
  assert.ok(sneaky.findings.some((f) => /bare IP/.test(f.text)));
  assert.ok(linkFindings('https://bit.ly/3abc').findings.some((f) => /shortened/.test(f.text)));
  assert.ok(linkFindings('https://secure-paypal.com.verify.example/x').findings.some((f) => f.severity === 'hard'));
});
