// Local scam signals. Pure functions only: no network, no chrome.* calls.
import { getDomain } from '../../dist/tldts.js';

// eTLD+1 from the Public Suffix List. Private suffixes count, so
// paypal-login.github.io is its own site rather than "github.io".
export function registrableDomain(host) {
  const clean = host.toLowerCase().replace(/\.$/, '');
  return getDomain(clean, { allowPrivateDomains: true }) ?? clean;
}

// The name part of a registrable domain: "paypal" for paypal.co.uk.
function nameOf(domain) {
  return domain.split('.')[0];
}

// Characters and pairs that read as other letters at a glance.
const CONFUSABLES = [
  ['rn', 'm'], ['vv', 'w'], ['0', 'o'], ['1', 'l'], ['|', 'l'], ['5', 's'],
  ['а', 'a'], ['е', 'e'], ['о', 'o'], ['р', 'p'], ['с', 'c'], ['х', 'x'], ['і', 'i'], ['ј', 'j'],
];

export function skeleton(label) {
  let s = label.toLowerCase().replace(/-/g, '');
  for (const [from, to] of CONFUSABLES) s = s.split(from).join(to);
  return s.replace(/i/g, 'l');
}

export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// Returns { kind, target } when host imitates one of the protected domains.
export function findLookalike(host, protectedDomains) {
  const domain = registrableDomain(host);
  if (protectedDomains.includes(domain)) return null;
  const name = nameOf(domain);
  const subLabels = host.toLowerCase().split('.').slice(0, -domain.split('.').length);

  for (const target of protectedDomains) {
    const targetName = nameOf(target);
    // amazon.co.uk or google.de: same name, different suffix. Usually the real
    // company, so the caller treats it as context rather than a red flag.
    if (name === targetName) return { kind: 'other-suffix', target };
    if (skeleton(name) === skeleton(targetName)) return { kind: 'confusable', target };
    if (targetName.length >= 5 && editDistance(name, targetName) === 1) return { kind: 'typo', target };
    if (targetName.length >= 4 && subLabels.some((l) => l === targetName || l.startsWith(`${targetName}-`))) {
      return { kind: 'brand-in-subdomain', target };
    }
    // paypal-login.com, secure-chase.net. Hyphen-separated parts only, so
    // amazonaws.com doesn't read as Amazon.
    if (targetName.length >= 4 && name.split('-').length > 1 && name.split('-').includes(targetName)) {
      return { kind: 'brand-in-name', target };
    }
  }
  return null;
}

export function hasPunycode(host) {
  return host.split('.').some((l) => l.startsWith('xn--'));
}

// Registration date from an RDAP domain response, or null.
export function registeredAt(rdap) {
  const event = rdap?.events?.find((e) => e.eventAction === 'registration');
  return event ? event.eventDate : null;
}

export function ageInDays(isoDate, now = Date.now()) {
  return Math.floor((now - Date.parse(isoDate)) / 86_400_000);
}

export const DEFAULT_PROTECTED = [
  'paypal.com', 'venmo.com', 'chase.com', 'bankofamerica.com', 'wellsfargo.com',
  'citi.com', 'capitalone.com', 'americanexpress.com', 'amazon.com', 'apple.com',
  'icloud.com', 'google.com', 'microsoft.com', 'coinbase.com', 'fidelity.com',
  'schwab.com', 'usps.com', 'fedex.com', 'ups.com', 'irs.gov',
];
