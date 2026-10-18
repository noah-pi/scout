import { MODELS } from '../shared/assessment.js';

const $ = (id) => document.getElementById(id);
const dollars = (usd) => (usd > 0 && usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`);

const ask = async (message) => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error ?? 'No response');
  return res.value;
};

const activeTabId = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

function item(...children) {
  const li = document.createElement('li');
  li.append(...children);
  return li;
}

function span(text, className) {
  const el = document.createElement('span');
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

async function render() {
  const tabId = await activeTabId();
  if (tabId === undefined) return;
  const { tab, blocked, receipts, chrome: protection, settings, spend, nano } = await ask({ type: 'panelState', tabId });

  $('level').textContent = tab.trusted ? 'trusted' : tab.level;
  $('level').className = `level ${tab.trusted ? 'quiet' : tab.level}`;
  $('host').textContent = tab.host || 'No page';
  $('trust').textContent = tab.trusted ? 'Stop trusting' : 'Trust this site';
  $('trust').hidden = !tab.host;

  $('notes').replaceChildren(
    ...(tab.trusted ? [] : tab.flags).map((flag) => {
      const li = item(span(flag.text));
      li.className = flag.severity;
      if (flag.severity === 'soft') {
        const dismiss = document.createElement('button');
        dismiss.className = 'link';
        dismiss.textContent = 'not useful';
        dismiss.onclick = () => ask({ type: 'dismiss', tabId, kind: flag.kind }).then(render);
        li.append(dismiss);
      }
      return li;
    }),
  );

  const byCompany = {};
  for (const t of Object.values(tab.trackers)) byCompany[t.company] = (byCompany[t.company] ?? 0) + t.blocked;
  const companies = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);
  const attributed = companies.reduce((n, [, count]) => n + count, 0);
  if (blocked > attributed) companies.push(['Blocked before Scout could name them', blocked - attributed]);
  $('trackers').replaceChildren(
    ...(companies.length ? companies.map(([c, n]) => item(span(c), span(String(n)))) : [item(span('None on this page', 'muted'))]),
  );
  $('fingerprinting').textContent = tab.fingerprinting.length ? `Fingerprinting seen: ${tab.fingerprinting.join(', ')}` : '';
  $('consent').textContent = !tab.consent
    ? ''
    : tab.consent.failed
      ? `Found a ${tab.consent.cmp} cookie banner but couldn't reject it.`
      : tab.consent.cosmetic
        ? `Hid a ${tab.consent.cmp} cookie banner.`
        : `Rejected cookies on a ${tab.consent.cmp} banner.`;

  $('chrome').textContent =
    protection.safeBrowsing === false
      ? 'Safe Browsing is off. Chrome is not checking pages against its list of known scams.'
      : protection.safeBrowsing
        ? 'Safe Browsing is on. Extensions can\'t see whether it\'s Enhanced protection, which adds on-device scam detection; check the setting.'
        : 'Safe Browsing status unavailable.';

  $('investigate').hidden = !tab.host;
  const inv = tab.investigation;
  $('investigation').hidden = !inv;
  if (inv) {
    const lines = inv.declined
      ? [`Claude couldn't assess this page (${inv.declined}).`]
      : [`${VERDICTS[inv.verdict] ?? inv.verdict}.`, inv.summary, ...(inv.reasons ?? [])];
    $('investigation').replaceChildren(...lines.filter(Boolean).map((l) => Object.assign(document.createElement('p'), { textContent: l })),
      Object.assign(document.createElement('p'), { className: 'muted', textContent: `${inv.model} · ${new Date(inv.at).toLocaleTimeString()}` }));
  }

  $('spend').textContent = settings.cloud
    ? `Today: ${spend.calls} of ${settings.dailyCap} page checks, ${spend.spoilerCalls ?? 0} spoiler checks, ${dollars(spend.usd)}.`
    : `Cloud checks are off${settings.hasKey ? '' : ' (no API key)'}. Investigate still works once a key is saved.`;
  $('nano').textContent = NANO[nano] ?? `On-device model: ${nano}.`;
  $('nano-download').hidden = nano !== 'downloadable';
  fillSettings(settings);
  renderCensus(tab.census);
  renderImages(tab.images ?? []);
  renderSpoilers(tab.spoilersHidden ?? 0);

  $('receipts').replaceChildren(
    ...receipts.map((r) =>
      item(
        span(`${r.dryRun ? 'dry run · ' : ''}${r.service}: ${r.sent}${r.usd ? ` · ${dollars(r.usd)}` : ''}`, r.dryRun ? 'dry' : ''),
        span(new Date(r.at).toLocaleTimeString()),
      ),
    ),
  );
}

$('trust').onclick = async () => {
  const tabId = await activeTabId();
  const { tab } = await ask({ type: 'panelState', tabId });
  await ask({ type: tab.trusted ? 'untrust' : 'trust', tabId });
  render();
};

const VERDICTS = { likely_scam: 'Likely a scam', unclear: "Can't tell", likely_safe: 'Nothing wrong found' };
const NANO = {
  available: 'On-device model (Gemini Nano) is ready; it runs before any cloud check.',
  downloadable: 'On-device model (Gemini Nano) can be downloaded.',
  downloading: 'On-device model is downloading.',
  unavailable: "On-device model isn't available on this device.",
  unsupported: "This Chrome doesn't offer an on-device model.",
};

let settingsFilled = false;
function fillSettings(settings) {
  if (settingsFilled) return; // don't clobber what you're typing on each refresh
  settingsFilled = true;
  const form = $('settings-form');
  for (const name of ['quickModel', 'deepModel']) {
    form[name].replaceChildren(...MODELS.map((m) => Object.assign(document.createElement('option'), { value: m, textContent: m })));
    form[name].value = settings[name];
  }
  form.cloud.checked = settings.cloud;
  form.dailyCap.value = settings.dailyCap;
  form.apiKey.placeholder = settings.hasKey ? 'saved (enter a new key to replace it)' : 'sk-ant-…';
}

$('settings-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const changes = { cloud: form.cloud.checked, quickModel: form.quickModel.value, deepModel: form.deepModel.value, dailyCap: form.dailyCap.value };
  if (form.apiKey.value.trim()) changes.apiKey = form.apiKey.value.trim();
  await ask({ type: 'saveSettings', changes });
  form.apiKey.value = '';
  settingsFilled = false;
  $('saved').textContent = 'Saved.';
  render();
};

$('investigate').onclick = async () => {
  const button = $('investigate');
  button.disabled = true;
  button.textContent = 'Investigating…';
  try {
    await ask({ type: 'investigate', tabId: await activeTabId() });
  } catch (error) {
    $('investigation').hidden = false;
    $('investigation').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Investigate';
    render();
  }
};

// Downloading Gemini Nano needs a click, so it starts here, not in the worker.
$('nano-download').onclick = async () => {
  try {
    const session = await LanguageModel.create({
      monitor: (m) => m.addEventListener('downloadprogress', (e) => ($('nano').textContent = `Downloading on-device model: ${Math.round(e.loaded * 100)}%`)),
    });
    session.destroy();
  } catch (error) {
    $('nano').textContent = `Download failed: ${error.message}`;
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
  $('spoiler-list').replaceChildren(
    ...spoilers.entries.map((entry, i) => {
      const remove = Object.assign(document.createElement('button'), { className: 'link', type: 'button', textContent: 'remove' });
      remove.onclick = () => saveSpoilers({ ...spoilers, entries: spoilers.entries.filter((_, j) => j !== i) });
      const detail = [entry.watched && `watched ${entry.watched}`, entry.aliases.length && `also ${entry.aliases.join(', ')}`].filter(Boolean).join(' · ');
      return item(span(detail ? `${entry.title} (${detail})` : entry.title), remove);
    }),
  );
  if (hiddenHere !== null) {
    $('spoiler-status').textContent = !spoilers.enabled
      ? 'Off.'
      : hiddenHere
        ? `${hiddenHere} passage${hiddenHere === 1 ? '' : 's'} hidden on this page.`
        : 'Nothing hidden on this page.';
  }
}

$('spoiler-enabled').onchange = (e) => saveSpoilers({ ...spoilers, enabled: e.target.checked });
$('spoiler-mode').onchange = (e) => saveSpoilers({ ...spoilers, mode: e.target.value });
$('spoiler-form').onsubmit = async (event) => {
  event.preventDefault();
  const f = event.target;
  await saveSpoilers({ ...spoilers, enabled: true, entries: [...spoilers.entries, { title: f.title.value, watched: f.watched.value, aliases: f.aliases.value }] });
  f.reset();
};
ask({ type: 'getSpoilers' }).then((s) => {
  spoilers = s;
  renderSpoilers();
});

function renderImages(images) {
  $('images').hidden = !images.length;
  $('image-list').replaceChildren(
    ...images.map((img) => {
      const li = document.createElement('li');
      let where = img.url;
      try {
        const u = new URL(img.url);
        where = u.hostname + u.pathname.split('/').slice(-1)[0].slice(0, 40);
      } catch {}
      li.append(
        Object.assign(document.createElement('p'), { className: `headline ${img.tone}`, textContent: img.headline }),
        ...img.lines.map((l) => Object.assign(document.createElement('p'), { className: 'muted', textContent: l })),
        Object.assign(document.createElement('p'), { className: 'muted', textContent: where }),
      );
      return li;
    }),
  );
}

const COORDINATION = { none: 'No sign of coordination', weak: 'Weak signs of coordination', moderate: 'Moderate signs of coordination', strong: 'Strong signs of coordination' };

function renderCensus(census) {
  $('census').hidden = !census;
  if (!census) return;
  const verdict = { none: 'Nothing unusual across accounts.', some: 'Some patterns across accounts.', notable: 'Several patterns line up across accounts.' }[census.level];
  $('census-summary').textContent = `${verdict} ${census.comments} comments from ${census.authors} accounts${census.checked ? `, ${census.checked} checked` : ''}.`;
  $('census-notes').replaceChildren(...census.notes.map((n) => item(span(n))));
  const a = census.analysis;
  $('census-analysis').hidden = !a;
  if (a) {
    const lines = a.declined ? [`The model couldn't assess this thread (${a.declined}).`] : [`${COORDINATION[a.coordination]}.`, a.summary, ...a.patterns];
    $('census-analysis').replaceChildren(...lines.filter(Boolean).map((l) => Object.assign(document.createElement('p'), { textContent: l })),
      Object.assign(document.createElement('p'), { className: 'muted', textContent: `${a.model} · ${new Date(a.at).toLocaleTimeString()}` }));
  }
}

async function busy(button, label, work) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await work();
  } catch (error) {
    $('census-analysis').hidden = false;
    $('census-analysis').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
    render();
  }
}

$('census-profiles').onclick = (e) => busy(e.target, 'Checking…', async () => ask({ type: 'censusProfiles', tabId: await activeTabId() }));
$('census-analyze').onclick = (e) => busy(e.target, 'Analyzing…', async () => ask({ type: 'censusAnalyze', tabId: await activeTabId() }));

$('chrome-settings').onclick = () => ask({ type: 'openChromeSecurity' });

$('export').onclick = async () => {
  const data = await ask({ type: 'exportMemory' });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `scout-memory-${data.exportedAt.slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
};

$('import').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await ask({ type: 'importMemory', file: JSON.parse(await file.text()) });
  render();
};

chrome.tabs.onActivated.addListener(render);
chrome.storage.onChanged.addListener(() => render());
render();
