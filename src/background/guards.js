// The service-worker side of Scout's page guards and tools: what the page
// guards report, the clipboard and wallet checks, downloads, forgetting
// closed sites, session-recorder blocking, x-ray, first-visit notes, the
// "without Scout" comparison, the outlet card, evidence, citations, honest
// YouTube titles, feed time, and the update check. installGuards() adds its
// handlers to the worker's message table and wires its own listeners.
import { REPLAY, addressSwap, dateNote, darkPatternFlags, disguisedDownload, runnable } from '../shared/guards.js';
import { effectiveGuards } from '../shared/modes.js';
import { registrableDomain } from '../shared/tripwire.js';
import { addReceipt, cached, getTab, updateTab } from './store.js';
import { clearActivity, count, getActivity, getHistory, logActivity } from './activity.js';
import * as memory from './memory.js';

const REPLAY_RULE = 20_000;
const PEEK_RULE = 19_990; // and 19_991
const DAY = 86_400_000;

let guards = effectiveGuards({});
const ownNames = new Map(); // download URL -> the filename Scout chose
export const currentGuards = () => guards;

// Reading settings is all a worker wake needs: Chrome keeps dynamic rules and
// registered scripts itself, so those are written only on install and when
// a setting changes. A lighter start loses fewer early events.
async function loadGuards() {
  const { shields } = await chrome.storage.local.get('shields');
  guards = effectiveGuards(shields);
}
chrome.runtime.onInstalled.addListener(async () => {
  const { shields } = await chrome.storage.local.get('shields');
  guards = effectiveGuards(shields);
  await syncReplayRule().catch(() => {});
  await syncFarble(shields?.farble ?? []).catch(() => {});
});

// Session recorders blocked everywhere (most are on EasyPrivacy already; this
// catches the rest), unless you switch it off.
async function syncReplayRule() {
  const domains = [...new Set(REPLAY.map(([d]) => d))];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REPLAY_RULE],
    addRules: guards.replayBlock
      ? [{ id: REPLAY_RULE, priority: 1, action: { type: 'block' }, condition: { requestDomains: domains, resourceTypes: ['script', 'xmlhttprequest', 'sub_frame', 'websocket', 'ping', 'other'] } }]
      : [],
  });
}

// Fingerprint defense runs only on sites you chose, registered as a
// main-world script for exactly those sites.
async function syncFarble(sites) {
  const id = 'scout-farble';
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  const clean = sites.filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
  if (!clean.length) return;
  await chrome.scripting.registerContentScripts([
    { id, js: ['dist/farble.js'], matches: clean.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]), runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true },
  ]);
}

export function installGuards({ handlers, mergeFlags, reassess, atUrl, getShields }) {
  loadGuards().catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.shields) return;
    const before = guards;
    guards = effectiveGuards(changes.shields.newValue);
    if (before.replayBlock !== guards.replayBlock) syncReplayRule().catch(() => {});
    if (JSON.stringify(changes.shields.oldValue?.farble ?? []) !== JSON.stringify(changes.shields.newValue?.farble ?? [])) syncFarble(changes.shields.newValue?.farble ?? []).catch(() => {});
  });

  const flagTab = (sender, fn) =>
    updateTab(sender.tab.id, async (current) => {
      const state = await atUrl(current, sender.tab.url);
      await fn(state);
      return reassess(sender.tab.id, state);
    });

  Object.assign(handlers, {
    // What the page guard saw. Sanitized; the page can write anything here.
    async guardFacts({ facts }, sender) {
      if (!sender.tab || !facts) return;
      const str = (s, n = 80) => String(s ?? '').slice(0, n);
      const clean = {
        unwrapped: Math.min(Number(facts.unwrapped) || 0, 9999),
        replay: (facts.replay ?? []).slice(0, 6).map((v) => str(v, 40)),
        affiliates: { total: Math.min(Number(facts.affiliates?.total) || 0, 9999), networks: Object.fromEntries(Object.entries(facts.affiliates?.networks ?? {}).slice(0, 12).map(([k, v]) => [str(k, 30), Number(v) || 0])) },
        email: { messages: Number(facts.email?.messages) || 0, names: (facts.email?.names ?? []).slice(0, 8).map((n) => str(n, 40)) },
        dates: facts.dates ? { published: Number(facts.dates.published) || null, modified: Number(facts.dates.modified) || null } : null,
        dark: facts.dark ? { timers: Number(facts.dark.timers) || 0, scarcity: (facts.dark.scarcity ?? []).slice(0, 3).map((t) => str(t)), prechecked: (facts.dark.prechecked ?? []).slice(0, 3).map((t) => str(t, 60)), shaming: (facts.dark.shaming ?? []).slice(0, 2).map((t) => str(t)) } : null,
      };
      return flagTab(sender, (state) => {
        const before = state.guard ?? {};
        if (clean.unwrapped > (before.unwrapped ?? 0)) count(['guards', 'unwrapped'], clean.unwrapped - (before.unwrapped ?? 0));
        for (const v of clean.replay) if (!(before.replay ?? []).includes(v)) count(['guards', 'replay']);
        if (clean.email.messages > (before.email?.messages ?? 0)) count(['guards', 'email'], clean.email.messages - (before.email?.messages ?? 0));
        state.guard = { ...clean, replayBlocked: guards.replayBlock };
        const flags = [];
        if (clean.replay.length && !guards.replayBlock) {
          const stakes = state.stakes?.password || state.stakes?.payment;
          flags.push({ kind: 'session-replay', severity: stakes ? 'soft' : 'info', text: `This page records your clicks and typing (${clean.replay.join(', ')})${stakes ? ' on a page that asks for a password or card' : ''}.` });
        }
        const note = clean.dates ? dateNote(clean.dates) : null;
        if (note) flags.push({ kind: 'date', severity: 'info', text: note.text });
        flags.push(...darkPatternFlags(clean.dark));
        state.flags = mergeFlags(state.flags.filter((f) => !/^(dark:|date$|session-replay$)/.test(f.kind)), flags);
        // Who runs a news site, looked up on its own if you asked for that.
        if (guards.outletAuto && clean.dates && !state.outlet && !state.outletQueued) {
          state.outletQueued = true;
          setTimeout(() => handlers.outlet({ tabId: sender.tab.id }).catch(() => {}), 0);
        }
      });
    },

    async clipboardCommand({ command, blocked }, sender) {
      if (!sender.tab) return;
      const host = new URL(sender.tab.url).hostname;
      count(['guards', blocked ? 'clipboard-blocked' : 'clipboard-noted']);
      logActivity({ kind: 'clipboard', host, tone: blocked ? 'bad' : 'info', text: blocked ? `Stopped a fake-CAPTCHA page from putting a command on your clipboard (${String(command).slice(0, 40)}…).` : `A page copied a command to your clipboard (${String(command).slice(0, 40)}…). Allowed: the page didn't look like a fake CAPTCHA.` });
      return flagTab(sender, (state) => {
        state.flags = mergeFlags(state.flags, [
          blocked
            ? { kind: 'clipboard-command', severity: 'hard', always: true, text: 'This page tried to put a command on your clipboard, the fake-CAPTCHA malware trick. Scout stopped it. Don\'t paste anything it asks you to run.' }
            : { kind: 'clipboard-command', severity: 'info', text: `This page copied a command to your clipboard: ${String(command).slice(0, 60)}…` },
        ]);
      });
    },

    async notificationPrompt(_, sender) {
      if (!sender.tab || !guards.notifications) return;
      const host = new URL(sender.tab.url).hostname;
      count(['guards', 'notifications']);
      logActivity({ kind: 'notifications', host, text: 'Held back a notification prompt that came before you did anything on the page.' });
      return flagTab(sender, (state) => {
        state.flags = mergeFlags(state.flags, [{ kind: 'notification-prompt', severity: 'info', text: 'Held back a notification prompt that arrived before you clicked anything.' }]);
      });
    },

    // Wallet addresses: remember what you copied (in memory for this browser
    // session only) and compare it with what you paste.
    async copiedAddress({ text }) {
      await chrome.storage.session.set({ lastAddress: { text: String(text).slice(0, 100), at: Date.now() } });
    },
    async checkPaste({ text }, sender) {
      const { lastAddress } = await chrome.storage.session.get('lastAddress');
      if (!lastAddress || Date.now() - lastAddress.at > 30 * 60_000) return null;
      const swap = addressSwap(lastAddress.text, text);
      if (!swap) return null;
      const host = sender.tab ? new URL(sender.tab.url).hostname : '';
      count(['guards', 'address-swap']);
      logActivity({ kind: 'address', host, tone: 'bad', text: `The ${swap.kind} address you pasted didn't match the one you copied.` });
      if (sender.tab) await flagTab(sender, (state) => void (state.flags = mergeFlags(state.flags, [{ kind: 'address-swap', severity: 'hard', always: true, text: swap.text }])));
      return { ...swap, copied: lastAddress.text };
    },

    // X-ray: outline on the page what Scout blocked, hid or marked.
    async xray({ tabId, on }) {
      const state = await getTab(tabId);
      const { xrayTabs = [] } = await chrome.storage.session.get('xrayTabs');
      const next = on ?? !xrayTabs.includes(tabId);
      await chrome.storage.session.set({ xrayTabs: next ? [...new Set([...xrayTabs, tabId])] : xrayTabs.filter((t) => t !== tabId) });
      const blocked = Object.values(
        Object.fromEntries((state.requests ?? []).map((r) => [`${r.list}:${r.host}`, { host: r.host, company: r.company, list: r.list }])),
      );
      await chrome.tabs.sendMessage(tabId, { type: 'xray', on: next, blocked }).catch(() => {});
      return { on: next };
    },
    async xrayClosed(_, sender) {
      if (!sender.tab) return;
      const { xrayTabs = [] } = await chrome.storage.session.get('xrayTabs');
      await chrome.storage.session.set({ xrayTabs: xrayTabs.filter((t) => t !== sender.tab.id) });
      await chrome.tabs.sendMessage(sender.tab.id, { type: 'xray', on: false }).catch(() => {});
    },

    // See the page as it would be without Scout: a temporary allow rule for
    // this site, a reload, and a restore when you say so or leave the site.
    async peek({ tabId, on }) {
      const state = await getTab(tabId);
      if (!state.host) throw new Error('No site on this tab.');
      const domain = registrableDomain(state.host);
      if (on) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [PEEK_RULE, PEEK_RULE + 1],
          addRules: [
            { id: PEEK_RULE, priority: 1000, action: { type: 'allowAllRequests' }, condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] } },
            { id: PEEK_RULE + 1, priority: 1000, action: { type: 'allow' }, condition: { initiatorDomains: [domain] } },
          ],
        });
        await chrome.storage.local.set({ peek: { domain, tabId, at: Date.now() } });
        // The network applies new rules a moment after the call resolves.
        await new Promise((resolve) => setTimeout(resolve, 250));
        chrome.alarms.create('peek-restore', { delayInMinutes: 5 });
        logActivity({ kind: 'peek', host: state.host, text: 'Showed this site without Scout, for comparison.' });
      } else {
        await endPeek(false);
      }
      await chrome.tabs.reload(tabId);
      return { on: Boolean(on), domain };
    },

    // Who runs this site, from Wikidata. Sends only the site's domain.
    async outlet({ tabId }) {
      const state = await getTab(tabId);
      if (!state.host) throw new Error('No site on this tab.');
      const domain = registrableDomain(state.host);
      const card = await cached(`outlet:${domain}`, 30 * DAY, async () => {
        const result = await wikidataOutlet(domain);
        await addReceipt({ service: 'query.wikidata.org', sent: domain, reason: 'Who runs this site?' });
        return result;
      });
      await updateTab(tabId, (s) => {
        if (s.host === state.host) s.outlet = { ...card, domain };
        return s;
      });
      return card;
    },

    // Evidence: the page's HTML and a screenshot, hashed and signed with a
    // key that never leaves this browser, saved to Downloads.
    async saveEvidence({ tabId }) {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tab.url ?? '')) throw new Error('Only web pages can be saved as evidence.');
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const [{ result: html }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => `<!-- saved by Scout from ${location.href} -->\n${document.documentElement.outerHTML}` });
      const htmlBytes = new TextEncoder().encode(html);
      const pngBytes = Uint8Array.from(atob(shot.split(',')[1]), (c) => c.charCodeAt(0));
      const record = {
        url: tab.url,
        title: tab.title,
        capturedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        files: { 'page.html': await sha256(htmlBytes), 'screenshot.png': await sha256(pngBytes) },
        note: 'The screenshot shows the visible part of the page only. Hashes are SHA-256, hex. The signature is ECDSA P-256 with SHA-256 over this JSON without the "signature" field, keys sorted.',
      };
      const { publicJwk, sign } = await evidenceKey();
      record.publicKey = publicJwk;
      record.signature = await sign(canonical(record));
      const folder = `Scout evidence/${new URL(tab.url).hostname} ${record.capturedAt.replace(/[:.]/g, '-')}`;
      const save = (name, url) => {
        ownNames.set(url, `${folder}/${name}`);
        return chrome.downloads.download({ url, filename: `${folder}/${name}`, conflictAction: 'uniquify', saveAs: false });
      };
      await save('page.html', `data:text/html;base64,${base64(htmlBytes)}`);
      await save('screenshot.png', shot);
      await save('evidence.json', `data:application/json;base64,${base64(new TextEncoder().encode(JSON.stringify(record, null, 2)))}`);
      logActivity({ kind: 'evidence', host: new URL(tab.url).hostname, text: `Saved signed evidence of ${tab.title?.slice(0, 60) || tab.url}.` });
      return { folder, hashes: record.files };
    },

    // A citation with a fresh Wayback Machine copy. Sends the page's address
    // to the Internet Archive, which is the point.
    async cite({ tabId }) {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tab.url ?? '')) throw new Error('Only web pages can be cited.');
      const [{ result: meta }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const m = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || '';
          return { site: m('meta[property="og:site_name"]'), author: m('meta[name="author"]') || m('meta[property="article:author"]'), title: m('meta[property="og:title"]') || document.title };
        },
      });
      const state = await getTab(tabId);
      let archived = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45_000);
        const res = await fetch(`https://web.archive.org/save/${tab.url}`, { credentials: 'omit', signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok && /\/web\/\d{14}/.test(res.url)) archived = res.url;
      } catch {}
      if (!archived) {
        const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(tab.url)}`, { credentials: 'omit' }).catch(() => null);
        archived = (await res?.json().catch(() => null))?.archived_snapshots?.closest?.url ?? null;
      }
      await addReceipt({ service: 'web.archive.org', sent: tab.url, reason: 'Cite with archive' });
      const date = (t) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const published = state.guard?.dates?.published;
      const parts = [
        meta.author && `${meta.author}.`,
        `“${meta.title || tab.title}.”`,
        `${meta.site || new URL(tab.url).hostname.replace(/^www\./, '')}${published ? `, ${date(published)}` : ''}.`,
        tab.url + '.',
        archived ? `Archived ${date(Date.now())} at ${archived}.` : `Accessed ${date(Date.now())}; the Internet Archive didn't return a copy.`,
      ];
      logActivity({ kind: 'cite', host: new URL(tab.url).hostname, text: archived ? 'Archived the page and copied a citation.' : 'Copied a citation; the archive was unavailable.' });
      return { text: parts.filter(Boolean).join(' '), archived };
    },

    // Honest titles on YouTube, from DeArrow's crowd-sourced titles. Only a
    // four-character prefix of each video ID's hash leaves the browser.
    async dearrow({ ids }) {
      if (!guards.honestTitles) return {};
      const clean = [...new Set((ids ?? []).map(String).filter((id) => /^[\w-]{11}$/.test(id)))].slice(0, 40);
      const out = {};
      const byPrefix = new Map();
      for (const id of clean) {
        const prefix = (await sha256(new TextEncoder().encode(id))).slice(0, 4);
        byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), id]);
      }
      let fetched = 0;
      for (const [prefix, vids] of byPrefix) {
        const data = await cached(`dearrow:${prefix}`, DAY, async () => {
          fetched++;
          const res = await fetch(`https://sponsor.ajay.app/api/branding/${prefix}`, { credentials: 'omit' });
          return res.ok ? res.json() : {};
        }).catch(() => ({}));
        for (const id of vids) {
          const best = data?.[id]?.titles?.find((t) => !t.original && (t.locked || t.votes >= 0));
          if (best?.title) out[id] = best.title.replace(/(^|\s)>(\S)/g, '$1$2').slice(0, 200);
        }
      }
      if (fetched) await dailyReceipt('sponsor.ajay.app', 'hash prefixes of YouTube video IDs', 'Honest titles (DeArrow)');
      return out;
    },

    // Feed time: counted while a feed tab is visible.
    async feedTick({ seconds }, sender) {
      if (!sender.tab || !guards.feedLimit) return { limit: 0 };
      const domain = registrableDomain(new URL(sender.tab.url).hostname);
      const day = new Date().toISOString().slice(0, 10);
      const { feedTime = {} } = await chrome.storage.local.get('feedTime');
      const today = feedTime.day === day ? feedTime : { day, sites: {}, snooze: {} };
      today.sites[domain] = (today.sites[domain] ?? 0) + Math.min(Number(seconds) || 0, 60);
      await chrome.storage.local.set({ feedTime: today });
      return { total: today.sites[domain], limit: guards.feedLimit * 60, snoozeUntil: today.snooze?.[domain] ?? 0 };
    },
    async feedSnooze({ minutes }, sender) {
      const domain = registrableDomain(new URL(sender.tab.url).hostname);
      const { feedTime } = await chrome.storage.local.get('feedTime');
      if (!feedTime) return;
      feedTime.snooze = { ...feedTime.snooze, [domain]: Date.now() + Math.min(Number(minutes) || 5, 30) * 60_000 };
      await chrome.storage.local.set({ feedTime });
      logActivity({ kind: 'feed', host: domain, text: `Took ${minutes} more minutes on ${domain} past your daily limit.` });
    },
    async feedLeave(_, sender) {
      if (sender.tab) await chrome.tabs.update(sender.tab.id, { url: 'chrome://newtab' }).catch(() => chrome.tabs.remove(sender.tab.id));
    },

    getActivity: () => getActivity(),
    clearActivity: () => clearActivity(),
    getHistory: () => getHistory(),
    openReport: () => chrome.tabs.create({ url: chrome.runtime.getURL('src/report/report.html') }),
    async checkUpdate() {
      await updateCheck(true);
      return (await chrome.storage.local.get('update')).update ?? null;
    },
  });

  // ---- Downloads: pause the disguised and the risky, then ask. ------------
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    // Listening here would otherwise override the names Scout gives its own
    // files (evidence), so those are named here.
    const own = item.byExtensionId === chrome.runtime.id && ownNames.get(item.url);
    if (own) {
      ownNames.delete(item.url);
      suggest({ filename: own, conflictAction: 'uniquify' });
      return;
    }
    suggest();
    if (!guards.downloads) return;
    (async () => {
      const disguised = disguisedDownload(item.filename);
      let reason = disguised;
      if (!reason && runnable(item.filename)) {
        const tabs = await chrome.tabs.query({});
        const referrer = item.referrer ? new URL(item.referrer).hostname : '';
        for (const t of tabs) {
          const state = await getTab(t.id);
          if (state.host && state.host === referrer && state.level === 'stop') reason = `It's a program, from a page Scout warned you about (${referrer}).`;
        }
      }
      if (!reason) return;
      await chrome.downloads.pause(item.id).catch(() => {});
      const host = (() => {
        try {
          return new URL(item.finalUrl || item.url).hostname;
        } catch {
          return '';
        }
      })();
      count(['guards', 'downloads']);
      logActivity({ kind: 'download', host, tone: 'bad', text: `Paused a download: ${reason}` });
      chrome.notifications.create(`scout-dl-${item.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Scout paused a download',
        message: reason,
        contextMessage: host,
        buttons: [{ title: 'Delete it' }, { title: 'Keep downloading' }],
        requireInteraction: true,
        priority: 2,
      });
    })().catch(() => {});
  });
  chrome.notifications.onButtonClicked.addListener((id, button) => {
    if (!id.startsWith('scout-dl-')) return;
    const downloadId = Number(id.slice(9));
    if (button === 0) chrome.downloads.cancel(downloadId).then(() => chrome.downloads.erase({ id: downloadId })).catch(() => {});
    else chrome.downloads.resume(downloadId).catch(() => {});
    chrome.notifications.clear(id);
  });

  // ---- First-visit notes --------------------------------------------------
  chrome.webNavigation.onCompleted.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0 || !/^https?:/.test(url) || guards.toasts === 'off') return;
    setTimeout(() => firstVisitNote(tabId, url, getShields).catch(() => {}), 2500);
  });

  // ---- Alarms: peek restore, forgetting closed sites, update check --------
  // Created once: re-creating an alarm on every worker wake resets its timer.
  chrome.alarms.get('update-check').then((a) => a || chrome.alarms.create('update-check', { periodInMinutes: 24 * 60, delayInMinutes: 3 }));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'peek-restore') endPeek(true).catch(() => {});
    if (alarm.name === 'update-check') updateCheck().catch(() => {});
    if (alarm.name.startsWith('forget:')) forget(alarm.name.slice(7)).catch(() => {});
  });
  chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    const { peek } = await chrome.storage.local.get('peek');
    if (peek?.tabId === tabId && /^https?:/.test(url) && registrableDomain(new URL(url).hostname) !== peek.domain) endPeek(false).catch(() => {});
  });

  return {
    // Called with a tab's last state as it closes.
    async onTabClosed(tabId, state) {
      const { peek } = await chrome.storage.local.get('peek');
      if (peek?.tabId === tabId) await endPeek(false);
      if (!guards.forgetOnClose || !state?.host) return;
      const domain = registrableDomain(state.host);
      if (await memory.isTrusted(domain)) return;
      chrome.alarms.create(`forget:${domain}`, { delayInMinutes: 1 });
    },
  };
}

async function endPeek(reload) {
  const { peek } = await chrome.storage.local.get('peek');
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PEEK_RULE, PEEK_RULE + 1] });
  await chrome.storage.local.remove('peek');
  await new Promise((resolve) => setTimeout(resolve, 250));
  chrome.alarms.clear('peek-restore');
  if (reload && peek?.tabId) chrome.tabs.reload(peek.tabId).catch(() => {});
}

// A minute after its last tab closes, a site's cookies and storage go,
// unless you've since gone back.
async function forget(domain) {
  const open = (await chrome.tabs.query({})).some((t) => {
    try {
      return registrableDomain(new URL(t.url).hostname) === domain;
    } catch {
      return false;
    }
  });
  if (open || (await memory.isTrusted(domain))) return;
  const origins = ['https', 'http'].flatMap((p) => [`${p}://${domain}`, `${p}://www.${domain}`]);
  await chrome.browsingData.remove({ origins }, { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true });
  count(['guards', 'forgotten']);
  logActivity({ kind: 'forget', host: domain, text: `Forgot ${domain}: cookies and site storage cleared after you closed it.` });
}

async function firstVisitNote(tabId, url, getShields) {
  const guards = currentGuards();
  const state = await getTab(tabId);
  if (!state.host || state.url !== url) return;
  const domain = registrableDomain(state.host);
  const shields = await getShields();
  if (shields.paused.includes(domain)) return;
  if (guards.toasts === 'first') {
    const { seenSites = [] } = await chrome.storage.local.get('seenSites');
    if (seenSites.includes(domain)) return;
    await chrome.storage.local.set({ seenSites: [domain, ...seenSites].slice(0, 3000) });
  } else {
    const { seenThisSession = [] } = await chrome.storage.session.get('seenThisSession');
    if (seenThisSession.includes(domain)) return;
    await chrome.storage.session.set({ seenThisSession: [domain, ...seenThisSession].slice(0, 500) });
  }
  const trackers = Object.values(state.trackers ?? {});
  const blocked = trackers.reduce((n, t) => n + t.blocked, 0);
  const rows = [];
  if (blocked) rows.push(['Trackers blocked', `${blocked} · ${trackers.length} ${trackers.length === 1 ? 'company' : 'companies'}`]);
  if (state.ads) rows.push(['Ads blocked', String(state.ads)]);
  if (state.consent && !state.consent.failed) rows.push(['Cookie banner', `${state.consent.cosmetic ? 'Hidden' : 'Rejected'} · ${state.consent.cmp}`]);
  if (state.guard?.replay?.length) rows.push(['Session recording', `${guards.replayBlock ? 'Blocked' : 'Seen'} · ${state.guard.replay[0]}`]);
  const hidden = Object.values(state.calm?.hidden ?? {}).reduce((a, b) => a + b, 0) + (state.calm?.folded ?? 0);
  if (hidden) rows.push(['Calm', `${hidden} hidden`]);
  if (state.guard?.affiliates?.total) rows.push(['Affiliate links', String(state.guard.affiliates.total)]);
  if (rows.length) await chrome.tabs.sendMessage(tabId, { type: 'toast', rows: rows.slice(0, 5) }).catch(() => {});
}

// A quiet daily look at the repo's manifest for a newer version.
async function updateCheck(force = false) {
  const { update } = await chrome.storage.local.get('update');
  if (!force && update?.checkedAt && Date.now() - update.checkedAt < 20 * 3_600_000) return;
  try {
    const res = await fetch('https://raw.githubusercontent.com/noah-pi/scout/main/manifest.json', { cache: 'no-store', credentials: 'omit' });
    const latest = (await res.json()).version;
    const current = chrome.runtime.getManifest().version;
    const newer = isNewer(latest, current);
    await chrome.storage.local.set({ update: { latest, current, newer, checkedAt: Date.now() } });
  } catch {
    await chrome.storage.local.set({ update: { ...(update ?? {}), checkedAt: Date.now(), error: true } });
  }
}

export function isNewer(latest, current) {
  const a = String(latest).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

async function dailyReceipt(service, sent, reason) {
  const key = `receipt:${service}:${new Date().toISOString().slice(0, 10)}`;
  if ((await chrome.storage.session.get(key))[key]) return;
  await chrome.storage.session.set({ [key]: true });
  await addReceipt({ service, sent, reason });
}

async function wikidataOutlet(domain) {
  const sites = ['https', 'http'].flatMap((p) => ['', 'www.'].flatMap((w) => ['', '/'].map((s) => `<${p}://${w}${domain}${s}>`))).join(' ');
  const query = `SELECT ?item ?itemLabel ?itemDescription ?founded ?wiki
    (GROUP_CONCAT(DISTINCT ?ownerName; separator="|") AS ?owners)
    (GROUP_CONCAT(DISTINCT ?parentName; separator="|") AS ?parents)
    (GROUP_CONCAT(DISTINCT ?countryName; separator="|") AS ?countries)
    (GROUP_CONCAT(DISTINCT ?typeName; separator="|") AS ?types)
    (GROUP_CONCAT(DISTINCT ?leanName; separator="|") AS ?leanings)
    WHERE {
      VALUES ?site { ${sites} }
      ?item wdt:P856 ?site .
      OPTIONAL { ?item wdt:P571 ?founded . }
      OPTIONAL { ?item wdt:P127 ?owner . ?owner rdfs:label ?ownerName . FILTER(LANG(?ownerName) = "en") }
      OPTIONAL { ?item wdt:P749 ?parent . ?parent rdfs:label ?parentName . FILTER(LANG(?parentName) = "en") }
      OPTIONAL { ?item wdt:P17 ?country . ?country rdfs:label ?countryName . FILTER(LANG(?countryName) = "en") }
      OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeName . FILTER(LANG(?typeName) = "en") }
      OPTIONAL { ?item wdt:P1387 ?lean . ?lean rdfs:label ?leanName . FILTER(LANG(?leanName) = "en") }
      OPTIONAL { ?wiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } GROUP BY ?item ?itemLabel ?itemDescription ?founded ?wiki LIMIT 3`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { credentials: 'omit', headers: { accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}.`);
  const row = (await res.json()).results.bindings[0];
  if (!row) return { found: false };
  const list = (k) => (row[k]?.value ? row[k].value.split('|').filter(Boolean) : []);
  const types = list('types');
  const state = types.some((t) => /state media|state-owned|government agency|public broadcaster|state broadcaster/i.test(t));
  return {
    found: true,
    name: row.itemLabel?.value,
    about: row.itemDescription?.value ?? '',
    founded: row.founded?.value ? new Date(row.founded.value).getUTCFullYear() : null,
    owners: list('owners'),
    parents: list('parents'),
    countries: list('countries'),
    types: types.slice(0, 4),
    leanings: list('leanings'),
    state,
    wikipedia: row.wiki?.value ?? null,
    wikidata: row.item?.value ?? null,
  };
}

// ---- Small crypto helpers ---------------------------------------------------
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const canonical = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);

async function evidenceKey() {
  let { evidenceKey: stored } = await chrome.storage.local.get('evidenceKey');
  if (!stored) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    stored = { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), createdAt: Date.now() };
    await chrome.storage.local.set({ evidenceKey: stored });
  }
  const key = await crypto.subtle.importKey('jwk', stored.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return {
    publicJwk: stored.publicJwk,
    sign: async (text) => base64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(text)))),
  };
}
