import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatOf, originalUrl, pngText, sniffMetadata, summarizeProvenance } from '../src/shared/provenance.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

function png(chunks) {
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const [type, body] of chunks) {
    const data = new TextEncoder().encode(body);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    parts.push(len, new TextEncoder().encode(type), data, new Uint8Array(4));
  }
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

test('formatOf', () => {
  assert.equal(formatOf(fixture('sealed-photo.jpg')), 'jpeg');
  assert.equal(formatOf(png([['IEND', '']])), 'png');
  assert.equal(formatOf(new Uint8Array(12)), 'unknown');
});

test('PNG text chunks reveal Stable Diffusion and ComfyUI settings', () => {
  const sd = png([['tEXt', 'parameters\0a castle, Steps: 30, Sampler: DPM++ 2M, CFG scale: 7'], ['IEND', '']]);
  assert.match(pngText(sd).parameters, /Steps: 30/);
  const meta = sniffMetadata(sd);
  assert.ok(meta.sdParameters);
  assert.equal(summarizeProvenance({ store: null, meta }).tone, 'ai');
  assert.ok(sniffMetadata(png([['tEXt', 'workflow\0{}'], ['IEND', '']])).comfyWorkflow);
});

test('XMP digital source type and creator tool', () => {
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" xmp:CreatorTool="Adobe Firefly"/></x:xmpmeta>';
  const bytes = Uint8Array.from([0xff, 0xd8, ...new TextEncoder().encode(xmp)]);
  const meta = sniffMetadata(bytes);
  assert.deepEqual(meta.sources, ['trainedAlgorithmicMedia']);
  assert.equal(meta.creatorTool, 'Adobe Firefly');
  assert.deepEqual(meta.generators, ['Adobe Firefly']);
  const s = summarizeProvenance({ store: null, meta });
  assert.equal(s.tone, 'ai');
  assert.match(s.lines[0], /Anyone can write or remove/);
});

const manifest = (sourceType) => ({
  active_manifest: 'm1',
  validation_state: 'Valid',
  manifests: { m1: { claim_generator: 'Source Kit/0.7.0 (com.verify.camera)', signature_info: { issuer: 'Source Kit' }, assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: `http://cv.iptc.org/newscodes/digitalsourcetype/${sourceType}` }] } }] } },
});

test('valid credentials: capture vs AI, trusted vs untrusted signer', () => {
  const trusted = summarizeProvenance({ store: { ...manifest('digitalCapture'), validation_state: 'Trusted' } });
  assert.equal(trusted.tone, 'captured');
  assert.match(trusted.lines[0], /Signed by Source Kit with Source Kit\/0\.7\.0/);
  assert.match(trusted.lines[1], /is on the C2PA trust list/);
  const selfSigned = summarizeProvenance({ store: { ...manifest('digitalCapture'), validation_status: [{ code: 'signingCredential.untrusted' }] } });
  assert.equal(selfSigned.tone, 'captured', 'an unknown signer is not tampering');
  assert.match(selfSigned.lines[1], /can't be confirmed/);
  assert.equal(summarizeProvenance({ store: manifest('trainedAlgorithmicMedia') }).tone, 'ai');
});

test('invalid credentials name what changed', () => {
  const altered = summarizeProvenance({ store: { ...manifest('digitalCapture'), validation_state: 'Invalid', validation_status: [{ code: 'signingCredential.untrusted' }, { code: 'assertion.dataHash.mismatch' }] } });
  assert.equal(altered.tone, 'tampered');
  assert.match(altered.headline, /picture was changed/);
  const attacked = summarizeProvenance({ store: { active_manifest: 'm1', manifests: {}, validation_state: 'Invalid', validation_status: [{ code: 'assertion.hashedURI.mismatch' }] } });
  assert.match(attacked.headline, /credential itself was altered/);
});

test('nothing found says so honestly', () => {
  const s = summarizeProvenance({ store: null, meta: { sources: [], generators: [] } });
  assert.equal(s.tone, 'none');
  assert.match(s.lines[0], /says nothing either way/);
});

test('originalUrl asks Google-hosted images for the original', () => {
  assert.equal(originalUrl('https://lh3.googleusercontent.com/abc123=w600-h400'), 'https://lh3.googleusercontent.com/abc123=d');
  assert.equal(originalUrl('https://lh3.googleusercontent.com/abc123=d'), null);
  assert.equal(originalUrl('https://example.com/a.jpg'), null);
});
