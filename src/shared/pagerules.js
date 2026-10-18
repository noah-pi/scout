// Page rules: what the calm layer hides and how AI-labeled posts are found.
// The bundled copy (data/page-rules.json) is refreshed daily from the repo;
// anything fetched passes through validateRules first. Rules can only hide:
// CSS selectors and short text patterns, never code. Pure.

const MAX = { selectors: 60, selector: 300, texts: 40, text: 80, sites: 40 };

const strings = (list, maxItems, maxLen) =>
  (Array.isArray(list) ? list : []).filter((s) => typeof s === 'string' && s.length > 0 && s.length <= maxLen).slice(0, maxItems);

// A selector is accepted only if the browser (or a test stand-in) can parse
// it; isValidSelector is injected so this stays pure.
export function validateRules(raw, isValidSelector = () => true) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.version) || raw.version < 1) throw new Error('page rules: bad version');
  const sel = (list) => strings(list, MAX.selectors, MAX.selector).filter((s) => isValidSelector(s));
  const calm = {};
  for (const [key, rule] of Object.entries(raw.calm ?? {}).slice(0, 30)) {
    if (!/^[a-zA-Z][\w-]{0,30}$/.test(key) || typeof rule !== 'object') continue;
    calm[key] = {
      label: strings([rule.label], 1, 80)[0] ?? key,
      sites: strings(rule.sites, MAX.sites, 80),
      selectors: sel(rule.selectors),
      exempt: strings(rule.exempt, MAX.sites, 80),
      behavior: rule.behavior === 'pause-autoplay' ? 'pause-autoplay' : undefined,
      textBlocks: rule.textBlocks ? { texts: strings(rule.textBlocks.texts, MAX.texts, MAX.text), container: sel([rule.textBlocks.container])[0] ?? null } : undefined,
    };
  }
  const labels = raw.aiLabels ?? {};
  const platforms = {};
  for (const [name, p] of Object.entries(labels.platforms ?? {}).slice(0, 20)) {
    const container = sel([p?.container])[0];
    const sites = strings(p?.sites, MAX.sites, 80);
    if (container && sites.length) platforms[strings([name], 1, 40)[0] ?? 'platform'] = { sites, container };
  }
  return {
    version: raw.version,
    updated: strings([raw.updated], 1, 40)[0] ?? null,
    calm,
    aiLabels: { label: strings([labels.label], 1, 80)[0] ?? 'Hide AI-labeled posts', texts: strings(labels.texts, MAX.texts, MAX.text), platforms },
  };
}

// "youtube.com" matches it and its subdomains; "google.*" any Google
// country domain; "*" everything.
export function siteMatches(pattern, host) {
  host = host.toLowerCase();
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const base = pattern.slice(0, -2);
    return new RegExp(`(^|\\.)${base.replace(/\./g, '\\.')}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

export const onSite = (sites, host) => (sites ?? []).some((p) => siteMatches(p, host));

// Exact, case-insensitive match on a short label's whole text.
export function labelMatcher(texts) {
  const set = new Set(texts.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()));
  return (text) => {
    const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length <= 60 && set.has(t);
  };
}
