// Your settings and today's cloud spend. Local only; the API key never syncs
// and never appears in receipts.
import { MODELS } from '../shared/assessment.js';

// Opus 5.5 at low effort for the quick check; Haiku 5.5 is roughly forty times
// cheaper per check if you'd rather trade judgment for cost.
export const DEFAULTS = {
  apiKey: '',
  cloud: false,
  quickModel: 'claude-opus-5-5',
  deepModel: 'claude-opus-5-5',
  dailyCap: 25,
  baseURL: '', // for tests; empty means api.anthropic.com
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

export async function saveSettings(changes) {
  const next = { ...(await getSettings()), ...changes };
  if (!MODELS.includes(next.quickModel)) next.quickModel = DEFAULTS.quickModel;
  if (!MODELS.includes(next.deepModel)) next.deepModel = DEFAULTS.deepModel;
  next.dailyCap = Math.max(0, Math.floor(Number(next.dailyCap) || 0));
  next.cloud = Boolean(next.cloud);
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
  return spend?.date === today() ? spend : { date: today(), calls: 0, usd: 0 };
}

export async function addSpend(usd) {
  const spend = await getSpend();
  await chrome.storage.local.set({ spend: { ...spend, calls: spend.calls + 1, usd: spend.usd + usd } });
}
