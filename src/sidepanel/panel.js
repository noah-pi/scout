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
  const { tab, receipts } = await ask({ type: 'panelState', tabId });

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
  $('trackers').replaceChildren(
    ...(companies.length ? companies.map(([c, n]) => item(span(c), span(String(n)))) : [item(span('None on this page', 'muted'))]),
  );
  $('fingerprinting').textContent = tab.fingerprinting.length ? `Fingerprinting seen: ${tab.fingerprinting.join(', ')}` : '';

  $('receipts').replaceChildren(
    ...receipts.map((r) =>
      item(span(`${r.dryRun ? 'dry run · ' : ''}${r.service}: ${r.sent}`, r.dryRun ? 'dry' : ''), span(new Date(r.at).toLocaleTimeString())),
    ),
  );
}

$('trust').onclick = async () => {
  const tabId = await activeTabId();
  const { tab } = await ask({ type: 'panelState', tabId });
  await ask({ type: tab.trusted ? 'untrust' : 'trust', tabId });
  render();
};

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
