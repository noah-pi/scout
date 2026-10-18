// Turns a page's host into flags. Local checks run on every navigation; the
// domain-age lookup leaves the browser, so it only runs once the page asks for
// a password or a card.
import { findLookalike, hasPunycode, registrableDomain, registeredAt, ageInDays } from '../shared/tripwire.js';
import { addReceipt, cached } from './store.js';
import { protectedDomains } from './memory.js';

const WEEK = 7 * 86_400_000;
const HARD_LOOKALIKES = new Set(['confusable', 'typo', 'brand-in-subdomain']);

export async function localFlags(host) {
  const flags = [];
  const lookalike = findLookalike(host, await protectedDomains());
  if (lookalike) {
    const hard = HARD_LOOKALIKES.has(lookalike.kind);
    flags.push({
      kind: `lookalike:${lookalike.kind}`,
      severity: hard ? 'hard' : 'soft',
      text: hard
        ? `Looks like ${lookalike.target}, but isn't it (${lookalike.kind}).`
        : `Same name as ${lookalike.target}, different suffix.`,
    });
  }
  if (hasPunycode(host)) {
    flags.push({ kind: 'punycode', severity: 'soft', text: 'Domain uses non-Latin characters encoded as punycode.' });
  }
  return flags;
}

export async function registrationOf(host) {
  const domain = registrableDomain(host);
  return cached(`rdap:${domain}`, WEEK, async () => {
    await addReceipt({ service: 'rdap.org', sent: domain, reason: 'Domain age check on a login or payment page' });
    try {
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
      return res.ok ? registeredAt(await res.json()) : null;
    } catch {
      return null;
    }
  });
}

export function ageFlags(registered) {
  if (!registered) return [];
  const days = ageInDays(registered);
  if (days < 30) return [{ kind: 'new-domain', severity: 'hard', text: `Domain registered ${days} days ago.` }];
  if (days < 180) return [{ kind: 'young-domain', severity: 'soft', text: `Domain registered ${days} days ago.` }];
  return [];
}
