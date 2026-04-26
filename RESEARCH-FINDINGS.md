# RES-Slim — Feature Gap Research

**Date**: 2026-04-10
**Baseline**: v0.3.2 (45 modules)
**Purpose**: Candidate features that could make RES-Slim genuinely unique vs. upstream RES and the 2026 old.reddit enhancer landscape.

## Methodology

- Filesystem audit of `lib/modules/` to confirm what's actually present (45 top-level modules + 87 host handlers matches `CLAUDE.md`).
- Sweep of Greasyfork (Apr 2026), GitHub repos updated in last 18 months, OpenUserJS.
- De-duped every candidate against the existing 45-module list.
- Rejected anything keyboard-shortcut-driven, mod-tool, new.reddit-only, or AGPL-licensed (RES is GPL-3 only).

## Landscape notes (2026)

- GitHub topic tags `reddit-enhancement-suite` and `reddit-userscript` are **empty** — the scene fragmented onto Greasyfork.
- Strongest precedents found: `RootThePlanet/Reddit_AI_BotBuster` (MIT), `SysAdminDoc/Reddit-Enhancement-Continued` (user's own prior work — free to lift), `Classic Reddit++`, `OctoNezd/oldlander`, `Farow/Reddit_comment_vote_history`, `logkirk/reddit-mark-read-userscript`.
- Four pillars where RES-Slim could legitimately become *the* old.reddit tool: **AI-content defense**, **multi-source archival diff**, **premium dark theme with accent extraction**, **local-LLM integration**.

## Reusable infrastructure already on disk

- [lib/modules/filteReddit/Case.js](lib/modules/filteReddit/Case.js) — filter kernel still resident; any filter-style feature below can reuse it instead of starting from scratch.
- [lib/modules/showImages/expando.js](lib/modules/showImages/expando.js) — extension point for media modules.
- [lib/modules/reddEye.js](lib/modules/reddEye.js) — extend in place for stylometry / karma-farm detection.
- [lib/modules/viewDeleted.js](lib/modules/viewDeleted.js) + [lib/modules/archiveLinks.js](lib/modules/archiveLinks.js) — foundations for threadTimeMachine.
- [lib/modules/nightMode.js](lib/modules/nightMode.js) — host for themePack / oledTrueBlack / brandedScrollbar.

---

## Top 10 highest-value picks

Ranked for bang-for-buck against the user's profile. None duplicate the existing 45 modules.

| # | Module | Why |
|---|---|---|
| 1 | **aiSlopOverlay** | AI-prose detector with 3-tier confidence outline + heuristic hovercard. Extends `reddEye` from accounts → comment text. MIT precedent: `RootThePlanet/Reddit_AI_BotBuster`. |
| 2 | **threadTimeMachine** | Diff thread against pullpush + Wayback + archive.ph snapshots; mark *edited / deleted by user / removed by mods / removed by admins / shadowban-invisible*. Novel — no live tool does the four-source diff. |
| 3 | **themePack** | Catppuccin Mocha / Tokyo Night / Rose Pine / Gruvbox dropped into `nightMode`. Lift verbatim from `SysAdminDoc/Reddit-Enhancement-Continued` (self-owned, no license risk). |
| 4 | **promotedNuke** | Hard-kill `.promoted` + the new 2026 `data-promoted="true"` rows Reddit sneaks past CSS filters. Counters in toolbar. |
| 5 | **vredditDashMerge** | Finishes the `downloadButtons` story: ffmpeg-wasm muxes the DASH audio track currently dropped. User already ships ffmpeg-wasm pipelines elsewhere. |
| 6 | **oledTrueBlack** | `#000000` variant of `nightMode` with per-subreddit accent extraction from sub icon (canvas dominant-hue quantize). Matches Android AMOLED standard. Novel. |
| 7 | **scrollStateSaver** | Restore scroll + expanded-comment state on browser Back. Closes the #1 `infiniteScroll` regression. Precedent: Greasyfork "Old Reddit state saver" (Feb 2026). |
| 8 | **authorContextBadge** | Inline badge on OP username: account age, karma ratio, % posts in current sub, first-time-poster flag. One cached API call. |
| 9 | **commentTreeExport** | Dump current thread to Markdown/JSON (title, OP, every comment w/ score, author, depth, timestamp). Power-user archival. |
| 10 | **llmSummarize** | Megathread → top-line summary via local Ollama (user already ships Ollama pipelines in FileOrganizer). Opt-in button on sort bar. Novel — no reddit tool does local-LLM summarization. |

---

## Full candidate list by category

### Bot / AI detection

- **aiSlopOverlay** *(M, MIT)* — Visual overlay flagging AI-generated comments with 3-tier confidence outline + hovercard (burstiness, contraction rate, em-dash density, bullet-list fetish, "it's not X, it's Y" construction). Source: `RootThePlanet/Reddit_AI_BotBuster`.
- **stylometryProfile** *(L, novel)* — Per-user rolling fingerprint (avg sentence length, vocabulary entropy, punctuation distribution) cached in IDB. Flag users whose last 20 comments cluster abnormally tight vs reddit baseline. Extends `reddEye` into trend territory no live tool covers.
- **karmaFarmDetector** *(M, novel)* — Flags accounts whose post history is >70% crosspost/repost of top-of-sub content, or whose comment history is >50% single-word/template replies. Uses `pullpush.io` (already wired by `viewDeleted`).
- **engagementBaitSniper** *(S, novel)* — Title-pattern classifier for ragebait/karma bait ("Am I wrong for...", "Update:...", "[Serious]", numbered listicles). Greys-out row with a tag.

### Media & downloads

- **vredditDashMerge** *(M, clean)* — Fetch DASH audio manifest + mux via `ffmpeg.wasm` or local helper. Finishes the v.redd.it story `downloadButtons` started.
- **galleryZip** *(S, novel)* — Download entire reddit gallery post as single zip (all images + captions.txt) via one button.
- **inlineRedgifsHd** *(S)* — Force redgifs to HD variant instead of whatever oEmbed returns.
- **imgurAlbumFlatten** *(S, novel)* — Imgur paywalled album embeds in 2026. Route album URLs through `rimgo` public instances and render all images inline.
- **gifToWebmTranscode** *(L)* — Intercept `.gif` expandos over N MB and swap to client-side webm conversion.

### Anti-tracking / anti-promo

- **promotedNuke** *(S)* — Hard-remove `.promoted` rows AND the `data-promoted="true"` entries Reddit sneaks into normal listings without the class. Counter badge in toolbar.
- **outboundLinkCleanser** *(S, novel-as-extension)* — Reddit rewrites outbound links through `out.reddit.com` / `alb.reddit.com` tracking shims in 2026. Strip at click-time AND on mouseover so Ctrl-C copies the clean URL. Current userscripts only handle click.
- **appPromptKiller** *(S)* — Kill the "open in app" interstitial, sticky install banner, and the new 2026 `.reddit-download-bar` variant.
- **nsfwQuarantineSkip** *(S)* — Auto-dismiss quarantine/NSFW/over-18 gate, no-cookie path.
- **ccpPrivacyToggle** *(M, novel)* — One-click toggle for reddit's opt-out endpoints (personalization, ad partners, sensitive ads) via preferences API, without navigating settings.

### Archival & deleted content

- **threadTimeMachine** *(L, novel)* — See top 10. Four-source diff: pullpush + Wayback + archive.ph + live DOM.
- **modlogSniff** *(M)* — For subs exposing public mod logs (Toolbox JSON), annotate removed posts/comments inline with removal reason + mod name. **Read-only**, not a mod tool, stays within scope.
- **shadowbanIndicator** *(S, novel)* — Check OPs via `reddit.com/user/<x>/about.json` vs `/comments.json` delta to infer shadowban. Badge.

### Discovery & search

- **kagiRedditLens** *(S)* — Right-click selection → search across reddit via Kagi's reddit lens (or Marginalia, or `redditfinder`). User profile already references Kagi.
- **subredditSimilarity** *(M, novel)* — On each subreddit banner, inject "related subs" chip list from `/api/subreddits/related` + `subredditstats.com` JSON.
- **redditSearchUnbroken** *(M, novel)* — Replace old.reddit's broken built-in search box with a dispatcher targeting: reddit native, redditsearch.io, pullpush, Kagi, Marginalia. Dropdown picker.

### Visual / UX polish

- **oledTrueBlack** *(M, novel)* — See top 10.
- **themePack** *(S, self-owned)* — See top 10.
- **staggeredEntrance** *(S, novel)* — Thread rows fade+slide in with 20ms stagger; comment children spring-in on expand. Matches "premium software" aesthetic mandate.
- **glassSidebar** *(S)* — Sticky subreddit sidebar with subtle top-layer gradient + hairline border. **No backdrop-filter blur** per CLAUDE.md Chrome extension rule.
- **sidebarCollapse** *(S)* — Toggle sidebar to vertical rail, persisted per-sub. Precedent: `Zhiro90/old-reddit-collapsible-sidebar` (check MIT).
- **brandedScrollbar** *(S)* — Reddit-orange accent scrollbar with shimmer on active drag.

### Quality of life

- **scrollStateSaver** *(S)* — See top 10.
- **commentTreeExport** *(S)* — See top 10. Precedent: Greasyfork 524797 (license check needed).
- **subRulesInline** *(S, novel)* — Hovercard on subreddit links showing rules + post requirements from `/about/rules.json`. No click-through.
- **voteHistoryLog** *(M)* — Local-only log of every up/downvote cast (comment + post, with snippet) into IDB, browsable from settings. Reddit's official history hides this. Precedent: `Farow/Reddit_comment_vote_history`.
- **crosspostMap** *(S, novel-as-inline)* — Compact list of every other sub the same content was posted to via `/duplicates.json`. Currently buried behind a click — make it always-on inline widget.
- **subredditBlacklistRegex** *(S)* — Current `subredditBlacklist` is literal-match. Extend to regex + weight (hide vs dim vs collapse) reusing the resident `filteReddit/Case.js` kernel.

### Wildcards

- **karmaDecayInline** *(M)* — Reverse-image-search image posts against karmadecay.com inline; badge with repost count + first-seen date.
- **commentHeatmap** *(M, novel)* — Thread minimap in right gutter showing comment density + controversial hotspots (gold dots where score hidden + high reply count). Click to jump.
- **authorContextBadge** *(S)* — See top 10.
- **llmSummarize** *(M, novel)* — See top 10.

---

## Explicitly rejected (don't revisit)

- Keyboard-driven navigation — banned across all user projects.
- Toolbox-style mod features — out of scope.
- User tagging with cloud sync — OAuth entirely stripped in v0.1.0.
- `emojis-for-old-reddit` / `new-reddit-profile-pics-on-old` — cosmetic noise, not the user's aesthetic.
- Anything from AGPL sources (`ludios/expand-everything`, `Trinovantes/old-reddit-emotes`, `jcunews` filter) — license incompat with GPL-3-only.
- Upstream RES `betteReddit` / `wheelBrowse` / `commandLine` — already rejected in v0.1.0 strip.
- `RobSis/reddit-inline-image-view` — overlaps with kept `showImages`.
- `radialmonster/reddit-user-tagger` — no LICENSE file, legal risk.
- Redirect scripts (`tom-james-watson/old-reddit-redirect` etc.) — users install their own.

## License quick reference

| Source | License | Usable? |
|---|---|---|
| Upstream RES | GPL-3.0 | Yes (baseline) |
| MIT / BSD / ISC userscripts | Permissive | Yes — include attribution in module header |
| AGPL-3.0 sources | AGPL | **No** — incompatible with GPL-3-only host |
| Unlicensed userscripts | None | **Reimplement from spec**, do not copy code |
| `SysAdminDoc/Reddit-Enhancement-Continued` | Self-owned | Yes — lift verbatim |

## Effort scale

- **S** — single module file, <200 LOC, reuses existing infra
- **M** — new module + some new utility, 200-600 LOC, possibly one new dep
- **L** — crosses multiple modules or needs significant new infra (ffmpeg-wasm, IDB schema, multi-source fetch orchestration)
