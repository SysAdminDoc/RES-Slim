# RES-Slim Roadmap

Stripped RES fork (upstream v5.24.8) for old.reddit.com — comment tweaks, 87 media-host expandos, minimal infra. Roadmap stays ruthlessly minimal while keeping parity with upstream security fixes and extending the media roster.

## Completed This Pass

- Settings console theme picker and density polish — added Graphite, Midnight, Forest, and Ember palettes backed by shared option tokens, persisted in local storage, with localized labels and accessible pressed-state controls.
- Initial `yarn test` fixture suite — added a no-dependency Node test contract for the settings-console theme picker and token coverage. Expand this into media-host fixtures next.

## Planned Features

### Upstream Sync
- Scripted diff tool to detect new upstream commits on kept modules
- Monthly security-fix sync job documented in CONTRIBUTING
- Automated regression tests for `showImages` against a fixture page
- Version-pin manifest that records upstream SHA per module

### Media Hosts
- Add missing 2025/2026-era hosts (catbox.moe, litter.catbox.moe refresh, imgbb, imgchest)
- Refresh YouTube / Reddit-hosted video fetch (v.redd.it HLS changes)
- Streamable + Redgifs API handler refresh
- Native Reddit gallery handler (sequence navigation, preload next)
- Video autoplay-pause on tab hidden

### Comment UX
- Compact mode CSS that shrinks vertical rhythm without losing hit targets
- Per-subreddit comment depth override
- "Collapse OP chain" one-click for long self-post threads

### Build & Release
- [x] esbuild + Flow remain; add `yarn test` fixture suite — initial settings-console fixture contract added; media-host and privacy fixtures remain open.
- CRX3 + XPI signed releases attached to GitHub Releases
- Parallel MV2 Firefox and MV3 Chrome manifests with shared source
- Automated version bump + CHANGELOG from conventional commits

### Privacy Hygiene
- Assert-no-network module that fails the build if any module adds a new outbound URL
- Strip residual upstream telemetry / remote-config paths
- Prove offline operation in test harness

### Documentation
- Per-module "what it does and why kept" notes
- Upstream parity table (kept / removed / modified)
- Contributor guide focused on *not* growing scope

## Competitive Research
- **Reddit Enhancement Suite (upstream)** — full-fat feature set, heavier. Lesson: RES-Slim's pitch is footprint; publish bundle size comparison.
- **Old Reddit Redirect** — tiny MV3 redirect only. Lesson: ship the redirect as an optional module flag.
- **Reddit Enhancement Continued** (user's own userscript) — parallel effort, userscript form factor. Lesson: share theme palettes / media handlers between the two projects.
- **uBlock Origin** — element hide + ad blocking. Lesson: don't duplicate ad-block; recommend uBO in README.

## Nice-to-Haves
- Theme bundle (Dracula / Nord / Catppuccin) cribbed from RE-Continued
- Keyboard-nav module subset
- Comment-tweaks-only mode (disable all media expandos)
- Per-subreddit override panel
- Import/export settings JSON
- Accessibility audit on the expando controls

## Open-Source Research (Round 2)

### Related OSS Projects
- https://github.com/honestbleeps/Reddit-Enhancement-Suite — Upstream RES; maintenance-only mode since 2023-24.
- https://github.com/libertysoft3/Reddit-Enhancement-Suite-old — Fork targeting Reddit clones (Teddit/Saidit/Lemmy-reddit-clones).
- https://github.com/libertysoft3/Reddit-Enhancement-Suite — Secondary libertysoft3 variant.
- https://github.com/Reddit-Enhancement-Suite — Org holding resize-observer-lite, jquery-tokeninput, hotfix-data shims.
- https://github.com/ArthurLimoge/redesign-reddit-classic — CSS-only project mimicking old.reddit on new reddit.
- https://github.com/arthurk/reddit-old — Redirect .new→old helper extension.
- https://github.com/dessant/old-reddit-redirect — Permanent new→old redirect, 100k+ users.
- https://github.com/Tetrax-10/reddit-tweaks — Actively-maintained small RES-like extension.

### Features to Borrow
- libertysoft3 Reddit-clone host whitelist pattern — add Teddit/Saidit host matches for free.
- old-reddit-redirect's lightweight manifest (dessant) — 30-line MV3 redirector; ship as companion extension for users landing on new.reddit links.
- Tetrax-10/reddit-tweaks modernizations — hover-card latency fixes, video-expando aspect-ratio handling.
- ArthurLimoge CSS delta — if old.reddit.com is ever sunset, repurpose the CSS as a new.reddit restyler fallback.
- hotfix-data shim channel (Reddit-Enhancement-Suite org) — fetch module-level overrides without pushing a new build.
- jquery-tokeninput replacement with a modern native-input autocompleter — one of the last jQuery dependencies upstream ships.
- resize-observer-lite polyfill removal — safe since all supported browsers ship ResizeObserver natively.
- Per-module telemetry toggle (opt-in) for identifying dead host handlers.

### Patterns & Architectures Worth Studying
- **Module registry with feature flags** (upstream RES) — each feature self-registers; already in RES-Slim.
- **esbuild + Flow + SASS pipeline** (already in project) — consider swapping Flow for TS LSP-only (no emit) for editor help without toolchain cost.
- **Hotfix-data remote config pattern** (Reddit-Enhancement-Suite org) — separate repo serves tiny JSON updates without a store review.
- **Single-file CRX3 + Firefox MV2 parallel build** (already in project) — align tag on upstream version (5.24.8) and append slim patch counter.
- **Host-handler manifest format** — upstream's host[] registry is the right shape; prune unused entries via static analysis of bundle.

## Implementation Deep Dive (Round 3)

### Reference Implementations to Study
- **honestbleeps/Reddit-Enhancement-Suite (upstream)** — https://github.com/honestbleeps/Reddit-Enhancement-Suite — canonical source we forked from; monitor for esbuild bumps and MV3 fixes to backport.
- **RES Pipeline workflow** — https://github.com/honestbleeps/Reddit-Enhancement-Suite/actions/workflows/pipeline.yml — reference CI shape (esbuild 0.25.x bumps via dependabot); mirror in our `.github/workflows/`.
- **libertysoft3/Reddit-Enhancement-Suite-old** — https://github.com/libertysoft3/Reddit-Enhancement-Suite-old — fork targeting Reddit clones (Lemmy-style); relevant if we ever extend past old.reddit.com.
- **RES release 5.24.3 notes** — https://redditenhancementsuite.com/releases/5.24.3/ — documents the MV3 migration + webpack→esbuild swap; exact blueprint for our own.
- **RES module loader `src/core/modules.js`** — https://github.com/honestbleeps/Reddit-Enhancement-Suite/blob/master/lib/core/modules.js — per-module enable/disable + dependency graph; skeleton for our 45-module tree.
- **Media expando host list** — https://github.com/honestbleeps/Reddit-Enhancement-Suite/tree/master/lib/modules/hosts — 100+ hosts; we ship 87 — periodically diff for new ones.
- **RES Firefox MV2 + Chrome MV3 dual build** — https://github.com/honestbleeps/Reddit-Enhancement-Suite/tree/master/build — manifest transform between targets; match for our CRX3 + XPI packer.

### Known Pitfalls from Similar Projects
- **Twitter/X expandos broken under MV3** — RES release notes call this out: MV3 remotely-hosted-code rule forbids the fetch-and-eval pattern these expandos used. Document as "won't fix" in our README too. Ref: https://redditenhancementsuite.com/releases/5.24.3/
- **old.reddit.com sunset risk** — Reddit has repeatedly threatened to retire old.reddit; our entire target surface could disappear. Monitor https://www.reddit.com/r/RESissues and plan a "new Reddit" mode behind a feature flag.
- **esbuild 0.25 API change** — Dependabot bumps on upstream required loader config updates; pin-and-test, don't ^-range. https://github.com/honestbleeps/Reddit-Enhancement-Suite/pulls
- **Flow annotations vs. TypeScript** — upstream uses Flow; many PRs stall because contributors write TS. We inherited this — decide whether to migrate or lock Flow at the current version.
- **SASS → CSS output** needs CSS namespacing (`.res-*` prefix) to avoid collisions with subreddit custom CSS.
- **`unsafeWindow` / page-world access** — RES uses content-script bridge via `<script>` injection; MV3 requires `world:"MAIN"` scripting — rewrite any remaining bridge code.
- **Dependabot churn** — upstream has constant dep bumps; our fork risks silently diverging. Mirror the same dependabot config or run `npm outdated` weekly.

### Library Integration Checklist
- **esbuild** pin `>=0.25.0` (matches upstream); entrypoint `esbuild.build`; gotcha: MV3 SW needs `format:"esm"`, content script needs `format:"iife"`.
- **Flow** pin current upstream; entrypoint `flow check`; gotcha: decide migration path before Flow's next major.
- **Dart Sass** pin `>=1.77`; entrypoint `sass src → build/css`; gotcha: `@import` deprecated — migrate to `@use` before 2.0.
- **webextension-polyfill** `>=0.12`; entrypoint `browser.*`; gotcha: keep for Firefox MV2 build only, strip for Chrome MV3.
- **CRX3 packer** (our own) — entrypoint `crx3 pack`; gotcha: reuse `.pem` across releases — regenerating = new extension ID = lost users.
- **AMO (Firefox) signing** via `web-ext sign`; gotcha: requires `browser_specific_settings.gecko.id` in manifest; Firefox MV2 still accepted for extension updates as of 2026.
- **declarativeNetRequest** MV3 only; entrypoint `updateEnabledRulesets`; gotcha: our filter-list features that used `webRequest` must migrate — one ruleset per feature group to stay under the 5K dynamic cap.
