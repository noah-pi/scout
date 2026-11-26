// Link services whose purpose is to record who opens a link: IP address,
// rough location, browser and device, and the time. People who want to unmask
// a reporter, a source or an activist send these. The list is partial;
// Grabify alone rotates through many innocent-looking domains.
import { registrableDomain } from './tripwire.js';

export const IP_LOGGERS = {
  'grabify.link': 'Grabify',
  'grabify.org': 'Grabify',
  'bmwforum.co': 'Grabify',
  'leancoding.co': 'Grabify',
  'spottyfly.com': 'Grabify',
  'stopify.co': 'Grabify',
  'quickmessage.us': 'Grabify',
  'joinmy.site': 'Grabify',
  'screenshare.pics': 'Grabify',
  'myprivate.pics': 'Grabify',
  'headshot.monster': 'Grabify',
  'gamingfun.me': 'Grabify',
  'catsnthings.fun': 'Grabify',
  'iplogger.org': 'IPLogger',
  'iplogger.com': 'IPLogger',
  'iplogger.ru': 'IPLogger',
  'iplogger.co': 'IPLogger',
  'iplogger.info': 'IPLogger',
  '2no.co': 'IPLogger',
  'yip.su': 'IPLogger',
  'iplis.ru': 'IPLogger',
  'ezstat.ru': 'IPLogger',
  'blasze.com': 'Blasze',
  'whatstheirip.com': 'WhatsTheirIP',
  'canarytokens.com': 'Canarytokens',
};

export function ipLogger(host) {
  if (!host) return null;
  const name = IP_LOGGERS[registrableDomain(String(host).toLowerCase())];
  return name ? { service: name, domain: registrableDomain(host) } : null;
}

// Regexes for the DNR rules that stop page loads on these domains, a few
// domains each: Chrome compiles each regex within 2 KB, and a longer list
// overflows it. RE2 syntax. A port is allowed so the browser tests can use
// their own server; \0 in a rule's substitution is then the whole URL.
export function ipLoggerRegexes(domains = Object.keys(IP_LOGGERS), per = 4) {
  const out = [];
  for (let i = 0; i < domains.length; i += per) {
    const alt = domains.slice(i, i + per).map((d) => d.replace(/[.]/g, '\\.')).join('|');
    out.push(`^https?://([a-z0-9-]+\\.)*(${alt})[:/].*`);
  }
  return out;
}
