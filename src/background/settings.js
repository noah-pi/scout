// Your settings and today's cloud spend. Local only; the API key never syncs
// and never appears in receipts.
import { MODELS } from '../shared/assessment.js';

// Haiku 5.5 for routine work (quick page checks, spoiler context); Opus 5.5
// for critical reasoning (Investigate, bot-pattern analysis).
export const DEFAULTS = {
  apiKey: '',
  cloud: false,
  quickModel: 'claude-haiku-5-5',
  deepModel: 'claude-opus-5-5',
  dailyCap: 25,
  spoilerCap: 100, // batched spoiler checks per day
  baseURL: '', // for tests; empty means api.anthropic.com
  keyInSession: false, // keep the key only until Chrome closes
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULTS, ...settings };
  if (merged.keyInSession) merged.apiKey = (await chrome.storage.session.get('apiKey')).apiKey ?? '';
  return merged;
}

export async function saveSettings(changes) {
  const next = { ...(await getSettings()), ...changes };
  if (!MODELS.includes(next.quickModel)) next.quickModel = DEFAULTS.quickModel;
  if (!MODELS.includes(next.deepModel)) next.deepModel = DEFAULTS.deepModel;
  next.dailyCap = Math.max(0, Math.floor(Number(next.dailyCap) || 0));
  next.spoilerCap = Math.max(0, Math.floor(Number(next.spoilerCap) || 0));
  next.cloud = Boolean(next.cloud);
  next.keyInSession = Boolean(next.keyInSession);
  if (next.keyInSession) {
    // The key lives in session storage (memory only) and leaves disk.
    await chrome.storage.session.set({ apiKey: next.apiKey });
    next.apiKey = '';
  } else {
    await chrome.storage.session.remove('apiKey');
  }
  await chrome.storage.local.set({ settings: next });
  return next;
}

// What the panel may see: everything except the key itself.
export async function publicSettings() {
  const { apiKey, ...rest } = await getSettings();
  return { ...rest, hasKey: Boolean(apiKey) };
}

const today = () => new Date().toISOString().slice(0, 10);

export async function getSpend() {
  const { spend } = await chrome.storage.local.get('spend');
  return spend?.date === today() ? { spoilerCalls: 0, ...spend } : { date: today(), calls: 0, spoilerCalls: 0, usd: 0 };
}

// counter: 'calls' (page checks and Investigate) or 'spoilerCalls'.
export async function addSpend(usd, counter = 'calls') {
  const spend = await getSpend();
  await chrome.storage.local.set({ spend: { ...spend, [counter]: spend[counter] + 1, usd: spend.usd + usd } });
}
