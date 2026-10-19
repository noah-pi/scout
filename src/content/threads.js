// Census, page side. Bundled to dist/threads.js. Reads the thread already on
// screen (Reddit, new and old; replies on X; YouTube comments), reports
// thread-level patterns to the service worker, and marks comments that share
// wording with other accounts. Profile lookups exist only on Reddit, run only
// when you ask, through your own session, slowly.
import { summarize, threadEvidence } from '../shared/census.js';

const PROFILE_TTL = 7 * 86_400_000;
const MAX_LOOKUPS = 40;
const LOOKUP_GAP_MS = 700;

const text = (el) => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const timeOf = (el) => {
  const raw = el?.getAttribute('created-timestamp') ?? el?.querySelector('faceplate-timeago[ts], time[datetime]')?.getAttribute('ts') ?? el?.querySelector('time[datetime]')?.getAttribute('datetime');
  const t = Date.parse(raw ?? '');
  return Number.isFinite(t) ? t : NaN;
};

// "3 hours ago" and friends, as YouTube writes them.
function relative(raw) {
  const m = String(raw ?? '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return NaN;
  const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[m[2].toLowerCase()];
  return Date.now() - Number(m[1]) * unit;
}

const SITES = {
  reddit: {
    match: /(^|\.)reddit\.com$/,
    profiles: true,
    read() {
      // New Reddit: <shreddit-comment author=… thingid=…>, nested.
      const modern = [...document.querySelectorAll('shreddit-comment[author]')].map((el) => ({
        el,
        body: el.querySelector(':scope > [slot="comment"]'),
        id: el.getAttribute('thingid') ?? el.id,
        author: el.getAttribute('author'),
        at: timeOf(el),
      }));
      if (modern.length) return modern;
      // Old Reddit: .thing.comment with data-author.
      return [...document.querySelectorAll('.thing.comment[data-author]')].map((el) => ({
        el,
        body: el.querySelector(':scope > .entry .usertext-body'),
        id: el.getAttribute('data-fullname') ?? el.id,
        author: el.getAttribute('data-author'),
        at: timeOf(el.querySelector(':scope > .entry .tagline')),
      }));
    },
    thread: () => ({
      subreddit: location.pathname.match(/^\/r\/[^/]+/)?.[0]?.slice(1) ?? null,
      title: document.querySelector('shreddit-post')?.getAttribute('post-title') ?? text(document.querySelector('h1, a.title')) ?? document.title,
    }),
  },
  x: {
    match: /(^|\.)(x|twitter)\.com$/,
    // Replies under a post: every tweet on a /status/ page after the first.
    read() {
      if (!/\/status\/\d+/.test(location.pathname)) return [];
      return [...document.querySelectorAll('article[data-testid="tweet"]')].slice(1).map((el) => ({
        el,
        body: el.querySelector('[data-testid="tweetText"]'),
        id: el.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '',
        author: el.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')?.slice(1) ?? '',
        at: Date.parse(el.querySelector('time[datetime]')?.getAttribute('datetime') ?? ''),
      }));
    },
    thread: () => ({ subreddit: null, title: text(document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]')).slice(0, 200) || document.title }),
  },
  youtube: {
    match: /(^|\.)youtube\.com$/,
    read() {
      if (location.pathname !== '/watch') return [];
      return [...document.querySelectorAll('ytd-comment-thread-renderer #comment, ytd-comment-view-model')].map((el) => ({
        el,
        body: el.querySelector('#content-text'),
        id: el.querySelector('#published-time-text a, a[href*="lc="]')?.getAttribute('href') ?? '',
        author: text(el.querySelector('#author-text')).replace(/^@/, ''),
        at: relative(text(el.querySelector('#published-time-text'))),
      }));
    },
    thread: () => ({ subreddit: null, title: text(document.querySelector('h1.ytd-watch-metadata, #title h1')) || document.title }),
  },
};
const site = Object.values(SITES).find((s) => s.match.test(location.hostname));

function readComments() {
  return (site?.read() ?? []).filter((c) => c.author && c.body).map((c) => ({ ...c, text: text(c.body) }));
}

function readThread() {
  return site.thread();
}

async function cachedProfiles(names) {
  const { redditProfiles = {} } = await chrome.storage.local.get('redditProfiles');
  const now = Date.now();
  return Object.fromEntries(names.filter((n) => redditProfiles[n] && now - redditProfiles[n].at < PROFILE_TTL).map((n) => [n, redditProfiles[n]]));
}

function style() {
  if (document.getElementById('scout-census-style')) return;
  const css = document.createElement('style');
  css.id = 'scout-census-style';
  css.textContent = `
    [data-scout-similar]::before { content: "Similar wording · " attr(data-scout-similar) " others";
      display: inline-block; margin: 2px 0 6px; padding: 3px 9px; border-radius: 999px;
      font: 800 9.5px/1.4 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      letter-spacing: .6px; text-transform: uppercase; color: #a4741c; background: rgba(164, 116, 28, .12); }
  `;
  (document.head ?? document.documentElement).append(css);
}

let last = { comments: [], report: null };

async function update() {
  const comments = readComments();
  if (comments.length < 3) return;
  const profiles = await cachedProfiles([...new Set(comments.map((c) => c.author))]);
  const report = summarize(comments, profiles);
  last = { comments, report, profiles };

  style();
  const byId = new Map(comments.map((c) => [c.id, c]));
  for (const el of document.querySelectorAll('[data-scout-similar]')) el.removeAttribute('data-scout-similar');
  for (const group of report.clusters) {
    for (const id of group) byId.get(id)?.body?.setAttribute('data-scout-similar', String(group.length - 1));
  }
  chrome.runtime.sendMessage({ type: 'census', report: { ...report, thread: readThread() } }).catch(() => {});
}

async function lookUpProfiles() {
  if (!site.profiles) return { checked: 0, failed: 0, unsupported: true };
  const names = [...new Set(last.comments.map((c) => c.author))].filter((n) => n && n !== '[deleted]' && n !== 'AutoModerator');
  const have = await cachedProfiles(names);
  const todo = names.filter((n) => !have[n]).slice(0, MAX_LOOKUPS);
  const { redditProfiles = {} } = await chrome.storage.local.get('redditProfiles');
  let checked = 0;
  let failed = 0;
  for (const name of todo) {
    try {
      const res = await fetch(`/user/${encodeURIComponent(name)}/about.json`, { credentials: 'include' });
      if (res.status === 429 || res.status === 403) {
        failed += todo.length - checked - failed;
        break; // Reddit said stop; respect it.
      }
      const data = (await res.json())?.data;
      if (data?.created_utc) {
        redditProfiles[name] = { created: data.created_utc * 1000, karma: data.total_karma ?? (data.link_karma ?? 0) + (data.comment_karma ?? 0), at: Date.now() };
        checked++;
      } else failed++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, LOOKUP_GAP_MS));
  }
  await chrome.storage.local.set({ redditProfiles });
  await update();
  return { checked, failed, cached: Object.keys(have).length };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'censusProfiles') {
    lookUpProfiles().then(reply, () => reply({ checked: 0, failed: 0 }));
    return true;
  }
  if (message?.type === 'censusEvidence') {
    reply(last.report ? threadEvidence(readThread(), last.comments, last.profiles ?? {}, last.report) : null);
    return false;
  }
  return false;
});

let timer = null;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(update, 1200);
};
if (site) {
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
}
