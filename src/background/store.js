// Storage helpers. Per-tab state lives in storage.session (gone when Chrome
// closes); memory, cache and receipts live in storage.local.

const RECEIPT_CAP = 500;

// The service worker gets many events per page load (every blocked tracker),
// so updates to one tab are chained to avoid read-modify-write races.
const chains = new Map();

export function emptyTab(url) {
  const host = url ? new URL(url).hostname : '';
  return { url, host, committedAt: url ? Date.now() : null, trackers: {}, fingerprinting: [], stakes: {}, flags: [], consent: null, level: 'quiet', escalate: null };
}

export async function getTab(tabId) {
  const key = `tab:${tabId}`;
  return (await chrome.storage.session.get(key))[key] ?? emptyTab('');
}

export function updateTab(tabId, fn) {
  const key = `tab:${tabId}`;
  const next = (chains.get(tabId) ?? Promise.resolve()).then(async () => {
    const current = (await chrome.storage.session.get(key))[key] ?? emptyTab('');
    const updated = (await fn(current)) ?? current;
    await chrome.storage.session.set({ [key]: updated });
    return updated;
  });
  chains.set(tabId, next.catch(() => {}));
  return next;
}

export async function dropTab(tabId) {
  chains.delete(tabId);
  await chrome.storage.session.remove(`tab:${tabId}`);
}

export async function cached(key, ttlMs, load) {
  const entry = (await chrome.storage.local.get(`cache:${key}`))[`cache:${key}`];
  if (entry && Date.now() - entry.at < ttlMs) return entry.value;
  const value = await load();
  await chrome.storage.local.set({ [`cache:${key}`]: { at: Date.now(), value } });
  return value;
}

// Every request that leaves the browser on Scout's behalf gets a receipt:
// what service, what was sent, and why.
export async function addReceipt({ service, sent, reason, dryRun = false }) {
  const { receipts = [] } = await chrome.storage.local.get('receipts');
  receipts.unshift({ at: Date.now(), service, sent, reason, dryRun });
  await chrome.storage.local.set({ receipts: receipts.slice(0, RECEIPT_CAP) });
}

export async function getReceipts() {
  return (await chrome.storage.local.get('receipts')).receipts ?? [];
}
