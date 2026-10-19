import { MODELS } from '../shared/assessment.js';
import { MODES } from '../shared/modes.js';

const $ = (id) => document.getElementById(id);
const dollars = (usd) => (usd > 0 && usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const time = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const ask = async (message) => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error ?? 'No response');
  return res.value;
};

const activeTabId = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
const li = (className, ...children) => {
  const node = el('li', className);
  node.append(...children);
  return node;
};
const linkButton = (text, onclick, extra = '') => Object.assign(el('button', `btn link ${extra}`.trim(), text), { type: 'button', onclick });
const empty = (text) => li('row empty', text);

// Tones from the worker, mapped onto the panel's three colors.
const TONE = { bad: 'bad', tampered: 'bad', mixed: 'mixed', ai: 'mixed', ok: 'good', captured: 'good', credentials: 'good' };

// Verdicts state what Scout saw; the icon carries the status. Nothing found
// stays neutral gray: green is for a site you chose to trust.
const RING = '<circle cx="12" cy="12" r="9"/>';
const LEVEL = {
  quiet: { verdict: 'Nothing found', glyph: '<path d="M18.4 5.6A9 9 0 1 0 21 12"/><circle class="fill" cx="12" cy="12" r="3.4"/>' },
  note: { verdict: 'Worth a look', glyph: `${RING}<path d="M12 7.5v5.2"/><circle class="fill" cx="12" cy="16.3" r="1.1"/>` },
  stop: { verdict: 'Stop and check', glyph: `${RING}<path d="M9 9l6 6M15 9l-6 6"/>` },
  trusted: { verdict: 'You trust this site', glyph: `${RING}<path d="M8.2 12.3l2.6 2.6 5-5.2"/>` },
  idle: { verdict: 'No page open', glyph: `${RING}<path d="M8.5 12h7"/>` },
};

function lede(level, tab) {
  const soft = tab.flags.filter((f) => f.severity === 'soft').length;
  if (level === 'idle') return 'Open a web page and Scout will look it over.';
  if (level === 'trusted') return 'Warnings are off here. Trust lapses after a year, or if the domain changes hands.';
  if (level === 'stop') return 'Something here doesn’t match. Don’t type anything until you’ve read why.';
  if (level === 'note') return `${soft === 1 ? 'One thing' : `${soft} things`} on this page could mislead. Read below.`;
  const stakes = tab.stakes && Object.entries(tab.stakes).filter(([, v]) => v).map(([k]) => ({ password: 'a password', payment: 'card details', otp: 'a one-time code', seed: 'a recovery phrase' })[k]);
  return stakes?.length ? `This page asks for ${stakes.join(' and ')}. No warning signs so far.` : 'No warning signs on this page.';
}

const VERDICTS = { likely_scam: 'Likely a scam', unclear: "Can't tell", likely_safe: 'Nothing wrong found' };
const VERDICT_TONE = { likely_scam: 'bad', unclear: 'mixed', likely_safe: 'good' };
const COORDINATION = { none: 'No sign of coordination', weak: 'Weak signs of coordination', moderate: 'Moderate signs of coordination', strong: 'Strong signs of coordination' };
const COORDINATION_TONE = { none: 'good', weak: '', moderate: 'mixed', strong: 'bad' };
const NANO = {
  available: 'Gemini Nano is ready on this device',
  downloadable: 'Gemini Nano can run on this device',
  downloading: 'Gemini Nano is downloading',
  unavailable: "Gemini Nano isn't available here",
  unsupported: "This Chrome doesn't offer Gemini Nano",
};

function card(box, { lead, tone = '', body = [], list = [], meta }) {
  const parts = [el('p', `lead ${tone}`.trim(), lead)];
  for (const line of body.filter(Boolean)) parts.push(el('p', '', line));
  if (list.length) {
    const ul = el('ul');
    ul.append(...list.map((t) => el('li', '', t)));
    parts.push(ul);
  }
  if (meta) parts.push(el('p', 'meta', meta));
  box.replaceChildren(...parts);
  box.hidden = false;
}

async function render() {
  const tabId = await activeTabId();
  if (tabId === undefined) return;
  const state = await ask({ type: 'panelState', tabId });
  const { tab, blocked, receipts, chrome: protection, settings, spend, nano, shields, site, trusted, extensions, pageRules } = state;
  renderBanners(state, site);
  renderTools(state, tab);
  renderGuards(state, tab, site);
  renderModeAndGuards(state.guards, shields, site);
  renderActivity();
  renderOutlet(tab.outlet);

  const level = !tab.host ? 'idle' : tab.trusted ? 'trusted' : tab.level;
  $('hero').dataset.level = level;
  $('verdict').textContent = LEVEL[level].verdict;
  $('glyph').innerHTML = LEVEL[level].glyph;
  $('lede').textContent = lede(level, tab);
  $('host').textContent = tab.host ?? '';
  $('page-actions').hidden = !tab.host;
  // Ink marks the one thing to do; on a quiet page there isn't one.
  $('investigate').classList.toggle('primary', level === 'note' || level === 'stop');
  $('investigate').classList.toggle('secondary', !(level === 'note' || level === 'stop'));
  $('trust').hidden = !tab.host;
  $('trust').textContent = tab.trusted ? 'Stop trusting this site' : level === 'stop' ? 'Trust anyway' : 'Trust this site';
  $('trust').classList.toggle('danger', level === 'stop');

  // Fingerprinting is reported in the label below, with what was read.
  const flags = tab.trusted ? [] : tab.flags.filter((f) => f.kind !== 'fingerprinting');
  $('notes').hidden = !flags.length;
  $('notes').replaceChildren(
    ...flags.map((flag) => {
      const row = li(`row finding ${flag.severity}`, el('span', 'dot'), el('span', 'grow', flag.text));
      if (flag.severity === 'soft') row.append(linkButton('Not useful', () => ask({ type: 'dismiss', tabId, kind: flag.kind }).then(render)));
      return row;
    }),
  );

  renderBlocked(tab, blocked);
  renderInvestigation(tab.investigation);
  renderFinePrint(tab.finePrint);
  renderCensus(tab.census);
  renderImages(tab.images ?? []);
  renderAsked(tab.asked ?? []);
  renderSpoilers(tab.spoilersHidden ?? 0);
  renderShields(tab, site, shields, trusted, extensions);
  renderCalm(tab, shields, pageRules);

  $('chrome').textContent =
    protection.safeBrowsing === false
      ? 'Safe Browsing is off. Chrome isn’t checking pages against its list of known scams.'
      : protection.safeBrowsing
        ? 'Safe Browsing is on. Enhanced protection adds on-device scam detection; extensions can’t see which you have.'
        : 'Safe Browsing status is unavailable.';

  $('spend').textContent = settings.cloud
    ? `${spend.calls} of ${settings.dailyCap} page checks · ${plural(spend.spoilerCalls ?? 0, 'spoiler check')} · ${dollars(spend.usd)}`
    : settings.hasKey
      ? `Cloud checks are off · ${dollars(spend.usd)} today`
      : 'Cloud checks are off. Add a key to use Investigate.';
  $('nano').textContent = NANO[nano] ?? `Gemini Nano: ${nano}`;
  $('nano-download').hidden = nano !== 'downloadable';
  fillSettings(settings);

  $('receipts').replaceChildren(
    ...(receipts.length
      ? receipts.map((r) => {
          const row = li(`row receipt${r.dryRun ? ' dry' : ''}`, el('span', 'what', r.service), el('span', 'when', time(r.at)), el('span', 'sent', r.sent));
          if (r.usd) row.querySelector('.when').textContent += ` · ${dollars(r.usd)}`;
          return row;
        })
      : [empty('Nothing has left this browser yet.')]),
  );
}

function renderBlocked(tab, blocked) {
  const byCompany = {};
  for (const t of Object.values(tab.trackers)) byCompany[t.company] = (byCompany[t.company] ?? 0) + t.blocked;
  const companies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);
  const attributed = companies.reduce((n, [, count]) => n + count, 0);
  const unnamed = Math.max(0, blocked - attributed);
  const rows = [...companies];
  if (unnamed) rows.push(['Before Scout could name them', unnamed]);
  const trackers = attributed + unnamed;

  const value = (row, text, tone = '') => {
    const v = row.querySelector('.v');
    v.textContent = text;
    v.className = `v ${tone}`.trim();
  };
  value($('blocked-toggle'), trackers ? `${trackers}${companies.length ? ` · ${plural(companies.length, 'company', 'companies')}` : ''}` : 'None', trackers ? '' : 'dim');
  const toggle = $('blocked-toggle');
  toggle.disabled = !rows.length;
  if (!rows.length) {
    toggle.setAttribute('aria-expanded', 'false');
    $('trackers').hidden = true;
  }
  $('trackers').replaceChildren(...rows.map(([name, n]) => li('', el('span', '', name), el('span', 'count', String(n)))));

  $('fingerprinting').hidden = !tab.fingerprinting.length;
  value($('fingerprinting'), `${tab.fingerprinting.join(', ')} · seen`, 'dim');
  $('ads-row').hidden = !tab.ads;
  $('ads').textContent = String(tab.ads ?? 0);
  $('consent').hidden = !tab.consent;
  if (tab.consent)
    value(
      $('consent'),
      `${tab.consent.failed ? 'Couldn’t reject' : tab.consent.cosmetic ? 'Hidden' : 'Rejected'} · ${tab.consent.cmp}`,
      tab.consent.failed ? 'warn' : '',
    );
  $('slop').hidden = !tab.slopHidden;
  value($('slop'), `${tab.slopHidden ?? 0} folded`);
}

$('blocked-toggle').onclick = () => {
  const toggle = $('blocked-toggle');
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  $('trackers').hidden = !open;
};

function renderInvestigation(inv) {
  const box = $('investigation');
  if (!inv) return (box.hidden = true);
  if (inv.declined) return card(box, { lead: 'Claude couldn’t assess this page', body: [inv.declined], meta: `${inv.model} · ${time(inv.at)}` });
  card(box, { lead: VERDICTS[inv.verdict] ?? inv.verdict, tone: VERDICT_TONE[inv.verdict], body: [inv.summary], list: inv.reasons ?? [], meta: `${inv.model} · ${time(inv.at)}` });
}

function renderFinePrint(fp) {
  const box = $('fine-print-result');
  if (!fp) return (box.hidden = true);
  if (fp.declined) return card(box, { lead: 'Couldn’t read these terms', body: [fp.declined] });
  const list = el('ul', 'fine-list');
  for (const point of fp.points) {
    const text = el('div', 'grow');
    const quote = el('blockquote', point.verified ? '' : 'unverified', `“${point.quote}”`);
    if (!point.verified) quote.title = 'Not found word for word in the text. Treat with caution.';
    text.append(el('p', '', point.text), quote);
    list.append(li(`fine-point ${{ bad: 'bad', good: 'good' }[point.verdict] ?? ''}`, el('span', 'dot'), text));
  }
  card(box, { lead: 'Fine print', body: [fp.summary], meta: `${fp.model} · ${fp.sources.map((s) => new URL(s).pathname).join(', ')}` });
  box.lastChild.before(list);
}

function renderCensus(census) {
  $('census').hidden = !census;
  if (!census) return;
  const verdict = { none: 'Nothing unusual across accounts', some: 'Some patterns across accounts', notable: 'Several patterns line up' }[census.level];
  const summary = $('census-summary');
  summary.replaceChildren(el('strong', '', verdict), el('small', 'secondary', `${plural(census.comments, 'comment')} · ${plural(census.authors, 'account')}${census.checked ? ` · ${census.checked} checked` : ''}`));
  $('census-notes').closest('li').hidden = !census.notes.length;
  // Account lookups exist only on Reddit.
  $('census-profiles').hidden = !census.thread?.subreddit;
  $('census-notes').replaceChildren(...census.notes.map((n) => el('li', '', n)));
  const a = census.analysis;
  const box = $('census-analysis');
  if (!a) box.hidden = true;
  else if (a.declined) card(box, { lead: 'Couldn’t assess this thread', body: [a.declined], meta: `${a.model} · ${time(a.at)}` });
  else card(box, { lead: COORDINATION[a.coordination], tone: COORDINATION_TONE[a.coordination], body: [a.summary], list: a.patterns, meta: `${a.model} · ${time(a.at)}` });
}

function result(item, subject) {
  const row = li('row result', el('p', `headline ${TONE[item.tone] ?? ''}`.trim(), item.headline), ...item.lines.map((l) => el('p', '', l)));
  if (subject) row.append(el('p', 'where', subject));
  return row;
}

function renderImages(images) {
  $('images').hidden = !images.length;
  $('image-list').replaceChildren(
    ...images.map((img) => {
      let where = img.url;
      try {
        const u = new URL(img.url);
        where = `${u.hostname} · ${u.pathname.split('/').pop().slice(0, 40)}`;
      } catch {}
      return result(img, where);
    }),
  );
}

function renderAsked(asked) {
  $('asked').hidden = !asked.length;
  $('asked-list').replaceChildren(...asked.map((a) => result(a, a.kind === 'link' ? a.subject : `“${a.subject}”`)));
}

// Runs a button's work with a spinner in place of its label; errors land in
// the named box so nothing fails silently.
async function busy(button, work, errorBox) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await work();
  } catch (error) {
    const box = $(errorBox);
    if (box.classList.contains('card')) card(box, { lead: 'Something went wrong', body: [error.message] });
    else box.textContent = error.message;
    box.hidden = false;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    render();
  }
}

$('investigate').onclick = (e) => busy(e.currentTarget, async () => ask({ type: 'investigate', tabId: await activeTabId() }), 'investigation');
$('fine-print').onclick = (e) => busy(e.currentTarget, async () => ask({ type: 'finePrint', tabId: await activeTabId() }), 'fine-print-result');
$('census-profiles').onclick = (e) => busy(e.currentTarget, async () => ask({ type: 'censusProfiles', tabId: await activeTabId() }), 'census-analysis');
$('census-analyze').onclick = (e) => busy(e.currentTarget, async () => ask({ type: 'censusAnalyze', tabId: await activeTabId() }), 'census-analysis');
$('rules-refresh').onclick = (e) => busy(e.currentTarget, () => ask({ type: 'refreshPageRules' }), 'rules-status');

$('trust').onclick = async () => {
  const tabId = await activeTabId();
  const { tab } = await ask({ type: 'panelState', tabId });
  await ask({ type: tab.trusted ? 'untrust' : 'trust', tabId });
  render();
};

// Settings: filled once, so a refresh never clobbers what you're typing.
let settingsFilled = false;
function fillSettings(settings) {
  if (settingsFilled) return;
  settingsFilled = true;
  const form = $('settings-form');
  for (const name of ['quickModel', 'deepModel']) {
    form[name].replaceChildren(...MODELS.map((m) => Object.assign(el('option', '', m), { value: m })));
    form[name].value = settings[name];
  }
  form.cloud.checked = settings.cloud;
  form.keyInSession.checked = settings.keyInSession;
  form.dailyCap.value = settings.dailyCap;
  form.spoilerCap.value = settings.spoilerCap;
  form.apiKey.placeholder = settings.hasKey ? 'API key saved · paste a new one to replace it' : 'Anthropic API key';
}

// Settings save as they change, the way system settings do. The key saves
// when you leave the field or press Return, and is never shown again.
let savedTimer;
async function saveSettings(form) {
  const changes = {
    cloud: form.cloud.checked,
    keyInSession: form.keyInSession.checked,
    quickModel: form.quickModel.value,
    deepModel: form.deepModel.value,
    dailyCap: form.dailyCap.value,
    spoilerCap: form.spoilerCap.value,
  };
  if (form.apiKey.value.trim()) changes.apiKey = form.apiKey.value.trim();
  await ask({ type: 'saveSettings', changes });
  form.apiKey.value = '';
  settingsFilled = false;
  $('saved').textContent = changes.apiKey ? 'Key saved.' : 'Saved.';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = 'Changes save as you make them.'), 2000);
  render();
}
$('settings-form').onchange = (event) => saveSettings(event.currentTarget);
$('settings-form').onsubmit = (event) => {
  event.preventDefault();
  saveSettings(event.currentTarget);
};

// Downloading Gemini Nano needs a click, so it starts here, not in the worker.
$('nano-download').onclick = async (e) => {
  const button = e.currentTarget;
  button.setAttribute('aria-busy', 'true');
  try {
    const session = await LanguageModel.create({
      monitor: (m) => m.addEventListener('downloadprogress', (ev) => ($('nano').textContent = `Downloading Gemini Nano · ${Math.round(ev.loaded * 100)}%`)),
    });
    session.destroy();
  } catch (error) {
    $('nano').textContent = `Download failed: ${error.message}`;
  } finally {
    button.removeAttribute('aria-busy');
  }
};

// Spoiler shield: the watchlist lives in extension storage; pages pick up
// changes on their next load.
let spoilers = { enabled: false, mode: 'ai', entries: [] };

async function saveSpoilers(next) {
  spoilers = await ask({ type: 'saveSpoilers', spoilers: next });
  renderSpoilers();
}

function renderSpoilers(hiddenHere = null) {
  $('spoiler-enabled').checked = spoilers.enabled;
  $('spoiler-mode').value = spoilers.mode;
  $('spoiler-list').hidden = !spoilers.entries.length;
  $('spoiler-list').replaceChildren(
    ...spoilers.entries.map((entry, i) => {
      const detail = [entry.watched && `Watched ${entry.watched}`, entry.aliases.length && `Also ${entry.aliases.join(', ')}`].filter(Boolean).join(' · ');
      const text = el('span', 'grow', entry.title);
      if (detail) text.append(el('small', 'secondary', detail));
      return li('row', text, linkButton('Remove', () => saveSpoilers({ ...spoilers, entries: spoilers.entries.filter((_, j) => j !== i) }), 'danger'));
    }),
  );
  if (hiddenHere !== null)
    $('spoiler-status').textContent = !spoilers.enabled ? '' : hiddenHere ? `${plural(hiddenHere, 'passage')} hidden on this page` : 'Nothing hidden on this page';
}

$('spoiler-enabled').onchange = (e) => saveSpoilers({ ...spoilers, enabled: e.target.checked });
$('spoiler-mode').onchange = (e) => saveSpoilers({ ...spoilers, mode: e.target.value });
$('spoiler-form').onsubmit = async (event) => {
  event.preventDefault();
  const f = event.target;
  await saveSpoilers({ ...spoilers, enabled: true, entries: [...spoilers.entries, { title: f.title.value, watched: f.watched.value, aliases: f.aliases.value }] });
  f.reset();
  f.title.focus();
};
ask({ type: 'getSpoilers' }).then((s) => {
  spoilers = s;
  renderSpoilers();
});

function renderShields(tab, site, shields, trusted, extensions) {
  $('slop-enabled').checked = shields.slop;

  const paused = Boolean(site && shields.paused.includes(site));
  $('pause').hidden = !tab.host;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('pause').classList.toggle('danger', !paused);
  $('pause-status').textContent = !tab.host ? 'No site on this tab' : paused ? `Paused on ${site}` : `Blocking on ${site ?? tab.host}`;

  $('trusted-list').replaceChildren(
    ...(trusted.length
      ? trusted.map((t) => li('row', el('span', 'grow', t.domain), linkButton('Remove', () => ask({ type: 'untrustDomain', domain: t.domain }).then(render), 'danger')))
      : [empty('None yet')]),
  );

  $('extensions').replaceChildren(
    ...(extensions.length
      ? extensions.map((e) => {
          const text = el('span', 'grow', e.name);
          text.append(el('small', 'secondary', `${e.reasons.join('; ')}.`));
          return li('row finding', Object.assign(el('span', 'dot'), { style: `background: var(${e.risk >= 3 ? '--red' : e.risk >= 2 ? '--orange' : '--tertiary'})` }), text);
        })
      : [empty('None with broad access')]),
  );
}

function renderCalm(tab, shields, rules) {
  const calm = tab.calm ?? {};
  const names = Object.fromEntries(rules.calm.map(({ key, label }) => [key, label.replace(/^(Hide|Stop) /, '')]));
  const parts = [...Object.entries(calm.hidden ?? {}).map(([k, n]) => `${names[k] ?? k} ${n}`), calm.folded && `${calm.folded} folded`, calm.aiFolded && `${calm.aiFolded} AI-labeled`, calm.paused && `${plural(calm.paused, 'video')} paused`].filter(Boolean);
  $('calm-status').hidden = !parts.length;
  $('calm-status').querySelector('.v').textContent = parts.join(' · ');

  $('calm-toggles').replaceChildren(
    ...rules.calm.map(({ key, label }) => {
      const box = Object.assign(el('input'), { type: 'checkbox', checked: shields.calm?.[key] !== false });
      box.setAttribute('role', 'switch');
      box.onchange = () => ask({ type: 'saveShields', changes: { calm: { ...shields.calm, [key]: box.checked } } }).then(render);
      const row = el('label', 'row switch');
      row.append(el('span', '', label), box);
      return li('', row);
    }),
  );
  $('ai-labels').checked = shields.aiLabels !== false;
  $('ai-platforms').textContent = `By each platform’s own label: ${rules.platforms.join(', ')}`;
  const when = rules.fetchedAt ? new Date(rules.fetchedAt).toLocaleDateString() : 'never';
  $('rules-status').textContent = rules.error
    ? `Rules from ${rules.updated ?? 'unknown'}. The last update check failed: ${rules.error}`
    : `Rules from ${rules.updated ?? 'unknown'}, checked ${when}. They update daily and can only hide things.`;
}

$('ai-labels').onchange = (e) => ask({ type: 'saveShields', changes: { aiLabels: e.target.checked } }).then(render);
$('slop-enabled').onchange = (e) => ask({ type: 'saveShields', changes: { slop: e.target.checked } }).then(render);
$('pause').onclick = async () => {
  await ask({ type: 'togglePause', tabId: await activeTabId() });
  render();
};
$('chrome-settings').onclick = () => ask({ type: 'openChromeSecurity' });

$('export').onclick = async () => {
  const data = await ask({ type: 'exportMemory' });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(el('a'), { href: url, download: `scout-memory-${data.exportedAt.slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
};

$('import').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await ask({ type: 'importMemory', file: JSON.parse(await file.text()) });
  render();
};

// Tabs. The choice is a per-viewer convenience, so localStorage is fine;
// it may be unavailable, and the panel works without it.
const tabs = [...document.querySelectorAll('.pills button')];
function showTab(name) {
  for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const m of document.querySelectorAll('main[data-panel]')) m.hidden = m.dataset.panel !== name;
  scrollTo(0, 0);
  try {
    localStorage.setItem('scout-tab', name);
  } catch {}
}
for (const b of tabs) b.onclick = () => showTab(b.dataset.tab);
document.querySelector('.pills').onkeydown = (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!step) return;
  const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const next = tabs[(i + step + tabs.length) % tabs.length];
  showTab(next.dataset.tab);
  next.focus();
};
let saved = 'page';
try {
  saved = localStorage.getItem('scout-tab') || 'page';
} catch {}
showTab(tabs.some((b) => b.dataset.tab === saved) ? saved : 'page');

// The bar gains a hairline only once content scrolls under it.
addEventListener('scroll', () => document.querySelector('.bar').classList.toggle('scrolled', scrollY > 4), { passive: true });

chrome.tabs.onActivated.addListener(render);
chrome.storage.onChanged.addListener(() => render());
render();

// ---- Banners: a temporary state, said once at the top ----------------------
function renderBanners({ peek, update, version }, site) {
  $('peek-banner').hidden = !(peek && peek.domain === site);
  $('peek-site').textContent = peek?.domain ?? '';
  $('update-banner').hidden = !update?.newer;
  $('update-text').textContent = update?.newer ? `Scout ${update.latest} is out (you have ${version}). Run git pull in the Scout folder, then reload Scout in chrome://extensions.` : '';
  $('version').textContent = `Scout ${version}${update?.checkedAt ? (update.newer ? ` · ${update.latest} available` : ' · up to date') : ''}`;
}
$('peek-restore').onclick = async (e) => busy(e.currentTarget, async () => ask({ type: 'peek', tabId: await activeTabId(), on: false }), 'tool-status');
$('check-update').onclick = (e) => busy(e.currentTarget, () => ask({ type: 'checkUpdate' }), 'tool-status');

// ---- Tools -------------------------------------------------------------------
function renderTools({ xray, peek }, tab) {
  $('tools').hidden = !tab.host;
  $('xray').setAttribute('aria-pressed', String(Boolean(xray)));
  $('xray').textContent = xray ? 'X-ray on' : 'X-ray';
  $('peek').disabled = Boolean(peek);
}
const toolStatus = (text) => ($('tool-status').textContent = text);
$('xray').onclick = async (e) => busy(e.currentTarget, async () => ask({ type: 'xray', tabId: await activeTabId() }), 'tool-status');
$('peek').onclick = async (e) => busy(e.currentTarget, async () => {
  await ask({ type: 'peek', tabId: await activeTabId(), on: true });
  toolStatus('Reloaded without Scout\'s blocking or marks. Restore from the banner; it also ends when you leave the site, or after five minutes.');
}, 'tool-status');
$('outlet-lookup').onclick = async (e) => busy(e.currentTarget, async () => ask({ type: 'outlet', tabId: await activeTabId() }), 'tool-status');
$('cite').onclick = async (e) => busy(e.currentTarget, async () => {
  toolStatus('Asking the Internet Archive for a fresh copy. This can take half a minute.');
  const { text, archived } = await ask({ type: 'cite', tabId: await activeTabId() });
  await navigator.clipboard.writeText(text);
  toolStatus(archived ? `Copied, with the archived copy: ${text}` : `Copied (the archive didn't answer, so no archived link): ${text}`);
}, 'tool-status');
$('evidence').onclick = async (e) => busy(e.currentTarget, async () => {
  const { folder, hashes } = await ask({ type: 'saveEvidence', tabId: await activeTabId() });
  toolStatus(`Saved to Downloads/${folder}: the page, a screenshot, and a signed record (page ${hashes['page.html'].slice(0, 10)}…).`);
}, 'tool-status');

function renderOutlet(o) {
  const box = $('outlet');
  if (!o) return (box.hidden = true);
  if (!o.found) return card(box, { lead: 'Not on Wikidata', body: [`Wikidata has no entry whose official website is ${o.domain}. Small and new sites often don't; so do some that would rather not be looked up.`] });
  const rows = [
    ['Owned by', o.owners.join(', ')],
    ['Part of', o.parents.join(', ')],
    ['Country', o.countries.join(', ')],
    ['Founded', o.founded ? String(o.founded) : ''],
    ['Kind', o.types.join(', ')],
    ['Leaning', o.leanings.join(', ')],
  ].filter(([, v]) => v);
  card(box, { lead: o.name, tone: o.state ? 'mixed' : '', body: [o.about && o.about[0].toUpperCase() + o.about.slice(1), o.state && 'Listed as state-run or government-funded media.'], meta: 'From Wikidata, which anyone can edit.' });
  const facts = el('ul', 'facts');
  facts.append(...rows.map(([n, v]) => li('', el('span', '', n), el('span', 'v', v))));
  box.lastChild.before(facts);
  if (o.wikipedia) {
    const a = Object.assign(el('a', '', 'Wikipedia'), { href: o.wikipedia, target: '_blank', rel: 'noopener' });
    box.lastChild.append(' · ', a);
  }
}

// ---- Label rows the guards fill ---------------------------------------------
function renderGuards({ shields }, tab, site) {
  const g = tab.guard ?? {};
  const row = (id, show, text, tone = '') => {
    $(id).hidden = !show;
    const v = $(id).querySelector('.v');
    v.textContent = text;
    v.className = `v ${tone}`.trim();
  };
  row('replay', g.replay?.length, `${g.replayBlocked ? 'Blocked' : 'Running'} · ${g.replay?.join(', ')}`, g.replayBlocked ? 'ok' : 'warn');
  const networks = Object.keys(g.affiliates?.networks ?? {});
  row('affiliates', g.affiliates?.total, `${g.affiliates?.total} · ${networks.slice(0, 3).join(', ')}`);
  row('unwrapped', g.unwrapped, String(g.unwrapped));
  row('email', g.email?.messages, `${g.email?.messages}${g.email?.names?.length ? ` · ${g.email.names.slice(0, 3).join(', ')}` : ''}`, 'warn');
  $('farbled').hidden = !(site && (shields.farble ?? []).includes(site));
}

// ---- Shields: mode and guards ----------------------------------------------
const GUARDS = {
  protective: [
    ['unwrap', 'Unwrap tracked links', 'Google, Facebook, YouTube and others log your clicks through redirect links.'],
    ['clipboard', 'Clipboard guard', 'Stops fake CAPTCHA pages from loading a malware command for you to paste.'],
    ['addresses', 'Wallet address check', 'Warns if a pasted crypto address differs from the one you copied.'],
    ['downloads', 'Download check', 'Pauses disguised files and programs from pages Scout warned about.'],
    ['notifications', 'Hold back notification prompts', 'Only prompts that arrive before you\'ve clicked anything.'],
    ['replayBlock', 'Block session recording', 'Hotjar, FullStory, Clarity and others that replay your clicks and typing.'],
  ],
  visible: [
    ['toasts', 'First-visit notes', 'A small card on arrival: what Scout handled.', 'select'],
    ['affiliateMarks', 'Mark affiliate links', 'A small $ on links that pay the site.'],
    ['dateNotes', 'Date old stories', 'A note on articles two or more years old.'],
    ['emailMarks', 'Mark tracked emails (Gmail)', 'Names the tracker when an email reports your opens.'],
    ['darkPatternMarks', 'Outline dark patterns', 'Countdown timers, invented scarcity, pre-ticked add-ons.'],
    ['badgeCount', 'Count blocks on the icon', 'Gray number on quiet pages.'],
  ],
  optin: [
    ['forgetOnClose', 'Forget sites when you close them', 'Cookies and storage cleared a minute after a site\'s last tab closes. Trusted sites are kept. You\'ll be signed out elsewhere.'],
    ['honestTitles', 'Honest YouTube titles', 'Crowd-sourced titles from DeArrow. Sends a 4-character hash prefix per video, never the video ID.'],
    ['outletAuto', 'Look up who runs news sites', 'Automatically, on article pages. Sends the site\'s domain to Wikidata.'],
    ['feedLimit', 'Daily feed limit', 'Minutes a day on each feed site (YouTube, X, Instagram, TikTok, Reddit…). 0 is off.', 'number'],
  ],
};

function guardRow([key, label, about, kind], value) {
  const text = el('span', 'grow', label);
  text.append(el('small', '', about));
  const save = (v) => ask({ type: 'saveShields', changes: { guards: { ...(lastShields.guards ?? {}), [key]: v } } }).then(render);
  if (kind === 'select') {
    const sel = el('select', 'small');
    sel.setAttribute('aria-label', label);
    sel.append(...[['off', 'Never'], ['first', 'First visit'], ['always', 'Every new site']].map(([v, t]) => Object.assign(el('option', '', t), { value: v })));
    sel.value = value;
    sel.onchange = () => save(sel.value);
    return li('row', text, sel);
  }
  if (kind === 'number') {
    const input = Object.assign(el('input'), { type: 'number', min: 0, max: 600, step: 5, value });
    input.setAttribute('aria-label', label);
    input.onchange = () => save(Number(input.value));
    return li('row', text, input);
  }
  const box = Object.assign(el('input'), { type: 'checkbox', checked: Boolean(value) });
  box.setAttribute('role', 'switch');
  box.onchange = () => save(box.checked);
  const row = el('label', 'row switch');
  row.append(text, box);
  return li('', row);
}

let lastShields = {};
function renderModeAndGuards(guards, shields, site) {
  lastShields = shields;
  $('modes').replaceChildren(
    ...Object.entries(MODES).map(([key, m]) => {
      const b = Object.assign(el('button', '', m.label), { type: 'button' });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(guards.mode === key));
      b.onclick = () => ask({ type: 'saveShields', changes: { mode: key } }).then(render);
      return b;
    }),
  );
  $('mode-about').textContent = MODES[guards.mode].about;
  for (const [group, id] of [['protective', 'guard-protective'], ['visible', 'guard-visible'], ['optin', 'guard-optin']]) {
    if ($(id).contains(document.activeElement)) continue; // don't redraw under your cursor
    $(id).replaceChildren(...GUARDS[group].map((g) => guardRow(g, guards[g[0]])));
  }
  $('farble').checked = Boolean(site && (shields.farble ?? []).includes(site));
  $('farble').disabled = !site;
}
$('farble').onchange = async (e) => {
  const { site, shields } = await ask({ type: 'panelState', tabId: await activeTabId() });
  if (!site) return;
  const farble = e.target.checked ? [...new Set([...(shields.farble ?? []), site])] : (shields.farble ?? []).filter((d) => d !== site);
  await ask({ type: 'saveShields', changes: { farble } });
  toolStatus(e.target.checked ? `Fingerprint defense is on for ${site}. Reload the page for it to take effect.` : `Fingerprint defense is off for ${site}.`);
  render();
};
$('notify-settings').onclick = () => chrome.tabs.create({ url: 'chrome://settings/content/notifications' });

// ---- Activity ---------------------------------------------------------------
async function renderActivity() {
  const items = await ask({ type: 'getActivity' });
  const list = $('activity-list');
  if (!items.length) return list.replaceChildren(el('p', 'footnote', 'Nothing yet. When Scout steps in, it says so here.'));
  const days = new Map();
  for (const a of items.slice(0, 200)) {
    const d = new Date(a.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(a);
  }
  const out = [];
  for (const [d, rows] of days) {
    out.push(el('p', 'act-day', d));
    const ul = el('ul', 'group');
    ul.append(...rows.map((a) => {
      const row = li(`row act ${a.tone ?? ''}`, el('span', 'dot'), el('span', '', a.text), el('span', 'when', time(a.at)));
      if (a.host) row.append(el('span', 'where', a.host));
      return row;
    }));
    out.push(ul);
  }
  list.replaceChildren(...out);
}
$('open-report').onclick = () => ask({ type: 'openReport' });
$('clear-activity').onclick = () => ask({ type: 'clearActivity' }).then(renderActivity);
