// Regenerates rules/trackers.json from src/shared/trackers.js.
// Run: npm run build:rules
import { writeFileSync } from 'node:fs';
import { TRACKERS } from '../src/shared/trackers.js';

const RESOURCE_TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'websocket', 'other'];

export function buildRules() {
  return Object.keys(TRACKERS).map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: `||${domain}^`, domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES },
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL('../rules/trackers.json', import.meta.url);
  writeFileSync(out, JSON.stringify(buildRules(), null, 2) + '\n');
  console.log(`wrote ${buildRules().length} rules`);
}
