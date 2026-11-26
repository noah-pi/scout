// Rule rot: Scout's page rules follow site markup that changes without
// notice. Each visit to a site a rule is written for counts as a chance for
// it to match; a rule that keeps missing for two weeks of visits has probably
// stopped working. Pure.
import { onSite } from './pagerules.js';

export const STALE_MISSES = 10;
export const STALE_DAYS = 14;
const DAY = 86_400_000;

// Rules that should match on most visits to their site: site-specific calm
// rules, and Census on Reddit threads. A rule for every site ('*') says
// nothing about markup when it misses.
export function expectations(rules, host, path) {
  const out = [];
  for (const [key, r] of Object.entries(rules.calm ?? {})) {
    if (r.sites.includes('*') || !onSite(r.sites, host)) continue;
    if (key === 'aiOverviews' && !path.startsWith('/search')) continue;
    out.push({ key, label: r.label, sites: r.sites });
  }
  if (/(^|\.)reddit\.com$/.test(host) && /\/comments\//.test(path)) out.push({ key: 'census-reddit', label: 'Census: reading Reddit threads', sites: ['reddit.com'] });
  return out;
}

export function recordVisit(health, key, label, hit, now = Date.now()) {
  const h = health[key] ?? { label, since: now, visits: 0, misses: 0, lastHit: null };
  h.label = label;
  h.visits += 1;
  h.lastVisit = now;
  if (hit) {
    h.misses = 0;
    h.lastHit = now;
  } else h.misses += 1;
  health[key] = h;
  return health;
}

export function staleRules(health, now = Date.now()) {
  return Object.entries(health)
    .filter(([, h]) => h.misses >= STALE_MISSES && now - (h.lastHit ?? h.since) >= STALE_DAYS * DAY)
    .map(([key, h]) => ({ key, label: h.label, lastHit: h.lastHit, misses: h.misses }));
}
