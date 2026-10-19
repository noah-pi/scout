// Page guards. Bundled to dist/guard.js; runs in every top-level page.
// Most of what it does is silent: unwrapping tracked links, noticing session
// recorders, reading a story's dates, counting affiliate links. It speaks on
// the page only where it matters, and how much it says follows your mode:
// a mark on a paid link, a date on an old story, a note on a tracked email,
// a warning beside a swapped wallet address or a poisoned clipboard.
import { ADDON, SCARCITY, SHAMING, addressKind, affiliateNetwork, dateNote, emailTracker, gmailOriginal, parseDate, replayVendor, unwrap } from '../shared/guards.js';
import { effectiveGuards } from '../shared/modes.js';
import { SHOP } from '../shared/shops.js';

if (window.top === window && /^https?:$/.test(location.protocol)) {
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
  const host = location.hostname;
  let guards = effectiveGuards({});
  let quiet = false; // a paused site, or "see it without Scout": no marks
  const facts = { unwrapped: 0, replay: [], affiliates: { total: 0, networks: {} }, email: { messages: 0, names: [] } };

  // One debounced report of everything the page has told us.
  let reportTimer = null;
  const report = () => (reportTimer ??= setTimeout(() => ((reportTimer = null), send({ type: 'guardFacts', facts })), 600));

  // ---- Styles -------------------------------------------------------------
  const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  function style() {
    if (document.getElementById('scout-guard-style')) return;
    const css = document.createElement('style');
    css.id = 'scout-guard-style';
    css.textContent = `
      a[data-scout-aff]::after { content: '$'; display: inline-block; margin-left: 2px; vertical-align: super;
        font: 700 9px/1 ${FONT}; color: #a4741c; text-decoration: none; }
      .scout-date { all: initial; display: inline-flex; align-items: center; gap: 7px; margin: 0 0 10px; padding: 4px 10px;
        border-radius: 999px; background: rgba(61, 107, 142, .1); color: #3d6b8e; font: 600 12px/1.35 ${FONT}; }
      .scout-date b { all: initial; font: 800 9.5px/1 ${FONT}; letter-spacing: 1.6px; text-transform: uppercase; color: inherit; }
      [data-scout-dark] { outline: 2px dashed rgba(164, 116, 28, .7) !important; outline-offset: 2px; }
      .scout-email { all: initial; display: flex; align-items: center; gap: 8px; width: fit-content; margin: 0 0 10px; padding: 5px 11px;
        border-radius: 999px; background: rgba(164, 116, 28, .1); color: #8a5f12; font: 600 12px/1.35 ${FONT}; }
      .scout-email b { all: initial; font: 800 9.5px/1 ${FONT}; letter-spacing: 1.6px; text-transform: uppercase; color: inherit; }
      html.scout-xray [data-scout-slop], html.scout-xray [data-scout-calm] { display: revert !important; opacity: .45; }
    `;
    (document.head ?? document.documentElement).append(css);
  }

  // A shadow-rooted layer for anything Scout draws over the page, so the
  // page's CSS can't reach it.
  let layer = null;
  function overlay() {
    if (layer?.isConnected) return layer.shadowRoot;
    layer = document.createElement('scout-layer');
    layer.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;';
    const root = layer.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
      .card { position: fixed; z-index: 2; background: #fff; color: #1d1d1f; border: 1px solid #e6e6eb; border-radius: 14px;
        box-shadow: 0 10px 30px -12px rgba(0,0,0,.28); padding: 12px 14px; font-size: 13px; line-height: 1.45; pointer-events: auto; }
      .kicker { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 10px; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; color: #78787d; }
      .kicker svg { width: 13px; height: 13px; }
      .kicker svg path { fill: none; stroke: #1f6b45; stroke-width: 1.8; stroke-linecap: round; }
      .kicker svg circle { fill: #1f6b45; }
      .row { display: flex; justify-content: space-between; gap: 14px; padding: 3px 0; }
      .row .n { color: #6e6e73; }
      .row .v { font-family: Menlo, ui-monospace, monospace; font-size: 12px; }
      .toast { right: 18px; bottom: 18px; width: 280px; transition: opacity .3s cubic-bezier(.22,.8,.3,1), transform .3s cubic-bezier(.22,.8,.3,1); }
      .toast.out { opacity: 0; transform: translateY(8px); }
      .alarm { top: 16px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); border-color: rgba(192,53,39,.55); background: #fff7f6; }
      .alarm .kicker, .warn .kicker { color: #c03527; }
      .alarm h2 { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #c03527; letter-spacing: -.2px; }
      .alarm p, .warn p { margin: 0; color: #1d1d1f; }
      .alarm code { font-family: Menlo, ui-monospace, monospace; font-size: 11.5px; color: #6e6e73; word-break: break-all; }
      .actions { display: flex; justify-content: flex-end; margin-top: 10px; }
      button { appearance: none; border: 0; border-radius: 10px; padding: 8px 14px; font: 700 12.5px/1 inherit; background: #1d1d1f; color: #f6f6f8; cursor: pointer; }
      .warn { width: 300px; border-color: rgba(192,53,39,.55); background: #fff7f6; }
      .box { position: absolute; border: 2px dashed var(--tone); border-radius: 4px; pointer-events: none; }
      .box span { position: absolute; top: -2px; left: -2px; padding: 3px 7px; border-radius: 4px 0 6px 0; background: var(--tone); color: #fff;
        font-size: 9.5px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
      .legend { left: 18px; bottom: 18px; max-width: 340px; }
      @media (prefers-color-scheme: dark) {
        .card { background: #151519; color: #e8e8ec; border-color: #26262c; }
        .alarm, .warn { background: #1f1213; }
        .alarm p, .warn p { color: #e8e8ec; }
        .row .n { color: #a9a9b2; }
        button { background: #e8e8ec; color: #0d0d0f; }
      }
    </style>`;
    (document.body ?? document.documentElement).append(layer);
    return root;
  }
  const MARK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.9 4.1A8.4 8.4 0 1 0 18.4 10"/><circle cx="10" cy="10" r="3.2"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function card(className, html) {
    const el = document.createElement('div');
    el.className = `card ${className}`;
    el.innerHTML = html;
    overlay().append(el);
    return el;
  }

  // ---- Relays from the page's own world (main-world.js) ------------------
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d?.__scout === 'clipboard') {
      send({ type: 'clipboardCommand', command: String(d.command).slice(0, 80), blocked: Boolean(d.blocked) });
      if (d.blocked) alarm(String(d.command));
    } else if (d?.__scout === 'copied-address') {
      send({ type: 'copiedAddress', text: String(d.text).slice(0, 100) });
    } else if (d?.__scout === 'notification-prompt') {
      send({ type: 'notificationPrompt' });
    }
  });

  let alarmShown = false;
  function alarm(command) {
    if (alarmShown) return;
    alarmShown = true;
    const el = card(
      'alarm',
      `<div class="kicker">${MARK} Scout stopped this</div>
       <h2>Don't paste anything this page asked you to</h2>
       <p>It tried to put a command on your clipboard. Fake “verify you're human” pages do this, then tell you to press Win+R or open Terminal and paste. That installs malware.</p>
       <p style="margin-top:6px"><code>${esc(command)}…</code></p>
       <div class="actions"><button type="button">Understood</button></div>`,
    );
    el.querySelector('button').onclick = () => el.remove();
  }

  // ---- Wrapped links ------------------------------------------------------
  // Unwrapped at the moment you click, after the page's own mousedown
  // handlers have had their turn at rewriting the link.
  const unwrapLink = (event) => {
    if (!guards.unwrap) return;
    const a = event.target?.closest?.('a[href]');
    if (!a) return;
    const target = unwrap(a.href);
    if (a.hasAttribute('ping')) a.removeAttribute('ping');
    if (!target) return;
    a.href = target;
    facts.unwrapped++;
    report();
  };
  for (const type of ['click', 'auxclick']) document.addEventListener(type, unwrapLink, true);

  // ---- Wallet addresses ---------------------------------------------------
  document.addEventListener(
    'copy',
    () => {
      const text = String(document.getSelection() ?? '').trim();
      if (guards.addresses && addressKind(text)) send({ type: 'copiedAddress', text });
    },
    true,
  );
  document.addEventListener(
    'paste',
    async (event) => {
      if (!guards.addresses) return;
      const text = event.clipboardData?.getData('text')?.trim();
      if (!text || !addressKind(text)) return;
      const field = event.target;
      const res = await send({ type: 'checkPaste', text });
      const swap = res?.value;
      if (!swap) return;
      const rect = field?.getBoundingClientRect?.() ?? { left: 20, bottom: 20 };
      const el = card(
        'warn',
        `<div class="kicker">${MARK} Check this address</div><p>${esc(swap.text)}</p>
         <p style="margin-top:6px;font-family:Menlo,monospace;font-size:11px;color:#6e6e73;word-break:break-all">Copied: ${esc(swap.copied)}<br>Pasted: ${esc(text)}</p>
         <div class="actions"><button type="button">Got it</button></div>`,
      );
      el.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - 320))}px`;
      el.style.top = `${Math.min(rect.bottom + 8, innerHeight - 180)}px`;
      el.querySelector('button').onclick = () => el.remove();
    },
    true,
  );

  // ---- Session recorders --------------------------------------------------
  function scanReplay() {
    const urls = [...document.scripts].map((s) => s.src).filter(Boolean);
    for (const entry of performance.getEntriesByType('resource')) urls.push(entry.name);
    let changed = false;
    for (const url of urls) {
      const vendor = replayVendor(url);
      if (vendor && !facts.replay.includes(vendor)) {
        facts.replay.push(vendor);
        changed = true;
      }
    }
    if (changed) report();
  }

  // ---- Affiliate links ----------------------------------------------------
  const affSeen = new WeakSet();
  function scanAffiliates() {
    let changed = false;
    for (const a of document.querySelectorAll('a[href]')) {
      if (affSeen.has(a)) continue;
      affSeen.add(a);
      const network = affiliateNetwork(a.href);
      if (!network) continue;
      facts.affiliates.total++;
      facts.affiliates.networks[network] = (facts.affiliates.networks[network] ?? 0) + 1;
      changed = true;
      if (guards.affiliateMarks && !quiet) {
        a.dataset.scoutAff = network;
        if (!a.title) a.title = `Affiliate link (${network}): the site may earn a commission if you buy.`;
      }
    }
    if (changed) report();
  }

  // ---- Story dates --------------------------------------------------------
  function readDates() {
    const meta = (sel) => document.querySelector(sel)?.getAttribute('content') ?? document.querySelector(sel)?.getAttribute('datetime');
    let published = parseDate(meta('meta[property="article:published_time"]') ?? meta('meta[itemprop="datePublished"]') ?? meta('meta[name="pubdate"]') ?? meta('meta[name="publishdate"]') ?? meta('meta[name="parsely-pub-date"]') ?? meta('meta[name="sailthru.date"]') ?? meta('meta[name="dc.date"]') ?? meta('meta[name="DC.date.issued"]') ?? meta('time[itemprop="datePublished"]'));
    let modified = parseDate(meta('meta[property="article:modified_time"]') ?? meta('meta[itemprop="dateModified"]') ?? meta('meta[property="og:updated_time"]'));
    let article = /article/i.test(meta('meta[property="og:type"]') ?? '');
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const nodes = [data, ...(Array.isArray(data) ? data : []), ...(data['@graph'] ?? [])].flat();
        for (const node of nodes) {
          const type = [].concat(node?.['@type'] ?? []).join(' ');
          if (!/Article|BlogPosting|Report|NewsArticle/i.test(type)) continue;
          article = true;
          published ??= parseDate(node.datePublished);
          modified ??= parseDate(node.dateModified);
        }
      } catch {}
    }
    if (!article || !published) return;
    facts.dates = { published, modified };
    report();
    const note = dateNote({ published, modified });
    if (!note?.stale || !guards.dateNotes || quiet || document.querySelector('.scout-date')) return;
    const anchor = document.querySelector('article h1, main h1, h1');
    if (!anchor) return;
    style();
    const chip = document.createElement('span');
    chip.className = 'scout-date';
    const year = new Date(published).getFullYear();
    chip.append(Object.assign(document.createElement('b'), { textContent: `From ${year}` }), document.createTextNode(note.text.replace(/\.$/, '')));
    anchor.before(chip);
  }

  // ---- Dark patterns ------------------------------------------------------
  function scanDark() {
    const body = document.body;
    if (!body) return;
    const buttons = [...document.querySelectorAll('button, a, input[type="submit"], [role="button"]')].slice(0, 600);
    const shoppy = buttons.some((b) => SHOP.test(b.textContent ?? b.value ?? '')) || document.querySelector('form input[type="email"], form input[autocomplete^="cc-"]');
    if (!shoppy) return;
    const found = { timers: 0, scarcity: [], prechecked: [], shaming: [] };
    const mark = (el, why) => {
      if (guards.darkPatternMarks && !quiet && el && !el.dataset.scoutDark) {
        style();
        el.dataset.scoutDark = '1';
        if (!el.title) el.title = `Scout: ${why}`;
      }
    };
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const clocks = [];
    for (let n = walker.nextNode(), i = 0; n && i < 4000; n = walker.nextNode(), i++) {
      const t = n.data.trim();
      if (!t || t.length > 160) continue;
      const m = t.match(SCARCITY);
      if (m && found.scarcity.length < 3) {
        found.scarcity.push(t.slice(0, 80));
        mark(n.parentElement, 'a scarcity claim, often invented');
      }
      if (/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/.test(t) && t.length < 40 && n.parentElement) clocks.push([n.parentElement, n.parentElement.textContent]);
    }
    for (const b of buttons) {
      const t = (b.textContent ?? b.value ?? '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 120 && SHAMING.test(t) && found.shaming.length < 2) {
        found.shaming.push(t.slice(0, 80));
        mark(b, 'a guilt-trip opt-out');
      }
    }
    for (const box of document.querySelectorAll('input[type="checkbox"]:checked')) {
      const label = (box.labels?.[0]?.textContent ?? box.closest('label')?.textContent ?? box.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
      if (label && ADDON.test(label) && found.prechecked.length < 3) {
        found.prechecked.push(label.slice(0, 60));
        mark(box.closest('label') ?? box, 'pre-ticked for you');
      }
    }
    // A countdown changes between two looks a second apart.
    setTimeout(() => {
      // Compared on the element: timers often replace their text node.
      for (const [box, before] of clocks.slice(0, 40)) {
        if (box.isConnected && box.textContent !== before) {
          found.timers++;
          mark(box, 'a countdown timer');
        }
      }
      if (found.timers || found.scarcity.length || found.prechecked.length || found.shaming.length) {
        facts.dark = found;
        report();
      }
    }, 1200);
  }

  // ---- Gmail: tracked messages -------------------------------------------
  const mailSeen = new WeakSet();
  function scanMail() {
    if (host !== 'mail.google.com') return;
    let changed = false;
    for (const body of document.querySelectorAll('div.a3s')) {
      if (mailSeen.has(body) || !body.textContent.trim()) continue;
      mailSeen.add(body);
      const names = new Set();
      let pixels = 0;
      for (const img of body.querySelectorAll('img')) {
        const original = gmailOriginal(img.src) ?? img.src;
        const name = emailTracker(original);
        const tiny = (Number(img.getAttribute('width')) || img.naturalWidth || 9) <= 3 && (Number(img.getAttribute('height')) || img.naturalHeight || 9) <= 3;
        if (name) names.add(name);
        if (name || tiny) pixels++;
      }
      let links = 0;
      for (const a of body.querySelectorAll('a[href]')) {
        const target = unwrap(a.href) ?? a.href;
        const name = emailTracker(target);
        if (name) {
          names.add(name);
          links++;
        }
      }
      if (!pixels && !links) continue;
      facts.email.messages++;
      for (const n of names) if (!facts.email.names.includes(n)) facts.email.names.push(n);
      changed = true;
      if (guards.emailMarks && !quiet) {
        style();
        const chip = document.createElement('span');
        chip.className = 'scout-email';
        const parts = [pixels && 'knows when you open it', links && `${links} tracked link${links === 1 ? '' : 's'}`].filter(Boolean);
        chip.append(Object.assign(document.createElement('b'), { textContent: 'Tracked' }), document.createTextNode(`${[...names].join(', ') || 'A tracker'} ${parts.join(' · ')}`));
        body.before(chip);
      }
    }
    if (changed) report();
  }

  // ---- X-ray --------------------------------------------------------------
  let xray = null;
  const ghosts = new WeakMap();
  const AD_SLOTS = '[id^="google_ads_iframe"], ins.adsbygoogle, [id^="div-gpt-ad"], [data-ad-slot], [data-google-query-id], [id*="ad-container" i], [class*="ad-slot" i]';
  function drawXray(blocked) {
    const root = overlay();
    root.querySelectorAll('.box, .legend').forEach((el) => el.remove());
    const counts = {};
    const boxes = [];
    const add = (el, label, tone, bucket) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 && r.height < 4) return;
      boxes.push({ r, label, tone });
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    };
    const hostMatch = (src) => {
      try {
        const h = new URL(src, location.href).hostname;
        return blocked.find((b) => h === b.host || h.endsWith(`.${b.host}`));
      } catch {
        return null;
      }
    };
    for (const el of document.querySelectorAll('iframe[src], img[src], embed[src], object[data]')) {
      const hit = hostMatch(el.getAttribute('src') ?? el.getAttribute('data'));
      if (!hit) continue;
      // Chrome collapses a blocked frame to nothing; stand a placeholder of
      // its intended size in its place so you can see what was there.
      let target = el;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) {
        let ghost = ghosts.get(el);
        if (!ghost?.isConnected) {
          ghost = document.createElement('scout-ghost');
          const w = Number(el.getAttribute('width')) || 300;
          const h = Number(el.getAttribute('height')) || 90;
          ghost.style.cssText = `all: initial; display: block; width: ${w}px; max-width: 100%; height: ${h}px;`;
          el.before(ghost);
          ghosts.set(el, ghost);
        }
        target = ghost;
      }
      add(target, `${hit.list === 'ads' ? 'Ad' : 'Tracker'} blocked · ${hit.company}`, '#c03527', hit.list === 'ads' ? 'ads' : 'trackers');
    }
    for (const el of document.querySelectorAll(AD_SLOTS)) add(el, 'Ad slot · emptied', '#c03527', 'ads');
    for (const el of document.querySelectorAll('[data-scout-calm], [data-scout-slop], [data-scout-xray]')) add(el, el.dataset.scoutXray ?? (el.hasAttribute('data-scout-slop') ? 'Folded · AI-heavy site' : 'Folded by Calm'), '#8a5f12', 'folded');
    for (const el of document.querySelectorAll('[data-scout-dark]')) add(el, el.title.replace(/^Scout: /, '') || 'Dark pattern', '#a4741c', 'dark');
    for (const el of document.querySelectorAll('.scout-spoiler')) add(el, 'Spoiler veiled', '#3d6b8e', 'spoilers');
    for (const { r, label, tone } of boxes) {
      const box = document.createElement('div');
      box.className = 'box';
      box.style.cssText = `--tone:${tone};left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
      box.append(Object.assign(document.createElement('span'), { textContent: label }));
      root.append(box);
    }
    const names = { ads: 'Ad spots', trackers: 'Tracker frames', folded: 'Folded', dark: 'Dark patterns', spoilers: 'Spoilers' };
    const unseen = blocked.filter((b) => b.list !== 'ads').length;
    const rows = Object.entries(counts).map(([k, n]) => `<div class="row"><span class="n">${names[k]}</span><span class="v">${n}</span></div>`).join('');
    const legend = card(
      'legend',
      `<div class="kicker">${MARK} X-ray</div>${rows || '<div class="row"><span class="n">Nothing visible to mark</span></div>'}
       ${unseen ? `<div class="row"><span class="n">Trackers with no visible part</span><span class="v">${unseen}</span></div>` : ''}
       <div class="actions"><button type="button">Close</button></div>`,
    );
    legend.querySelector('button').onclick = () => setXray(false);
  }
  function setXray(on, blocked = []) {
    document.documentElement.classList.toggle('scout-xray', on);
    clearInterval(xray);
    xray = null;
    if (!on) {
      overlay().querySelectorAll('.box, .legend').forEach((el) => el.remove());
      document.querySelectorAll('scout-ghost').forEach((el) => el.remove());
      send({ type: 'xrayClosed' });
      return;
    }
    style();
    // Let calm.js and slop.js unhide what they folded before drawing.
    setTimeout(() => drawXray(blocked), 60);
    xray = setInterval(() => drawXray(blocked), 2500);
  }

  // ---- Toast --------------------------------------------------------------
  function toast(rows) {
    const el = card('toast', `<div class="kicker">${MARK} Scout on ${esc(host.replace(/^www\./, ''))}</div>${rows.map(([n, v]) => `<div class="row"><span class="n">${esc(n)}</span><span class="v">${esc(v)}</span></div>`).join('')}`);
    let timer = setTimeout(() => close(), 4500);
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    };
    el.onmouseenter = () => clearTimeout(timer);
    el.onmouseleave = () => (timer = setTimeout(close, 1500));
    el.onclick = close;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'xray') setXray(Boolean(message.on), message.blocked ?? []);
    if (message?.type === 'toast' && Array.isArray(message.rows) && message.rows.length) toast(message.rows);
  });

  // ---- Start --------------------------------------------------------------
  async function start() {
    const { shields } = await chrome.storage.local.get('shields');
    guards = effectiveGuards(shields);
    const { peek } = await chrome.storage.local.get('peek');
    const under = (d) => d && (host === d || host.endsWith(`.${d}`));
    quiet = (shields?.paused ?? []).some(under) || under(peek?.domain);
    const settle = () => {
      readDates();
      scanAffiliates();
      scanReplay();
      scanMail();
    };
    settle();
    setTimeout(scanDark, 2500);
    setTimeout(scanReplay, 6000);
    let frame = null;
    new MutationObserver(() => {
      frame ??= setTimeout(() => {
        frame = null;
        scanAffiliates();
        scanMail();
      }, 1000);
    }).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shields) guards = effectiveGuards(changes.shields.newValue);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
