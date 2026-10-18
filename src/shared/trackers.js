// Starter tracker map. scripts/build-rules.mjs turns it into rules/trackers.json.
// A converted EasyPrivacy list replaces this in a later phase; the company
// labels stay, since they power the ledger.
export const TRACKERS = {
  'doubleclick.net': { company: 'Google', category: 'advertising' },
  'google-analytics.com': { company: 'Google', category: 'analytics' },
  'googlesyndication.com': { company: 'Google', category: 'advertising' },
  'connect.facebook.net': { company: 'Meta', category: 'advertising' },
  'analytics.tiktok.com': { company: 'ByteDance', category: 'advertising' },
  'bat.bing.com': { company: 'Microsoft', category: 'advertising' },
  'clarity.ms': { company: 'Microsoft', category: 'session recording' },
  'adnxs.com': { company: 'Microsoft (Xandr)', category: 'advertising' },
  'scorecardresearch.com': { company: 'Comscore', category: 'analytics' },
  'quantserve.com': { company: 'Quantcast', category: 'advertising' },
  'criteo.com': { company: 'Criteo', category: 'advertising' },
  'taboola.com': { company: 'Taboola', category: 'advertising' },
  'outbrain.com': { company: 'Outbrain', category: 'advertising' },
  'hotjar.com': { company: 'Hotjar', category: 'session recording' },
  'fullstory.com': { company: 'FullStory', category: 'session recording' },
};

// Walks up the labels so "px.ads.criteo.com" resolves to criteo.com.
export function trackerFor(host) {
  const labels = host.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (TRACKERS[candidate]) return { domain: candidate, ...TRACKERS[candidate] };
  }
  return null;
}
