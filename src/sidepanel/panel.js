import { MODELS } from '../shared/assessment.js';

const $ = (id) => document.getElementById(id);

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
    ? `Today: ${spend.calls} of ${settings.dailyCap} cloud checks, $${spend.usd.toFixed(3)}.`
    : `Cloud checks are off${settings.hasKey ? '' : ' (no API key)'}. Investigate still works once a key is saved.`;
  $('nano').textContent = NANO[nano] ?? `On-device model: ${nano}.`;
  $('nano-download').hidden = nano !== 'downloadable';
  fillSettings(settings);

  $('receipts').replaceChildren(
    ...receipts.map((r) =>
      item(
        span(`${r.dryRun ? 'dry run · ' : ''}${r.service}: ${r.sent}${r.usd ? ` · $${r.usd.toFixed(4)}` : ''}`, r.dryRun ? 'dry' : ''),
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
