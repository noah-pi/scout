// Names the company behind a blocked request, for the ledger. The owner list
// (data/entities.json, from DuckDuckGo Tracker Radar) is about 1 MB, so callers
// load it when first needed and pass the index in; the service worker starts
// faster without it.
import { getDomain } from '../../dist/tldts.js';

export function ownerIndex(entities) {
  const owners = new Map();
  for (const [company, domains] of entities) for (const d of domains) owners.set(d, company);
  return owners;
}

// Unknown owners fall back to the domain itself, so the ledger still says who.
export function trackerFor(host, owners) {
  const domain = getDomain(host) ?? host;
  return { domain, company: owners.get(domain) ?? domain };
}
