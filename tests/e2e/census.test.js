// Census against a page shaped like new Reddit (shreddit-comment elements),
// with fake profile and Messages API endpoints. Markup on the real site may
// drift; this pins what Scout expects.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer, visit } from './harness.js';

const NOW = Date.now();
const PITCH = 'Honestly I switched to NovaVPN last month and my speeds doubled, best decision I made this year';
const comment = (id, author, body, minsAgo) =>
  `<shreddit-comment author="${author}" thingid="t1_${id}" created-timestamp="${new Date(NOW - minsAgo * 60_000).toISOString()}"><div slot="comment"><p>${body}</p></div></shreddit-comment>`;

const THREAD = `<!doctype html><title>Best VPN?</title>
<shreddit-post post-title="Which VPN do you actually use?"></shreddit-post>
${comment('a', 'Brisk_Otter_4821', PITCH, 50)}
${comment('b', 'Quiet_Lamp_1188', `${PITCH}!`, 48)}
${comment('c', 'Amber_Field_7730', 'honestly i switched to NovaVPN last month and my speeds doubled, best decision i made all year', 47)}
${comment('d', 'longtime_reader', 'Has anyone compared these against a plain WireGuard setup on a cheap VPS? I trust that more.', 30)}
${comment('e', 'Pale_Moss_2210', 'Mullvad has been solid for me for years, no complaints about speed or support.', 25)}`;

const DAY = 86_400;
const ages = { Brisk_Otter_4821: 20, Quiet_Lamp_1188: 19, Amber_Field_7730: 18, longtime_reader: 3000, Pale_Moss_2210: 1400 };
const profile = (req) => {
  const name = decodeURIComponent(req.url.split('/')[2]);
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { created_utc: Math.floor(NOW / 1000) - ages[name] * DAY, total_karma: ages[name] > 100 ? 40000 : 3 } }) };
};

const calls = [];
function messages(_req, body) {
  const request = JSON.parse(body);
  calls.push(request);
  const verdict = { coordination: 'strong', summary: 'Three young accounts repeat one VPN pitch.', patterns: ['A1, A2 and A3 post the same NovaVPN line within minutes.'] };
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: JSON.stringify(verdict) }], usage: { input_tokens: 1500, output_tokens: 200 } }) };
}

const routes = { '/r/vpn/comments/x/best_vpn/': THREAD, '/v1/messages': messages };
for (const name of Object.keys(ages)) routes[`/user/${name}/about.json`] = profile;

let server, browser;
before(async () => {
  server = await startServer(routes);
  browser = await launch();
  await browser.ext.send({ type: 'saveSettings', changes: { apiKey: 'sk-ant-test', baseURL: `http://api.mock:${server.port}` } });
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('reads the thread, marks shared wording, and stays factual without lookups', async () => {
  const page = await visit(browser.context, `http://www.reddit.com:${server.port}/r/vpn/comments/x/best_vpn/`, 3500);
  const marked = await page.$$eval('[data-scout-similar]', (els) => els.map((e) => e.getAttribute('data-scout-similar')));
  assert.deepEqual(marked, ['2', '2', '2']);
  const { census } = await browser.ext.tabState();
  assert.equal(census.comments, 5);
  assert.equal(census.clusters, 1);
  assert.equal(census.checked, 0);
  assert.equal(server.seen.filter((r) => r.url.startsWith('/user/')).length, 0, 'no profile lookups until asked');
});

test('account lookups run on request and feed the report', async () => {
  const { tabId } = await browser.ext.tabState();
  const res = await browser.ext.send({ type: 'censusProfiles', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.value.checked, 5);
  await new Promise((r) => setTimeout(r, 1500));
  const { census } = await browser.ext.tabState();
  assert.equal(census.checked, 5);
  assert.equal(census.level, 'notable');
  assert.ok(census.notes.some((n) => n.includes('same week')));
});

test('pattern analysis goes to the critical-reasoning model with pseudonymous authors', async () => {
  const { tabId } = await browser.ext.tabState();
  const res = await browser.ext.send({ type: 'censusAnalyze', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.value.census.analysis.coordination, 'strong');
  const request = calls.at(-1);
  assert.equal(request.model, 'claude-opus-5-5');
  assert.equal(request.output_config.effort, 'high');
  const sent = request.messages[0].content;
  assert.ok(!sent.includes('Brisk_Otter') && !sent.includes('longtime_reader'));
  assert.equal(JSON.parse(sent).comments[0].account_age_days, 20);
});
