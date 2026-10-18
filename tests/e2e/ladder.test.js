// The cloud tiers against a fake Messages API: the quick check fires on a
// login page with mixed signals, Investigate sends visible text, and nothing
// typed into the page leaves it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const PHISH = `<!doctype html><title>PayPal: Log in to your account</title>
<meta name="description" content="Secure login. Contact help@shop-help.example or 212-555-0100.">
<h1>Confirm your account</h1>
<form action="https://collector.example-drop.net/p"><label for="e">Email</label><input id="e" name="email" value="victim@example.com">
<input type="password" name="pw"></form><p>Your account will be suspended in 24 hours.</p>`;

const calls = [];
function messages(_req, body) {
  const request = JSON.parse(body);
  calls.push(request);
  const deep = request.output_config.format.schema.required.includes('summary');
  const verdict = { verdict: 'likely_scam', impersonating: 'PayPal', reasons: ['Claims PayPal on an unrelated domain.'], ...(deep ? { summary: 'A fake PayPal login.' } : {}) };
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: JSON.stringify(verdict) }], usage: { input_tokens: 900, output_tokens: 120 } }),
  };
}

let server, browser;
before(async () => {
  server = await startServer({ '/login': PHISH, '/v1/messages': messages });
  browser = await launch();
  await browser.ext.send({ type: 'saveSettings', changes: { cloud: true, apiKey: 'sk-ant-test', baseURL: `http://api.mock:${server.port}` } });
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('mixed signals escalate to a quick check on the routine model', async () => {
  await visit(browser.context, `http://www.example-shop.com:${server.port}/login`, 4000);
  const state = await browser.ext.tabState();
  assert.deepEqual(state.flags.filter((f) => f.severity !== 'info').map((f) => f.kind), ['brand-mention', 'form-elsewhere', 'Claude:likely_scam']);
  assert.equal(state.level, 'stop');

  const quick = calls[0];
  assert.equal(quick.model, 'claude-haiku-5-5');
  assert.equal(quick.output_config.effort, 'low');
  assert.equal(quick.fallbacks, undefined, 'Haiku has no server-side fallback');
  const sent = quick.messages[0].content;
  assert.ok(!sent.includes('victim@example.com'), 'typed values never leave the page');
  assert.ok(!sent.includes('help@shop-help.example') && !sent.includes('212-555'), 'redacted');
  assert.ok(!('page_text' in JSON.parse(sent)));
});

test('Investigate uses the critical-reasoning model and never feeds it an earlier verdict', async () => {
  const { tabId } = await browser.ext.tabState();
  const res = await browser.ext.send({ type: 'investigate', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.value.investigation.summary, 'A fake PayPal login.');

  const deep = calls.at(-1);
  assert.equal(deep.model, 'claude-opus-5-5');
  assert.equal(deep.output_config.effort, 'high');
  assert.equal(deep.fallbacks, 'default');
  const evidence = JSON.parse(deep.messages[0].content);
  assert.ok(evidence.page_text.includes('suspended in 24 hours'));
  assert.ok(evidence.local_signals.every((s) => !s.startsWith('Claude')));
  assert.deepEqual(evidence.page.form_targets, ['example-drop.net']);

  const panel = await browser.ext.panel(tabId);
  assert.equal(panel.spend.calls, 2);
  assert.ok(panel.receipts.some((r) => r.service === 'claude (claude-opus-5-5)'));
});
