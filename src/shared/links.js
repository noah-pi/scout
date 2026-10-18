// Ask Scout about a link: local checks on where it points, before you click.
// Pure. Domain age is looked up separately (it leaves the browser).
import { DEFAULT_PROTECTED, findLookalike, hasPunycode, registrableDomain } from './tripwire.js';

const SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in', 's.id', 't.ly', 'bl.ink']);

export function linkFindings(href, protectedDomains = DEFAULT_PROTECTED) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { host: null, findings: [{ severity: 'soft', text: "This isn't a valid web address." }] };
  }
  const host = url.hostname;
  const findings = [];
  if (url.username || url.password) findings.push({ severity: 'hard', text: `The address hides its real destination behind "${url.username}@"; it goes to ${host}.` });
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) findings.push({ severity: 'soft', text: 'It points at a bare IP address, not a named site.' });
  if (url.protocol === 'http:') findings.push({ severity: 'soft', text: "It isn't encrypted (http)." });
  if (!/^https?:$/.test(url.protocol)) findings.push({ severity: 'soft', text: `It uses the ${url.protocol} scheme, not a web page.` });
  if (SHORTENERS.has(registrableDomain(host))) findings.push({ severity: 'soft', text: "It's a shortened link, so the destination is hidden until you click." });
  if (hasPunycode(host)) findings.push({ severity: 'soft', text: 'The domain uses non-Latin characters encoded as punycode.' });
  if (host.split('.').length > 5) findings.push({ severity: 'soft', text: 'The address has an unusually long chain of subdomains.' });
  const look = findLookalike(host, protectedDomains);
  if (look && look.kind !== 'other-suffix') findings.push({ severity: 'hard', text: `It imitates ${look.target} (${look.kind}).` });
  return { host, domain: registrableDomain(host), findings };
}
