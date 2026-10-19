// Spoiler shield, page side. Bundled to dist/spoilers.js.
// Finds passages that mention a watchlist title, skipping bare mentions (tags,
// nav links, chips), and dims each one while the service worker asks Haiku
// whether it spoils. Clean passages come back at once. A spoiler veils the
// whole article, post or comment it sits in, behind one label and a click.
import { PASSAGE_LIMIT, buildMatcher, passageKey } from '../shared/spoilers.js';

const HIDDEN = 'scout-spoiler';
const PENDING = 'scout-spoiler-pending';
const SKIP = 'script, style, noscript, textarea, input, select, code, pre, svg, [contenteditable], .scout-spoiler-label';
const BLOCKS = 'p, li, blockquote, dd, td, h1, h2, h3, h4, h5, h6, figcaption, article, section, div, span, a';
// What a confirmed spoiler hides: the story or post around it, not the page.
const UNITS = 'article, [role="article"], [itemprop="articleBody"], shreddit-post, shreddit-comment, ytd-comment-thread-renderer, ytd-rich-item-renderer, ytd-video-renderer';

let matcher = null;
let mode = 'ai';
const seen = new WeakSet();
const opened = new WeakSet(); // veils you lifted stay lifted
const queue = new Map(); // id -> { el, text, titles }

function style() {
  if (document.getElementById('scout-spoiler-style')) return;
  const css = document.createElement('style');
  css.id = 'scout-spoiler-style';
  // Text is hidden with transparent color plus a soft shadow rather than a
  // filter, so the warning label inside stays sharp.
  css.textContent = `
    .${PENDING}, .${PENDING} * { color: transparent !important; text-shadow: 0 0 7px rgba(128, 128, 128, .6) !important; }
    .${PENDING} :is(img, video, picture, canvas) { filter: blur(10px); }
    .${HIDDEN}, .${HIDDEN} * {
      color: transparent !important; text-shadow: 0 0 9px rgba(128, 128, 128, .85) !important; cursor: pointer; }
    .${HIDDEN} :is(img, video, picture, canvas, iframe) { filter: blur(18px) !important; }
    .${HIDDEN} { position: relative; outline: 1px solid rgba(120, 120, 125, .22); outline-offset: 4px; border-radius: 6px; }
    .${HIDDEN}[data-scout-size='line'] { min-height: 34px; }
    .${HIDDEN}[data-scout-size='small'] { outline-style: dashed; }
    .${HIDDEN} > .scout-spoiler-label, .${HIDDEN} > .scout-spoiler-label * { all: initial; }
    .${HIDDEN} > .scout-spoiler-label { position: absolute; inset: 0; z-index: 2147483000; display: flex;
      align-items: center; justify-content: center; cursor: pointer; }
    /* A tall article keeps its label in view as you scroll past it. */
    .${HIDDEN}[data-scout-size='tall'] > .scout-spoiler-label { position: sticky; top: 40vh; inset: auto; height: 0; overflow: visible; }
    .${HIDDEN} > .scout-spoiler-label > span { display: inline-flex; align-items: baseline; gap: 6px; max-width: calc(100% - 12px);
      padding: 6px 13px; border-radius: 999px; background: rgba(13, 13, 15, .9);
      box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
      color: #f5f5f7 !important; text-shadow: none !important;
      font: 600 12px/1.3 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .${HIDDEN}[data-scout-size='tall'] > .scout-spoiler-label > span { transform: translateY(28px); }
    .${HIDDEN}[data-scout-size='compact'] > .scout-spoiler-label > span { padding: 5px 10px; gap: 5px; }
    .${HIDDEN}[data-scout-size='compact'] > .scout-spoiler-label b { display: none; }
    .${HIDDEN} > .scout-spoiler-label u { font: inherit; font-size: 9.5px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase;
      text-decoration: none; color: #c7c7cc !important; text-shadow: none !important; }
    .${HIDDEN} > .scout-spoiler-label b { font: inherit; color: #f5f5f7 !important; text-shadow: none !important; overflow: hidden; text-overflow: ellipsis; }
    .${HIDDEN} > .scout-spoiler-label i { font: inherit; font-style: normal; font-weight: 700; color: #7ed6a4 !important; text-shadow: none !important; }
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
  delete el.dataset.scoutSize;
  el.removeAttribute('title');
  el.querySelector(':scope > .scout-spoiler-label')?.remove();
  for (const inner of el.querySelectorAll(`.${PENDING}`)) inner.classList.remove(PENDING);
}

// How big the veiled box is decides how it is labelled. Inline bits and tiny
// boxes get no pill (it would overflow them), just a tooltip; narrow cards get
// a short one; one-line blocks grow enough to hold it; tall articles get a
// label that follows you down the page.
function sizeOf(el) {
  const { width, height } = el.getBoundingClientRect();
  if (getComputedStyle(el).display.startsWith('inline') || width < 110 || height < 12) return 'small';
  if (width < 240) return height < 28 ? 'small' : 'compact';
  if (height < 34) return 'line';
  return height > 280 ? 'tall' : 'block';
}

function hide(passage, titles) {
  const el = passage.closest(UNITS) ?? passage;
  passage.classList.remove(PENDING);
  if (opened.has(el) || el.classList.contains(HIDDEN)) return;
  for (const inner of el.querySelectorAll(`.${PENDING}`)) inner.classList.remove(PENDING);
  el.classList.add(HIDDEN);
  const size = sizeOf(el);
  el.dataset.scoutSize = size;
  const what = titles.join(', ');
  if (size === 'small') {
    el.title = `Spoiler: ${what}. Click to show.`;
    return;
  }
  const label = document.createElement('span');
  label.className = 'scout-spoiler-label';
  label.setAttribute('role', 'button');
  label.setAttribute('aria-label', `Spoiler for ${what}. Click to reveal.`);
  // An ink capsule over the veiled story: SPOILER: Severance  Show.
  const chip = document.createElement('span');
  const kicker = document.createElement('u');
  kicker.textContent = 'Spoiler: ';
  const name = document.createElement('b');
  name.textContent = what;
  const show = document.createElement('i');
  show.textContent = 'Show';
  chip.append(kicker, name, show);
  label.append(chip);
  el.prepend(label);
}

function onClick(event) {
  const el = event.target.closest(`.${HIDDEN}, .${PENDING}`);
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  reveal(el);
  seen.add(el);
  opened.add(el);
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
    if (!titles.length || matcher.mentionOnly(text)) continue;
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
