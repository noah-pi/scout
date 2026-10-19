// What Scout did, for you to read back: a running activity log (the panel's
// Activity tab) and daily totals for the weekly page. Both stay on this
// machine in storage.local.

const ACTIVITY_CAP = 400;
const HISTORY_DAYS = 35;

let pending = [];
let flushTimer = null;

// kind: a short machine name ('clipboard', 'download', 'forget', ...);
// text: one plain sentence; host: where it happened.
export function logActivity({ kind, text, host = '', tone = 'info' }) {
  pending.push({ at: Date.now(), kind, text, host, tone });
  flushTimer ??= setTimeout(flush, 300);
}

async function flush() {
  flushTimer = null;
  const batch = pending;
  pending = [];
  const { activity = [] } = await chrome.storage.local.get('activity');
  await chrome.storage.local.set({ activity: [...batch.reverse(), ...activity].slice(0, ACTIVITY_CAP) });
}

export async function getActivity() {
  return (await chrome.storage.local.get('activity')).activity ?? [];
}

export const clearActivity = () => chrome.storage.local.set({ activity: [] });

// Daily totals. Counted in memory and written every few seconds, since a
// single page load can block dozens of requests.
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
let counts = null;
let countTimer = null;

// keys: e.g. ['companies', 'Google'], ['guards', 'clipboard'].
export function count(keys, n = 1) {
  counts ??= {};
  const today = (counts[day()] ??= {});
  let node = today;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  const last = keys.at(-1);
  node[last] = (node[last] ?? 0) + n;
  countTimer ??= setTimeout(saveCounts, 4000);
}

function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
    else merge((into[k] ??= {}), v);
  }
  return into;
}

async function saveCounts() {
  countTimer = null;
  const add = counts;
  counts = null;
  if (!add) return;
  const { history = {} } = await chrome.storage.local.get('history');
  for (const [d, totals] of Object.entries(add)) history[d] = merge(history[d] ?? {}, totals);
  const keep = Object.keys(history).sort().slice(-HISTORY_DAYS);
  await chrome.storage.local.set({ history: Object.fromEntries(keep.map((d) => [d, history[d]])) });
}

export async function getHistory() {
  await saveCounts();
  return (await chrome.storage.local.get('history')).history ?? {};
}
