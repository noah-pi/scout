// Climbs the ladder for one page: Gemini Nano on the device first (free),
// then a quick Claude check if the page is still in the uncertain middle,
// cloud checks are on, and today's budget allows it. "Investigate" is the
// user-initiated deep check.
import {
  NANO_BRAND_PROMPT, buildEvidence, buildRequest, costOf, nanoFlags, parseVerdict, verdictFlags,
} from '../shared/assessment.js';
import { registrableDomain } from '../shared/tripwire.js';
import { addReceipt } from './store.js';
import { addSpend, getSettings, getSpend } from './settings.js';

let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Runs model calls (Anthropic SDK, Chrome Prompt API) outside the service worker.',
    })
    .finally(() => (creating = null));
  await creating;
}

export async function offscreen(op, args) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', op, args });
  if (!res?.ok) throw Object.assign(new Error(res?.error?.message ?? 'offscreen call failed'), { kind: res?.error?.kind });
  return res.value;
}

export async function nanoStatus() {
  try {
    return await offscreen('nanoAvailability');
  } catch {
    return 'unavailable';
  }
}

async function askNano(state, page) {
  if ((await nanoStatus()) !== 'available') return [];
  const evidence = buildEvidence(state, page);
  const prompt = JSON.stringify({ host: evidence.host, page: evidence.page });
  try {
    const result = await offscreen('nanoPrompt', { ...NANO_BRAND_PROMPT, prompt });
    return nanoFlags(result?.brand ?? null, registrableDomain(state.host));
  } catch {
    return [];
  }
}

async function askClaude(state, page, { deep }) {
  const settings = await getSettings();
  const model = deep ? settings.deepModel : settings.quickModel;
  const evidence = buildEvidence(state, page, { deep });
  const request = buildRequest(model, evidence, { deep });
  const response = await offscreen('claude', { apiKey: settings.apiKey, baseURL: settings.baseURL, request });
  const usd = costOf(model, response.usage);
  await addSpend(usd);
  await addReceipt({
    service: `claude (${model})`,
    sent: `${state.host}: ${Object.keys(evidence.page).length} page fields${deep ? ' + visible text' : ''}`,
    reason: deep ? 'You asked Scout to investigate' : 'Login or payment page with mixed signals',
    usd,
  });
  return parseVerdict(response);
}

// Returns why the quick cloud check can't run now, or null when it can.
export async function cloudBlocker() {
  const settings = await getSettings();
  if (!settings.cloud) return 'cloud checks are off';
  if (!settings.apiKey) return 'no API key';
  if ((await getSpend()).calls >= settings.dailyCap) return `daily cap of ${settings.dailyCap} reached`;
  return null;
}

// Runs tiers 2 and 3 for a page. `apply` merges new flags into the tab's
// state and returns the reassessed state.
export async function escalate(state, page, apply) {
  const fromNano = await askNano(state, page);
  if (fromNano.length) state = await apply(fromNano);
  if (state.escalate !== 'tier3') return;

  const blocked = await cloudBlocker();
  if (blocked) {
    await addReceipt({ service: 'tier3', sent: state.host, reason: `${state.flags.map((f) => f.kind).join(', ')} (skipped: ${blocked})`, dryRun: true });
    return;
  }
  try {
    await apply(verdictFlags(await askClaude(state, page, { deep: false }), 'Claude'));
  } catch (error) {
    await apply([{ kind: 'claude:error', severity: 'info', text: `Cloud check failed: ${error.message}` }]);
  }
}

export async function investigate(state, page) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error('Add an API key in Settings first.');
  const result = await askClaude(state, page, { deep: true });
  return { result, flags: verdictFlags(result, 'Claude'), model: settings.deepModel, at: Date.now() };
}
