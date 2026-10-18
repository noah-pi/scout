// Refreshes the third-party lists Scout ships with. Needs network; run it
// every few weeks, then `npm test` and commit the results.
//
//   rules/easyprivacy.json        block rules   (uBO Lite's DNR build of EasyPrivacy, GPLv3)
//   rules/easyprivacy-allow.json  allow rules   (same source; kept apart so the ledger only counts blocks)
//   rules/easylist.json           ad block rules (uBO Lite's DNR build of EasyList, GPLv3 / CC BY-SA)
//   rules/easylist-allow.json     its allow rules
//   data/entities.json            domain → owning company (DuckDuckGo Tracker Radar, CC BY-NC-SA 4.0)
//   data/ai-sites.json            AI-heavy sites for the search slop filter (laylavish HUGE AI Blocklist, CC0)
import { writeFileSync } from 'node:fs';

const UBOL = 'https://raw.githubusercontent.com/uBlockOrigin/uBOL-home/main/chromium/rulesets/main';
const EASYPRIVACY = `${UBOL}/easyprivacy.json`;
const EASYLIST = `${UBOL}/easylist.json`;
const AI_SITES = 'https://raw.githubusercontent.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist/main/list_uBlacklist.txt';
const ENTITY_MAP = 'https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/entity_map.json';

const out = (path) => new URL(`../${path}`, import.meta.url);

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Redirect rules point at uBO's own stub scripts, which Scout doesn't carry,
// and the header rules rewrite CSP on a handful of piracy sites. Keep the rest.
export function splitEasyPrivacy(rules) {
  const block = rules.filter((r) => r.action.type === 'block');
  const allow = rules.filter((r) => r.action.type === 'allow');
  return { block, allow };
}

// uBlacklist format: match patterns (*://*.example.com/*) and /regex/ lines.
export function parseUBlacklist(text) {
  const domains = new Set();
  const patterns = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = line.match(/^\*:\/\/(?:\*\.)?([a-z0-9.-]+)\/\*$/i);
    if (m) domains.add(m[1].toLowerCase());
    else if (/^\/.+\/$/.test(line)) patterns.push(line.slice(1, -1));
  }
  return { domains: [...domains].sort(), patterns };
}

export function compactEntities(entityMap) {
  return Object.entries(entityMap)
    .map(([name, entity]) => [entity.displayName || name, [...new Set(entity.properties ?? [])].sort()])
    .filter(([, domains]) => domains.length)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { block, allow } = splitEasyPrivacy(await json(EASYPRIVACY));
  writeFileSync(out('rules/easyprivacy.json'), JSON.stringify(block) + '\n');
  writeFileSync(out('rules/easyprivacy-allow.json'), JSON.stringify(allow) + '\n');
  console.log(`easyprivacy: ${block.length} block, ${allow.length} allow`);

  const ads = splitEasyPrivacy(await json(EASYLIST));
  writeFileSync(out('rules/easylist.json'), JSON.stringify(ads.block) + '\n');
  writeFileSync(out('rules/easylist-allow.json'), JSON.stringify(ads.allow) + '\n');
  console.log(`easylist: ${ads.block.length} block, ${ads.allow.length} allow`);

  const res = await fetch(AI_SITES);
  if (!res.ok) throw new Error(`${AI_SITES}: HTTP ${res.status}`);
  const aiSites = parseUBlacklist(await res.text());
  writeFileSync(out('data/ai-sites.json'), JSON.stringify(aiSites) + '\n');
  console.log(`ai sites: ${aiSites.domains.length} domains, ${aiSites.patterns.length} patterns`);

  const entities = compactEntities(await json(ENTITY_MAP));
  writeFileSync(out('data/entities.json'), JSON.stringify(entities) + '\n');
  console.log(`entities: ${entities.length} companies, ${entities.reduce((n, [, d]) => n + d.length, 0)} domains`);
}
