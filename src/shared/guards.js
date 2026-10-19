// Small, pure detectors behind Scout's page guards: session recorders,
// affiliate links, stale stories, dark patterns, clipboard commands, wallet
// address swaps, wrapped links, disguised downloads and email trackers.
// Shared by the content scripts (bundled) and the service worker.

const hostOf = (url) => {
  try {
    return new URL(url, 'https://x.invalid').hostname.toLowerCase();
  } catch {
    return '';
  }
};
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const lookup = (table, url) => {
  const host = hostOf(url);
  for (const [domain, name] of table) if (onDomain(host, domain)) return name;
  return null;
};

// Session-replay tools record keystrokes, clicks and mouse movement.
export const REPLAY = [
  ['hotjar.com', 'Hotjar'],
  ['hotjar.io', 'Hotjar'],
  ['fullstory.com', 'FullStory'],
  ['logrocket.com', 'LogRocket'],
  ['logrocket.io', 'LogRocket'],
  ['lr-ingest.io', 'LogRocket'],
  ['lr-in.com', 'LogRocket'],
  ['lr-in-prod.com', 'LogRocket'],
  ['mouseflow.com', 'Mouseflow'],
  ['smartlook.com', 'Smartlook'],
  ['smartlook.cloud', 'Smartlook'],
  ['clarity.ms', 'Microsoft Clarity'],
  ['quantummetric.com', 'Quantum Metric'],
  ['contentsquare.net', 'Contentsquare'],
  ['contentsquare.com', 'Contentsquare'],
  ['glassboxdigital.io', 'Glassbox'],
  ['inspectlet.com', 'Inspectlet'],
  ['luckyorange.com', 'Lucky Orange'],
  ['luckyorange.net', 'Lucky Orange'],
  ['crazyegg.com', 'Crazy Egg'],
  ['sessioncam.com', 'SessionCam'],
  ['decibelinsight.net', 'Decibel'],
  ['heapanalytics.com', 'Heap'],
  ['uxcam.com', 'UXCam'],
];
export const replayVendor = (url) => lookup(REPLAY, url) ?? (/mc\.yandex\.(ru|com)\/.*webvisor|webvisor/i.test(url) ? 'Yandex Webvisor' : null);

// Links that pay the site when you buy.
const AFFILIATE = [
  ['amzn.to', 'Amazon'],
  ['amzn.com', 'Amazon'],
  ['go.skimresources.com', 'Skimlinks'],
  ['go.redirectingat.com', 'Skimlinks'],
  ['redirect.viglink.com', 'Sovrn'],
  ['shareasale.com', 'ShareASale'],
  ['awin1.com', 'Awin'],
  ['click.linksynergy.com', 'Rakuten'],
  ['anrdoezrs.net', 'CJ'],
  ['jdoqocy.com', 'CJ'],
  ['tkqlhce.com', 'CJ'],
  ['dpbolvw.net', 'CJ'],
  ['kqzyfj.com', 'CJ'],
  ['prf.hn', 'Partnerize'],
  ['pntra.com', 'Pepperjam'],
  ['pjtra.com', 'Pepperjam'],
  ['gopjn.com', 'Pepperjam'],
  ['sjv.io', 'Impact'],
  ['pxf.io', 'Impact'],
  ['7tiv.net', 'Impact'],
  ['evyy.net', 'Impact'],
  ['ojrq.net', 'Impact'],
  ['howl.me', 'Howl'],
  ['howl.link', 'Howl'],
  ['geni.us', 'Geniuslink'],
  ['shop-links.co', 'Narrativ'],
  ['avantlink.com', 'AvantLink'],
  ['flexlinkspro.com', 'FlexOffers'],
  ['shopltk.com', 'LTK'],
  ['liketk.it', 'LTK'],
  ['rover.ebay.com', 'eBay'],
  ['goto.walmart.com', 'Walmart'],
  ['affil.walmart.com', 'Walmart'],
  ['goto.target.com', 'Target'],
];
export function affiliateNetwork(href) {
  const named = lookup(AFFILIATE, href);
  if (named) return named;
  try {
    const u = new URL(href, 'https://x.invalid');
    if (/(^|\.)amazon\.[a-z.]{2,6}$/.test(u.hostname) && u.searchParams.has('tag')) return 'Amazon';
    if (/(^|\.)ebay\.[a-z.]{2,6}$/.test(u.hostname) && u.searchParams.has('campid')) return 'eBay';
  } catch {}
  return null;
}

// Publication dates, from the page's own metadata. Returns epoch ms or null.
export function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(String(value).trim());
  return Number.isFinite(t) && t > Date.UTC(1995, 0, 1) && t < Date.now() + 86_400_000 ? t : null;
}

const DAY = 86_400_000;
const fmt = (t) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
function ago(ms) {
  const days = Math.floor(ms / DAY);
  if (days < 1) return 'today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.4);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(days / 365.25)} years ago`;
}

// A story more than a year old, said plainly. `stale` decides whether the
// page itself gets a note too (two years and up).
export function dateNote({ published, modified }, now = Date.now()) {
  if (!published || now - published < 365 * DAY) return null;
  const freshEdit = modified && modified - published > 30 * DAY && now - modified < 30 * DAY;
  const text = `Published ${fmt(published)}, ${ago(now - published)}${freshEdit ? `; updated ${ago(now - modified)}` : ''}.`;
  return { text, stale: now - published >= 730 * DAY, published, modified: modified ?? null };
}

// Dark patterns on shop and sign-up pages.
export const SCARCITY = /only \d+ left|\d+ (people|others|shoppers) (are )?(viewing|looking at|watching)|selling fast|almost gone|low in stock|\d+ (sold|bought|booked) in the (last|past)|nur noch \d+|plus que \d+ en stock|solo quedan \d+/i;
export const SHAMING = /no,? thanks?,? i (don'?t|do not) (want|like|need|care)|i('d)? rather (pay full|miss out|not save)|i (don'?t|do not) (want|like) (to )?(sav|discount|deal|free|money)|i prefer (to )?pay (full|more)|i('ll)? pass on (savings|the deal)/i;
export const ADDON = /insurance|protection plan|warranty|donat|newsletter|subscribe|marketing|special offers|partners|add[- ]on|gift wrap|\btip\b|carbon offset|priority (processing|support)/i;

// facts: { timers, scarcity: [], prechecked: [], shaming: [] }
export function darkPatternFlags(facts) {
  if (!facts) return [];
  const flags = [];
  if (facts.timers) flags.push({ kind: 'dark:timer', text: 'A countdown timer is pressing you to decide.' });
  if (facts.scarcity?.length) flags.push({ kind: 'dark:scarcity', text: `Scarcity claim: "${facts.scarcity[0]}". These are often invented.` });
  if (facts.prechecked?.length) flags.push({ kind: 'dark:prechecked', text: `Pre-ticked: ${facts.prechecked.slice(0, 3).map((t) => `"${t}"`).join(', ')}. Untick what you didn't choose.` });
  if (facts.shaming?.length) flags.push({ kind: 'dark:shaming', text: `Guilt-trip opt-out: "${facts.shaming[0]}".` });
  return flags.map((f) => ({ ...f, severity: 'soft' }));
}

// A command a page put on your clipboard. Fake CAPTCHAs ("press Win+R, then
// Ctrl+V") rely on it; no legitimate page needs to hand you a shell command
// you didn't select yourself.
const COMMAND = /\b(powershell|pwsh)\b|\bcmd(\.exe)?\s*\/[ck]\b|\bmshta\b|\brundll32\b|\bregsvr32\b|\bcertutil\b|\bbitsadmin\b|\b[wc]script\b|invoke-(webrequest|expression|restmethod)|\biex\b|\biwr\s|\b(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b|\bosascript\b|base64\s+(-d|--decode)|frombase64string|start-process|\s-e(nc|ncodedcommand)?\s+[a-z0-9+/=]{20,}|\bmsiexec\s|%temp%|\$env:|\bappdata\b|\bchmod\s+\+x\b/i;
export function commandIn(text) {
  const t = String(text ?? '');
  if (t.length < 6 || t.length > 8000) return null;
  const m = t.match(COMMAND);
  return m ? m[0].trim() : null;
}

// Wallet addresses, by family. Attackers swap a copied address for their own,
// often one that shares its first and last few characters.
const ADDRESS = [
  ['Bitcoin', /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/],
  ['Ethereum-style', /^0x[a-fA-F0-9]{40}$/],
  ['Tron', /^T[1-9A-HJ-NP-Za-km-z]{33}$/],
  ['Litecoin', /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM][1-9A-HJ-NP-Za-km-z]{26,33})$/],
  ['XRP', /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/],
  ['Solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/],
];
export function addressKind(text) {
  const t = String(text ?? '').trim();
  if (t.length < 25 || t.length > 90 || /\s/.test(t)) return null;
  return ADDRESS.find(([, re]) => re.test(t))?.[0] ?? null;
}
export function addressSwap(copied, pasted) {
  const a = String(copied ?? '').trim();
  const b = String(pasted ?? '').trim();
  const kind = addressKind(b);
  if (!kind || !addressKind(a) || a === b) return null;
  const lookalike = a.slice(0, 4) === b.slice(0, 4) || a.slice(-4) === b.slice(-4);
  return { kind, lookalike, text: `The ${kind} address you pasted isn't the one you copied${lookalike ? ', though it starts or ends the same way' : ''}. Something may have swapped it.` };
}

// Redirect wrappers that log your click on the way out.
const WRAPPERS = [
  [/^(www\.)?google\.[a-z.]+$/, '/url', ['q', 'url']],
  [/^l\.facebook\.com$|^lm\.facebook\.com$/, '/l.php', ['u']],
  [/^l\.instagram\.com$/, '/', ['u']],
  [/^(www\.)?youtube\.com$/, '/redirect', ['q']],
  [/^t\.umblr\.com$/, '/redirect', ['z']],
  [/^slack-redir\.net$/, '/link', ['url']],
  [/^steamcommunity\.com$/, '/linkfilter/', ['url', 'u']],
  [/safelinks\.protection\.outlook\.com$/, '/', ['url']],
  [/^(www\.)?linkedin\.com$/, '/redir/redirect', ['url']],
  [/^disq\.us$/, '/url', ['url']],
  [/^away\.vk\.com$/, '/away.php', ['to']],
  [/^(www\.)?bing\.com$/, '/ck/a', ['u']],
];
export function unwrap(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  for (const [host, path, params] of WRAPPERS) {
    if (!host.test(u.hostname) || !u.pathname.startsWith(path)) continue;
    for (const p of params) {
      let target = u.searchParams.get(p);
      if (!target) continue;
      if (u.hostname.endsWith('bing.com') && target.startsWith('a1')) {
        try {
          target = atob(target.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
        } catch {
          continue;
        }
      }
      if (u.hostname === 'disq.us') target = target.replace(/:[\w-]+$/, '');
      try {
        const t = new URL(target);
        if (t.protocol === 'http:' || t.protocol === 'https:') return t.href;
      } catch {}
    }
  }
  return null;
}

// Downloads dressed up as documents.
const DOC = '(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|csv|mp4|mov|mp3|wav|zip|rtf|html?)';
const RUNS = '(exe|scr|com|bat|cmd|msi|msix|js|jse|vbs|vbe|wsf|wsh|hta|lnk|ps1|psm1|jar|apk|dmg|pkg|app|iso|img|vhdx?|cpl|reg|scf|url)';
export function disguisedDownload(filename) {
  const name = String(filename ?? '').split(/[\\/]/).pop();
  if (/[‪-‮⁦-⁩]/.test(name)) return `"${name.replace(/[‪-‮⁦-⁩]/g, '')}" hides its real extension with a text-direction character.`;
  if (new RegExp(`\\.${DOC}\\s*\\.${RUNS}$`, 'i').test(name)) return `"${name}" looks like a document but is a program.`;
  if (new RegExp(`\\.${DOC}\\s{3,}`, 'i').test(name)) return `"${name}" pads its name with spaces to hide the real extension.`;
  return null;
}
export const runnable = (filename) => new RegExp(`\\.${RUNS}$`, 'i').test(String(filename ?? ''));

// Open-tracking pixels and click trackers in email.
const EMAIL = [
  ['list-manage.com', 'Mailchimp'],
  ['mailchimp.com', 'Mailchimp'],
  ['sendgrid.net', 'SendGrid'],
  ['hubspotemail.net', 'HubSpot'],
  ['hubspotlinks.com', 'HubSpot'],
  ['hs-analytics.net', 'HubSpot'],
  ['mailtrack.io', 'Mailtrack'],
  ['superhuman.com', 'Superhuman'],
  ['mixmax.com', 'Mixmax'],
  ['yesware.com', 'Yesware'],
  ['mailfoogae.appspot.com', 'Streak'],
  ['bananatag.com', 'Bananatag'],
  ['mandrillapp.com', 'Mandrill'],
  ['mailgun.org', 'Mailgun'],
  ['klaviyomail.com', 'Klaviyo'],
  ['klaviyo.com', 'Klaviyo'],
  ['rs6.net', 'Constant Contact'],
  ['exacttarget.com', 'Salesforce Marketing Cloud'],
  ['mktoweb.com', 'Marketo'],
  ['mktdns.com', 'Marketo'],
  ['customer.io', 'Customer.io'],
  ['substack.com', 'Substack'],
  ['convertkit-mail.com', 'ConvertKit'],
  ['convertkit-mail2.com', 'ConvertKit'],
  ['sailthru.com', 'Sailthru'],
  ['createsend.com', 'Campaign Monitor'],
  ['cmail19.com', 'Campaign Monitor'],
  ['cmail20.com', 'Campaign Monitor'],
  ['intercom-mail.com', 'Intercom'],
  ['mailjet.com', 'Mailjet'],
  ['sparkpostmail.com', 'SparkPost'],
  ['postmarkapp.com', 'Postmark'],
  ['getresponse.com', 'GetResponse'],
  ['beehiiv.com', 'beehiiv'],
  ['ct.sendgrid.net', 'SendGrid'],
];
export const emailTracker = (url) => lookup(EMAIL, url);

// Gmail proxies remote images and keeps the original address after a '#'.
export function gmailOriginal(src) {
  const i = String(src ?? '').indexOf('#http');
  return i >= 0 ? src.slice(i + 1) : null;
}
