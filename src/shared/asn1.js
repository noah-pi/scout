// Just enough DER for RFC 3161 timestamps: building a request and reading the
// parts of a response Scout checks. Pure; shared by the worker and the tests.

export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
};

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

function length(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes = [];
  for (; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export const tlv = (tag, content) => concat([Uint8Array.of(tag), length(content.length), content]);
export const seq = (...parts) => tlv(0x30, concat(parts));
export const set = (...parts) => tlv(0x31, concat(parts));
export const octets = (bytes) => tlv(0x04, bytes);
export const bool = (v) => tlv(0x01, Uint8Array.of(v ? 0xff : 0));
export const nul = () => tlv(0x05, new Uint8Array());
export const explicit = (n, content) => tlv(0xa0 + n, content);
export const gtime = (date) => tlv(0x18, new TextEncoder().encode(date.toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z')));
export function int(value) {
  let bytes = typeof value === 'number' ? Uint8Array.of(...(value ? [] : [0]), ...(() => { const b = []; for (let n = value; n > 0; n = Math.floor(n / 256)) b.unshift(n & 0xff); return b; })()) : Uint8Array.from(value);
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && bytes[i + 1] < 0x80) i++;
  bytes = bytes.subarray(i);
  return tlv(0x02, bytes[0] >= 0x80 ? concat([Uint8Array.of(0), bytes]) : bytes);
}
export function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const body = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    body.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(body));
}

// Parses one TLV at `at`; constructed values get their children parsed too.
export function parse(bytes, at = 0) {
  const tag = bytes[at];
  let len = bytes[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error('Bad DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[start + i];
    start += n;
  }
  const end = start + len;
  if (end > bytes.length) throw new Error('Truncated DER');
  const node = { tag, start, end, content: bytes.subarray(start, end) };
  if (tag & 0x20) {
    node.children = [];
    for (let p = start; p < end; p = node.children.at(-1).end) node.children.push(parse(bytes, p));
  }
  return node;
}

export const intValue = (node) => [...node.content].reduce((n, b) => n * 256 + b, 0);
export function oidValue(node) {
  const b = node.content;
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  for (let i = 1, v = 0; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) out.push(v), (v = 0);
  }
  return out.join('.');
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// TimeStampReq (RFC 3161 §2.4.1) for a SHA-256 hash, asking for the TSA's
// certificate in the reply so the token can be checked on its own.
export const timestampRequest = (hash, nonce) => seq(int(1), seq(seq(oid(OID.sha256), nul()), octets(hash)), int(nonce), bool(true));

// Reads a TimeStampResp: whether it was granted, and whether the token is for
// this hash and nonce, and when the TSA says it saw them. The TSA's own
// signature over the token is checked by openssl (see HOW-TO-VERIFY.txt).
export function readTimestampResponse(bytes, hash, nonce) {
  const resp = parse(bytes);
  const status = intValue(resp.children[0].children[0]);
  if (status > 1 || !resp.children[1]) return { granted: false, status };
  const token = resp.children[1];
  if (oidValue(token.children[0]) !== OID.signedData) throw new Error('Not a signed timestamp token');
  const signedData = token.children[1].children[0];
  const encap = signedData.children.find((c) => c.tag === 0x30 && c.children?.[0]?.tag === 0x06);
  if (oidValue(encap.children[0]) !== OID.tstInfo) throw new Error('Not a timestamp');
  const octetString = encap.children[1].children[0];
  const tst = parse(octetString.content);
  const [, , imprint, , genTime, ...rest] = tst.children;
  const nonceNode = rest.find((c) => c.tag === 0x02);
  const time = new TextDecoder().decode(genTime.content);
  const m = time.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\.\d+)?Z$/);
  return {
    granted: true,
    status,
    genTime: m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`).toISOString() : time,
    matchesHash: same(imprint.children[1].content, hash) && oidValue(imprint.children[0].children[0]) === OID.sha256,
    matchesNonce: Boolean(nonceNode) && same(int(nonce).subarray(2), nonceNode.content),
  };
}
