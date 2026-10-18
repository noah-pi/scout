# Scout

A personal Chrome extension that stays quiet until something is worth your attention: trackers, scams, bots, AI imagery, fine print. Most of what it does is local and free. It reaches for an AI model only when the stakes are high and the local signals disagree.

Built for one user, loaded unpacked, never published to the Chrome Web Store.

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Pin Scout. Clicking it opens the side panel.

The manifest carries a fixed `key`, so the extension ID (and the memory stored under it) survives moving the folder. Export memory from the panel before uninstalling; removing the extension erases it.

## What works now (v0.2)

| Piece | What it does |
|---|---|
| **Shield** | Blocks trackers with EasyPrivacy: about 8,200 block rules covering roughly 47,000 domains, plus about 830 allow rules that keep sites from breaking. The rules come from uBlock Origin Lite's conversion to Chrome's rule format. A per-page ledger names the owner of each blocked tracker from DuckDuckGo's Tracker Radar (19,000 companies). It relies on `onRuleMatchedDebug`, which only fires for unpacked extensions. When the panel opens, Chrome's own count of blocks on the tab backfills anything the ledger missed. |
| **Doorman** | Rejects cookie banners with DuckDuckGo's autoconsent: it clicks "reject all" using about 1,000 site and consent-platform rules, or hides the banner when rejecting isn't possible. Only autoconsent's own named snippets run in the page, never arbitrary code. |
| **Global Privacy Control** | Sends `Sec-GPC: 1` on every request and sets `navigator.globalPrivacyControl`. Under CCPA and several other state laws, sites must honor it as an opt-out of sale and sharing. |
| **Fingerprint watch** | Notes when a page reads canvas, WebGL GPU strings, audio or font probes. It reports and never blocks. Login pages do this routinely for fraud checks, so it never moves the badge. |
| **Tripwire** | Local lookalike detection (confusable characters, one-letter typos, a brand in a subdomain or a hyphenated name, punycode) against your banks, stores and trusted sites, using the full Public Suffix List. Domain age comes from RDAP, and only once a page shows a password or payment field. |
| **Chrome relay** | Shows whether Chrome's Safe Browsing is on. Extensions can't see whether it's Enhanced protection (the mode with on-device scam detection), so the panel links to the setting. |
| **Ladder** | Turns stakes and flags into a badge (quiet, `•` note, `!` stop) and decides when a cloud check would be worth it. Cloud tiers are not wired yet. Each time one would have run, Scout logs a **dry-run receipt**, so the trigger rate is visible before any tokens are spent. |
| **Receipts** | Every request that leaves the browser on Scout's behalf, listed in the panel with what was sent and why. |
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
src/content/            main-world.js (GPC + fingerprint hooks), page.js (stakes), consent.js (autoconsent)
src/sidepanel/          the panel
tests/                  node:test
```

Generated files are committed, so **Load unpacked** works straight from a clone. To change anything:

```
npm install
npm test               # unit tests
npm run build          # after bumping autoconsent or tldts
npm run update-lists   # every few weeks: fresh EasyPrivacy and Tracker Radar
```

## Design rules

- **Local first.** Tier 0 (lists, rules) and Tier 1 (heuristics) run everywhere. Tier 2 is Gemini Nano on the device. Tiers 3 and 4 are cloud models, called with your own key.
- **Escalate on stakes × uncertainty.** A cloud check runs only when the page asks for a password or a card, the local signals are mixed, and nothing is decisive either way.
- **The model can add suspicion, never remove it.** Deterministic red flags stand regardless of what a model says, which blunts pages written to talk the model out of a warning.
- **Cloud calls get extracted fields, never page HTML, cookies or form contents.** Every call gets a receipt.
- **Defer to Chrome, then cover its gaps.** Where Chrome has a native check (Safe Browsing, its on-device scam detection, the C2PA and SynthID checks announced at I/O 2026), Scout relays Chrome's finding in its field notes. It also runs its own check wherever Chrome's coverage stops: metadata Chrome doesn't read, non-Google watermarks, sites and media types Chrome skips.

## Known limits

- EasyPrivacy covers tracking. Ad blocking (EasyList) is not included yet; uBlock Origin Lite next to Scout covers it.
- uBO's 13 redirect rules are dropped, since they depend on uBO's own stub scripts. A few trackers that uBO would neuter therefore load.
- If Chrome has idled the service worker, early tracker events on a page can arrive before Scout is listening. They're still blocked, and the panel counts them as "blocked before Scout could name them."
- Large data files load on first use. Bundling them into the service worker kept Chrome from delivering navigation and rule-match events to it.
- Chrome gives extensions no access to TLS certificates, so trust is tied to domain registration rather than the certificate.

## Roadmap

1. ~~Shield, GPC, Tripwire (local), badge, receipts, memory~~
2. ~~EasyPrivacy, consent-banner auto-reject, the full Public Suffix List, Safe Browsing state~~
3. Escalation engine live: Gemini Nano tier, Claude tiers, daily budget meter
4. Census: Reddit thread coordination scoring
5. Provenance: relay Chrome's C2PA and SynthID results; own c2pa-js reading and IPTC labels for the rest
6. Ask Scout (right-click), Fine print reader on sign-up and checkout pages

## Licenses of bundled data

- EasyPrivacy rules: GPLv3 / CC BY-SA 3.0 (EasyList authors), via uBlock Origin Lite (GPLv3)
- Tracker Radar entity map: CC BY-NC-SA 4.0 (DuckDuckGo), fine for personal, non-commercial use
- autoconsent: MPL-2.0 (DuckDuckGo) · tldts: MIT
