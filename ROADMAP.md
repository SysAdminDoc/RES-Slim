# RES-Slim Roadmap

**Version:** v0.5 planning pass · **Updated:** 2026-05-19 · **Baseline:** v0.4.0 (45 modules, 86 hosts, esbuild 0.23.1, Flow 0.84.0, GPL-3.0, MV3+MV2 dual build)

Stripped fork of [Reddit Enhancement Suite](https://github.com/honestbleeps/Reddit-Enhancement-Suite) v5.24.8 for **old.reddit.com**. Roadmap stays ruthlessly minimal — every entry must (a) trace to a competitor / upstream / community source in the [Appendix](#appendix-sources), (b) align with the [stated philosophy](#non-negotiable-philosophy), and (c) be sized so we never carry a tier with more than ~12 open items.

---

## Non-negotiable philosophy

1. **Scope minimalism** — every added feature must justify its kilobytes. Reject duplicate-of-uBlock or duplicate-of-Tampermonkey work.
2. **No telemetry, no cloud, no OAuth** — outbound URL allow-list is enforced by `tests/unit/privacy-outbound-urls.test.mjs` ([snapshot](tests/fixtures/privacy/outbound-url-snapshot.json)). New network references fail the build until reviewed.
3. **No keyboard shortcuts inside feature modules** (banned across user projects). The settings console may still have keyboard nav for accessibility.
4. **No pill / oval / fully-rounded backdrops** in any new UI — global hard rule.
5. **old.reddit.com only.** Reddit has *not* announced a sunset (confirmed 2026-05; old.reddit even kept `/r/all` after new Reddit dropped it [^old-reddit-r-all]). Plan for indefinite support; new-reddit mode stays under "Under Consideration".
6. **Private fork** — extension ID intentionally diverges from upstream RES. Settings do not auto-migrate. No code goes upstream unless explicitly contributed.
7. **Inherited license is GPL-3.0** — no AGPL sources, no unlicensed userscripts pasted in.

---

## Status snapshot (2026-05-19)

| Surface | State |
| --- | --- |
| Modules | 45 (18 comment / 1 media + 86 host handlers / 3 appearance / 7 infra) |
| Build | esbuild 0.23.1, Flow-Remove-Types 2.246, Dart SASS 1.x, JSZip, semver, Commander |
| Manifest | Chrome MV3 (min 114) + Firefox MV2 (min 115). MV2 stays per [Mozilla's renewed MV2 commitment](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/) |
| Tests | 12 unit contracts via `node --test` (theme, hosts, privacy, SW safety, build, permissions, save, navigator, downloads, BG perms, premium polish, hideChildComments) |
| CI | **None.** Build + release fully manual |
| Release artifacts | ZIP per-target via `yarn build`. CRX via `python build/pack-crx.py` w/ `build/res-slim.pem`. No XPI signing. No GitHub Release uploads |
| Known dead-host deadwood | gfycat (shut Sep 2023), liveleak (closed 2019), vlive (closed Mar 2023), simplecove, memecrunch, memedad, livememe |

### Completed since the last roadmap pass

- Settings console rebuild (cbb4dd4) — two-panel independent scrolling, search/staging/mobile fixes, disabled-module accessibility, locale cleanup, right-panel toggle alignment.
- v0.4.0 QA audit — 16 bugs fixed, 50KB CSS reduction, dead deps (`suncalc`, `favico.js`) removed.
- Theme picker — Graphite / Midnight / Forest / Ember palettes, persisted, accessible pressed-state.
- Initial `yarn test` fixture suite — settings console theme + token coverage.
- `tests/fixtures/showImages/old-reddit-media.html` + host-registry / critical-host / browser-permission contracts.
- Privacy outbound-URL guard — reviewed `lib/**/*.js` snapshot, telemetry-domain assertions.
- MV3 background-script migration safety contract ([tests/unit/background-service-worker-safety.test.mjs](tests/unit/background-service-worker-safety.test.mjs)).
- `hideChildComments` repair (bcfe0a9, May 2026).
- Polish passes across `commentNavigator`, `notifications`, `showImages`, permissions plumbing (c804a2a, a1e0225, 8050371).

---

## Tier: **Now** — v0.5.x (next minor, 4–8 weeks)

Per-item criterion: ≤ M effort, single-file or small surface, fits philosophy, source-cited.

### Host roster hygiene
- **`hosts/`: remove gfycat.** Shut down 2023-09-01 [^gfycat]. Delete `gfycat.js`, import line, export line; drop GIF fallback chain. Source: Wikipedia.
- **`hosts/`: remove liveleak, vlive, memecrunch, memedad, livememe, simplecove, ppy.** All dead per upstream issue traffic and basic uptime check. Roll into one PR.
- **`hosts/redgifs.js`: switch to `embed_url`.** The 2022 RedGIFs API break left `file_url` deprecated; embed-url is the supported path [^redgifs-2022]. Upstream PR [#5481](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5481) addresses the same regression.
- **`hosts/soundcloud.js`: fix broken oEmbed.** Upstream issue [#5568](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5568) confirms current breakage; mirror their fix once merged.
- **`hosts/pastebin.js`: fix 404 on embed.** Upstream PR [#5583](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5583).
- **`hosts/reddit*.js`: refresh gallery + poll handlers.** Mirror upstream PR [#5570](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5570) (gallery expandos) and [#5556](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5556) (poll redirect).
- **`hosts/catbox.js`: add catbox.moe + litterbox.catbox.moe.** Trending image/file host; 2025-06 userscript saw catbox URL-regex updates. Two-domain handler [^catbox].
- **`hosts/imgchest.js` + `hosts/imgbb.js`: add.** Both are alive 2026, both surface in Greasyfork download scripts [^greasyfork-top30].
- **`hosts/nitter.js`: add.** Privacy-frontend for twitter; upstream PR [#5560](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5560) provides the pattern.

### Privacy + anti-promo
- **`promotedNuke` module.** Hard-remove `.promoted` *and* `data-promoted="true"` rows that bypass the legacy CSS class selector. Counter badge in toolbar. Source: `RESEARCH-FINDINGS.md` v0.3.2 audit; Greasyfork "Hide Reddit's promoted posts" precedent [^greasyfork-promoted].
- **`outboundLinkCleanser` module.** Strip `out.reddit.com` / `alb.reddit.com` shims at click *and* mouseover so Ctrl-C copies clean URLs. Greasyfork "Reddit Bypass Enhancer" handles click only — leapfrog with mouseover [^greasyfork-bypass].
- **`appPromptKiller` module.** Kill "open in app" interstitial + sticky install banner + 2026 `.reddit-download-bar` variant. Documented in Greasyfork "Reddit Bypass Enhancer" [^greasyfork-bypass].
- **`nsfwQuarantineSkip` module.** Auto-dismiss quarantine / NSFW / over-18 gates without setting the `_options` cookie if user opts in. Greasyfork "Reddit NSFW Unblur" (8.4k installs) as reference [^greasyfork-nsfw-unblur].

### Comment UX
- **Markdown code-block support.** Wire the `sourceSnudown` path to render fenced ```triple-backtick``` + indented blocks at parity with new Reddit. Upstream feature-request [#5223](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5223) (20 comments). Also fold in PR [#5441](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5441) — backtick block fixes.
- **Copy-to-clipboard button on code blocks.** Upstream feature-request [#5566](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5566). Tiny module; sits on top of the snudown render path.
- **`hideChildComments` second pass.** Continue follow-up to bcfe0a9 — verify Reddit's `.expand` toggle gets clicked (not just `.collapsed` class added) per the v0.3.7 fix pattern.

### Build + release
- **GitHub Actions release workflow** (`workflow_dispatch`, `contents: write`). Steps: `yarn install --frozen-lockfile` → `yarn build` (Chrome) → `yarn build --browsers firefox` → `python build/pack-crx.py` → SHA256 each artifact → `gh release upload vX.Y.Z`. Matches the standard per `~/CLAUDE.md` "CI/CD Standard".
- **`gh repo create` flags + branch protection.** Confirm `enforce_admins: true` on main (likely already set).
- **Dependabot config.** Weekly cadence on direct deps + GH Actions. Mirror upstream RES's dependabot.yml minus `webpack` paths.
- **esbuild bump to 0.25.x.** Upstream PR [#5563](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5563) tracked the same bump — review for loader-config drift.
- **Auto-CHANGELOG from conventional commits.** Use git-cliff or release-please-style. Closes the stale-CHANGELOG issue visible at [CHANGELOG.md](CHANGELOG.md) line 5 (`[v5.24.8] - %Y->-` placeholder).
- **`yarn lint` in CI.** Currently defined in `package.json` but never gated.

### Accessibility (audit)
- **Honor `prefers-reduced-motion`.** Disable shimmer, pulse, stage-status animation, hover lift, and any future motion when the OS pref is set. Add a `tests/unit/a11y-reduced-motion-contract.test.mjs`.
- **Focus traps in settings console modals.** Filter chips already use `aria-pressed` (fixed v0.3.7); audit the keycode-capture modal + theme-picker modal.
- **Color contrast on all four themes.** WCAG AA on text-vs-background and AA-large on chips/toggles. Test contract pulls token values from `lib/options/options.scss` and checks ratios with `tinycolor2`.

### Privacy hygiene
- **Drop hardcoded Google API key from `hosts/youtube.js`.** Gate behind an opt-in toggle (host already optional). Documented in `res-slim.md` memory + `CLAUDE.md` gotchas; the key has been unchanged from upstream since fork.
- **Prove offline operation.** Extend `privacy-outbound-urls.test.mjs` to set `connect-src 'none'` in a fixture and assert no module throws on initial load. Existing roadmap item, partial.

---

## Tier: **Next** — v0.6.x – v0.7.x (8–24 weeks)

### Comment UX
- **`commentMarkdownToolbar` module.** Live-preview Markdown editor toolbar mirroring new Reddit's. Source: `SysAdminDoc/Reddit-Enhancement-Continued` v2.7.5 (self-owned) [^re-continued].
- **`botCommentAutoCollapse` module.** Auto-collapse AutoModerator + known bots (configurable username list + regex). Source: RE-Continued.
- **`continuedThreadInline` module.** Replace `[continue this thread]` link with inline lazy-load. Upstream issue tradition; RE-Continued has it.
- **`commentSubtitleSearch` module.** Filter currently-loaded comments by post-title regex. Upstream feature-request [#5572](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5572).
- **`commentTreeExport` module.** Dump thread (title, OP, every comment w/ score, author, depth, timestamp) to Markdown or JSON. From `RESEARCH-FINDINGS.md` top-10 — power-user archival, no precedent in upstream.
- **`opChainCollapse` module.** One click → collapse every comment authored by OP except the top-level chain. From existing roadmap "nice-to-haves" pivot.
- **`subCommentDepthOverride` module.** Per-subreddit override of `commentDepth` setting. From existing roadmap.
- **Compact mode** — single SCSS partial behind a toggle, shrinks vertical rhythm without losing 32px hit targets. From existing roadmap. Hard rule reminder: corner radii stay in `0/4/6/8/10/12`.
- **`saveCommentDraft` module.** Persist reply textarea to local storage so a refresh doesn't nuke a long comment. Upstream issue [#4642](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/4642).

### Filtering + tagging
- **`subredditBlacklistRegex` extension.** Extend current literal-match `subredditBlacklist` to regex + per-rule weight (hide vs dim vs collapse). Reuses the resident `lib/modules/filteReddit/Case.js` kernel.
- **`userTaggerLocal` module.** Local-only user tagging (label + color). No cloud sync — preserves the v0.1.0 OAuth strip. Source: RE-Continued; upstream RES has it but with cloud sync.
- **`userIgnoreList` module.** Hide/dim/collapse content by author. Source: RE-Continued.
- **`bulkFilterImport` module.** Import a list of blocked subs / users / domains from a textarea. Upstream feature-request [#5573](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5573).
- **`visitedLinkFade` module.** Visited links fade by a percentage; option to hide entirely. RE-Continued.

### Anti-AI + author context
- **`aiSlopOverlay` module.** Three-tier confidence outline (em-dash density / contraction rate / burstiness / "not X, but Y" construction / bullet-list fetish). Source: `RootThePlanet/Reddit_AI_BotBuster` (MIT, 17 stars) [^botbuster]. Stays read-only, no calls to external classifier.
- **`authorContextBadge` module.** Inline badge on every OP/username with: account age, comment-karma / post-karma ratio, % of recent posts in the current sub, "first-time-poster" flag. One cached call to `/user/<x>/about.json`.
- **`shadowbanIndicator` module.** Diff `reddit.com/user/<x>/about.json` against `/comments.json` to flag suspected shadowbans. Cheap badge.

### Discovery + search
- **`redditSearchUnbroken` module.** Replace old.reddit's busted built-in search with a dispatcher dropdown: reddit-native / pullpush.io / redditsearch.io / Marginalia / DuckDuckGo. Source: `RESEARCH-FINDINGS.md`.
- **`subredditRulesInline` module.** Hovercard on any `/r/foo` link → rules + post requirements from `/about/rules.json`. Source: `RESEARCH-FINDINGS.md`.
- **`crosspostMap` module.** Always-on inline widget on a post showing other subs the content appears in via `/duplicates.json`. Source: `RESEARCH-FINDINGS.md`.

### Visual / theming
- **`themePack` module.** Drop Catppuccin Mocha / Tokyo Night / Rose Pine / Gruvbox / Nord / Dracula / One Dark / Kanagawa / Everforest / Synthwave / GitHub Dark / Solarized Dark / Reddit Classic light. Lift verbatim from RE-Continued (self-owned, no license risk). Wire into the existing v0.4.0 theme picker on top of Graphite/Midnight/Forest/Ember.
- **`lightTheme` first-class.** Existing palette set is dark-only. CLAUDE.md mandates light option when practical. Plumb through nightMode body-class + token system.
- **`oledTrueBlack` module.** `#000000` body variant with per-subreddit accent extraction (canvas dominant-hue quantize of sub icon). Matches Android AMOLED standard. Novel — no live old-reddit tool ships it.
- **`brandedScrollbar` module.** Reddit-orange accent scrollbar (configurable). RE-Continued has it.
- **`subredditSidebarCollapse` module.** Toggle sticky sidebar to a vertical rail, persisted per-sub. RE-Continued; Greasyfork "Old Reddit Inline Images" (5/2026) shows the same pattern.
- **`fullWidthMode` module.** Lift the page-width clamp. RE-Continued.
- **`cakeDayShimmer` module.** SVG cake icon + subtle rainbow shimmer on author's cake-day. RE-Continued has it; one-day-a-year delight.

### Author / vote info
- **`voteEstimator` module.** Show estimated up/down breakdown + percent. RE-Continued has it; Classic Reddit++ precedent.
- **`viewCounter` module.** Restore the per-post view count (API-backed with fallback estimation). RE-Continued. Upstream feature-request [#5581](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5581) for subscriber counts is the same flavor — restore numerical signals Reddit hid.
- **`fullNumberScore` module.** Show 12,847 instead of "12k". RE-Continued.

### Archival
- **`viewDeleted` enhancement: 2-source diff.** Current module pulls pullpush. Add Wayback + archive.ph fallback chain with provenance badge. Subset of `threadTimeMachine` (which stays in Later).
- **`archiveLinks` extension.** Current module wires Unddit/etc. Add an explicit "snapshot now" button that triggers `web.archive.org/save/<url>` in a new tab — opt-in.

### Build + dev experience
- **Upstream-diff tool.** Script that fetches a kept module's history from honestbleeps/RES and lists commits since our fork SHA. Output: `docs/upstream-diff.md`. From existing roadmap.
- **Version-pin manifest.** `build/upstream-sync.json` recording `{ module: upstream-SHA }` per kept module. From existing roadmap.
- **Pre-commit secret scan.** `gitleaks` or `git-secrets` config + a `tests/unit/secret-scan-contract.test.mjs` that fails CI on `re/(AIza|sk-|gh[pous]_)/` patterns.
- **Bundle size budget.** Fail CI if `dist/chrome/foreground.entry.js` grows >5% per release. Use the esbuild metafile already emitted.
- **Sass `@import` → `@use` migration.** Dart Sass 2.0 drops `@import`. Upstream PRs lagging this; do it once for the slim surface.

### Docs
- **Per-module "what it does and why kept" notes** — short doc per file. From existing roadmap.
- **Upstream parity table** (kept / removed / modified). From existing roadmap.
- **Contributor guide focused on NOT growing scope.** From existing roadmap.
- **README screenshot pass.** Capture all four themes via the screenshots recipe (DPI-aware, 125%).

### i18n
- **Locale fallback audit.** Verify dead-module keys in `locales/locales/*.json` no longer block fall-through to `en.json`. Hint: a stripped module's missing key currently logs noise.
- **Strip locale entries for stripped modules.** Same scope as v0.4.0 CSS dead-import sweep.
- **Browser-locale date format.** `absoluteTimestamps` already has locale/iso option; default to browser locale.

### Reliability
- **Module crash isolation.** Wrap each module's `go()` in a try/catch that toasts + logs to an in-extension panel without breaking sibling modules.
- **In-extension error log panel.** Replace any console-only `logger.error()` with a settings-page tab that surfaces the last N module errors (no upload, local-only).
- **Schema-versioned settings storage.** Add a `__schema_version` key; on bump, run a registered migration. Avoids the bag-of-keys drift that bit upstream issue [#4358](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/4358) (backup permissions not persisted).

### Settings UX
- **Settings import/export JSON.** Buttons in the global stage bar. Round-trips through the existing `lib/core/options/stage.js` snapshot path.
- **"Show what changed since v0.4.0" first-launch panel.** Single dismissible overlay; no recurring upsell. Drives feature discovery without growing scope.

---

## Tier: **Later** — post-1.0 / v1.x

Larger items that need either new infra, a new dep, or a multi-PR sequencing plan.

- **`threadTimeMachine` module.** Four-source diff: pullpush + Wayback + archive.ph + live DOM, with state tags (edited / deleted-by-user / removed-by-mods / removed-by-admins / shadowban-invisible). Novel — no live tool ships the four-source picture. From `RESEARCH-FINDINGS.md`. Requires multi-fetch orchestration + UI affordance.
- **`vredditDashMerge` enhancement to `downloadButtons`.** Mux DASH audio track via `ffmpeg.wasm` (currently dropped, audio-less downloads). User already runs ffmpeg-wasm pipelines elsewhere. Heavy but valuable — 8 MB wasm budget needs the lazy-load infra below.
- **Lazy-load host handlers.** Today `lib/modules/hosts/index.js` static-imports all 86. Switch to dynamic `await import()` keyed on the matched domain. Pre-requisite for ffmpeg-wasm + future heavy hosts.
- **Flow → TypeScript migration (or strip annotations).** Industry has decisively left Flow [^flow-eol]; upstream RES still pins Flow 0.84.0 but is essentially in maintenance. Two paths: (a) full TS LSP-only conversion (no emit, JSDoc-rich), (b) strip Flow annotations entirely and rely on tests. Decide in a 1-pager before code.
- **jQuery removal, module-by-module.** Settings console + a handful of legacy paths still use `$`. Each module-extraction lands as one PR. Long-term goal: zero-jQuery `dist/`.
- **`modlogSniff` module.** For subs exposing public mod logs (Toolbox JSON), annotate removed posts/comments inline with removal reason + mod name. Read-only — stays out of mod-tool territory. From `RESEARCH-FINDINGS.md`.
- **`subredditSimilarity` hovercard.** Inject related-subs chip list from `/api/subreddits/related` + `subredditstats.com`. From `RESEARCH-FINDINGS.md`.
- **`liveSearchPalette` module.** Replace gear-menu search of options + sub-jump + user-jump with a single command palette. Settings console only — does *not* introduce feature keyboard shortcuts; lives on the settings page. From existing roadmap.
- **Self-hosted update channel for Firefox.** `update.json` served from GitHub Pages, signed `.xpi` attached to GitHub Release. Bypasses AMO review for the private fork. Note: Chrome blocks self-hosted CRX with `CRX_REQUIRED_PROOF_MISSING` since Chromium 75 — ship ZIP as primary install asset (per `stack-chrome-extensions.md`).
- **Visual regression for settings console.** Playwright + pixel diff baseline. CI gate. After v0.5 release-workflow lands.
- **Web Worker for any future stylometry compute.** If `aiSlopOverlay` performance bites on long threads, move the heuristic to a worker. Defer until benchmarked.

---

## Tier: **Under Consideration** — needs more evidence before scheduling

- **New-reddit "fallback" mode behind a feature flag.** Hedge against old.reddit sunset. Today's signal (2026-05): no sunset announced; Reddit even kept `/r/all` on old.reddit after dropping it from new [^old-reddit-r-all]. Revisit only if Reddit gives a deprecation window.
- **`hotfix-data` remote-config channel.** Reddit-Enhancement-Suite org pattern: tiny JSON in a sibling repo lets modules patch host regexes without a store review. Strong upside; conflicts with the no-network-on-load privacy stance unless we make it opt-in. Decide after talking through the privacy posture.
- **declarativeNetRequest filter ruleset for promoted-domain blocking.** Could replace `promotedNuke` DOM scrubbing with proper network filtering — uBO does this better, so we'd be duplicating their list. Park unless we find an old-reddit-specific filter that uBO won't ship.
- **`localLLMSummarize` module.** Megathread → top-line summary via local Ollama. Listed top-10 in `RESEARCH-FINDINGS.md` but rejects on philosophy: heavy dep on user-side runtime, scope-creep beyond a "stripped fork". Park.
- **`stylometryProfile` module.** Per-user rolling fingerprint cached in IDB. Heavy compute, marginal value over `aiSlopOverlay`. Park unless `aiSlopOverlay` proves under-powered.
- **Cloud-backup OAuth.** Upstream RES has WebDAV/cloud backup [#5398](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5398). Stripped in v0.1.0 by design. Settings import/export JSON (in Next) is the local-only substitute.
- **Mobile mode.** `oldlander` covers this niche [^oldlander]. Recommend it in README instead of building our own.
- **Safari port.** Upstream issue [#5238](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5238) gets 20 comments / multiple years; no contributor finished it. Won't ship until a maintainer with a Mac volunteers.

---

## Tier: **Rejected** — explicit no-go list

Don't re-propose these without new evidence:

- **Keyboard-driven feature modules** (e.g. upstream `keyboardNav`, [#5465 submissionShortcuts](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5465), j/k/x/Enter bindings) — banned across user projects.
- **Toolbox-style mod features** — out of scope.
- **User tagging with cloud sync** — OAuth was deliberately removed in v0.1.0.
- **Pill / oval / fully-rounded backdrops** — hard rule. Corner radii live in `0/4/6/8/10/12`.
- **AGPL sources** (`ludios/expand-everything`, `Trinovantes/old-reddit-emotes`, `jcunews` filters) — incompatible with our GPL-3.0-only host.
- **Unlicensed userscripts** — reimplement from spec only, never paste in.
- **Upstream `betteReddit` / `wheelBrowse` / `commandLine`** — rejected in v0.1.0 strip.
- **`RobSis/reddit-inline-image-view`** — overlaps with kept `showImages`.
- **`radialmonster/reddit-user-tagger`** — no LICENSE file, legal risk.
- **Bundled new→old redirector** — users install their own (`dessant/old-reddit-redirect`, etc.).
- **Emojis-for-old-reddit / new-reddit-profile-pics-on-old** — cosmetic noise; doesn't match aesthetic.
- **In-extension ad-blocker** — would duplicate uBlock Origin badly. README recommendation is the right answer.
- **`gifToWebmTranscode`** (client-side gif→webm via ffmpeg.wasm at scroll time) — wasm cost outweighs the rare large-gif case.
- **`ccpPrivacyToggle`** (one-click for Reddit's opt-out endpoints) — overlap with browser-level Do Not Sell signals; marginal extension value.
- **Telemetry**, even opt-in — explicit privacy stance.

---

## Themes (rollup)

Each open Now/Next item should map to one of these themes. If something doesn't map, either drop it or extend the theme list explicitly.

| Theme | What it covers | Now → Next items |
| --- | --- | --- |
| **Upstream parity** | Mirror security/host fixes from honestbleeps/RES | redgifs, soundcloud, pastebin, reddit-poll, gallery, esbuild bump, upstream-diff tool, version-pin manifest |
| **Host roster hygiene** | Trim deadwood, add 2026 hosts | gfycat/liveleak/vlive removals; catbox/imgchest/imgbb/nitter adds |
| **Privacy & anti-promo** | Strip tracking surfaces, kill promoted/upsell | promotedNuke, outboundLinkCleanser, appPromptKiller, nsfwQuarantineSkip, drop YT API key, offline-load proof |
| **Comment ergonomics** | Things that make threads readable | markdown code blocks, copy-to-clipboard, hideChildComments follow-up, markdown toolbar, botCommentAutoCollapse, continuedThreadInline, commentSubtitleSearch, commentTreeExport, opChainCollapse, subCommentDepthOverride, compact mode, saveCommentDraft |
| **Filtering & tagging** | Hide what you don't want to see | subredditBlacklistRegex, userTaggerLocal, userIgnoreList, bulkFilterImport, visitedLinkFade |
| **AI & author context** | Read-only signals to read the room | aiSlopOverlay, authorContextBadge, shadowbanIndicator |
| **Discovery & search** | Replace broken/missing reddit affordances | redditSearchUnbroken, subredditRulesInline, crosspostMap |
| **Visual & theming** | Look the way I want | themePack, lightTheme, oledTrueBlack, brandedScrollbar, subredditSidebarCollapse, fullWidthMode, cakeDayShimmer |
| **Vote/karma signals** | Restore numbers Reddit hides | voteEstimator, viewCounter, fullNumberScore |
| **Archival** | See what was edited/removed/snapshotted | viewDeleted 2-source diff, archiveLinks snapshot button |
| **Build, release, & supply chain** | Cut manual release pain, lock the lockfile | GH Actions release, dependabot, esbuild bump, auto-CHANGELOG, lint gate, bundle size budget, sass `@use`, secret scan |
| **Accessibility** | Don't ship inaccessible | prefers-reduced-motion, focus traps, WCAG AA contrast |
| **Reliability** | Don't take the whole extension down on one bad module | module crash isolation, in-extension error log, schema-versioned storage |
| **Docs** | Future-me reads this fork in 3 years | per-module notes, upstream parity table, contributor guide, README screenshots |

---

## Risks

- **`bsky.app` / `embed.bsky.app` oEmbed deprecation** — Bluesky's embed API is young; assume churn. Keep the host handler small.
- **`pullpush.io` rate-limits / shutdown** — multiple modules (`viewDeleted`, future `threadTimeMachine`) depend on it. Plan for failure mode: feature degrades, no module crash.
- **RedGIFs geo-blocking** — UK + 8 US states already blocked [^redgifs-geo]; user-region detection isn't worth it, just surface a "blocked by host" message instead of a black box.
- **old.reddit.com sunset** — no announced timeline as of 2026-05 [^old-reddit-r-all], but Reddit's been making old-reddit-hostile changes annually. Keep `new-reddit fallback mode` thinking active without building it.
- **Chromium CRX self-host blocked since v75** — confirmed in `stack-chrome-extensions.md`. Primary install artifact must be the ZIP ("Load unpacked"), not the CRX.
- **Flow 0.84.0 freeze** — upstream is the only large Flow user we depend on for type signatures. If they migrate, we're stuck on a frozen Flow. Migration plan needs to land in Later, not be deferred indefinitely.

---

## Appendix: sources

This roadmap is sourced. Each footnote is a URL or repo path; each item above traces back to either this section or to an upstream issue/PR linked inline.

### Direct OSS competitors

- [`honestbleeps/Reddit-Enhancement-Suite`](https://github.com/honestbleeps/Reddit-Enhancement-Suite) — Upstream RES, 4.4k stars, last release 5.24.8 (2025-01-22), JavaScript. Maintenance mode since 2023-24.
- [`libertysoft3/Reddit-Enhancement-Suite-old`](https://github.com/libertysoft3/Reddit-Enhancement-Suite-old) — 2 stars, fork targeting Saidit/Lemmy/Reddit-clones. Reference for clone-host whitelist pattern, not for features.
- [`OctoNezd/oldlander`](https://github.com/OctoNezd/oldlander) — 178 stars, last release 1.1.0.521 (2026-01-13), TypeScript. Mobile restyler for old.reddit. Recommends RES alongside.[^oldlander]
- [`RootThePlanet/Reddit_AI_BotBuster`](https://github.com/RootThePlanet/Reddit_AI_BotBuster) — 17 stars, MIT. AI-prose detection heuristics + DOM overlay.[^botbuster]
- [`SysAdminDoc/Reddit-Enhancement-Continued`](https://github.com/SysAdminDoc/Reddit-Enhancement-Continued) — Self-owned MIT userscript, v2.7.5. 14 theme palettes; vote estimator; view counter; full-number scores; cake-day shimmer; markdown toolbar; botCommentAutoCollapse; userTagger; etc.[^re-continued]
- [`Farow/Reddit_comment_vote_history`](https://github.com/Farow/Reddit_comment_vote_history) — Local-only vote-cast log. Reference for IDB schema if `voteHistoryLog` ever moves out of Under Consideration.
- [`dessant/old-reddit-redirect`](https://github.com/dessant/old-reddit-redirect) — 100k+ users. Confirms the "do one thing well" pitch for a *separate* redirector extension.
- `Tetrax-10/Reddit-Tweaks` — 404'd at time of audit. Tracked in earlier roadmap; will re-check.

### Upstream RES, open feature work cited

- Open issues / PRs cited inline above by `#NNNN`. Top-traffic open issues at audit time (2026-05-19):
  - [#5238](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5238) Safari support · [#5582](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5582) network-security block · [#5581](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5581) subscriber counts · [#5223](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5223) markdown code blocks · [#5573](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5573) bulk-import filters · [#5572](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5572) filter new comments by title · [#5569](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5569) follow-link new-tab visited · [#5568](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5568) soundcloud broken · [#5566](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/5566) copy-to-clipboard code blocks · [#5398](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5398) WebDAV backups · [#4642](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/4642) save comment when replying · [#4358](https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/4358) backup permissions persistence.
- Open PRs cited: [#5587](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5587) Safari, [#5583](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5583) Pastebin 404, [#5570](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5570) gallery expandos, [#5565](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5565) Firefox bug workaround, [#5563](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5563) esbuild 0.25 bump, [#5561](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5561) Bluesky chromium fix, [#5560](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5560) nitter expandos, [#5556](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5556) reddit poll fix, [#5481](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5481) redgifs fix, [#5478](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5478) emoji-title download, [#5465](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5465) submission shortcuts, [#5448](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5448) strawpoll fix, [#5441](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5441) backtick code blocks, [#5425](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pull/5425) neverEndingComments dedup.
- Last 20 merged PRs reviewed at [pulls?is%3Amerged](https://github.com/honestbleeps/Reddit-Enhancement-Suite/pulls?q=is%3Apr+is%3Aclosed+is%3Amerged+sort%3Aupdated-desc).

### Release history

- [v5.24.8 (2025-01-22)](https://redditenhancementsuite.com/releases/) — Bluesky expando, reddit poll fix, Google reverse image search fix.
- v5.24.7 (2024-09-21) — mute-keybind, imgur host update, permission popup fix.
- v5.24.6 (2024-05-04) — background audio fix.
- v5.24.5 (2024-04-29) — video player load fix.
- v5.24.4 (2024-03-28) — CSS toggle + X tweet detection.
- v5.24.3 (2024-03-24) — **MV3 + webpack→esbuild migration**, Firefox-for-Android initial support, Wikipedia expando improvements, gallery captions.

### Community signal

- [Greasyfork — Reddit scripts by install count](https://greasyfork.org/en/scripts/by-site/reddit.com) — Top 30 reviewed; signal aggregated as `[^greasyfork-*]` footnotes below.
- Reddit's r/RESissues — fetch blocked from this environment; ROADMAP open to community PRs to refresh.

### Standards / platform / browser

- [MDN: declarativeNetRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest) (updated Feb 2026) — static / dynamic / session rulesets, dynamic-rule patterns relevant if filter rulesets ever land.
- [Mozilla Add-ons Blog: Manifest V2 / V3 status](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/) — Firefox keeps MV2 indefinitely; renewed commitment 2025.
- [Chrome for Developers — declarativeNetRequest reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).
- [Reddit Help — Changelog February 4 2026](https://support.reddithelp.com/hc/en-us/articles/45959071783316-Changelog-February-4-2026) — Reddit's only formal deprecation in that window was old-modmail (2026-02-23), not old.reddit.

### Dependency / supply chain

- Upstream `package.json` snapshot — RES-Slim diverges from upstream by removing `dashjs` (kept for show-images), `fast-levenshtein`, `favico.js`, `snudown-js`, `sortablejs`, `suncalc`, `tinycolor2`. (Audit caught a stale assumption: `dashjs`, `dompurify`, `snudown-js`, `sortablejs`, `tinycolor2`, `fast-levenshtein` are all still in our `package.json` v0.4.0 — only `suncalc` and `favico.js` were actually removed. Treat the "removed 7 deps" line in earlier notes as wrong.)
- [TypeScript 7.0 / Corsa progress (Dec 2025)](https://devnewsletter.com/p/state-of-typescript-2026/) — Go-based compiler mid-2026; informs the Flow → TS migration plan.

### License posture

- GPL-3.0 only (inherited from upstream). AGPL incompatible. MIT/BSD/ISC permissive sources can be lifted with attribution. Self-owned (`SysAdminDoc/*`) lifted freely.

### Footnotes (URL anchors)

[^gfycat]: <https://en.wikipedia.org/wiki/Gfycat> — Shut down 2023-09-01.
[^redgifs-2022]: <https://redgifs.readthedocs.io/en/stable/changelogs.html> — `URL.file_url` deprecated, use `URL.embed_url`. 2022 API break + 403 fallout.
[^redgifs-geo]: <https://en.wikipedia.org/wiki/RedGIFs> — UK + 8 US states blocked 2025.
[^catbox]: <https://catbox.moe/> + <https://litterbox.catbox.moe/> + community userscript trail showing URL-regex updates 2024–2025.
[^greasyfork-top30]: <https://greasyfork.org/en/scripts/by-site/reddit.com> — sorted by install count, audited 2026-05-19.
[^greasyfork-promoted]: "Hide Reddit's promoted posts" — 1.9k installs, last updated 2025-08-04.
[^greasyfork-bypass]: "Reddit Bypass Enhancer" — 2.4k installs, last updated 2026-04-17; bypasses "open in app" and unblurs NSFW.
[^greasyfork-nsfw-unblur]: "Reddit NSFW Unblur" — 8.4k installs, last updated 2026-05-10.
[^botbuster]: <https://github.com/RootThePlanet/Reddit_AI_BotBuster> — MIT, em-dash density, burstiness, formal-phrasing heuristics, hover tooltips.
[^re-continued]: <https://github.com/SysAdminDoc/Reddit-Enhancement-Continued> — self-owned MIT, v2.7.5, 14 themes, full feature surface listed in body.
[^oldlander]: <https://github.com/OctoNezd/oldlander> — 178★, 1.1.0.521 (2026-01-13), TS.
[^flow-eol]: <https://devnewsletter.com/p/state-of-typescript-2026/> + Pinterest's 3.7M-line Flow→TS migration confirms industry consensus.
[^old-reddit-r-all]: <https://www.ghacks.net/2026/04/05/reddit-removes-r-all-from-app-and-desktop-but-old-reddit-still-shows-it/> — Reddit kept `/r/all` on old.reddit after dropping it from new Reddit in Feb 2026; reverse signal that old.reddit is not on a near-term sunset path.

---

*This roadmap is a working document. Promotions between tiers happen at version-bump time. When an item ships, strike it from its tier and add a one-line entry under "Completed since the last roadmap pass" at the top of the next pass.*
