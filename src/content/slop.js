// Slop filter for search results. Bundled to dist/slop.js, with the list
// (data/ai-sites.json, laylavish's CC0 HUGE AI Blocklist) built in.
// Results from known AI-heavy sites fold down to one quiet line; click it
// to bring the result back.
import list from '../../data/ai-sites.json';
import { NOTE_CSS, makeNote } from './note.js';

const domains = new Set(list.domains);
const patterns = list.patterns.map((p) => {
  try {
    return new RegExp(p, 'i');
  } catch {
    return null;
  }
}).filter(Boolean);

const engineHost = location.hostname;

// Unwraps the engines' redirect links to the real destination.
function destination(a) {
  try {
    const url = new URL(a.href, location.href);
    if (url.hostname === engineHost || url.hostname.endsWith(`.${engineHost.split('.').slice(-2).join('.')}`)) {
      const q = url.searchParams.get('q') ?? url.searchParams.get('url') ?? url.searchParams.get('uddg');
      if (q && /^https?:/.test(q)) return new URL(q);
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isSlop(url) {
  const labels = url.hostname.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) if (domains.has(labels.slice(i).join('.'))) return labels.slice(i).join('.');
  return patterns.some((re) => re.test(url.href)) ? url.hostname : null;
}

// The result block around a link: climb while the block still points at a
// single destination site and stays result-sized.
function resultFor(a, host) {
  let el = a;
  while (el.parentElement && el.parentElement !== document.body) {
    const parent = el.parentElement;
    if (parent.textContent.length > 1500) break;
    const others = [...parent.querySelectorAll('a[href]')].some((x) => {
      const d = destination(x);
      return d && d.hostname !== host;
    });
    if (others) break;
    el = parent;
  }
  return el;
}

function style() {
  if (document.getElementById('scout-slop-style')) return;
  const css = document.createElement('style');
  css.id = 'scout-slop-style';
  css.textContent = `
    [data-scout-slop] { display: none !important; }
    ${NOTE_CSS}
  `;
  (document.head ?? document.documentElement).append(css);
}

let hidden = 0;
const done = new WeakSet();

function scan() {
  for (const a of document.querySelectorAll('a[href]')) {
    if (done.has(a)) continue;
    done.add(a);
    const url = destination(a);
    const site = url && isSlop(url);
    if (!site) continue;
    const block = resultFor(a, url.hostname);
    if (block.hasAttribute('data-scout-slop') || block.closest('[data-scout-slop]')) continue;
    block.setAttribute('data-scout-slop', site);
    block.before(makeNote('scout-slop-note', `${site} is on Scout’s list of AI-heavy sites`, () => block.removeAttribute('data-scout-slop')));
    hidden++;
  }
  if (hidden) chrome.runtime.sendMessage({ type: 'slopCount', count: hidden }).catch(() => {});
}

async function start() {
  const { shields } = await chrome.storage.local.get('shields');
  if (shields?.slop === false) return;
  style();
  scan();
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

start();
