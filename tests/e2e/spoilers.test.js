import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const PAGE = `<!doctype html><title>TV news</title>
<p id="spoil">In the Severance finale, Mark Scout finally learns that Ms. Casey dies in the testing floor.</p>
<p id="clean">Severance season three starts filming in March, Apple says.</p>
<p id="other">The weather in Lisbon is mild this week.</p>
<script>setTimeout(() => { const p = document.createElement('p'); p.id = 'late'; p.textContent = 'Lumon fans: Helly dies at the end of episode nine.'; document.body.append(p); }, 1500);</script>`;

const calls = [];
function messages(_req, body) {
  const request = JSON.parse(body);
  calls.push(request);
  const { passages } = JSON.parse(request.messages[0].content);
  // Stand-in judgment: anything with a death in it is a spoiler.
  const results = passages.map((p) => ({ id: p.id, spoiler: /dies/.test(p.text) }));
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: JSON.stringify({ results }) }], usage: { input_tokens: 400, output_tokens: 60 } }),
  };
}

const classes = (page) =>
  page.evaluate(() => Object.fromEntries(['spoil', 'clean', 'other', 'late'].map((id) => [id, document.getElementById(id)?.className ?? null])));

let server, browser;
before(async () => {
  server = await startServer({ '/tv': PAGE, '/v1/messages': messages });
  browser = await launch();
  await browser.ext.send({ type: 'saveSettings', changes: { cloud: true, apiKey: 'sk-ant-test', baseURL: `http://api.mock:${server.port}` } });
  await browser.ext.send({ type: 'saveSpoilers', spoilers: { enabled: true, mode: 'ai', entries: [{ title: 'Severance', watched: 'S2E3', aliases: 'Lumon, Mark Scout' }] } });
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('hides spoilers, reveals clean mentions, catches late content, and reveals on click', async () => {
  const page = await visit(browser.context, `http://tv.example.com:${server.port}/tv`, 4000);
  assert.deepEqual(await classes(page), { spoil: 'scout-spoiler', clean: '', other: '', late: 'scout-spoiler' });
  assert.match(await page.textContent('#spoil .scout-spoiler-label'), /Spoiler: Severance/);

  const request = calls[0];
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.equal(JSON.parse(request.messages[0].content).watched_so_far.Severance, 'S2E3');

  await page.click('#spoil');
  assert.equal((await classes(page)).spoil, '');

  const state = await browser.ext.tabState();
  assert.equal(state.spoilersHidden, 2);
});

test('verdicts are cached: a reload makes no new calls', async () => {
  const before = calls.length;
  const page = await visit(browser.context, `http://tv.example.com:${server.port}/tv`, 4000);
  assert.equal(calls.length, before);
  assert.equal((await classes(page)).spoil, 'scout-spoiler');
});

test('keyword mode hides every mention without asking a model', async () => {
  await browser.ext.send({ type: 'saveSpoilers', spoilers: { enabled: true, mode: 'keyword', entries: [{ title: 'Severance', aliases: 'Lumon' }] } });
  const before = calls.length;
  const page = await visit(browser.context, `http://tv2.example.com:${server.port}/tv`, 3000);
  const c = await classes(page);
  assert.equal(c.spoil, 'scout-spoiler');
  assert.equal(c.clean, 'scout-spoiler');
  assert.equal(c.other, '');
  assert.equal(calls.length, before);
});
