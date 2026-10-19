// The weekly page: daily totals from the last seven days, read from
// storage.local through the service worker. Nothing here leaves the browser.
const $ = (id) => document.getElementById(id);
const ask = async (message) => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error ?? 'No response');
  return res.value;
};
const el = (tag, className = '', text = '') => Object.assign(document.createElement(tag), { className, textContent: text });

const GUARD_NAMES = {
  warnings: 'Warnings shown',
  'clipboard-blocked': 'Clipboard commands stopped',
  'clipboard-noted': 'Clipboard commands noted',
  'address-swap': 'Swapped wallet addresses caught',
  downloads: 'Downloads paused',
  notifications: 'Notification prompts held back',
  replay: 'Session recorders seen',
  unwrapped: 'Tracked links unwrapped',
  email: 'Tracked emails marked',
  forgotten: 'Sites forgotten on close',
};

function add(into, from) {
  for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v;
  return into;
}

function emptyRow(text) {
  const li = el('li', 'label-row');
  li.append(el('span', 'n', text));
  return li;
}

function rows(list, entries, empty, bars = false) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  list.replaceChildren(
    ...(entries.length
      ? entries.map(([name, n]) => {
          const li = el('li', `label-row${bars ? ' bar' : ''}`);
          if (bars) li.style.setProperty('--w', `${Math.round((n / max) * 100)}%`);
          li.append(el('span', 'n', name), el('span', 'v', n.toLocaleString()));
          return li;
        })
      : [emptyRow(empty)]),
  );
}

async function main() {
  const history = await ask({ type: 'getHistory' });
  const days = Object.keys(history).sort().slice(-7);
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' });
  $('range').textContent = !days.length ? 'Nothing counted yet.' : days.length === 1 ? `Since ${fmt(days[0])}` : `${fmt(days[0])} to ${fmt(days.at(-1))}`;
  const week = { blocked: {}, companies: {}, sites: {}, guards: {}, banners: 0 };
  for (const d of days) {
    const h = history[d];
    add(week.blocked, h.blocked);
    add(week.companies, h.companies);
    add(week.sites, h.sites);
    add(week.guards, h.guards);
    week.banners += h.banners ?? 0;
  }
  const stats = [
    [week.blocked.trackers ?? 0, 'Trackers blocked'],
    [week.blocked.ads ?? 0, 'Ads blocked'],
    [week.banners, 'Cookie banners answered'],
    [Object.keys(week.companies).length, 'Companies kept out'],
  ];
  $('totals').replaceChildren(
    ...stats.map(([n, k]) => {
      const box = el('div', 'stat');
      box.append(el('div', 'n', n.toLocaleString()), el('div', 'k', k));
      return box;
    }),
  );
  const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  rows($('companies'), top(week.companies), 'None yet', true);
  rows($('sites'), top(week.sites), 'None yet', true);
  rows($('guards'), top(week.guards, 20).map(([k, n]) => [GUARD_NAMES[k] ?? k, n]), 'Nothing needed stepping in. Good.');

  const { receipts = [] } = await chrome.storage.local.get('receipts');
  const since = Date.now() - 7 * 86_400_000;
  const sent = {};
  let usd = 0;
  for (const r of receipts) {
    if (r.at < since || r.dryRun) continue;
    sent[r.service] = (sent[r.service] ?? 0) + 1;
    usd += r.usd ?? 0;
  }
  rows($('sent'), top(sent, 12).map(([s, n]) => [s, n]), 'Nothing. Every check ran on this machine.');
  if (usd) {
    const li = el('li', 'label-row');
    li.append(el('span', 'n', 'Spent on cloud checks'), el('span', 'v', `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`));
    $('sent').append(li);
  }
}

main().catch((error) => ($('range').textContent = error.message));
