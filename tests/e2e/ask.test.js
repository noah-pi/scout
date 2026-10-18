// Fine print and Ask Scout against a fake shop and a fake Messages API.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const SHOP = `<!doctype html><title>Checkout</title><input autocomplete="cc-number">
<footer><a href="/legal/privacy">Privacy Policy</a> <a href="/legal/terms">Terms of Service</a></footer>`;
const PRIVACY = `<!doctype html><title>Privacy</title><nav>Menu</nav><main><h1>Privacy Policy</h1>
<p>We may sell your personal information to our advertising partners.</p>
<p>We keep your data for as long as your account exists, plus seven years.</p><p>${'Boilerplate. '.repeat(40)}</p></main>`;
const TERMS = `<!doctype html><main><h1>Terms</h1><p>Any dispute will be resolved by binding arbitration, and you waive any right to a class action.</p><p>${'More terms. '.repeat(40)}</p></main>`;

const calls = [];
function messages(_req, body) {
  const request = JSON.parse(body);
  calls.push(request);
  const isPolicy = request.output_config.format.schema.required.includes('points');
  const out = isPolicy
    ? { summary: 'They sell your data and force arbitration.', points: [
        { topic: 'sells_or_shares', verdict: 'bad', text: 'They can sell your personal information.', quote: 'We may sell your personal information to our advertising partners.' },
        { topic: 'arbitration', verdict: 'bad', text: 'Disputes go to binding arbitration.', quote: 'Any dispute will be resolved by binding arbitration' },
        { topic: 'deletion', verdict: 'good', text: 'You can delete everything instantly.', quote: 'Users may delete all data instantly at any time.' },
      ] }
    : { verdict: 'likely_scam', impersonating: 'USPS', reasons: ['Asks for a redelivery fee by link.'] };
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 3000, output_tokens: 300 } }) };
}

let server, browser, tabId;
before(async () => {
  server = await startServer({ '/checkout': SHOP, '/legal/privacy': PRIVACY, '/legal/terms': TERMS, '/v1/messages': messages });
  browser = await launch();
  await browser.ext.send({ type: 'saveSettings', changes: { apiKey: 'sk-ant-test', baseURL: `http://api.mock:${server.port}` } });
  await visit(browser.context, `http://shop.example.com:${server.port}/checkout`, 2000);
  ({ tabId } = await browser.ext.tabState());
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('fine print finds both documents, reads them without cookies, and checks every quote', async () => {
  const res = await browser.ext.send({ type: 'finePrint', tabId });
  assert.ok(res.ok, res.error);
  const fp = res.value.finePrint;
  assert.deepEqual(fp.sources.map((s) => new URL(s).pathname), ['/legal/privacy', '/legal/terms']);
  assert.deepEqual(fp.points.map((p) => p.verified), [true, true, false], 'an invented quote is caught');
  const sent = calls.at(-1).messages[0].content;
  assert.ok(sent.includes('binding arbitration') && !sent.includes('Menu'));
  assert.equal(calls.at(-1).model, 'claude-haiku-5-5');
  const fetches = server.seen.filter((r) => r.url.startsWith('/legal/'));
  assert.ok(fetches.every((r) => !r.headers.cookie));
});

test('a link check catches a disguised destination without a model call', async () => {
  const before = calls.length;
  const res = await browser.ext.send({ type: 'checkLink', tabId, url: 'http://paypal.com@203.0.113.9/login' });
  assert.ok(res.ok, res.error);
  assert.equal(res.value.tone, 'bad');
  assert.ok(res.value.lines.some((l) => /hides its real destination/.test(l)));
  assert.equal(calls.length, before);
});

test('selected text goes to the routine model and comes back as a verdict', async () => {
  const res = await browser.ext.send({ type: 'askText', tabId, text: 'USPS: your parcel is held. Pay $1.99 at usps-redeliver.top within 12 hours. Reply to 415-555-0199.' });
  assert.ok(res.ok, res.error);
  assert.match(res.value.headline, /Likely a scam, posing as USPS/);
  assert.ok(!calls.at(-1).messages[0].content.includes('415-555'), 'phone number redacted');
  const state = await browser.ext.tabState();
  assert.deepEqual(state.asked.map((a) => a.kind), ['text', 'link']);
});
