// Feed sites. Bundled to dist/feeds.js. Two opt-in guards:
// - Feed limit: time on a feed site is counted while its tab is in front of
//   you; past your daily limit the page dims behind a note you can wave off
//   for five minutes or answer by leaving.
// - Honest titles (YouTube): video titles are replaced by DeArrow's
//   crowd-sourced, de-clickbaited ones where they exist. The original stays
//   in the tooltip.
import { effectiveGuards } from '../shared/modes.js';

if (window.top === window) {
  const send = (message) => chrome.runtime.sendMessage(message).then((r) => r?.value).catch(() => null);
  const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const NAMES = { 'youtube.com': 'YouTube', 'x.com': 'X', 'twitter.com': 'X', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'tiktok.com': 'TikTok', 'reddit.com': 'Reddit', 'threads.net': 'Threads', 'threads.com': 'Threads', 'linkedin.com': 'LinkedIn', 'bsky.app': 'Bluesky' };
  const site = Object.keys(NAMES).find((d) => location.hostname === d || location.hostname.endsWith(`.${d}`));

  // ---- Feed limit ---------------------------------------------------------
  let veil = null;
  function showVeil(total, limit) {
    if (veil?.isConnected) return;
    veil = document.createElement('scout-veil');
    veil.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646;';
    const root = veil.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .back { position: fixed; inset: 0; background: rgba(246,246,248,.72); -webkit-backdrop-filter: blur(8px) saturate(.6); backdrop-filter: blur(8px) saturate(.6); display: grid; place-items: center; font-family: ${FONT}; }
      .card { width: min(380px, calc(100vw - 32px)); padding: 18px; border-radius: 14px; background: #fff; border: 1px solid #e6e6eb; color: #1d1d1f; box-shadow: 0 20px 40px -24px rgba(0,0,0,.35); }
      .kicker { font-size: 10px; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; color: #78787d; margin-bottom: 8px; }
      h2 { margin: 0 0 6px; font-size: 20px; font-weight: 700; letter-spacing: -.3px; }
      p { margin: 0 0 14px; color: #6e6e73; font-size: 13.5px; line-height: 1.5; }
      .row { display: flex; gap: 8px; }
      button { flex: 1; appearance: none; border: 0; border-radius: 10px; padding: 11px 14px; font: 700 13px/1 ${FONT}; cursor: pointer; }
      .leave { background: #1d1d1f; color: #f6f6f8; }
      .more { background: #eeeef2; color: #1d1d1f; }
      @media (prefers-color-scheme: dark) { .back { background: rgba(13,13,15,.72); } .card { background: #151519; border-color: #26262c; color: #e8e8ec; } p { color: #a9a9b2; } .leave { background: #e8e8ec; color: #0d0d0f; } .more { background: #232328; color: #e8e8ec; } }
    </style>
    <div class="back"><div class="card">
      <div class="kicker">Scout · feed limit</div>
      <h2>${Math.round(total / 60)} minutes on ${NAMES[site]} today</h2>
      <p>You set ${limit / 60} minutes a day. The feed will still be here tomorrow.</p>
      <div class="row"><button class="more" type="button">Five more minutes</button><button class="leave" type="button">Leave</button></div>
    </div></div>`;
    root.querySelector('.more').onclick = () => {
      send({ type: 'feedSnooze', minutes: 5 });
      veil.remove();
    };
    root.querySelector('.leave').onclick = () => send({ type: 'feedLeave' });
    document.documentElement.append(veil);
    document.querySelectorAll('video').forEach((v) => v.pause());
  }

  function feedClock() {
    setInterval(async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const r = await send({ type: 'feedTick', seconds: 15 });
      if (r?.limit && r.total >= r.limit && Date.now() > (r.snoozeUntil ?? 0)) showVeil(r.total, r.limit);
    }, 15_000);
  }

  // ---- Honest titles ------------------------------------------------------
  const CARDS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model';
  const TITLES = '#video-title, #video-title-link yt-formatted-string, .yt-lockup-metadata-view-model-wiz__title span, .yt-lockup-metadata-view-model__title span, h3 a span';
  const titles = new Map(); // video id -> honest title, or '' for none
  const idOf = (href) => href?.match(/[?&]v=([\w-]{11})/)?.[1] ?? href?.match(/\/shorts\/([\w-]{11})/)?.[1] ?? null;

  function apply(el, id) {
    const honest = titles.get(id);
    if (!honest || !el || el.textContent === honest) return;
    if (!el.dataset.scoutOriginal) el.dataset.scoutOriginal = el.textContent.trim();
    el.textContent = honest;
    el.title = `Original title: ${el.dataset.scoutOriginal}\n(Honest title from DeArrow, via Scout)`;
  }

  async function honest() {
    const found = [];
    for (const card of document.querySelectorAll(CARDS)) {
      const id = idOf(card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]')?.getAttribute('href'));
      if (id) found.push([card.querySelector(TITLES), id]);
    }
    const watchId = location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
    const heading = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata');
    if (watchId && heading) found.push([heading, watchId]);
    const missing = [...new Set(found.map(([, id]) => id).filter((id) => !titles.has(id)))];
    if (missing.length) {
      for (const id of missing) titles.set(id, '');
      const got = (await send({ type: 'dearrow', ids: missing.slice(0, 40) })) ?? {};
      for (const [id, t] of Object.entries(got)) titles.set(id, t);
    }
    for (const [el, id] of found) apply(el, id);
  }

  async function start() {
    const { shields } = await chrome.storage.local.get('shields');
    const guards = effectiveGuards(shields);
    if (site && guards.feedLimit) feedClock();
    if (guards.honestTitles && /(^|\.)youtube\.com$/.test(location.hostname)) {
      let timer = null;
      new MutationObserver(() => (timer ??= setTimeout(() => ((timer = null), honest()), 800))).observe(document.documentElement, { childList: true, subtree: true });
      honest();
    }
  }
  if (site) start();
}
