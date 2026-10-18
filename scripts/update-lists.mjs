// Refreshes the third-party lists Scout ships with. Needs network; run it
// every few weeks, then `npm test` and commit the results.
//
//   rules/easyprivacy.json        block rules   (uBO Lite's DNR build of EasyPrivacy, GPLv3)
//   rules/easyprivacy-allow.json  allow rules   (same source; kept apart so the ledger only counts blocks)
//   data/entities.json            domain → owning company (DuckDuckGo Tracker Radar, CC BY-NC-SA 4.0)
import { writeFileSync } from 'node:fs';

const EASYPRIVACY = 'https://raw.githubusercontent.com/uBlockOrigin/uBOL-home/main/chromium/rulesets/main/easyprivacy.json';
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

  const entities = compactEntities(await json(ENTITY_MAP));
  writeFileSync(out('data/entities.json'), JSON.stringify(entities) + '\n');
  console.log(`entities: ${entities.length} companies, ${entities.reduce((n, [, d]) => n + d.length, 0)} domains`);
}
