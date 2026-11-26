// Watched stories: pages you cited or chose to watch, fetched again once a day
// (without cookies) and compared with the copy Scout kept, so a headline,
// a paragraph or a quote that changes quietly is noticed. Also: what changed
// since the Internet Archive's earliest copy of a page.
import { compareSnapshots, describeChanges } from '../shared/edits.js';
import { addReceipt, updateTab } from './store.js';
import { logActivity } from './activity.js';
import { offscreen } from './escalate.js';

const DAY = 86_400_000;
const WATCH_DAYS = 90;
const MAX_WATCHED = 100;

const storyUrl = (url) => {
  const u = new URL(url);
  u.hash = '';
  return u.href;
};
const getWatched = async () => (await chrome.storage.local.get('watched')).watched ?? {};
const setWatched = (watched) => chrome.storage.local.set({ watched });
// archiveBase is for tests, which serve the archive locally.
const archiveBase = async () => (await chrome.storage.local.get('archiveBase')).archiveBase || 'https://web.archive.org';

// The list the panel shows: newest first, without the stored text.
function summary(watched) {
  return Object.values(watched)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(({ url, title, host, addedAt, checkedAt, until, error, changes = [] }) => ({ url, title, host, addedAt, checkedAt, until, error, changes: changes.slice(-10) }));
}

export function installWatch({ handlers }) {
  Object.assign(handlers, {
    async watchStory({ tabId, url }) {
      const target = url ?? (await chrome.tabs.get(tabId)).url;
      if (!/^https?:/.test(target ?? '')) throw new Error('Only web pages can be watched.');
      const key = storyUrl(target);
      const watched = await getWatched();
      if (watched[key]) return summary(watched);
      if (Object.keys(watched).length >= MAX_WATCHED) throw new Error(`Scout watches up to ${MAX_WATCHED} stories. Stop watching one first.`);
      const snap = await offscreen('storySnapshot', { url: key });
      await addReceipt({ service: new URL(key).hostname, sent: 'nothing (fetched the story without cookies)', reason: 'Watch for edits: the first copy' });
      const now = Date.now();
      watched[key] = { url: key, title: snap.headline || key, host: new URL(key).hostname, addedAt: now, checkedAt: now, until: now + WATCH_DAYS * DAY, last: snap, changes: [] };
      await setWatched(watched);
      logActivity({ kind: 'watch', host: watched[key].host, text: `Watching “${watched[key].title.slice(0, 80)}” for edits for ${WATCH_DAYS} days.` });
      return summary(watched);
    },

    async unwatchStory({ url }) {
      const watched = await getWatched();
      delete watched[storyUrl(url)];
      await setWatched(watched);
      return summary(watched);
    },

    getWatched: async () => summary(await getWatched()),

    checkWatched: ({ force } = {}) => checkWatched(Boolean(force)).then(async () => summary(await getWatched())),

    // What changed since the Internet Archive first saw this page. Sends the
    // page's address to the archive, then fetches both copies without cookies.
    async compareEarliest({ tabId }) {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tab.url ?? '')) throw new Error('Only web pages have archived copies.');
      const url = storyUrl(tab.url);
      const base = await archiveBase();
      const res = await fetch(`${base}/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=1&fl=timestamp,original&filter=statuscode:200`, { credentials: 'omit' });
      await addReceipt({ service: new URL(base).hostname, sent: url, reason: 'Changes since the earliest archived copy' });
      if (!res.ok) throw new Error(`The Internet Archive answered ${res.status}.`);
      const [, first] = (await res.json().catch(() => [])) ?? [];
      let result;
      if (!first) result = { found: false };
      else {
        const [ts, original] = first;
        const archived = `${base}/web/${ts}id_/${original}`;
        const [then, now] = await Promise.all([offscreen('storySnapshot', { url: archived }), offscreen('storySnapshot', { url })]);
        const cmp = compareSnapshots(then, now);
        const at = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
        result = { found: true, at, archived: `https://web.archive.org/web/${ts}/${original}`, ...cmp, sentence: cmp.readable ? describeChanges(cmp) : `Couldn't compare: ${cmp.reason}.` };
      }
      await updateTab(tabId, (s) => {
        if (s.url && storyUrl(s.url) === url) s.earliest = { ...result, checked: Date.now() };
        return s;
      });
      return result;
    },
  });

  chrome.alarms.get('watch-check').then((a) => a || chrome.alarms.create('watch-check', { periodInMinutes: 24 * 60, delayInMinutes: 7 }));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'watch-check') checkWatched(false).catch(() => {});
  });
}

let checking = null;
function checkWatched(force) {
  checking ??= runCheck(force).finally(() => (checking = null));
  return checking;
}

async function runCheck(force) {
  const watched = await getWatched();
  const now = Date.now();
  let fetched = 0;
  for (const entry of Object.values(watched)) {
    if (now > entry.until) continue;
    if (!force && now - (entry.checkedAt ?? 0) < 20 * 3_600_000) continue;
    if (fetched++) await new Promise((r) => setTimeout(r, 1500)); // one site at a time, gently
    try {
      const snap = await offscreen('storySnapshot', { url: entry.url });
      const cmp = compareSnapshots(entry.last, snap);
      entry.checkedAt = Date.now();
      if (!cmp.readable) {
        entry.error = `Couldn't compare: ${cmp.reason}.`;
        continue;
      }
      entry.error = null;
      if (cmp.changes.length) {
        const sentence = describeChanges(cmp);
        entry.changes = [...(entry.changes ?? []), { at: entry.checkedAt, changes: cmp.changes, stealth: cmp.stealth, sentence }].slice(-30);
        if (snap.headline) entry.title = snap.headline;
        logActivity({ kind: 'edit', host: entry.host, tone: cmp.stealth ? 'bad' : 'info', text: `A story you watch changed: “${entry.title.slice(0, 70)}”. ${sentence}` });
        chrome.notifications.create(`scout-edit-${entry.checkedAt}`, {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: cmp.stealth ? 'A story you cited changed without saying so' : 'A story you cited changed',
          message: `${entry.title.slice(0, 90)}\n${sentence}`,
          contextMessage: entry.host,
        });
      }
      entry.last = snap;
    } catch (error) {
      entry.checkedAt = Date.now();
      entry.error = `Couldn't fetch it: ${error.message ?? error}.`;
    }
  }
  await setWatched(watched);
  if (fetched) await addReceipt({ service: 'the sites you watch', sent: `nothing (fetched ${fetched} ${fetched === 1 ? 'story' : 'stories'} without cookies)`, reason: 'Daily edit check for watched stories' });
}
