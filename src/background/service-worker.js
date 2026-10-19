import { assess } from '../shared/ladder.js';
import { ownerIndex, trackerFor } from '../shared/trackers.js';
import { registrableDomain } from '../shared/tripwire.js';
import { addReceipt, dropTab, emptyTab, getReceipts, getTab, updateTab } from './store.js';
import { ageFlags, localFlags, registrationOf } from './tripwire.js';
import * as memory from './memory.js';
import { analyzeThread, askAboutText, checkSpoilers, escalate, investigate, nanoStatus, offscreen, readFinePrint } from './escalate.js';
import { policyLinks } from '../shared/fineprint.js';
import { linkFindings } from '../shared/links.js';
import { auditAll } from '../shared/extensions.js';
import { shopFlags } from '../shared/shops.js';
import { validateRules } from '../shared/pagerules.js';
import { ageInDays } from '../shared/tripwire.js';
import { originalUrl, summarizeProvenance } from '../shared/provenance.js';
import { getSpend, publicSettings, saveSettings } from './settings.js';
import { pageFlags } from '../shared/assessment.js';
import { normalizeEntry } from '../shared/spoilers.js';
import { GUARD_KEYS, MODES, effectiveGuards } from '../shared/modes.js';
import { evalSnippets, filterCompactRules } from '../../dist/consent-lib.js';
import { currentGuards, installGuards } from './guards.js';
import { count, logActivity } from './activity.js';

// Reject everything a banner offers; cosmetic rules hide banners that can't be
// answered. Heuristic detection stays off: it guesses at buttons.
const CONSENT_CONFIG = { autoAction: 'optOut', enableCosmeticRules: true };

// Large data files load on first use, keeping service-worker start-up short.
// A slow start is when Chrome drops early tracker events.
const loadJson = (path) => fetch(chrome.runtime.getURL(path)).then((res) => res.json());
let consentRules = null;
const loadConsentRules = () => (consentRules ??= loadJson('dist/consent-rules.json'));
let owners = null;
const loadOwners = () => (owners ??= loadJson('data/entities.json').then(ownerIndex));

// Chrome's own count of blocks on a tab, to catch matches that arrived while
// the worker was starting. Rate-limited by Chrome, so cached briefly.
const blockCounts = new Map();
async function blockedSince(tabId, since) {
  const cached = blockCounts.get(tabId);
  if (cached && cached.since === since && Date.now() - cached.at < 15_000) return cached.count;
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId, minTimeStamp: since });
    const count = rulesMatchedInfo.filter((m) => m.rule.rulesetId === 'easyprivacy').length;
    blockCounts.set(tabId, { since, at: Date.now(), count });
    return count;
  } catch {
    return cached?.count ?? null;
  }
}

// What Chrome itself is doing. Extensions can read whether Safe Browsing is on,
// but not whether it's the Enhanced mode, so the panel links to the setting.
async function chromeProtection() {
  try {
    const { value } = await chrome.privacy.services.safeBrowsingEnabled.get({});
    return { safeBrowsing: value };
  } catch {
    return { safeBrowsing: null };
  }
}

const BADGE = {
  quiet: { text: '', color: '#00000000' },
  note: { text: '•', color: '#A4741C' },
  stop: { text: '!', color: '#C03527' },
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Page rules (calm layer, AI labels) refresh daily from the public repo.
// One request, no personal data; the result is validated before use.
const PAGE_RULES_URL = 'https://raw.githubusercontent.com/noah-pi/scout/main/data/page-rules.json';

async function refreshPageRules(force = false) {
  const { pageRules, pageRulesUrl } = await chrome.storage.local.get(['pageRules', 'pageRulesUrl']);
  if (!force && pageRules?.fetchedAt && Date.now() - pageRules.fetchedAt < 20 * 3_600_000) return pageRules;
  const url = pageRulesUrl || PAGE_RULES_URL; // pageRulesUrl is for tests
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 200_000) throw new Error('too large');
    const rules = validateRules(JSON.parse(text));
    const bundledVersion = (await (await fetch(chrome.runtime.getURL('data/page-rules.json'))).json()).version;
    if (rules.version < bundledVersion) throw new Error('older than the bundled rules');
    const next = { rules, fetchedAt: Date.now(), from: url };
    await chrome.storage.local.set({ pageRules: next });
    await addReceipt({ service: new URL(url).hostname, sent: 'nothing (fetched page-rules.json)', reason: 'Daily page-rules refresh' });
    return next;
  } catch (error) {
    await chrome.storage.local.set({ pageRules: { ...(pageRules ?? {}), fetchedAt: Date.now(), error: String(error.message ?? error) } });
    return null;
  }
}

// Created once: re-creating an alarm on every worker wake resets its timer.
chrome.alarms.get('page-rules').then((a) => a || chrome.alarms.create('page-rules', { periodInMinutes: 24 * 60, delayInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'page-rules') refreshPageRules();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'scout-image', title: 'Check image with Scout', contexts: ['image'] });
  chrome.contextMenus.create({ id: 'scout-link', title: 'Check this link with Scout', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'scout-text', title: 'Is this a scam? Ask Scout', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // Opening the panel needs the click's user gesture, so it comes first.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  if (info.menuItemId === 'scout-image' && info.srcUrl) handlers.checkImage({ tabId: tab.id, url: info.srcUrl }).catch(() => {});
  if (info.menuItemId === 'scout-link' && info.linkUrl) handlers.checkLink({ tabId: tab.id, url: info.linkUrl }).catch(() => {});
  if (info.menuItemId === 'scout-text' && info.selectionText) handlers.askText({ tabId: tab.id, text: info.selectionText }).catch(() => {});
});

function addAsked(tabId, entry) {
  return updateTab(tabId, (s) => {
    s.asked = [entry, ...(s.asked ?? [])].slice(0, 6);
    return s;
  }).then(() => entry);
}

const hasAiHints = (meta) => Boolean(meta?.sources?.length || meta?.sdParameters || meta?.comfyWorkflow || meta?.aigcLabel || meta?.generators?.length);

async function freshTab(url, committedAt) {
  const state = emptyTab(url);
  if (committedAt) state.committedAt = Math.floor(committedAt);
  state.flags = await localFlags(state.host);
  return state;
}

// onCommitted can fire before a cold-starting service worker is listening,
// so messages from the page also carry its URL. If the state doesn't know the
// page yet, fill it in and keep whatever was already recorded for it.
async function atUrl(state, url, timeOrigin) {
  if (!url || !/^https?:/.test(url)) return state;
  const host = new URL(url).hostname;
  if (state.host === host) return state;
  const fresh = await freshTab(url, timeOrigin);
  if (!state.host) {
    fresh.trackers = state.trackers;
    fresh.fingerprinting = state.fingerprinting;
    fresh.stakes = state.stakes;
    fresh.consent = state.consent;
    fresh.flags.push(...state.flags.filter((f) => f.kind === 'fingerprinting'));
  }
  return fresh;
}

async function reassess(tabId, state) {
  const domain = state.host ? registrableDomain(state.host) : null;
  const trusted = domain && (await memory.isTrusted(domain, state.registeredAt));
  const flags = trusted ? [] : state.flags;
  const result = assess({ stakes: state.stakes, flags, dismissals: await memory.dismissals() });

  const why = flags.find((f) => f.severity === 'hard');
  // Guards that stop a page log their own, more specific entry.
  if (result.level === 'stop' && state.level !== 'stop' && state.host && !why?.always) {
    logActivity({ kind: 'warning', host: state.host, tone: 'bad', text: `Warned you: ${why?.text ?? 'this page looks dangerous.'}` });
    count(['guards', 'warnings']);
  }
  state.level = result.level;
  state.escalate = result.escalate;
  state.trusted = Boolean(trusted);
  setBadge(tabId, state);
  return state;
}

// Notes and stops always show. In Watchful mode a quiet page shows how many
// requests Scout blocked, in gray.
function setBadge(tabId, state) {
  let badge = BADGE[state.level];
  if (state.level === 'quiet' && currentGuards().badgeCount) {
    const n = Object.values(state.trackers ?? {}).reduce((a, t) => a + t.blocked, 0) + (state.ads ?? 0);
    if (n) badge = { text: n > 999 ? '999+' : String(n), color: '#6E6E73' };
  }
  chrome.action.setBadgeText({ tabId, text: badge.text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
}

// Replaces flags of the same kind, so a re-check updates its note in place.
function mergeFlags(flags, added) {
  const kinds = new Set(added.map((f) => f.kind));
  return [...flags.filter((f) => !kinds.has(f.kind)), ...added];
}

// Adds flags to a tab, unless it has since moved to another site.
function applyFlags(tabId, host) {
  return (added) =>
    updateTab(tabId, async (state) => {
      if (state.host !== host) return state;
      state.flags = mergeFlags(state.flags, added);
      return reassess(tabId, state);
    });
}

// Tiers 2 and 3 run at most once per page, after the stakes are known.
function maybeEscalate(tabId, state) {
  if (state.escalate !== 'tier3' || state.escalated) return state;
  state.escalated = true;
  const page = state.page ?? {};
  queueMicrotask(() => escalate(structuredClone(state), page, applyFlags(tabId, state.host)).catch(() => {}));
  return state;
}

// Shields: on/off switches and sites where blocking is paused.
const SHIELD_DEFAULTS = { slop: true, paused: [], calm: {}, aiLabels: true, mode: 'balanced', guards: {}, farble: [] };
const PAUSE_RULE_BASE = 10_000;

function pauseRules(domain, id) {
  return [
    { id, priority: 1000, action: { type: 'allowAllRequests' }, condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] } },
    { id: id + 1, priority: 1000, action: { type: 'allow' }, condition: { initiatorDomains: [domain] } },
  ];
}

async function getShields() {
  const { shields } = await chrome.storage.local.get('shields');
  return { ...SHIELD_DEFAULTS, ...shields };
}

// A paused site gets two high-priority rules: allowAllRequests for its
// frames, and a plain allow for anything it initiates. Chrome sometimes
// issues a page's requests without tying them to its tab (tabId -1), which
// the first rule alone would miss.
async function syncPauseRules(paused) {
  const existing = (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= PAUSE_RULE_BASE && r.id < PAUSE_RULE_BASE + 9000).map((r) => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing,
    addRules: paused.slice(0, 4499).flatMap((domain, i) => pauseRules(domain, PAUSE_RULE_BASE + 2 * i)),
  });
  await rulesSettle();
}

// updateDynamicRules resolves a moment before the network applies the new
// rules; a reload in that window would still be blocked.
const rulesSettle = () => new Promise((resolve) => setTimeout(resolve, 250));

async function pageRulesSummary() {
  const { pageRules } = await chrome.storage.local.get('pageRules');
  const rules = pageRules?.rules ?? validateRules(await (await fetch(chrome.runtime.getURL('data/page-rules.json'))).json());
  return {
    calm: Object.entries(rules.calm).map(([key, r]) => ({ key, label: r.label })),
    aiLabel: rules.aiLabels.label,
    platforms: Object.keys(rules.aiLabels.platforms),
    updated: rules.updated,
    fetchedAt: pageRules?.fetchedAt ?? null,
    error: pageRules?.error ?? null,
  };
}

let nanoCache = null;
async function cachedNanoStatus() {
  if (!nanoCache || Date.now() - nanoCache.at > 60_000) nanoCache = { at: Date.now(), value: await nanoStatus() };
  return nanoCache.value;
}

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, timeStamp }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  updateTab(tabId, async (current) => {
    // Already set up for this page by an event that arrived first: keep it.
    if (current.host === new URL(url).hostname && current.committedAt >= timeStamp - 50) return reassess(tabId, current);
    return reassess(tabId, await freshTab(url, timeStamp));
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  for (const [origin, id] of tabByOrigin) if (id === tabId) tabByOrigin.delete(origin);
  const state = await getTab(tabId);
  await guardHooks.onTabClosed(tabId, state).catch(() => {});
  dropTab(tabId);
});

// Fires only for unpacked extensions, which is how Scout runs. It powers the
// per-site tracker ledger.
// Chrome sometimes reports a page's request with no tab (tabId -1). Those
// are attributed by the request's initiator to the tab showing that origin.
// One can even arrive before Chrome has given the tab its new address; it
// waits a few seconds for that page to commit.
const tabByOrigin = new Map();
const waiting = new Map(); // origin -> [{ at, match }]
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  const origin = new URL(url).origin;
  tabByOrigin.set(origin, tabId);
  const held = (waiting.get(origin) ?? []).filter((w) => Date.now() - w.at < 10_000);
  waiting.delete(origin);
  for (const { match } of held) recordMatch(tabId, match.request, match.rule, true);
});

async function tabForRequest(request) {
  if (request.tabId >= 0) return request.tabId;
  if (!request.initiator?.startsWith('http')) return -1;
  // Match patterns can't carry a port, so search by host and compare origins.
  const { protocol, hostname } = new URL(request.initiator);
  const tabs = (await chrome.tabs.query({ url: `${protocol}//${hostname}/*` }).catch(() => [])).filter((t) => {
    try {
      return new URL(t.url).origin === request.initiator;
    } catch {
      return false;
    }
  });
  const best = tabs.find((t) => t.active) ?? tabs.sort((a, b) => b.id - a.id)[0];
  return best?.id ?? tabByOrigin.get(request.initiator) ?? -1;
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (match) => {
  const tabId = await tabForRequest(match.request);
  if (tabId >= 0) return recordMatch(tabId, match.request, match.rule, match.request.tabId < 0);
  const origin = match.request.initiator;
  if (origin?.startsWith('http')) waiting.set(origin, [...(waiting.get(origin) ?? []), { at: Date.now(), match }].slice(-200));
});

function recordMatch(tabId, request, rule, viaInitiator) {
  request = { ...request, tabId };
  const list = rule.rulesetId === 'easylist' ? 'ads' : rule.rulesetId === 'easyprivacy' ? 'trackers' : rule.rulesetId === '_dynamic' && rule.ruleId === 20_000 ? 'trackers' : null;
  if (!list) return;
  const url = new URL(request.url);
  updateTab(request.tabId, async (current) => {
    // A tab-less match can beat the page's commit event here; set the page
    // up first so the commit finds it and keeps what was recorded.
    const state = viaInitiator ? await atUrl(current, `${request.initiator}/`) : current;
    const tracker = trackerFor(url.hostname, await loadOwners());
    if (list === 'ads') state.ads = (state.ads ?? 0) + 1;
    else {
      const entry = state.trackers[tracker.domain] ?? { company: tracker.company, blocked: 0 };
      entry.blocked += 1;
      state.trackers[tracker.domain] = entry;
    }
    // The request log behind the panel's list and x-ray: host and path, no query.
    state.requests = [{ host: url.hostname, path: url.pathname.slice(0, 60), type: request.type, list, company: tracker.company }, ...(state.requests ?? [])].slice(0, 150);
    count(['blocked', list]);
    count(['companies', tracker.company]);
    if (state.host) count(['sites', registrableDomain(state.host)]);
    if (state.level === 'quiet') setBadge(request.tabId, state);
    return state;
  });
}

const handlers = {
  async stakes({ stakes, page, timeOrigin }, sender) {
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url, timeOrigin);
      const isNew = ['password', 'payment', 'otp', 'seed'].some((k) => stakes[k] && !state.stakes[k]);
      state.stakes = { ...state.stakes, ...stakes };
      if (isNew && state.host) {
        if (state.registeredAt === undefined) {
          state.registeredAt = await registrationOf(state.host);
          state.flags = mergeFlags(state.flags.filter((f) => !f.kind.endsWith('domain')), ageFlags(state.registeredAt));
        }
        if (page) {
          state.page = { ...page, formHosts: (page.formHosts ?? []).map(registrableDomain) };
          state.flags = mergeFlags(state.flags, pageFlags(registrableDomain(state.host), state.page, await memory.protectedDomains()));
        }
      }
      return maybeEscalate(tabId, await reassess(tabId, state));
    });
  },

  async fingerprint({ kind, timeOrigin }, sender) {
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url, timeOrigin);
      if (state.fingerprinting.includes(kind)) return reassess(tabId, state);
      state.fingerprinting.push(kind);
      if (!state.flags.some((f) => f.kind === 'fingerprinting')) {
        state.flags.push({ kind: 'fingerprinting', severity: 'info', text: 'This page fingerprinted your browser.' });
      }
      return reassess(tabId, state);
    });
  },

  // Autoconsent's content script talks to the worker through this one type:
  // it asks for rules, asks for main-world snippets to run, and reports results.
  async consent({ message, timeOrigin }, sender) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (tabId === undefined) return;
    const replyTo = (reply) =>
      chrome.tabs.sendMessage(tabId, { type: 'consentReply', message: reply }, { frameId }).catch(() => {});

    switch (message?.type) {
      case 'init': {
        const paused = (await getShields()).paused.includes(registrableDomain(new URL(sender.tab.url).hostname));
        return replyTo({
          type: 'initResp',
          config: paused ? { ...CONSENT_CONFIG, enabled: false } : CONSENT_CONFIG,
          rules: { autoconsent: [], compact: filterCompactRules(await loadConsentRules(), { url: message.url, mainFrame: frameId === 0 }) },
        });
      }
      case 'eval': {
        // Only autoconsent's own named snippets run, never arbitrary code strings.
        const snippet = evalSnippets[message.snippetId];
        let result = false;
        if (snippet) {
          try {
            const [run] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func: snippet });
            result = run?.result ?? false;
          } catch {}
        }
        return replyTo({ type: 'evalResp', id: message.id, result });
      }
      case 'autoconsentDone':
      case 'optOutResult':
        if (message.type === 'optOutResult' && message.result) return;
        return updateTab(tabId, async (current) => {
          const state = await atUrl(current, sender.tab.url, frameId === 0 ? timeOrigin : undefined);
          if (message.type === 'autoconsentDone' && !state.consent) count(['banners']);
          state.consent = message.type === 'autoconsentDone'
            ? { cmp: message.cmp, cosmetic: message.isCosmetic, clicks: message.totalClicks }
            : { cmp: message.cmp, failed: true };
          return state;
        });
    }
  },

  async panelState({ tabId }) {
    const tab = await getTab(tabId);
    const blocked = tab.committedAt ? await blockedSince(tabId, tab.committedAt) : null;
    return {
      tab,
      blocked,
      receipts: (await getReceipts()).slice(0, 25),
      chrome: await chromeProtection(),
      shields: await getShields(),
      pageRules: await pageRulesSummary(),
      site: tab.host ? registrableDomain(tab.host) : null,
      trusted: await memory.listTrusted(),
      extensions: auditAll(await chrome.management.getAll().catch(() => []), chrome.runtime.id),
      settings: await publicSettings(),
      spend: await getSpend(),
      nano: await cachedNanoStatus(),
      guards: effectiveGuards(await getShields()),
      update: (await chrome.storage.local.get('update')).update ?? null,
      peek: (await chrome.storage.local.get('peek')).peek ?? null,
      xray: ((await chrome.storage.session.get('xrayTabs')).xrayTabs ?? []).includes(tabId),
      version: chrome.runtime.getManifest().version,
    };
  },

  saveSettings: ({ changes }) => saveSettings(changes).then(() => publicSettings()),

  async spoilerCheck({ items }, sender) {
    if (!sender.tab || !Array.isArray(items)) return {};
    const { spoilers } = await chrome.storage.local.get('spoilers');
    if (!spoilers?.enabled) return {};
    const clean = items.slice(0, 12).map((i) => ({ id: String(i.id), text: String(i.text).slice(0, 700), titles: (i.titles ?? []).map(String) }));
    const host = new URL(sender.tab.url).hostname;
    const verdicts = await checkSpoilers(clean, spoilers.entries, host);
    const hidden = Object.values(verdicts).filter(Boolean).length;
    if (hidden) {
      updateTab(sender.tab.id, (state) => {
        state.spoilersHidden = (state.spoilersHidden ?? 0) + hidden;
        return state;
      });
    }
    return verdicts;
  },

  // Census: the Reddit content script reports the thread; the panel asks for
  // profile lookups and the Opus analysis.
  async census({ report }, sender) {
    if (!sender.tab) return;
    const keep = {
      level: ['none', 'some', 'notable'].includes(report?.level) ? report.level : 'none',
      notes: (report?.notes ?? []).slice(0, 8).map(String),
      authors: Number(report?.authors) || 0,
      comments: Number(report?.comments) || 0,
      checked: Number(report?.checked) || 0,
      clusters: (report?.clusters ?? []).length,
      thread: { subreddit: report?.thread?.subreddit ? String(report.thread.subreddit).slice(0, 60) : null },
    };
    return updateTab(sender.tab.id, async (current) => {
      const state = await atUrl(current, sender.tab.url);
      state.census = { ...state.census, ...keep };
      return state;
    });
  },

  async censusProfiles({ tabId }) {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'censusProfiles' }, { frameId: 0 });
    if (result?.checked) await addReceipt({ service: 'reddit.com', sent: `${result.checked} public profiles, via your session`, reason: 'You asked Scout to check thread accounts' });
    return result;
  },

  async censusAnalyze({ tabId }) {
    const evidence = await chrome.tabs.sendMessage(tabId, { type: 'censusEvidence' }, { frameId: 0 });
    if (!evidence?.comments?.length) throw new Error('No thread to analyze on this page.');
    const state = await getTab(tabId);
    const analysis = await analyzeThread(evidence, state.host);
    return updateTab(tabId, (s) => {
      if (s.host === state.host) s.census = { ...s.census, analysis };
      return s;
    });
  },

  // Provenance: credentials and metadata for one image, on request.
  async checkImage({ tabId, url }) {
    const pending = { url, tone: 'pending', headline: 'Checking…', lines: [], at: Date.now() };
    const record = (entry) =>
      updateTab(tabId, (s) => {
        s.images = [entry, ...(s.images ?? []).filter((i) => i.url !== url)].slice(0, 5);
        return s;
      });
    await record(pending);
    let entry;
    try {
      let read = await offscreen('readImage', { url });
      let triedOriginal = false;
      const original = read.store ? null : originalUrl(url);
      if (original) {
        const better = await offscreen('readImage', { url: original }).catch(() => null);
        triedOriginal = true;
        if (better?.store || hasAiHints(better?.meta)) read = better;
      }
      entry = { url, ...summarizeProvenance({ ...read, triedOriginal }), at: Date.now() };
      // A QR code's link gets the same checks as a link you right-click.
      for (const code of (read.qr ?? []).slice(0, 2)) {
        if (!/^https?:\/\//i.test(code)) {
          entry.lines = [...entry.lines, `QR code: ${String(code).slice(0, 120)}`];
          continue;
        }
        const { findings } = linkFindings(code, await memory.protectedDomains());
        const hard = findings.some((f) => f.severity === 'hard');
        entry.lines = [...entry.lines, `QR code links to ${code.slice(0, 120)}`, ...findings.map((f) => f.text)];
        if (hard) {
          entry.tone = 'tampered';
          entry.headline = `Careful: this image's QR code leads somewhere suspicious. ${entry.headline}`;
        }
      }
    } catch (error) {
      entry = { url, tone: 'none', headline: "Couldn't check this image.", lines: [error.message], at: Date.now() };
    }
    await record(entry);
    return entry;
  },

  // Ask Scout: links and selected text, kept per tab as a short list.
  async checkLink({ tabId, url }) {
    const { host, domain, findings } = linkFindings(url, await memory.protectedDomains());
    if (domain && /[a-z]/i.test(domain) && !domain.startsWith('[') && !(await memory.isTrusted(domain))) {
      const registered = await registrationOf(host).catch(() => null);
      for (const f of ageFlags(registered)) findings.push({ severity: f.severity, text: f.text });
    }
    const hard = findings.some((f) => f.severity === 'hard');
    const entry = { kind: 'link', subject: url, tone: hard ? 'bad' : findings.length ? 'mixed' : 'ok', headline: hard ? 'Be careful with this link.' : findings.length ? 'Worth a look before you click.' : 'Nothing wrong found locally.', lines: findings.map((f) => f.text), at: Date.now() };
    return addAsked(tabId, entry);
  },

  async askText({ tabId, text }) {
    const state = await getTab(tabId);
    const result = await askAboutText(String(text), state.host || 'page');
    const headline = result.declined
      ? `The model couldn't assess this (${result.declined}).`
      : { likely_scam: `Likely a scam${result.impersonating ? `, posing as ${result.impersonating}` : ''}.`, unclear: "Can't tell.", likely_safe: 'Nothing scam-like found.' }[result.verdict];
    const tone = result.verdict === 'likely_scam' ? 'bad' : result.verdict === 'unclear' ? 'mixed' : 'ok';
    return addAsked(tabId, { kind: 'text', subject: String(text).slice(0, 140), tone, headline, lines: result.reasons ?? [], at: Date.now() });
  },

  async finePrint({ tabId }) {
    const state = await getTab(tabId);
    if (!state.host) throw new Error('No page to read.');
    const { links = [] } = (await chrome.tabs.sendMessage(tabId, { type: 'extract', links: true }, { frameId: 0 }).catch(() => ({}))) ?? {};
    const urls = policyLinks(links, state.url);
    if (!urls.length) throw new Error("Couldn't find a privacy policy or terms link on this page.");
    const found = await readFinePrint(registrableDomain(state.host), urls);
    return updateTab(tabId, (s) => {
      if (s.host === state.host) s.finePrint = found;
      return s;
    });
  },

  async slopCount({ count }, sender) {
    if (!sender.tab) return;
    return updateTab(sender.tab.id, (s) => {
      s.slopHidden = Math.max(0, Number(count) || 0);
      return s;
    });
  },

  async saveShields({ changes }) {
    const next = { ...(await getShields()), ...changes };
    next.slop = Boolean(next.slop);
    next.aiLabels = Boolean(next.aiLabels);
    next.calm = Object.fromEntries(Object.entries(next.calm ?? {}).map(([k, v]) => [String(k).slice(0, 30), Boolean(v)]));
    next.paused = [...new Set((next.paused ?? []).map(String))].slice(0, 500);
    next.mode = MODES[next.mode] ? next.mode : 'balanced';
    // Changing the mode resets per-guard overrides to that mode's defaults.
    if (changes.mode && !changes.guards) next.guards = {};
    next.guards = Object.fromEntries(
      Object.entries(next.guards ?? {})
        .filter(([k]) => GUARD_KEYS.includes(k))
        .map(([k, v]) => [k, k === 'feedLimit' ? Math.max(0, Math.min(600, Number(v) || 0)) : k === 'toasts' ? (['off', 'first', 'always'].includes(v) ? v : 'first') : Boolean(v)]),
    );
    next.farble = [...new Set((next.farble ?? []).map(String).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))].slice(0, 200);
    await chrome.storage.local.set({ shields: next });
    await syncPauseRules(next.paused);
    return next;
  },

  async togglePause({ tabId }) {
    const state = await getTab(tabId);
    if (!state.host) throw new Error('No site to pause.');
    const domain = registrableDomain(state.host);
    const shields = await getShields();
    const paused = shields.paused.includes(domain) ? shields.paused.filter((d) => d !== domain) : [...shields.paused, domain];
    return handlers.saveShields({ changes: { paused } });
  },

  untrustDomain: ({ domain }) => memory.untrust(String(domain)),

  // Fake-shop check. The domain-age lookup leaves the browser, so it runs only
  // once the page already shows at least one warning sign.
  async shop({ facts, timeOrigin }, sender) {
    if (!sender.tab || !facts?.isShop) return;
    const clean = {
      isShop: true,
      legalLinks: Number(facts.legalLinks) || 0,
      contact: Boolean(facts.contact),
      seals: (facts.seals ?? []).slice(0, 10).map((s) => ({ name: String(s.name).slice(0, 40), linked: Boolean(s.linked) })),
      text: String(facts.text ?? '').slice(0, 20000),
      discounts: (facts.discounts ?? []).slice(0, 200).map(Number).filter(Number.isFinite),
    };
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url, timeOrigin);
      let flags = shopFlags(clean, null);
      if (flags.length && state.host && !(await memory.isTrusted(registrableDomain(state.host)))) {
        state.registeredAt ??= await registrationOf(state.host);
        flags = shopFlags(clean, state.registeredAt ? ageInDays(state.registeredAt) : null);
      }
      state.flags = mergeFlags(state.flags.filter((f) => !/^(shop:|fake-shop)/.test(f.kind)), flags);
      return reassess(tabId, state);
    });
  },

  async calmCount({ counts }, sender) {
    if (!sender.tab) return;
    return updateTab(sender.tab.id, (s) => {
      const hidden = Object.fromEntries(
        Object.entries(counts?.hidden ?? {})
          .filter(([k, n]) => /^[a-zA-Z][\w-]{0,30}$/.test(k) && Number(n) > 0)
          .slice(0, 30)
          .map(([k, n]) => [k, Math.min(Number(n), 9999)]),
      );
      s.calm = { folded: Number(counts?.folded) || 0, aiFolded: Number(counts?.aiFolded) || 0, paused: Number(counts?.paused) || 0, hidden };
      return s;
    });
  },

  refreshPageRules: () => refreshPageRules(true).then((r) => ({ ok: Boolean(r?.rules), updated: r?.rules?.updated ?? null })),

  getSpoilers: async () => (await chrome.storage.local.get('spoilers')).spoilers ?? { enabled: false, mode: 'ai', entries: [] },

  async saveSpoilers({ spoilers }) {
    const clean = {
      enabled: Boolean(spoilers.enabled),
      mode: spoilers.mode === 'keyword' ? 'keyword' : 'ai',
      entries: (spoilers.entries ?? []).map(normalizeEntry).filter((e) => e.title.length >= 2).slice(0, 200),
    };
    await chrome.storage.local.set({ spoilers: clean });
    return clean;
  },

  // Tier 4: you asked. Reads the page's visible text as well as its fields.
  async investigate({ tabId }) {
    const state = await getTab(tabId);
    if (!state.host) throw new Error('Nothing to investigate on this page.');
    const page = await chrome.tabs.sendMessage(tabId, { type: 'extract', deep: true }, { frameId: 0 }).catch(() => state.page ?? {});
    const formHosts = (page.formHosts ?? state.page?.formHosts ?? []).map(registrableDomain);
    const found = await investigate(state, { ...(state.page ?? {}), ...page, formHosts });
    return updateTab(tabId, async (s) => {
      if (s.host !== state.host) return s;
      s.investigation = { verdict: found.result.verdict, summary: found.result.summary, reasons: found.result.reasons, declined: found.result.declined, model: found.model, at: found.at };
      s.flags = mergeFlags(s.flags, found.flags);
      return reassess(tabId, s);
    });
  },

  openChromeSecurity: () => chrome.tabs.create({ url: 'chrome://settings/security' }),

  async trust({ tabId }) {
    const state = await getTab(tabId);
    const registered = state.registeredAt ?? (await registrationOf(state.host));
    await memory.trust(registrableDomain(state.host), registered);
    return updateTab(tabId, (s) => reassess(tabId, { ...s, registeredAt: registered }));
  },

  async untrust({ tabId }) {
    const state = await getTab(tabId);
    await memory.untrust(registrableDomain(state.host));
    return updateTab(tabId, (s) => reassess(tabId, s));
  },

  async dismiss({ tabId, kind }) {
    await memory.dismiss(kind);
    return updateTab(tabId, (s) => reassess(tabId, s));
  },

  exportMemory: () => memory.exportMemory(),
  importMemory: ({ file }) => memory.importMemory(file),
};

const guardHooks = installGuards({ handlers, mergeFlags, reassess, atUrl, getShields });

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle-xray' && tab?.id) handlers.xray({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then((value) => reply({ ok: true, value }))
    .catch((error) => reply({ ok: false, error: String(error) }));
  return true;
});
