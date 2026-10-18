// Runs Scout's model calls: Claude through the Anthropic SDK, and Gemini Nano
// through Chrome's Prompt API. It lives in an offscreen document so the 300 KB
// SDK stays out of the service worker, and so slow calls outlive the worker's
// idle timer.
import { Anthropic } from '../../dist/anthropic.js';
import { Context, Reader, createC2pa } from '../../dist/c2pa.js';
import { sniffMetadata } from '../shared/provenance.js';

function describe(error) {
  if (error instanceof Anthropic.AuthenticationError) return { kind: 'auth', message: 'The API key was rejected.' };
  if (error instanceof Anthropic.PermissionDeniedError) return { kind: 'permission', message: error.message };
  if (error instanceof Anthropic.RateLimitError) return { kind: 'rate', message: 'Rate limited; try again shortly.' };
  if (error instanceof Anthropic.BadRequestError) return { kind: 'bad-request', message: error.message };
  if (error instanceof Anthropic.APIConnectionError) return { kind: 'network', message: 'Could not reach the API.' };
  if (error instanceof Anthropic.APIError) return { kind: 'api', message: `API error ${error.status}: ${error.message}` };
  return { kind: 'unknown', message: String(error?.message ?? error) };
}

async function claude({ apiKey, baseURL, request }) {
  // dangerouslyAllowBrowser: the key is yours and lives only in this
  // extension's local storage; there is no server to proxy through.
  const client = new Anthropic({ apiKey, baseURL: baseURL || undefined, dangerouslyAllowBrowser: true, maxRetries: 1 });
  return client.beta.messages.create(request);
}

async function nanoAvailability() {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return await LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

async function nanoPrompt({ system, prompt, schema }) {
  if ((await nanoAvailability()) !== 'available') return null;
  const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: system }] });
  try {
    return JSON.parse(await session.prompt(prompt, { responseConstraint: schema }));
  } finally {
    session.destroy();
  }
}

// c2pa-web starts its worker from a blob: URL, which extension pages may not
// load, and only accepts a replacement URL over https. Hand it the packaged
// copy of the same worker instead.
const C2PA_WORKER = chrome.runtime.getURL('dist/c2pa/c2pa_worker.js');
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
  constructor(url, options) {
    const s = String(url);
    super(s.startsWith('blob:') || s.startsWith('data:') ? C2PA_WORKER : url, s.startsWith('blob:') || s.startsWith('data:') ? { ...options, type: 'module' } : options);
  }
};

let c2paReady = null;
const c2pa = () =>
  (c2paReady ??= WebAssembly.compileStreaming(fetch(chrome.runtime.getURL('dist/c2pa/c2pa_bg.wasm'))).then((wasmSrc) => createC2pa({ wasmSrc })));

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

// Fetches an image and returns its bytes' metadata plus any C2PA manifest
// store. Runs here, not in the page, so the page never sees the check.
async function readImage({ url }) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Couldn't fetch the image (HTTP ${res.status}).`);
  const blob = await res.blob();
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image is too large to check.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let store = null;
  let c2paError = null;
  try {
    const reader = await Reader.fromBlob(await c2pa(), blob.type || undefined, blob, new Context({ verify: { verifyTrust: false } }));
    if (reader) {
      store = await reader.manifestStore();
      await reader.free();
    }
  } catch (error) {
    c2paError = String(error?.message ?? error);
  }
  return { url, type: blob.type, size: blob.size, store, c2paError, head: Array.from(bytes.subarray(0, 16)), meta: sniffMetadata(bytes) };
}

const ops = { claude, nanoAvailability, nanoPrompt, readImage };

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.target !== 'offscreen' || !ops[message.op]) return false;
  ops[message.op](message.args ?? {})
    .then((value) => reply({ ok: true, value }))
    .catch((error) => reply({ ok: false, error: describe(error) }));
  return true;
});
