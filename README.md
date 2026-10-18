# Scout

A personal Chrome extension that stays quiet until something is worth your attention: trackers, scams, bots, AI imagery, fine print. Most of what it does is local and free. It reaches for an AI model only when the stakes are high and the local signals disagree.

Built for one user, loaded unpacked, never published to the Chrome Web Store.

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Pin Scout. Clicking it opens the side panel.

The manifest carries a fixed `key`, so the extension ID (and the memory stored under it) survives moving the folder. Export memory from the panel before uninstalling; removing the extension erases it.

## What works now (v0.3)

| Piece | What it does |
|---|---|
| **Shield** | Blocks trackers with EasyPrivacy: about 8,200 block rules covering roughly 47,000 domains, plus about 830 allow rules that keep sites from breaking. The rules come from uBlock Origin Lite's conversion to Chrome's rule format. A per-page ledger names the owner of each blocked tracker from DuckDuckGo's Tracker Radar (19,000 companies). It relies on `onRuleMatchedDebug`, which only fires for unpacked extensions. When the panel opens, Chrome's own count of blocks on the tab backfills anything the ledger missed. |
| **Ads** | EasyList, from uBO Lite's DNR build: about 3,200 block rules and 500 allow rules. Counted in the panel next to trackers. |
| **Clean links** | Strips tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`, `igshid` and about twenty more) from pages you open. |
| **Slop filter** | On Google, Bing, DuckDuckGo, Brave Search and Startpage, results from about 1,100 AI-heavy sites (laylavish's CC0 HUGE AI Blocklist) fold to one quiet line; click to show. |
| **Doorman** | Rejects cookie banners with DuckDuckGo's autoconsent: it clicks "reject all" using about 1,000 site and consent-platform rules, or hides the banner when rejecting isn't possible. Only autoconsent's own named snippets run in the page, never arbitrary code. |
| **Global Privacy Control** | Sends `Sec-GPC: 1` on every request and sets `navigator.globalPrivacyControl`. Under CCPA and several other state laws, sites must honor it as an opt-out of sale and sharing. |
| **Fingerprint watch** | Notes when a page reads canvas, WebGL GPU strings, audio or font probes. It reports and never blocks. Login pages do this routinely for fraud checks, so it never moves the badge. |
| **Tripwire** | Local lookalike detection (confusable characters, one-letter typos, a brand in a subdomain or a hyphenated name, punycode) against your banks, stores and trusted sites, using the full Public Suffix List. Domain age comes from RDAP, and only once a page shows a password or payment field. |
| **Fake-shop check** | On pages that look like a shop (multilingual "add to cart", product markup): no contact details or legal notice, trust seals that don't link to their issuer, only hard-to-reverse payment (bank transfer, crypto, gift cards), discounts of 70% or more across the page. Domain age is looked up only once a sign appears. Two or more signs (with a young domain or risky payment), or any three, make a hard flag: a note while browsing, a stop at checkout. Modeled on Germany's Fakeshop-Finder and Austria's Watchlist Internet. |
| **Chrome relay** | Shows whether Chrome's Safe Browsing is on. Extensions can't see whether it's Enhanced protection (the mode with on-device scam detection), so the panel links to the setting. |
| **Ladder** | Turns stakes and flags into a badge (quiet, `•` note, `!` stop). On a login or payment page whose local signals are mixed (soft flags, no hard one), it climbs: **Gemini Nano** on the device first (free; names the brand the page presents as), then a **quick Claude check** if cloud checks are on and today's cap allows. When cloud checks are off, Scout logs a dry-run receipt instead, so you can see how often one would have run. |
| **Page checks** | Free local checks once a page asks for a password, a card, a one-time code or a wallet recovery phrase (checked on load, as the page changes, and the moment you click into such a field): a protected brand named in the title or headings on a different domain, a sensitive form that posts to another site, hidden text addressed to AI assistants (prompt injection aimed at tools like Scout), and any request for a recovery phrase, which is a hard stop on its own. Hidden text never reaches a model. |
| **Investigate** | A button in the panel. Sends Claude the page's fields plus its visible text (redacted, capped at 6,000 characters) at high effort and shows a verdict, a short summary and reasons. |
| **Census (Reddit)** | Reads the thread already on screen (new and old Reddit) and reports patterns across accounts: near-identical wording from different accounts (marked on the page as "similar wording"), Reddit's generated usernames, bursts of posting. On request it looks up public profiles through your own session (at most 40, slowly, cached for a week) for account age, same-week creation and karma. **Analyze pattern** sends the thread to Opus with usernames replaced by A1, A2…. Scout describes the thread; it never labels one person a bot. |
| **Provenance** | Right-click any image → **Check image with Scout**. Reads C2PA Content Credentials with Adobe's c2pa-web (in the offscreen document; the 9 MB WASM loads only on first use), plus unsigned labels: IPTC digital source type, Stable Diffusion and ComfyUI settings in PNGs, generator names, and what looks like China's AIGC label. Checks the signer against the official C2PA trust list (32 certificates: Google, Adobe, DigiCert, SSL.com, Huawei, vivo, Xiaomi and others; refreshed monthly), and keeps "unknown signer" separate from "altered". Tells apart an edited picture from an edited credential. For Google-hosted images it also checks the original-size file, since the displayed copy is stripped. "Nothing found" is said as exactly that. |
| **Ask Scout** | Right-click a link → **Check this link with Scout**: disguised destinations (`brand.com@elsewhere`), bare IPs, shorteners, lookalikes, punycode, domain age. Local, no model call. Select text → **Is this a scam? Ask Scout**: Haiku judges the message (redacted). |
| **Fine print** | **Read the fine print** finds the page's privacy policy and terms (in several languages), fetches them without cookies, and has Haiku pull out up to eight points: data selling, AI training, tracking, arbitration, auto-renewal, retention, deletion, opt-out. Every point carries a verbatim quote, and Scout checks each quote against the fetched text; one it can't find is marked so. |
| **Spoiler shield** | List shows and films with how far you've watched. Any passage that mentions one (or an alias, such as a character's name) is blurred the moment it appears. Haiku then judges each batch against your progress; clean mentions are revealed, spoilers stay behind a click-to-reveal label. Verdicts are cached for 30 days. With cloud checks off, or in "hide every mention" mode, every mention stays hidden. |
| **Shields tab** | Pause ad, tracker and cookie-banner blocking on a site that breaks (scam checks keep running); spoiler watchlist; slop-filter switch; trusted sites with remove; an audit of your other extensions that can read every site or control the browser. |
| **Receipts** | Every request that leaves the browser on Scout's behalf, listed in the panel with what was sent, why and what it cost. |
| **Memory** | Sites you trust and alerts you dismiss. Trust lapses if a domain's registration date changes (expired and re-bought) or after a year. Hard red flags can't be dismissed; only trusting the site clears them. |

## Layout

```
manifest.json
rules/                  DNR rulesets: gpc, easyprivacy (block), easyprivacy-allow (generated)
data/entities.json      tracker domain → owning company (generated)
dist/                   bundled dependencies: autoconsent, tldts (generated, committed)
scripts/update-lists.mjs  refreshes rules/ and data/ from upstream (needs network)
scripts/build.mjs         rebuilds dist/ from node_modules (offline)
src/shared/             pure logic: ladder, tripwire, trust, tracker naming (unit-tested)
src/background/         service worker, storage, memory, network lookups
src/content/            main-world.js (GPC + fingerprint hooks); page.js (stakes, page fields, shop facts), consent.js, spoilers.js, reddit.js, slop.js (all bundled to dist/)
src/offscreen/          model calls: Anthropic SDK and Chrome's Prompt API
src/sidepanel/          the panel
tests/                  node:test
```

Generated files are committed, so **Load unpacked** works straight from a clone. To change anything:

```
npm install
npm test               # unit tests
npm run build          # after bumping autoconsent, tldts or the Anthropic SDK
npm run update-lists   # every few weeks: fresh EasyPrivacy and Tracker Radar
```

## Cloud checks

Off until you turn them on. In the panel, open **Models → Settings**, paste an Anthropic API key, and tick **Cloud checks**.

- **Models:** Claude Haiku 5.5 for routine work (quick page checks, spoiler context). Claude Opus 5.5 for critical reasoning: Investigate (high effort) and bot-pattern analysis. Both are configurable.
- **Cost:** a quick check sends about 1,000 tokens and gets back a few hundred, under a tenth of a cent on Haiku 5.5. Investigate on Opus 5.5 costs a cent or more, depending on the page. The panel shows today's count and spend, and each receipt carries its own cost.
- **Cap:** 25 quick checks a day by default. Investigate isn't capped, since you click it yourself.
- **Refusals:** Opus and Sonnet requests opt into server-side fallback (`fallbacks: "default"`), so a safety decline is retried on another model. A refusal that still stands becomes an info note, never a warning.
- **Where it runs:** model calls happen in an offscreen document, not the service worker. The SDK is 300 KB, and slow calls outlive the worker's idle timer there.
- **What's sent:** the evidence object in `src/shared/assessment.js`: host, registration date, what the page asks for, Scout's local signals, and the page's title, description, headings, field labels and form destinations. Emails and long numbers are redacted. Investigate adds visible text. Values typed into fields are never read.

## Design rules

- **Local first.** Tier 0 (lists, rules) and Tier 1 (heuristics) run everywhere. Tier 2 is Gemini Nano on the device. Tiers 3 and 4 are cloud models, called with your own key.
- **Escalate on stakes × uncertainty.** A cloud check runs only when the page asks for a password or a card, the local signals are mixed, and nothing is decisive either way.
- **The model can add suspicion, never remove it.** Deterministic red flags stand regardless of what a model says, which blunts pages written to talk the model out of a warning.
- **Cloud calls get extracted fields, never page HTML, cookies or form contents.** Every call gets a receipt.
- **Defer to Chrome, then cover its gaps.** Where Chrome has a native check (Safe Browsing, its on-device scam detection, the C2PA and SynthID checks announced at I/O 2026), Scout relays Chrome's finding in its field notes. It also runs its own check wherever Chrome's coverage stops: metadata Chrome doesn't read, non-Google watermarks, sites and media types Chrome skips.

## Known limits

- Ad blocking is network-level only; uBO Lite's cosmetic filters (hiding empty ad slots) aren't included.
- uBO's 13 redirect rules are dropped, since they depend on uBO's own stub scripts. A few trackers that uBO would neuter therefore load.
- If Chrome has idled the service worker, early tracker events on a page can arrive before Scout is listening. They're still blocked, and the panel counts them as "blocked before Scout could name them."
- Large data files load on first use. Bundling them into the service worker kept Chrome from delivering navigation and rule-match events to it.
- Once, in testing, a page opened in the first moment after install showed no blocks at all, which suggests Chrome hadn't loaded the rules yet. It didn't recur.
- The Gemini Nano tier is wired and feature-detected but untested on real hardware: headless Chromium reports the model as downloadable and can't run it.
- The API key sits unencrypted in the extension's local storage unless you tick **Forget the key when Chrome closes**, which keeps it in memory only. Don't load Scout into a shared Chrome profile.
- Reddit blocked logged-out `.json` requests in May 2026 and is closing its public API through March 2027. Census works from the page you're reading; profile lookups depend on your logged-in session still being served, and stop the moment Reddit returns 403 or 429. Reddit's markup changes; the e2e fixture pins what Scout expects.
- SynthID has no public API, and Chrome gives extensions no way to read its own SynthID check; Scout points to Google's tool instead.
- `'wasm-unsafe-eval'` is in the extension's CSP so c2pa-web can compile its WASM. It permits WebAssembly only, not JavaScript eval.
- Chrome gives extensions no access to TLS certificates, so trust is tied to domain registration rather than the certificate.

## Roadmap

1. ~~Shield, GPC, Tripwire (local), badge, receipts, memory~~
2. ~~EasyPrivacy, consent-banner auto-reject, the full Public Suffix List, Safe Browsing state~~
3. ~~Escalation engine live: Gemini Nano tier, Claude tiers, daily budget meter, Investigate~~
4. ~~Census: Reddit thread coordination scoring~~
5. ~~Provenance: c2pa-web reading, IPTC and generator labels, original-file retry for Google-hosted images~~ (relaying Chrome's own SynthID/C2PA result has no extension API yet)
6. ~~Ask Scout (right-click links and text), fine print reader with quote checking~~

## Licenses of bundled data

- EasyPrivacy rules: GPLv3 / CC BY-SA 3.0 (EasyList authors), via uBlock Origin Lite (GPLv3)
- Tracker Radar entity map: CC BY-NC-SA 4.0 (DuckDuckGo), fine for personal, non-commercial use
- EasyList rules: GPLv3 / CC BY-SA 3.0, via uBlock Origin Lite
- AI-site list: CC0 (laylavish/uBlockOrigin-HUGE-AI-Blocklist)
- autoconsent: MPL-2.0 (DuckDuckGo) · tldts: MIT · Anthropic SDK: MIT · c2pa-web: MIT (Adobe)
- Test images in `tests/fixtures/`: Source Kit samples, Apache-2.0
- C2PA trust list: c2pa-org/conformance-public
