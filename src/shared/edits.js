// Silent edits: what a story says now against what it said before. A snapshot
// keeps the parts an edit would touch (headline, dek, byline, dates, body
// paragraphs); a comparison names what changed, paragraph by paragraph and
// quote by quote, and whether the page admitted it by moving its updated
// date. Pure, apart from reading a parsed document.

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Curly and straight quotes, dashes and spaces vary between fetches of the
// same text; an edit is a change in words.
const norm = (s) => clean(s).replace(/[“”„«»]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, '-');

const MAX_PARAGRAPHS = 300;
const MAX_TEXT = 60_000;

export function snapshotFromDocument(doc, url) {
  const meta = (sel) => clean(doc.querySelector(sel)?.getAttribute('content'));
  const text = (sel) => clean(doc.querySelector(sel)?.textContent);
  const snap = {
    url,
    headline: meta('meta[property="og:title"]') || text('h1') || clean(doc.title),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    byline: meta('meta[name="author"]') || meta('meta[property="article:author"]') || text('[rel="author"], [itemprop="author"], .byline'),
    published: meta('meta[property="article:published_time"]') || meta('meta[itemprop="datePublished"]'),
    modified: meta('meta[property="article:modified_time"]') || meta('meta[itemprop="dateModified"]'),
  };
  doc.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, [aria-hidden="true"]').forEach((el) => el.remove());
  const root = doc.querySelector('article') ?? doc.querySelector('main, [role="main"]') ?? doc.body;
  const paragraphs = [];
  let size = 0;
  for (const p of root?.querySelectorAll('p') ?? []) {
    const t = clean(p.textContent);
    if (t.length < 40 || paragraphs.includes(t)) continue;
    if ((size += t.length) > MAX_TEXT || paragraphs.length >= MAX_PARAGRAPHS) break;
    paragraphs.push(t);
  }
  return { ...snap, paragraphs };
}

// Quoted passages of 20 characters or more.
export function quotesIn(paragraphs) {
  const out = [];
  for (const p of paragraphs) for (const m of norm(p).matchAll(/"([^"]{20,400})"/g)) out.push(m[1]);
  return [...new Set(out)];
}

const words = (s) => new Set(norm(s).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(1, x.size + y.size - shared);
}

// before and after are snapshots. readable is false when the new copy can't
// be compared fairly: too little text (a paywall, a block page) or a page that
// no longer resembles the old one (a redesign). No edits are claimed then.
export function compareSnapshots(before, after) {
  const changes = [];
  for (const field of ['headline', 'description', 'byline']) {
    if (before[field] && after[field] && norm(before[field]) !== norm(after[field])) changes.push({ field, before: before[field], after: after[field] });
  }
  const result = (readable, reason) => ({
    readable,
    reason,
    changes,
    // An edit the page didn't own up to: its updated date stayed put.
    dateMoved: norm(before.modified) !== norm(after.modified),
    stealth: changes.length > 0 && norm(before.modified) === norm(after.modified),
  });
  if (before.paragraphs.length < 3 || after.paragraphs.length < 3) return result(false, 'too little text to compare');
  const b = before.paragraphs.map(norm);
  const a = after.paragraphs.map(norm);
  const aSet = new Set(a);
  const bSet = new Set(b);
  const kept = b.filter((p) => aSet.has(p)).length;
  if (kept / b.length < 0.3 && kept / a.length < 0.3) {
    const close = b.filter((p) => a.some((q) => similarity(p, q) >= 0.5)).length;
    if (close / b.length < 0.3) return result(false, 'the page no longer resembles the copy Scout kept');
  }
  let removed = before.paragraphs.filter((p) => !aSet.has(norm(p)));
  let added = after.paragraphs.filter((p) => !bSet.has(norm(p)));
  const edited = [];
  for (const old of [...removed]) {
    let best = null;
    for (const neu of added) {
      const s = similarity(old, neu);
      if (s >= 0.5 && (!best || s > best.s)) best = { neu, s };
    }
    if (best) {
      edited.push({ before: old, after: best.neu });
      removed = removed.filter((p) => p !== old);
      added = added.filter((p) => p !== best.neu);
    }
  }
  if (edited.length || removed.length || added.length) changes.push({ field: 'body', edited: edited.slice(0, 20), removed: removed.slice(0, 20), added: added.slice(0, 20) });
  const now = after.paragraphs.map(norm).join('\n');
  const gone = quotesIn(before.paragraphs).filter((q) => !now.includes(q));
  if (gone.length) changes.push({ field: 'quotes', removed: gone.slice(0, 20) });
  return result(true);
}

// One sentence for a notification or the activity log.
export function describeChanges(cmp) {
  const parts = [];
  for (const c of cmp.changes) {
    if (c.field === 'headline') parts.push('the headline');
    if (c.field === 'description') parts.push('the summary');
    if (c.field === 'byline') parts.push('the byline');
    if (c.field === 'body') {
      const n = c.edited.length + c.removed.length + c.added.length;
      parts.push(`${n} paragraph${n === 1 ? '' : 's'}`);
    }
    if (c.field === 'quotes') parts.push(`${c.removed.length} quote${c.removed.length === 1 ? '' : 's'} removed`);
  }
  if (!parts.length) return 'No changes.';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Changed: ${list}.${cmp.stealth ? ' The page’s updated date didn’t move.' : ''}`;
}
