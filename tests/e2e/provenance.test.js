// Provenance against Source Kit's sample files (signed with C2PA, then
// altered in the picture or in the credential) and a PNG carrying Stable
// Diffusion settings. Exercises c2pa-web's WASM inside the offscreen document.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, startServer, visit } from './harness.js';

const file = (name, type) => () => ({ headers: { 'content-type': type }, body: readFileSync(new URL(`../fixtures/${name}`, import.meta.url)) });

function sdPng() {
  const chunk = (type, body) => {
    const data = Buffer.from(body, 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', 'parameters\0a lighthouse at dusk\nSteps: 28, Sampler: Euler a, CFG scale: 6'), chunk('IEND', '')]);
}

let server, browser, tabId;
before(async () => {
  server = await startServer({
    '/page': '<!doctype html><title>Photos</title><img src="/sealed.jpg">',
    '/sealed.jpg': file('sealed-photo.jpg', 'image/jpeg'),
    '/altered.jpg': file('altered-photo.jpg', 'image/jpeg'),
    '/attacked.jpg': file('attacked-manifest.jpg', 'image/jpeg'),
    '/plain.jpg': () => ({ headers: { 'content-type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
    '/sd.png': () => ({ headers: { 'content-type': 'image/png' }, body: sdPng() }),
  });
  browser = await launch();
  await visit(browser.context, `http://photos.example.com:${server.port}/page`, 1000);
  ({ tabId } = await browser.ext.tabState());
});
after(async () => {
  await browser?.close();
  server?.close();
});

const check = async (path) => {
  const res = await browser.ext.send({ type: 'checkImage', tabId, url: `http://photos.example.com:${server.port}${path}` });
  assert.ok(res.ok, res.error);
  return res.value;
};

test('a sealed camera capture verifies, with the trust-list caveat', async () => {
  const r = await check('/sealed.jpg');
  assert.equal(r.tone, 'captured', JSON.stringify(r));
  assert.match(r.lines[0], /Signed by Source Kit/);
  assert.match(r.lines[1], /trust list/);
});

test('an edited picture and an edited credential are told apart', async () => {
  const altered = await check('/altered.jpg');
  assert.equal(altered.tone, 'tampered');
  assert.match(altered.headline, /picture was changed/);
  assert.match(altered.lines[0], /assertion\.dataHash\.mismatch/);

  const attacked = await check('/attacked.jpg');
  assert.equal(attacked.tone, 'tampered');
  assert.match(attacked.headline, /credential itself was altered/);
});

test('generation settings in a PNG count as an unsigned AI label', async () => {
  const r = await check('/sd.png');
  assert.equal(r.tone, 'ai');
  assert.match(r.lines[0], /Stable Diffusion/);
});

test('a bare image says nothing either way, and the panel keeps the last five', async () => {
  const r = await check('/plain.jpg');
  assert.equal(r.tone, 'none');
  const state = await browser.ext.tabState();
  assert.equal(state.images.length, 5);
  assert.equal(state.images[0].url.endsWith('/plain.jpg'), true);
});
