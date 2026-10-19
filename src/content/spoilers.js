// Spoiler shield, page side. Bundled to dist/spoilers.js.
// Blurs every passage that mentions a watchlist title the moment it's found,
// then asks the service worker which ones actually spoil. Clean passages are
// revealed; spoilers stay hidden behind a click.
import { PASSAGE_LIMIT, buildMatcher, passageKey } from '../shared/spoilers.js';

const HIDDEN = 'scout-spoiler';
const PENDING = 'scout-spoiler-pending';
const SKIP = 'script, style, noscript, textarea, input, select, code, pre, svg, [contenteditable], .scout-spoiler-label';
const BLOCKS = 'p, li, blockquote, dd, td, h1, h2, h3, h4, h5, h6, figcaption, article, section, div, span, a';

let matcher = null;
let mode = 'ai';
const seen = new WeakSet();
const queue = new Map(); // id -> { el, text, titles }

function style() {
  if (document.getElementById('scout-spoiler-style')) return;
  const css = document.createElement('style');
  css.id = 'scout-spoiler-style';
  // Text is hidden with transparent color plus a soft shadow rather than a
  // filter, so the warning label inside stays sharp.
  css.textContent = `
    .${PENDING}, .${PENDING} *, .${HIDDEN}, .${HIDDEN} * {
      color: transparent !important; text-shadow: 0 0 9px rgba(128, 128, 128, .85) !important; cursor: pointer; }
    .${PENDING} :is(img, video, picture, canvas), .${HIDDEN} :is(img, video, picture, canvas) { filter: blur(14px); }
    .${HIDDEN} { position: relative; }
    .${HIDDEN} > .scout-spoiler-label, .${HIDDEN} > .scout-spoiler-label * { all: initial; }
    .${HIDDEN} > .scout-spoiler-label { position: absolute; inset: 0; z-index: 2147483000; display: flex;
      align-items: center; justify-content: center; padding: 6px; cursor: pointer; border-radius: 10px;
      background: rgba(128, 128, 128, .12); -webkit-backdrop-filter: blur(10px) saturate(1.4); backdrop-filter: blur(10px) saturate(1.4); }
    .${HIDDEN} > .scout-spoiler-label > span { display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      padding: 5px 12px; border-radius: 999px; background: rgba(29, 29, 31, .78);
      box-shadow: 0 2px 10px rgba(0, 0, 0, .16); color: #f5f5f7 !important; text-shadow: none !important;
      font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
      letter-spacing: -.003em; -webkit-font-smoothing: antialiased; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .${HIDDEN} > .scout-spoiler-label b { font: inherit; font-weight: 600; color: #f5f5f7 !important; text-shadow: none !important; }
    .${HIDDEN} > .scout-spoiler-label i { font: inherit; font-style: normal; font-weight: 600; color: #64d2ff !important; text-shadow: none !important; }
  `;
  (document.head ?? document.documentElement).append(css);
}

// The smallest sensible block around a matching text node.
function blockFor(node) {
  let el = node.parentElement;
  while (el && el !== document.body) {
    if (el.matches(BLOCKS) && el.textContent.length >= 20) return el.textContent.length <= PASSAGE_LIMIT * 2 ? el : node.parentElement;
    el = el.parentElement;
  }
  return node.parentElement;
}

function reveal(el) {
  el.classList.remove(HIDDEN, PENDING);
  el.querySelector(':scope > .scout-spoiler-label')?.remove();
}

function hide(el, titles) {
  el.classList.remove(PENDING);
  el.classList.add(HIDDEN);
  if (el.querySelector(':scope > .scout-spoiler-label')) return;
  const label = document.createElement('span');
  label.className = 'scout-spoiler-label';
  label.setAttribute('role', 'button');
  label.setAttribute('aria-label', `Spoiler for ${titles.join(', ')}. Click to reveal.`);
  // Reads "Spoiler: Severance · Show" in a capsule over the frosted passage.
  const chip = document.createElement('span');
  const what = document.createElement('b');
  what.textContent = `Spoiler: ${titles.join(', ')}`;
  const show = document.createElement('i');
  show.textContent = 'Show';
  chip.append(what, document.createTextNode(' · '), show);
  label.append(chip);
  el.append(label);
}

function onClick(event) {
  const el = event.target.closest(`.${HIDDEN}, .${PENDING}`);
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  reveal(el);
  seen.add(el);
}

function scan(root) {
  if (!matcher || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) || !matcher.test(n.data) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = blockFor(node);
    if (!el || seen.has(el) || el.closest(`.${HIDDEN}, .${PENDING}`)) continue;
    seen.add(el);
    const text = el.innerText || el.textContent;
    const titles = matcher.find(text);
    if (!titles.length) continue;
    if (mode === 'keyword') {
      hide(el, titles);
      continue;
    }
    el.classList.add(PENDING);
    queue.set(passageKey(text, titles), { el, text: text.slice(0, PASSAGE_LIMIT), titles });
  }
  flushSoon();
}

let timer = null;
function flushSoon() {
  if (timer || !queue.size) return;
  timer = setTimeout(flush, 400);
}

async function flush() {
  timer = null;
  const batch = [...queue].slice(0, 12);
  for (const [id] of batch) queue.delete(id);
  const items = batch.map(([id, item]) => ({ id, text: item.text, titles: item.titles }));
  let verdicts = {};
  try {
    verdicts = (await chrome.runtime.sendMessage({ type: 'spoilerCheck', items }))?.value ?? {};
  } catch {}
  for (const [id, item] of batch) {
    if (verdicts[id] === false) reveal(item.el);
    else hide(item.el, item.titles);
  }
  flushSoon();
}

// Runs from document_start, so passages are caught as the page streams in
// rather than after it has already been read.
async function start() {
  const { spoilers } = await chrome.storage.local.get('spoilers');
  if (!spoilers?.enabled || !spoilers.entries?.length) return;
  matcher = buildMatcher(spoilers.entries);
  if (!matcher) return;
  mode = spoilers.mode === 'keyword' ? 'keyword' : 'ai';
  style();
  document.addEventListener('click', onClick, true);

  const added = new Set();
  let frame = null;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') added.add(r.target.parentElement);
      for (const n of r.addedNodes) added.add(n.nodeType === 1 ? n : n.parentElement);
    }
    frame ??= requestAnimationFrame(() => {
      frame = null;
      const roots = [...added].filter((n) => n?.isConnected);
      added.clear();
      for (const root of roots) scan(root);
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.body) scan(document.body);
}

start();
