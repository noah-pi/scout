// Watches whether Scout's page rules still match the sites they're written
// for. After each page you finish loading on such a site, the calm counts
// (and Census, on a Reddit thread) say whether the rule found anything.
import { expectations, recordVisit, staleRules } from '../shared/rot.js';
import { validateRules } from '../shared/pagerules.js';
import { registrableDomain } from '../shared/tripwire.js';
import { getTab } from './store.js';

async function currentRules() {
  const { pageRules } = await chrome.storage.local.get('pageRules');
  return pageRules?.rules ?? validateRules(await (await fetch(chrome.runtime.getURL('data/page-rules.json'))).json());
}

export const ruleRot = async () => staleRules((await chrome.storage.local.get('ruleHealth')).ruleHealth ?? {});

export function installRot({ getShields }) {
  chrome.webNavigation.onCompleted.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0 || !/^https?:/.test(url)) return;
    setTimeout(() => check(tabId, url, getShields).catch(() => {}), 8000);
  });
}

async function check(tabId, url, getShields) {
  const { hostname, pathname } = new URL(url);
  const rules = await currentRules();
  const wanted = expectations(rules, hostname, pathname);
  if (!wanted.length) return;
  const shields = await getShields();
  if (shields.paused.includes(registrableDomain(hostname))) return;
  const state = await getTab(tabId);
  if (state.url !== url) return; // moved on before the page settled
  const { ruleHealth = {} } = await chrome.storage.local.get('ruleHealth');
  for (const { key, label } of wanted) {
    if (key !== 'census-reddit' && shields.calm?.[key] === false) continue;
    const hit = key === 'census-reddit' ? (state.census?.comments ?? 0) > 0 : (state.calm?.hidden?.[key] ?? 0) > 0 || (key === 'aiOverviews' && (state.calm?.folded ?? 0) > 0);
    recordVisit(ruleHealth, key, label, hit);
  }
  await chrome.storage.local.set({ ruleHealth });
}
