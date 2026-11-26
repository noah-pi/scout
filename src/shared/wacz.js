// A one-page web archive in the WACZ 1.1.1 format (Webrecorder), which
// ReplayWeb.page and other archive tools open: the page as you saw it (its
// HTML after scripts ran) and a screenshot, in a WARC file, with an index, a
// page list and a manifest of SHA-256 hashes. Pure: bytes in, bytes out.
import { concat } from './asn1.js';

const enc = new TextEncoder();
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

// ---- ZIP, stored (uncompressed), as WACZ asks for the archive ------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

export function zip(files, date = new Date()) {
  const { time, day } = dosTime(date);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const header = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, day, 2], [14, crc, 4], [18, bytes.length, 4], [22, bytes.length, 4], [26, nameBytes.length, 2], [28, 0, 2]].forEach(([at, v, n]) => (n === 4 ? header.setUint32(at, v, true) : header.setUint16(at, v, true)));
    locals.push(new Uint8Array(header.buffer), nameBytes, bytes);
    const entry = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, day, 2], [16, crc, 4], [20, bytes.length, 4], [24, bytes.length, 4], [28, nameBytes.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]].forEach(([at, v, n]) => (n === 4 ? entry.setUint32(at, v, true) : entry.setUint16(at, v, true)));
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  const dir = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, dir.length, 4], [16, offset, 4], [20, 0, 2]].forEach(([at, v, n]) => (n === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
  return concat([...locals, dir, new Uint8Array(end.buffer)]);
}

// ---- WARC 1.1 ------------------------------------------------------------
async function warcRecord({ type, uri, date, contentType, body, id }) {
  const digest = `sha256:${await sha256(body)}`;
  const head = [
    'WARC/1.1',
    `WARC-Type: ${type}`,
    `WARC-Record-ID: <urn:uuid:${id}>`,
    `WARC-Date: ${date}`,
    ...(uri ? [`WARC-Target-URI: ${uri}`] : []),
    `WARC-Block-Digest: ${digest}`,
    ...(type === 'resource' ? [`WARC-Payload-Digest: ${digest}`] : []),
    `Content-Type: ${contentType}`,
    `Content-Length: ${body.length}`,
  ].join('\r\n');
  return { bytes: concat([enc.encode(`${head}\r\n\r\n`), body, enc.encode('\r\n\r\n')]), digest };
}

// The URL in SURT form, the sort key archive indexes use.
export function surt(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\d*\./, '').split('.').reverse().join(',');
  return `${host}${u.port ? `:${u.port}` : ''})${(u.pathname + u.search).toLowerCase()}`;
}

const stamp14 = (iso) => iso.replace(/[-:T]/g, '').slice(0, 14);

// page: { url, title, html (bytes), screenshot (PNG bytes), capturedAt (ISO) }
export async function buildWacz({ url, title, html, screenshot, capturedAt, software, uuid = () => crypto.randomUUID() }) {
  const date = capturedAt.replace(/\.\d+Z$/, 'Z');
  const records = [
    { type: 'warcinfo', contentType: 'application/warc-fields', body: enc.encode(`software: ${software}\r\nformat: WARC File Format 1.1\r\nconformsTo: http://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/\r\ndescription: The page as rendered in the browser (its HTML after scripts ran) and a screenshot of the visible part, saved by Scout.\r\n`) },
    { type: 'resource', uri: url, contentType: 'text/html; charset=utf-8', body: html, mime: 'text/html' },
    { type: 'resource', uri: `urn:screenshot:${url}`, contentType: 'image/png', body: screenshot, mime: 'image/png' },
  ];
  const parts = [];
  const index = [];
  let offset = 0;
  for (const r of records) {
    const { bytes, digest } = await warcRecord({ ...r, date, id: uuid() });
    if (r.uri) {
      const key = r.uri.startsWith('urn:') ? r.uri : surt(r.uri);
      index.push(`${key} ${stamp14(date)} ${JSON.stringify({ url: r.uri, mime: r.mime, digest, length: String(bytes.length), offset: String(offset), filename: 'data.warc' })}`);
    }
    parts.push(bytes);
    offset += bytes.length;
  }
  const warc = concat(parts);
  const cdx = enc.encode(index.sort().join('\n') + '\n');
  const pages = enc.encode(`${JSON.stringify({ format: 'json-pages-1.0', id: 'pages', title: 'All Pages' })}\n${JSON.stringify({ id: (await sha256(enc.encode(url + date))).slice(0, 10), url, title, ts: date })}\n`);
  const files = [
    { name: 'archive/data.warc', bytes: warc },
    { name: 'indexes/index.cdx', bytes: cdx },
    { name: 'pages/pages.jsonl', bytes: pages },
  ];
  const resources = [];
  for (const f of files) resources.push({ name: f.name.split('/').pop(), path: f.name, hash: `sha256:${await sha256(f.bytes)}`, bytes: f.bytes.length });
  const datapackage = enc.encode(JSON.stringify({ profile: 'data-package', wacz_version: '1.1.1', title: title || url, created: date, software, mainPageUrl: url, mainPageDate: date, resources }, null, 2));
  const digest = enc.encode(JSON.stringify({ path: 'datapackage.json', hash: `sha256:${await sha256(datapackage)}` }, null, 2));
  return zip([...files, { name: 'datapackage.json', bytes: datapackage }, { name: 'datapackage-digest.json', bytes: digest }], new Date(capturedAt));
}
