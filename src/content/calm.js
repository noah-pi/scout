// Calm layer and AI-label filter. Bundled to dist/calm.js; the bundled
// page rules are the fallback, the daily-refreshed copy in storage wins.
// Selector rules hide by CSS from document_start, so nothing flashes; text
// rules (Google's AI Overviews, platforms' AI labels) fold the post or block
// to a one-line note you can click.
import bundled from '../../data/page-rules.json';
import { labelMatcher, onSite, validateRules } from '../shared/pagerules.js';
import { NOTE_CSS as CAPSULE, makeNote } from './note.js';

const host = location.hostname;
let folded = 0;
let aiFolded = 0;
let paused = 0;
let hidden = {}; // rule key -> elements its selectors currently hide

const report = () =>
  chrome.runtime.sendMessage({ type: 'calmCount', counts: { folded, aiFolded, paused, hidden } }).catch(() => {});

// CSS hides leave no trace, so count what each rule's selectors match; the
// panel shows it, and a rule that never matches anything is visibly broken.
function counter(active) {
  let timer = null;
  const count = () => {
    timer = null;
    const next = {};
    for (const [key, r] of active) {
      let n = 0;
      for (const sel of r.selectors) {
        try {
          n += document.querySelectorAll(sel).length;
        } catch {}
      }
      if (n) next[key] = n;
    }
    if (JSON.stringify(next) !== JSON.stringify(hidden)) {
      hidden = next;
      report();
    }
  };
  return () => (timer ??= setTimeout(count, 1500));
}

function css(text) {
  const style = document.createElement('style');
  style.dataset.scout = 'calm';
  style.textContent = text;
  (document.head ?? document.documentElement).append(style);
}

const NOTE_CSS = `[data-scout-calm] { display: none !important; }${CAPSULE}`;

function fold(block, why, counter) {
  if (!block || block.hasAttribute('data-scout-calm') || block.closest('[data-scout-calm]')) return false;
  block.setAttribute('data-scout-calm', '');
  block.before(makeNote('scout-calm-note', why, () => block.removeAttribute('data-scout-calm')));
  counter();
  return true;
}

// From a label, the largest block that still contains none of `boundary`:
// for Google, everything around "AI Overview" up to, not including, the first
// real result. Survives Google renaming its classes, which it does often.
function climb(el, boundary) {
  let block = el;
  for (let up = el.parentElement; up && up !== document.body && !up.querySelector(boundary); up = up.parentElement) block = up;
  return block === el ? null : block;
}

// Short elements whose whole text matches, e.g. a label chip reading "AI info".
function* labelled(root, matches) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.data.length <= 60 && matches(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) yield n.parentElement;
}

function pauseAutoplay(exempt) {
  if (onSite(exempt, host)) return;
  // Videos with the autoplay attribute lose it as they appear; scripts that
  // call play() on their own are caught by the listener below.
  const disarm = (v) => {
    if (!v.autoplay) return;
    v.autoplay = false;
    v.removeAttribute('autoplay');
    v.pause();
    paused++;
    report();
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n instanceof HTMLVideoElement) disarm(n);
        else if (n.querySelectorAll) n.querySelectorAll('video[autoplay]').forEach(disarm);
      }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('video[autoplay]').forEach(disarm);

  let lastGesture = 0;
  for (const type of ['pointerdown', 'keydown', 'touchstart']) addEventListener(type, () => (lastGesture = Date.now()), true);
  addEventListener(
    'play',
    (event) => {
      const v = event.target;
      // Players retry play() when paused, so nothing short of your own click
      // or key press lets a video start. Count each video once.
      if (!(v instanceof HTMLVideoElement) || Date.now() - lastGesture < 1500) return;
      v.pause();
      v.autoplay = false;
      if (!v.dataset.scoutPaused) {
        v.dataset.scoutPaused = '1';
        paused++;
        report();
      }
    },
    true,
  );
}

async function start() {
  const { pageRules, shields } = await chrome.storage.local.get(['pageRules', 'shields']);
  let rules;
  try {
    rules = pageRules?.rules && pageRules.rules.version >= bundled.version ? pageRules.rules : validateRules(bundled);
  } catch {
    return;
  }
  if ((shields?.paused ?? []).some((d) => host === d || host.endsWith(`.${d}`))) return;
  const enabled = { ...Object.fromEntries(Object.keys(rules.calm).map((k) => [k, true])), ...(shields?.calm ?? {}) };
  const aiOn = shields?.aiLabels !== false;

  const active = Object.entries(rules.calm).filter(([k, r]) => enabled[k] && onSite(r.sites, host));
  const selectors = active.flatMap(([, r]) => r.selectors);
  // One rule per selector: an invalid selector then fails alone instead of
  // voiding the whole list.
  css(NOTE_CSS + selectors.map((s) => `\n${s} { display: none !important; }`).join(''));
  for (const [, r] of active) if (r.behavior === 'pause-autoplay') pauseAutoplay(r.exempt);
  const recount = counter(active.filter(([, r]) => r.selectors.length));
  new MutationObserver(recount).observe(document.documentElement, { childList: true, subtree: true });
  recount();

  const textRules = active.filter(([, r]) => r.textBlocks?.texts?.length && (r.textBlocks.container || r.textBlocks.boundary)).map(([, r]) => ({ ...r.textBlocks, matches: labelMatcher(r.textBlocks.texts), label: r.label }));
  const platform = aiOn ? Object.entries(rules.aiLabels.platforms).find(([, p]) => onSite(p.sites, host)) : null;
  const aiMatches = platform ? labelMatcher(rules.aiLabels.texts) : null;
  if (!textRules.length && !platform) return;

  const scan = (root) => {
    if (!root?.querySelectorAll && root !== document) return;
    let changed = false;
    for (const rule of textRules) {
      for (const el of labelled(root, rule.matches)) {
        changed = fold(rule.boundary ? climb(el, rule.boundary) : el.closest(rule.container), rule.note ?? 'Hidden by Calm', () => folded++) || changed;
      }
    }
    if (platform) {
      const [name, p] = platform;
      for (const el of labelled(root, aiMatches)) {
        changed = fold(el.closest(p.container), `${name} labels this post as made with AI`, () => aiFolded++) || changed;
      }
    }
    if (changed) report();
  };

  const pending = new Set();
  let frame = null;
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) pending.add(n.nodeType === 1 ? n : n.parentElement);
    frame ??= requestAnimationFrame(() => {
      frame = null;
      for (const n of pending) if (n?.isConnected) scan(n);
      pending.clear();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.body) scan(document.body);
  else addEventListener('DOMContentLoaded', () => scan(document.body), { once: true });
}

start();
