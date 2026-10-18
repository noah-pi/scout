// What Scout has learned about you: sites you trust and alerts you dismiss.
// Local only. Export it before reinstalling; removing the extension erases it.
import { makeTrustRecord, trustStillValid } from '../shared/trust.js';
import { DEFAULT_PROTECTED } from '../shared/tripwire.js';

async function load() {
  const { memory } = await chrome.storage.local.get('memory');
  return memory ?? { trusted: {}, dismissals: {} };
}

async function save(memory) {
  await chrome.storage.local.set({ memory });
}

export async function trust(domain, registeredAt) {
  const memory = await load();
  memory.trusted[domain] = makeTrustRecord(domain, registeredAt);
  await save(memory);
}

export async function untrust(domain) {
  const memory = await load();
  delete memory.trusted[domain];
  await save(memory);
}

export async function isTrusted(domain, currentRegisteredAt) {
  const memory = await load();
  return trustStillValid(memory.trusted[domain], currentRegisteredAt);
}

export async function dismiss(kind) {
  const memory = await load();
  memory.dismissals[kind] = (memory.dismissals[kind] ?? 0) + 1;
  await save(memory);
}

export async function dismissals() {
  return (await load()).dismissals;
}

// Sites a lookalike would imitate: the built-in list plus everything you trust.
export async function protectedDomains() {
  return [...new Set([...DEFAULT_PROTECTED, ...Object.keys((await load()).trusted)])];
}

export async function exportMemory() {
  return { version: 1, exportedAt: new Date().toISOString(), memory: await load() };
}

export async function importMemory(file) {
  if (file?.version !== 1 || !file.memory?.trusted) throw new Error('Not a Scout memory export');
  await save(file.memory);
}
