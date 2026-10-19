// Census, Reddit side. Bundled to dist/reddit.js. Reads the thread already on
// screen (new and old Reddit), reports thread-level patterns to the service
// worker, and marks comments that share wording with other accounts. Profile
// lookups run only when you ask, through your own session, slowly.
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

function readComments() {
  // New Reddit: <shreddit-comment author=… thingid=…>, nested.
  const modern = [...document.querySelectorAll('shreddit-comment[author]')].map((el) => ({
    el,
    id: el.getAttribute('thingid') ?? el.id,
    author: el.getAttribute('author'),
    text: text(el.querySelector(':scope > [slot="comment"]')),
    at: timeOf(el),
  }));
  if (modern.length) return modern;
  // Old Reddit: .thing.comment with data-author.
  return [...document.querySelectorAll('.thing.comment[data-author]')].map((el) => ({
    el,
    id: el.getAttribute('data-fullname') ?? el.id,
    author: el.getAttribute('data-author'),
    text: text(el.querySelector(':scope > .entry .usertext-body')),
    at: timeOf(el.querySelector(':scope > .entry .tagline')),
  }));
}

function readThread() {
  const post = document.querySelector('shreddit-post');
  return {
    subreddit: location.pathname.match(/^\/r\/[^/]+/)?.[0]?.slice(1) ?? null,
    title: post?.getAttribute('post-title') ?? text(document.querySelector('h1, a.title')) ?? document.title,
  };
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
  for (const c of comments) c.el.removeAttribute('data-scout-similar');
  for (const group of report.clusters) {
    for (const id of group) {
      const target = byId.get(id)?.el.querySelector(':scope > [slot="comment"], :scope > .entry .usertext-body');
      target?.setAttribute('data-scout-similar', String(group.length - 1));
    }
  }
  chrome.runtime.sendMessage({ type: 'census', report: { ...report, thread: readThread() } }).catch(() => {});
}

async function lookUpProfiles() {
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
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
schedule();
