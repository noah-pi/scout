// Nightly canary for Scout's page rules: loads a few live pages in plain
// Chromium and checks that each site-specific rule still finds something.
// A rule that finds nothing has probably been broken by a markup change.
// A page that won't load or shows a bot check says nothing about the rule,
// so it is reported as "blocked", apart from "missing".
//
//   node scripts/rule-canary.mjs [--json report.json]
//
// Exits 0 whatever it finds; the workflow turns "missing" into an issue.
import { readFileSync, writeFileSync } from 'node:fs';
import { validateRules } from '../src/shared/pagerules.js';

const rules = validateRules(JSON.parse(readFileSync(new URL('../data/page-rules.json', import.meta.url), 'utf8')));

// Census reads Reddit threads with these (src/content/threads.js).
const CENSUS_REDDIT = ['shreddit-comment[author]', '.thing.comment[data-author]'];
const BOT_CHECK = /unusual traffic|are you a robot|verify you are human|blocked by network security|before you continue to (google|youtube)/i;

export const CHECKS = [
  { key: 'shorts', url: 'https://www.youtube.com/results?search_query=news&hl=en', selectors: () => rules.calm.shorts?.selectors ?? [] },
  {
    key: 'aiOverviews',
    url: 'https://www.google.com/search?q=why+is+the+sky+blue&hl=en&gl=us',
    selectors: () => rules.calm.aiOverviews?.selectors ?? [],
    texts: () => rules.calm.aiOverviews?.textBlocks?.texts ?? [],
  },
  { key: 'census-reddit', url: 'https://old.reddit.com/r/AskHistorians/top/?t=week', follow: 'a.comments', selectors: () => CENSUS_REDDIT },
];

// What a page shows for one check: how many elements its selectors match, and
// whether any short element's text is one of the rule's headings.
export async function probe(page, check) {
  try {
    const res = await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (check.follow) {
      const next = await page.getAttribute(check.follow, 'href').catch(() => null);
      if (next) await page.goto(new URL(next, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await page.waitForTimeout(check.wait ?? 6000);
    const status = res?.status() ?? 0;
    const body = (await page.textContent('body').catch(() => '')) ?? '';
    if (status >= 400 || BOT_CHECK.test(body.slice(0, 5000))) return { key: check.key, url: page.url(), result: 'blocked', detail: `HTTP ${status}` };
    const found = await page.evaluate(
      ({ selectors, texts }) => {
        let n = 0;
        for (const s of selectors) {
          try {
            n += document.querySelectorAll(s).length;
          } catch {}
        }
        const want = new Set(texts.map((t) => t.toLowerCase()));
        const headings = [...document.querySelectorAll('h1, h2, h3, div[role="heading"], span')].filter((el) => want.has(el.textContent.trim().toLowerCase())).length;
        return { selectors: n, headings };
      },
      { selectors: check.selectors(), texts: check.texts?.() ?? [] },
    );
    return { key: check.key, url: page.url(), result: found.selectors + found.headings > 0 ? 'ok' : 'missing', detail: `${found.selectors} selector matches, ${found.headings} heading matches` };
  } catch (error) {
    return { key: check.key, url: check.url, result: 'blocked', detail: String(error.message ?? error).split('\n')[0] };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.SCOUT_CHROMIUM || undefined });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const report = [];
  for (const check of CHECKS) report.push(await probe(await context.newPage(), check));
  await browser.close();
  for (const r of report) console.log(`${r.result.padEnd(8)} ${r.key.padEnd(14)} ${r.detail} · ${r.url}`);
  const at = process.argv.indexOf('--json');
  if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify({ checkedAt: new Date().toISOString(), rulesUpdated: rules.updated, report }, null, 2));
}
