import { assess } from '../shared/ladder.js';
import { trackerFor } from '../shared/trackers.js';
import { registrableDomain } from '../shared/tripwire.js';
import { addReceipt, dropTab, emptyTab, getReceipts, getTab, updateTab } from './store.js';
import { ageFlags, localFlags, registrationOf } from './tripwire.js';
import * as memory from './memory.js';

const BADGE = {
  quiet: { text: '', color: '#00000000' },
  note: { text: '•', color: '#B7791F' },
  stop: { text: '!', color: '#C53030' },
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function freshTab(url) {
  const state = emptyTab(url);
  state.flags = await localFlags(state.host);
  return state;
}

// onCommitted can fire before a cold-starting service worker is listening,
// so messages from the page also carry its URL. If the state doesn't know the
// page yet, fill it in and keep whatever was already recorded for it.
async function atUrl(state, url) {
  if (!url || !/^https?:/.test(url)) return state;
  const host = new URL(url).hostname;
  if (state.host === host) return state;
  const fresh = await freshTab(url);
  if (!state.host) {
    fresh.trackers = state.trackers;
    fresh.fingerprinting = state.fingerprinting;
    fresh.stakes = state.stakes;
    fresh.flags.push(...state.flags.filter((f) => f.kind === 'fingerprinting'));
  }
  return fresh;
}

async function reassess(tabId, state) {
  const domain = state.host ? registrableDomain(state.host) : null;
  const trusted = domain && (await memory.isTrusted(domain, state.registeredAt));
  const flags = trusted ? [] : state.flags;
  const result = assess({ stakes: state.stakes, flags, dismissals: await memory.dismissals() });

  if (result.escalate && !state.escalate) {
    // Cloud tiers aren't wired yet. Logging the would-be call shows how often
    // the trigger fires before any tokens are spent on it.
    await addReceipt({ service: 'tier3', sent: domain, reason: result.notes.map((n) => n.kind).join(', '), dryRun: true });
  }

  state.level = result.level;
  state.escalate = result.escalate;
  state.trusted = Boolean(trusted);
  const badge = BADGE[result.level];
  chrome.action.setBadgeText({ tabId, text: badge.text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
  return state;
}

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  updateTab(tabId, async () => reassess(tabId, await freshTab(url)));
});

chrome.tabs.onRemoved.addListener((tabId) => dropTab(tabId));

// Fires only for unpacked extensions, which is how Scout runs. It powers the
// per-site tracker ledger.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ request, rule }) => {
  if (rule.rulesetId !== 'trackers' || request.tabId < 0) return;
  const tracker = trackerFor(new URL(request.url).hostname);
  if (!tracker) return;
  updateTab(request.tabId, (state) => {
    const entry = state.trackers[tracker.domain] ?? { company: tracker.company, category: tracker.category, blocked: 0 };
    entry.blocked += 1;
    state.trackers[tracker.domain] = entry;
    return state;
  });
});

const handlers = {
  async stakes({ stakes }, sender) {
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url);
      const isNew = (stakes.password && !state.stakes.password) || (stakes.payment && !state.stakes.payment);
      state.stakes = { ...state.stakes, ...stakes };
      if (isNew && state.host && state.registeredAt === undefined) {
        state.registeredAt = await registrationOf(state.host);
        state.flags = [...state.flags.filter((f) => !f.kind.endsWith('domain')), ...ageFlags(state.registeredAt)];
      }
      return reassess(tabId, state);
    });
  },

  async fingerprint({ kind }, sender) {
    const tabId = sender.tab.id;
    return updateTab(tabId, async (current) => {
      const state = await atUrl(current, sender.tab.url);
      if (state.fingerprinting.includes(kind)) return reassess(tabId, state);
      state.fingerprinting.push(kind);
      if (!state.flags.some((f) => f.kind === 'fingerprinting')) {
        state.flags.push({ kind: 'fingerprinting', severity: 'info', text: 'This page fingerprinted your browser.' });
      }
      return reassess(tabId, state);
    });
  },

  async panelState({ tabId }) {
    return { tab: await getTab(tabId), receipts: (await getReceipts()).slice(0, 25) };
  },

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
