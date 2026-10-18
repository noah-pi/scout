import { assess } from '../shared/ladder.js';
import { ownerIndex, trackerFor } from '../shared/trackers.js';
import { registrableDomain } from '../shared/tripwire.js';
import { dropTab, emptyTab, getReceipts, getTab, updateTab } from './store.js';
import { ageFlags, localFlags, registrationOf } from './tripwire.js';
import * as memory from './memory.js';
import { checkSpoilers, escalate, investigate, nanoStatus } from './escalate.js';
import { getSpend, publicSettings, saveSettings } from './settings.js';
import { pageFlags } from '../shared/assessment.js';
import { normalizeEntry } from '../shared/spoilers.js';
import { evalSnippets, filterCompactRules } from '../../dist/consent-lib.js';

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
  note: { text: '•', color: '#B7791F' },
  stop: { text: '!', color: '#C53030' },
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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

  state.level = result.level;
  state.escalate = result.escalate;
  state.trusted = Boolean(trusted);
  const badge = BADGE[result.level];
  chrome.action.setBadgeText({ tabId, text: badge.text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
  return state;
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

let nanoCache = null;
async function cachedNanoStatus() {
  if (!nanoCache || Date.now() - nanoCache.at > 60_000) nanoCache = { at: Date.now(), value: await nanoStatus() };
  return nanoCache.value;
}

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, timeStamp }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  updateTab(tabId, async () => reassess(tabId, await freshTab(url, timeStamp)));
});

chrome.tabs.onRemoved.addListener((tabId) => dropTab(tabId));

// Fires only for unpacked extensions, which is how Scout runs. It powers the
// per-site tracker ledger.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ request, rule }) => {
  if (rule.rulesetId !== 'easyprivacy' || request.tabId < 0) return;
  const host = new URL(request.url).hostname;
  updateTab(request.tabId, async (state) => {
    const tracker = trackerFor(host, await loadOwners());
    const entry = state.trackers[tracker.domain] ?? { company: tracker.company, blocked: 0 };
    entry.blocked += 1;
    state.trackers[tracker.domain] = entry;
    return state;
  });
});

const handlers = {
  async stakes({ stakes, page, timeOrigin }, sender) {
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url, timeOrigin);
      const isNew = (stakes.password && !state.stakes.password) || (stakes.payment && !state.stakes.payment);
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
      case 'init':
        return replyTo({
          type: 'initResp',
          config: CONSENT_CONFIG,
          rules: { autoconsent: [], compact: filterCompactRules(await loadConsentRules(), { url: message.url, mainFrame: frameId === 0 }) },
        });
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
      settings: await publicSettings(),
      spend: await getSpend(),
      nano: await cachedNanoStatus(),
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

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then((value) => reply({ ok: true, value }))
    .catch((error) => reply({ ok: false, error: String(error) }));
  return true;
});
