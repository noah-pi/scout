import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { intValue, oidValue, parse, readTimestampResponse, timestampRequest, OID } from '../src/shared/asn1.js';
import { buildWacz, crc32, sha256, surt, zip } from '../src/shared/wacz.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/tsa/${name}`, import.meta.url)));
const hashOf = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const NONCE = Uint8Array.of(0x9a, 1, 2, 3, 4, 5, 6, 7);

test('a timestamp request carries version 1, the SHA-256 imprint, the nonce, and asks for the certificate', async () => {
  const hash = await hashOf(fixture('sample.txt'));
  const req = parse(timestampRequest(hash, NONCE));
  const [version, imprint, nonce, certReq] = req.children;
  assert.equal(intValue(version), 1);
  assert.equal(oidValue(imprint.children[0].children[0]), OID.sha256);
  assert.deepEqual([...imprint.children[1].content], [...hash]);
  assert.deepEqual([...nonce.content], [0, ...NONCE], 'a high first byte gets a leading zero');
  assert.equal(certReq.content[0], 0xff);
});

test('a real openssl timestamp reply is read: granted, the time, and whether it answers this hash and nonce', async () => {
  const hash = await hashOf(fixture('sample.txt'));
  const read = readTimestampResponse(fixture('sample.tsr'), hash, NONCE);
  assert.equal(read.granted, true);
  assert.match(read.genTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
  assert.equal(read.matchesHash, true);
  assert.equal(read.matchesNonce, true);
  const other = readTimestampResponse(fixture('sample.tsr'), hash.map((b) => b ^ 1), Uint8Array.of(1));
  assert.deepEqual([other.matchesHash, other.matchesNonce], [false, false]);
});

test('a refused reply reads as refused', () => {
  // TimeStampResp { status { rejection(2) } }
  assert.deepEqual(readTimestampResponse(Uint8Array.of(0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02), new Uint8Array(32), NONCE), { granted: false, status: 2 });
});

test('crc32 and SURT keys match the usual values', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(surt('https://www.Example.com/A/b?Q=1'), 'com,example)/a/b?q=1');
  assert.equal(surt('http://news.example.org:8080/'), 'org,example,news:8080)/');
});

test('the WACZ is a valid zip whose manifest hashes every file', async () => {
  const html = new TextEncoder().encode('<!doctype html><title>Hi</title><p>Saved.</p>');
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const wacz = await buildWacz({ url: 'https://www.example.com/story?id=4', title: 'Hi', html, screenshot: png, capturedAt: '2026-11-26T12:00:00.000Z', software: 'Scout test' });
  const dir = mkdtempSync(join(tmpdir(), 'scout-wacz-'));
  writeFileSync(join(dir, 'page.wacz'), wacz);
  // Python's zipfile checks every CRC and the central directory.
  const listing = JSON.parse(
    execFileSync('python3', ['-c', 'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n: z.read(n).decode("latin-1") for n in z.namelist()}))', join(dir, 'page.wacz')], { encoding: 'utf8' }),
  );
  assert.deepEqual(Object.keys(listing), ['archive/data.warc', 'indexes/index.cdx', 'pages/pages.jsonl', 'datapackage.json', 'datapackage-digest.json']);
  const bytes = (name) => Uint8Array.from(listing[name], (c) => c.charCodeAt(0));
  const pkg = JSON.parse(listing['datapackage.json']);
  assert.equal(pkg.wacz_version, '1.1.1');
  for (const r of pkg.resources) assert.equal(r.hash, `sha256:${await sha256(bytes(r.path))}`, r.path);
  assert.equal(JSON.parse(listing['datapackage-digest.json']).hash, `sha256:${await sha256(bytes('datapackage.json'))}`);
  assert.match(listing['indexes/index.cdx'], /^com,example\)\/story\?id=4 20261126120000 \{/m);
  assert.match(listing['archive/data.warc'], /WARC-Target-URI: urn:screenshot:https:\/\/www\.example\.com\/story\?id=4/);
  assert.equal(listing['pages/pages.jsonl'].split('\n')[1] && JSON.parse(listing['pages/pages.jsonl'].split('\n')[1]).url, 'https://www.example.com/story?id=4');
});

test('zip stores names and contents byte for byte', () => {
  const z = zip([{ name: 'a.txt', bytes: new TextEncoder().encode('abc') }]);
  assert.deepEqual([...z.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(new TextDecoder().decode(z.subarray(30, 35)), 'a.txt');
  assert.equal(new TextDecoder().decode(z.subarray(35, 38)), 'abc');
});
