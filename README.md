# Scout

A personal Chrome extension that stays quiet until something is worth your attention: trackers, scams, bots, AI imagery, fine print. Most of what it does is local and free. It reaches for an AI model only when the stakes are high and the local signals disagree.

Built for one user, loaded unpacked, never published to the Chrome Web Store.

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Pin Scout. Clicking it opens the side panel.

The manifest carries a fixed `key`, so the extension ID (and the memory stored under it) survives moving the folder. Export memory from the panel before uninstalling; removing the extension erases it.

## What works now (v0.1)

| Piece | What it does |
|---|---|
| **Shield** | Blocks a starter set of trackers with `declarativeNetRequest` and keeps a per-page ledger by company. The ledger relies on `onRuleMatchedDebug`, which only fires for unpacked extensions. |
| **Global Privacy Control** | Sends `Sec-GPC: 1` on every request and sets `navigator.globalPrivacyControl`. Under CCPA and several other state laws, sites must honor it as an opt-out of sale and sharing. |
| **Fingerprint watch** | Notes when a page reads canvas, WebGL GPU strings, audio or font probes. It reports and never blocks. Login pages do this routinely for fraud checks, so it never moves the badge. |
| **Tripwire** | Local lookalike detection (confusable characters, one-letter typos, a brand name buried in a subdomain, punycode) against your banks, stores and trusted sites. Domain age comes from RDAP, and only once a page shows a password or payment field. |
| **Ladder** | Turns stakes and flags into a badge (quiet, `•` note, `!` stop) and decides when a cloud check would be worth it. Cloud tiers are not wired yet. Each time one would have run, Scout logs a **dry-run receipt**, so the trigger rate is visible before any tokens are spent. |
| **Receipts** | Every request that leaves the browser on Scout's behalf, listed in the panel with what was sent and why. |
| **Memory** | Sites you trust and alerts you dismiss. Trust lapses if a domain's registration date changes (expired and re-bought) or after a year. Hard red flags can't be dismissed; only trusting the site clears them. |

## Layout

```
manifest.json
rules/                  DNR rulesets (gpc.json, trackers.json, generated)
scripts/build-rules.mjs trackers.json from src/shared/trackers.js
src/shared/             pure logic: ladder, tripwire, trust, tracker map (unit-tested)
src/background/         service worker, storage, memory, network lookups
src/content/            main-world.js (GPC + fingerprint hooks), page.js (stakes detection)
src/sidepanel/          the panel
tests/                  node:test, no dependencies
```

```
npm test              # unit tests
npm run build:rules   # after editing the tracker map
```

## Design rules

- **Local first.** Tier 0 (lists, rules) and Tier 1 (heuristics) run everywhere. Tier 2 is Gemini Nano on the device. Tiers 3 and 4 are cloud models, called with your own key.
- **Escalate on stakes × uncertainty.** A cloud check runs only when the page asks for a password or a card, the local signals are mixed, and nothing is decisive either way.
- **The model can add suspicion, never remove it.** Deterministic red flags stand regardless of what a model says, which blunts pages written to talk the model out of a warning.
- **Cloud calls get extracted fields, never page HTML, cookies or form contents.** Every call gets a receipt.
- **Defer to Chrome, then cover its gaps.** Where Chrome has a native check (Safe Browsing, its on-device scam detection, the C2PA and SynthID checks announced at I/O 2026), Scout relays Chrome's finding in its field notes. It also runs its own check wherever Chrome's coverage stops: metadata Chrome doesn't read, non-Google watermarks, sites and media types Chrome skips.

## Known limits

- The tracker list is a 15-domain starter. EasyPrivacy, converted to DNR rules, comes next.
- `registrableDomain` uses a short suffix list, not the full Public Suffix List.
- On a cold service-worker start, the first page can lose its tracker ledger entries. The trackers are still blocked; only the count is missed.
- Chrome gives extensions no access to TLS certificates, so trust is tied to domain registration rather than the certificate.

## Roadmap

1. ~~Shield, GPC, Tripwire (local), badge, receipts, memory~~
2. EasyPrivacy conversion, consent-banner auto-reject (DuckDuckGo autoconsent), the full Public Suffix List, Safe Browsing state
3. Escalation engine live: Gemini Nano tier, Claude tiers, daily budget meter
4. Census: Reddit thread coordination scoring
5. Provenance: relay Chrome's C2PA and SynthID results; own c2pa-js reading and IPTC labels for the rest
6. Ask Scout (right-click), Fine print reader on sign-up and checkout pages
