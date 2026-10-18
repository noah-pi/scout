// Loads Scout unpacked into headless Chromium, maps every hostname to a local
// test server, and exposes the extension's own APIs through its panel page.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXTENSION = fileURLToPath(new URL('../..', import.meta.url));

// routes: { '/path': html | (req, body) => ({ status, headers, body }) }
export function startServer(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      const path = req.url.split('?')[0];
      const route = routes[path];
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
        return res.end();
      }
      if (typeof route === 'function') {
        const out = route(req, body);
        res.writeHead(out.status ?? 200, { 'access-control-allow-origin': '*', ...(out.headers ?? {}) });
        return res.end(out.body);
      }
      res.writeHead(route ? 200 : 404, { 'content-type': 'text/html' });
      res.end(route ?? '');
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ port: server.address().port, seen, close: () => server.close() })));
}

export async function launch() {
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    // Full Chromium in new headless mode; the default headless shell can't load extensions.
    channel: 'chromium',
    executablePath: process.env.SCOUT_CHROMIUM || undefined,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--host-resolver-rules=MAP * 127.0.0.1'],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;

  // An extension page can call chrome.* (Playwright's worker handle can't).
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${id}/src/sidepanel/panel.html`);
  // Give Chrome a moment to finish loading rulesets after install.
  await probe.waitForTimeout(500);

  const ext = {
    send: (message) => probe.evaluate((m) => chrome.runtime.sendMessage(m), message),
    session: () => probe.evaluate(() => chrome.storage.session.get(null)),
    async tabState() {
      const entries = Object.entries(await ext.session()).filter(([k]) => k.startsWith('tab:'));
      return entries.length ? { tabId: Number(entries.at(-1)[0].slice(4)), ...entries.at(-1)[1] } : null;
    },
    async panel(tabId) {
      return (await ext.send({ type: 'panelState', tabId })).value;
    },
  };
  return { context, probe, ext, close: () => context.close() };
}

export async function visit(context, url, wait = 3000) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(wait);
  return page;
}
