# RES-Slim Max Roadmap

**Artifact:** research and planning only — no feature code in this run.
**Updated:** 2026-05-22
**Project name / version convention:** `RES-Slim` repository identity, internal product name `RES-Slim Max`. Semantic versions `vX.Y.Z`. Phase number maps to minor version when a phase ships (`v0.5.0 = Phase 5`, `v0.6.0 = Phase 6`, etc.).
**Baseline repo:** RES-Slim v0.10.0 — private stripped fork of Reddit Enhancement Suite v5.24.8 with eight additional phases of net-new modules layered on top.
**Target site:** `old.reddit.com` first; `www.reddit.com`, `np.reddit.com`, `sh.reddit.com` as redirect handoffs and compatibility surfaces only.
**Chosen vehicle:** Chrome MV3 extension + Firefox MV2 extension as the primary products, single-file userscript as a portable companion. Justification under [Userscript vs Extension](#userscript-vs-extension-split).
**License:** GPL-3.0 (inherited from upstream RES). All vendored code must be GPL-3.0-compatible; AGPL sources are strictly excluded.

This roadmap supersedes every prior planning document in the repo. It is the union of:

- Every shipped RES-Slim module (60 modules + 87 media host handlers as of v0.10.0).
- Every feature observed across 156 competing tools (RES, Reddit Enhancer, Reddit Enhancement Continued, Sink It, Moderator Toolbox, Reveddit Real-Time, Reddit Uncensored, Power Delete Suite, Redd-Eye/AI BotBuster, Old Reddit Redirect, Reddit Comment Collapser, Photon Reddit, Hover Zoom+, Custom Top Sort, plus ~140 Greasy Fork / OpenUserJS / Stylus / smaller extensions — full table below).
- Every unmet feature request mined from RES GitHub issues, r/Enhancement threads, and store reviews.
- The decoded DOM ground truth from the two captured `.mhtml` files in this repo.

The goal is the most complex, versatile, feature-dense old-Reddit power suite in existence. v1.0.0 ships when this roadmap is fully implemented or every remaining item has a documented hard blocker.

---

## Table of Contents

- [Project Overview](#project-overview)
- [House Style — bake into every phase](#house-style)
- [Phase 0 — Local Repo State](#phase-0--local-repo-state)
- [Phase 1 — Competitive Landscape](#phase-1--competitive-landscape)
- [Phase 2 — Feature Catalog and Gap Analysis](#phase-2--feature-catalog-and-gap-analysis)
- [Phase 3 — Technical Reconnaissance](#phase-3--technical-reconnaissance)
- [Selector & API Reference](#selector--api-reference)
- [Settings Schema](#settings-schema)
- [Phased Build Plan](#phased-build-plan)
- [Settings Panel Spec](#settings-panel-spec)
- [Risks and Open Questions](#risks-and-open-questions)
- [Definition of Done](#definition-of-done)
- [Source Index](#source-index)

---

## Project Overview

**One-line pitch:** a premium dark-only power suite for old Reddit that combines RES-style browsing, modern UI controls, the archived Moderator Toolbox workflow, every notable Greasy Fork utility, Reveddit-style mod-action awareness, Arctic-Shift comment restoration, downloader pipelines, archival/export tooling, local-first author intelligence, and AI/bot detection — behind one reversible feature registry, one settings schema, one selector map, and one design system.

**Why this exists.**

- Upstream **RES** is maintenance-only since 2023. Its architecture is jQuery-era and its filter / tagger / dashboard modules were stripped from this fork to keep the surface clean.
- **Moderator Toolbox** was archived 2026-03-04 (last release v6.1.25). There is no successor. Subreddits with usernotes / removal reasons / queue tools wired through Toolbox are running on read-only software.
- **Pushshift** was locked to moderators in 2023. Every "view deleted" tool that depended on it (Unedit-and-Undelete and friends) is broken for non-mods. **Arctic Shift** is the durable replacement.
- **Reddit Enhancer** (joelacus, v3.1.2 May 2026) is currently the most-polished modern alternative, but old-Reddit depth is thinner than RES. It is the modern UI bar to clear.
- **Reddit Enhancement Continued / REL** (SysAdminDoc, MIT) is this user's own prior userscript — every feature is free to lift verbatim into this repo.

**The user we are building for.** A senior systems administrator who lives on old.reddit, runs a private fork already, expects premium dark visuals, will never accept light themes, light backgrounds, pill backdrops, confirmation dialogs, or keyboard shortcuts, and will never enable any feature that talks to a server they have not personally approved.

---

## House Style

Bake into every phase. Every module. Every test. Non-negotiable across the project.

- **Visual:** deep dark and OLED palettes only. No light theme ever. Glass surfaces, subtle shimmer, hover lift, spring easing, staggered entrances, branded accent (Reddit orangered `#ff4500`), branded scrollbar, dense mode opt-in.
- **No pill / oval / fully-rounded backdrops.** Allowed control radius set: `{0, 2, 3, 4, 6, 8, 10, 12}`px. True circles (`50%`/`100%`) only for avatars, status dots ≤14 px, and spinner rings.
- **No keyboard shortcuts.** Normal browser focus order, Tab nav, Enter/Space activation for a11y — that is all. Every competitor (RES, REL, Reddit Enhancer, Toolbox) ships shortcut systems. We deliberately don't.
- **No confirmation dialogs.** Immediate action, toast feedback, reversible undo where the endpoint allows it.
- **Every feature has a clean `destroy()`** path that removes DOM nodes, listeners, observers, timers, injected styles, body classes, and storage subscriptions. Disabling a feature in settings must visibly reverse it before the next paint.
- **Settings overlays use `pointer-events: none` when inactive.** Inert pane behind scrim.
- **Injected CSS is scoped to body classes** under `body.rsm-root` and `body.rsm-feature-<id>`. Theme tokens are CSS custom properties `--rsm-*`. Never raw hex values inside module CSS.
- **TrustedTypes policy `res-slim-html`** centralises every `innerHTML` / `insertAdjacentHTML` write. Required on old.reddit (no enforcement today) and pre-required on any future new/sh.reddit support (where enforcement is live).
- **Stable selectors first.** `data-*` attributes, ARIA roles, IDs, structural paths. Hashed/obfuscated classes only as fragile fallbacks. Selector contract tests pin both layers against captured MHTML fixtures.
- **MutationObserver processes added nodes only.** Never full-document rescans. Per-feature WeakSet of processed nodes. `IntersectionObserver` for expensive media/API work. `requestIdleCallback` with timeout fallback for non-critical adornments.
- **No telemetry.** No network call to anywhere outside `*.reddit.com` and `*.redditstatic.com` unless the user explicitly enabled an external integration. Privacy URL snapshot test enforces this.
- **No co-authored-by or AI attribution** in commits or docs.

---

## Phase 0 — Local Repo State

### 0.1 Repository

- **Path:** `~/repos/RES-Slim/`
- **GitHub:** `SysAdminDoc/RES-Slim` (public)
- **License:** GPL-3.0
- **Current version:** v0.10.0
- **Test count:** 151 unit assertions across 32 contract suites
- **Build:** esbuild + sass + Flow-strip via `build.js`; Chrome MV3 + Firefox MV2 targets only (edge/opera/chromebeta removed in v0.4.0).
- **CRX self-host:** `build/pack-crx.py` reads version from `package.json` and signs with `build/res-slim.pem`. CRX is shipped only as a secondary asset; primary install path is ZIP + "Load unpacked" because Chromium 75+ rejects self-signed CRX with `CRX_REQUIRED_PROOF_MISSING`.

### 0.2 Modules registered (`lib/modules/index.js`)

60 modules grouped by category:

**Comment workflow (18)** — `absoluteTimestamps`, `autoExpand`, `commentDepth`, `commentDepthColors`, `commentHidePersistor`, `commentHighlights`, `commentNavigator`, `commentPreview`, `commentQuickCollapse`, `commentSortBy`, `commentStyle`, `commentTools`, `context`, `continueThreadInline`, `hideChildComments`, `hideGifComments`, `newCommentCount`, `nextTopComment`, `noParticipation`, `readComments`, `saveComments`, `showParent`, `sourceSnudown`, `spoilerTags`, `viewDeleted`.

**Media (1 + 87 host handlers)** — `showImages` master + the host roster under `lib/modules/hosts/*.js`. Plus `downloadButtons`, `fixImageLinks`, `fixProcessingImg`. Hosts include `imgur`, `youtube`, `vimeo`, `twitch`, `dailymotion`, `streamable`, `gfycat`, `redgifs`, `bluesky`, `redditgallery`, `redditbooru`, `clyp`, `soundcloud`, `spotify`, `hastebin`, `pastebin`, `codepen`, `jsfiddle`, `github`, `xkcd`, `wikipedia`, plus the `default{Image,Video,Audio}` fallbacks.

**Appearance & layout (5)** — `nightMode`, `layoutTweaks`, `classicFavicon`, `disableSubredditStyles`, `commentDepthColors`.

**Privacy & redirect (6)** — `removePromoted`, `outboundCleanser`, `eventTrackingSabotage`, `frictionRemovers`, `oldRedditRedirect`, `hideUsername`.

**Navigation & search (5)** — `search` (hidden but functional), `searchDispatcher`, `searchFilterPersist`, `continueThreadInline`, `scrollRestore`.

**Reading & interaction (5)** — `markAllRead`, `topCommentsPreview`, `autoRefreshComments`, `threadMinimap`, `selectedEntry`.

**Utility & feedback (4)** — `menu`, `notifications`, `settingsNavigation`, `version`, `requestPermissions`, `hover`.

**Reliability fixers (5)** — `archiveLinks`, `infiniteScroll`, `restoreSubCounts`, `userProfileSearch`, `reddEye`, `subredditBlacklist`.

**Filters (1)** — `filterRules` foundation (JSON-backed builder shipped v0.10.0; consumers scheduled).

### 0.3 Core infrastructure

- **Feature registry** — `lib/core/registry/featureRegistry.js`. `register(feature)`, `initFeature(id)`, `initEnabled()`, `isRunning()`. Lifecycle: `running` map, idempotent re-init, isolated init failures (toast + local error log, no cascade).
- **Page phases** — `lib/utils/pagePhases.js`. Stages `loadI18n → onInit → loadOptions → addModuleBodyClasses → always → beforeLoad → contentStart → go → afterLoad`.
- **Watcher** — `lib/utils/watchers.js`. `watchForThings(types[], cb)` with per-type WeakSet dedup. `Thing.tasks = { immediate, visible, byId }` callbacks are `once()`-wrapped.
- **Settings stack** — `lib/core/settings/schema.js` + `defaults.js` + `migrations.js`. Stage / commit / discard via `lib/core/options/stage.js`. Import/export via `lib/core/options/snapshot.js` with unknown-future-key preservation.
- **Theme** — `lib/core/theme/settingsThemePresets.js` (OLED default + dark + three others), `lib/core/theme/antiFouc.js` (document-start OLED + body classes), `--rsm-*` token system planned for module CSS.
- **Selectors** — `lib/core/dom/selectors.js`. Frozen object keyed by surface name; each surface exposes `stable[]` + `fallback[]` arrays. Selector contract test runs against the MHTML fixtures.
- **TrustedTypes** — `lib/core/dom/trustedHtml.js`. `getTrustedHtmlPolicy()` → `createTrustedHTML(html)` → `setTrustedHTML(el, html)`.
- **Rate limiter** — `lib/utils/rateLimiter.js`. Token bucket with `tokens / refillMs / maxConcurrent`. Shared by `autoRefreshComments` and `topCommentsPreview`.
- **Filter rules** — `lib/utils/filterRules.js` (pure: `ruleMatches`, `evaluateRules`, `parseRulesFromJson`). Regex fail-closed. Schema: `field ∈ {user, subreddit, domain, keyword, flair, score, commentCount}` × `op ∈ {equals, contains, regex, lt, gt}` × `action ∈ {hide, dim, collapse, badge}`, optional `target ∈ {post, comment, both}`.
- **Outbound cleanser** — `lib/utils/outboundCleanser.js` (pure helpers; `OUTBOUND_HOST`, `TRACKING_PARAMS`, `cleanseUrl`).

### 0.4 Manifests

- **Chrome MV3** (`chrome/manifest.json`) — Permissions: `tabs`, `history`, `storage`, `unlimitedStorage`, `scripting`. Optional: `downloads`, `geolocation`. Host: `https://*.reddit.com/*`. Optional hosts: Twitter oEmbed, DeviantArt, Gyazo, Tumblr, xkcd, Steam, redd.it, Flickr, Bluesky. CSP: `default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src https:; font-src 'self' data:; frame-ancestors https://*.reddit.com`. Service worker: `background.entry.js`. Content script at `document_start`, matches `https://*.reddit.com/*`, excludes mod/ads/i/m/static/thumbs/blog/code/about/sh/talk/chat/compact/mobile/json variants.
- **Firefox MV2** (`firefox/manifest.json`) — same permission shape, `background.scripts` array, flat `web_accessible_resources`, `gecko.id` for auto-update.

### 0.5 Test contracts (`tests/unit/*.test.mjs`)

Each suite locks a contract. Existing 32 (151 assertions): selector map, TrustedTypes, feature registry, settings save/snapshot/contrast/theme, anti-FOUC, toast, build release, MV3 background permissions, service worker safety, premium polish, hide-child-comments, comment-navigator, download, show-images-hosts, privacy-outbound-urls, remove-promoted, outbound-cleanser, event-tracking-sabotage, friction-removers, old-reddit-redirect, hide-username, continue-thread-inline, scroll-restore, thread-minimap, search-filter-persist, search-dispatcher, top-comments-preview, auto-refresh-comments, layout-and-depth, filter-rules.

### 0.6 MHTML capture findings (live DOM ground truth)

Decoded files in `./.research/parts/{home,comments}/`. Full selector map: `./.research/mhtml-selector-map.md`.

**Body state machine** — stable. Page-kind token is the right hook:

| Token | Meaning |
| --- | --- |
| `body.listing-page` + `best-page` / `hot-page` / `new-page` | feed |
| `body.comments-page` | thread |
| `body.profile-page` | user page |
| `body.search-page` | search |
| `body.wiki-page` | wiki / rules |
| `body.loggedin` | signed in |
| `body.with-listing-chooser` + `listing-chooser-collapsed/shown` | multireddit drawer state |

**Post rows expose a rich `data-*` API.** Prefer the data attributes — they are stable across Reddit redesign cycles. Class strings carry RES/Darkreader pollution in real DOMs and are unreliable.

```
<div class="thing id-t3_<id> link [self|controversial]"
     data-fullname="t3_<id>"
     data-type="link"
     data-author="<u>" data-author-fullname="t2_<id>"
     data-subreddit="..." data-subreddit-prefixed="r/..." data-subreddit-fullname="t5_..."
     data-subreddit-type="public"
     data-timestamp="<ms>"
     data-url="..." data-permalink="..." data-domain="..."
     data-comments-count data-score data-rank data-num-crossposts
     data-promoted="false" data-nsfw="false" data-spoiler="false" data-oc="false"
     data-stickied data-whitelist-status data-gildings
     data-kind="video|image|..." data-is-gallery
     data-recommendation-source     // pre-empt the 2026 ad-sneak surface
     data-context="listing">
```

**Comment nodes** carry the same convention (`data-fullname^="t1_"`, `data-author`, `data-permalink`, `data-replies`, `data-subreddit-fullname`).

**`data-event-action`** on action buttons is the most stable behavioural hook: `upvote, downvote, thumbnail, title, comments, submit, hide, report, permalink, embed, comment`.

**Body inline scripts:** old.reddit does *not* expose `r.config` / `modhash` in the static HTML. They're injected at runtime by `reddit-init.en.*.js` (loaded from `redditstatic.com`). Bind defensively: `if (window.r && window.r.config) { … }`. The only static tracker is `#hsts_pixel` → `https://reddit.com/static/pixel.png`. Outbound URL wrapping (`out.reddit.com`, `alb.reddit.com`) is applied at click-time by JS, not server-rendered.

**No CSP / Trusted-Types meta** is set on the captured pages. Verify the HTTP header via `curl -I https://old.reddit.com/` on the live site. Even though enforcement is off today, the TrustedTypes helper stays mandatory because (a) Chrome 121+ is hardening MV3 against `unsafe-eval` and (b) any future `new.reddit.com` / `sh.reddit.com` support runs into TT enforcement on those origins.

**Design tokens:** old.reddit's main bundle ships zero CSS custom properties. Every color and size is hard-coded. Recovered palette (top of 358 unique colors):

```
#808080 neutral-gray   #ffffff white          #000000 black
#336699 legacy-blue    #ff4500 ORANGERED      #0079d3 redesign-blue
#9a7d2e reddit-gold    #ff0000 error          #ff6600 warning
```

Brand pair `#ff4500` + `#0079d3` plus the neutral gray ramp covers ~80% of weight. Vote-state colours: upvote → orangered family, downvote → `#7193ff` (historic), unvoted → `#888`.

External CSS bundles referenced from `<head>` (load order matters when extending in CSS):

```
reddit.ETA_etA2z5U.css                (353 KB — main bundle)
expando.gMzRK16vwrQ.css
crosspost-preview.De3P20Yb4PY.css
author-tooltip.1VKQhhDIRMI.css
listing-comments.AZZO7Kj_O88.css
popup-notification.6-JvPBpHWMo.css
about-this-ad-modal.zVecmeeCuWY.css
crossposting-modal.Jve5ccTgZ4o.css
desktoponboarding.k2RNrAG42v4.css
videoplayer.ANmi3DZjWG4.css
videoplayercontrols.a_TwaTy76-k.css
```

### 0.7 Strengths & gaps as of v0.10.0

**Strengths**

- Reversible feature registry shipped, contract-tested.
- Selector map with stable+fallback layers shipped, contract-tested against captured MHTML.
- TrustedTypes helper centralised.
- Settings snapshot import/export with unknown-key preservation shipped.
- OLED default + WCAG AA contrast contract across 5 themes.
- Privacy URL snapshot test pins outbound origins.
- Rate limiter shared by every polling consumer.
- 60 modules / 87 hosts / 151 assertions / 32 contract suites all green.

**Gaps to close in v0.10.x → v1.0.0**

- `filterRules` consumers (user tagger, bot collapse, duplicate map, author context, AI prose signal, OP/admin/mod/friend highlight refresh, per-sub custom-style override) — scheduled to land as the v0.10.x patch series.
- Media downloads stop at "fetch existing source" — v.redd.it DASH audio merge, gallery zip, RedGifs v3, search-gallery carousel all unbuilt.
- No moderator workbench — and the Toolbox archive (March 2026) makes this a strategic gap not just a feature gap.
- No comment-tree export, saved-content backup, vote/read history log, or media archive manifest.
- No deleted-content restoration that survived the Pushshift lockdown (Arctic Shift integration not yet built).
- No userscript single-file build target.
- No CI workflow.
- No author intelligence (age + karma badge, shadowban detector, AI/bot prose signal, per-user vote weight).
- No visual power-suite extras (hover zoom, drag-resize, cake-day animation, font replacement, background image).
- No on-page AI summarisation or external-article TLDR (every other tool punts to off-page services or doesn't ship it).

---

## Phase 1 — Competitive Landscape

156 tools surveyed across CWS, AMO, Edge Add-ons, Greasy Fork, OpenUserJS, GitHub, userstyles, and notable standalone web frontends. Ranked by install count, then recency, then breadth.

### 1.1 Ranked tool table (top 50, descending by user reach)

| # | Tool | Vehicle | Reach | Last updated | License | What it does best |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Reddit Enhancement Suite (RES)** | Chrome/FF/Edge ext + userscript | ~1M Chrome + 305k FF + 4.4k GH ⭐ | v5.24.8 Jan 2025 (maintenance) | GPL-3.0 | The platform. Deep old-Reddit browsing, expandos, filteReddit, user tagger, dashboard, settings |
| 2 | **Sink It for Reddit** | Chrome/FF/Safari ext | CWS Featured | v7.110.0 Feb 2026 | proprietary | Mute subs/sites/words/users, banner+ad scrub, adaptive dark, focus mode |
| 3 | **Reddit Enhancer (joelacus)** | Chrome/FF ext | 10k CWS + 2.6k FF + 213 ⭐ | v3.1.2 May 17 2026 | public source | 100+ toggles on **both** old + new, bionic reading, background image/blur, browser sync |
| 4 | **Old Reddit Redirect (tom-james-watson)** | Chrome/FF/Edge ext | 90k CWS + 65k AMO | Mar 2026 | MIT | Force old + EU cookie-banner kill + gallery URL rewrite |
| 5 | **Moderator Toolbox** | Chrome/FF ext | 10k CWS + 2.4k AMO | v6.1.25 Feb 2026 — **archived 2026-03-04** | Apache-2.0 | Usernotes, ModMail Pro, queue tools, removal reasons, macros. **Successor opportunity** |
| 6 | **Reveddit Real-Time** | Chrome/FF ext | active | 2026 | open source | Real-time mod-removal / lock / reapprove notifications; works on both layouts |
| 7 | **Reddit Uncensored (Fubs)** | Chrome/FF ext | active | 2026 | open source | **Arctic-Shift restoration** of deleted posts and comments — the spiritual successor to Unedit-and-Undelete |
| 8 | **Power Delete Suite (j0be)** | Bookmarklet | longstanding | active | open source | API-driven multi-sort multi-timeframe sweep of own comments with overwrite-then-delete |
| 9 | **Reddit AI BotBuster / Redd-Eye (RootThePlanet)** | Chrome ext + userscript | active | 2025–2026 | open source | Local-only AI/bot detection with confidence outlines + sliders |
| 10 | **Reddit Enhancement Continued / REL (SysAdminDoc)** | Userscript | own work | v2.7.5 | MIT (self-owned) | 14 themes, inline expandos, drag-resize, cake-day, bot-collapse, scroll memory, vote weight |
| 11 | **Reddit Comment Collapser (tom-james-watson)** | Chrome/FF/FF-Android ext | 5k CWS + 1k AMO | v6.0.1 | MIT | Click-column-to-collapse chain on old.reddit; RES-compatible |
| 12 | **Reddit Insights** | Chrome ext | CWS Featured 3.5★ | active | open source | Top 5 subs visited + Perspective API toxicity score (privacy tradeoff) |
| 13 | **rAger (rDevCoder)** | Chrome ext | CWS 3.7★ Featured | v0.0.1.3 May 2023 | open source | Inline age + karma badge next to every username, both layouts, NER-compatible |
| 14 | **Reddit User Detective** | Chrome ext | CWS | active | unknown | Karma breakdown, top subs, peak posting hours, recent history, controversial tracking |
| 15 | **Redbar (Sidebar for Reddit)** | Chrome ext | ~142 users 4.2★ | v0.2.0 | unknown | Sidebar with OP karma/cake-day + OP's recent/top + sub recent/top/hot |
| 16 | **Reddit Redux** | Chrome ext | ~ | active | unknown | new-Reddit only — user tags, themes, account switcher, keyword filter, mute users |
| 17 | **Reddit Promoted Ad Blocker** | Chrome ext | CWS | MV3 Feb 2024 | unknown | Hide promoted on both layouts |
| 18 | **Reddit Comment Exporter** | Chrome ext | CWS | active | unknown | Save thread comments to JSON/CSV in-browser |
| 19 | **Custom Top Sort (arvidsandin)** | Chrome/FF/Edge ext | CWS 3.2★ | active | GPL-3.0 | Arbitrary "top of last N hours" sort — filters Reddit's API response |
| 20 | **Reddit Auto Dark Mode (Nathaniel-Wu)** | Userscript | 924 | May 2025 | unknown | Toggle built-in dark mode |
| 21 | **Hover Zoom+ (extesy)** | Chrome (GH)/FF ext | AMO listed; CWS delisted | 2025–2026 | MIT | Hover preview for images+video across the web incl. Reddit |
| 22 | **Photon Reddit (Arthur Heitmann)** | Standalone web client | open source | active | open source | Web frontend replacement, drop-in URL swap |
| 23 | **Reddit++ (lnm95)** | Userscript | 6,669 | Apr 2026 | unknown | Current active userscript — UI cleanup, keyword filter, themes, expansion |
| 24 | **redditmod2 (Derv 82)** | Userscript | 2,965 | Sep 2023 | unknown | Legacy all-in-one — dark, endless scroll, filters, comments, inline post view |
| 25 | **Reddit Mark Read (logkirk)** | Userscript | longstanding | active | open source | Persistent read-link memory |
| 26 | **Reddit Fix** | Userscript | 14,012 | Feb 2025 | unknown | UI repair signal |
| 27 | **Remove Reddit Login Requirement (SoCuul)** | Userscript | 10,821 | Jul 2025 | unknown | Bypass forced login |
| 28 | **Reddit NSFW Unblur (hdyzen)** | Userscript | 8,456 | May 2026 | unknown | Unblur NSFW/spoiler |
| 29 | **Privacy Redirector (dybdeskarphet)** | Userscript | 8,407 | Feb 2025 | unknown | Reddit→privacy-frontend |
| 30 | **iarp — Fuck Reddit's Tracking** | Userscript | 7,937 | Apr 2018 | unknown | Strip Reddit link-tracking redirect |
| 31 | **iarp — Remove Reddit URL Click Tracking** | Userscript | 7,967 | Apr 2018 | unknown | Strip Reddit click-tracking redirect |
| 32 | **Reddit Video Downloader (Lawrence Sim)** | Userscript | 7,769 | Dec 2022 | unknown | Simple media download affordance |
| 33 | **delete all reddit comments (avrpunk)** | Userscript | 7,542 | May 2014 | unknown | Bulk history cleanup |
| 34 | **The Internet Gets Better: No Cookies** | Userscript | 7,279 | Dec 2022 | unknown | Cookie banner kill |
| 35 | **Remove Reddit Over-18 Login Popup (jeyami)** | Userscript | 6,301 | Jun 2023 | unknown | Age-gate popup removal |
| 36 | **Reddit Old Redirect (Agreasyforkuser)** | Userscript | 4,783 | May 2026 | unknown | Script-level old-reddit force |
| 37 | **Reddit expand media and comments (woxxom)** | Userscript | 4,640 | Nov 2024 | unknown | Auto-expand media + comment tree |
| 38 | **Reddit Age Bypass (bertigert)** | Userscript | 4,303 | Sep 2024 | unknown | Age-gate bypass |
| 39 | **Reddit spoiler blur remover (violhain)** | Userscript | 4,091 | Nov 2020 | unknown | Spoiler unblur |
| 40 | **Reddit – Load 'Continue this thread' inline (spiralx)** | Userscript | 4,075 | Oct 2022 | unknown | Inline continuation |
| 41 | **Reddit Highlight Newest (JonnyRobbie)** | Userscript | 2,979 | Jan 2016 | unknown | Gradient-by-age new-comment highlight |
| 42 | **Cobalt Tools Video Downloader (yodaluca23)** | Userscript | 3,374 | Jan 2025 | unknown | Routes video URLs to cobalt.tools |
| 43 | **Better Reddit Delete (Tim Linden)** | Userscript | 2,930 | Jul 2018 | unknown | Safer own-content deletion |
| 44 | **Reddit Bypass Enhancer (UniverseDev)** | Userscript | 2,487 | Apr 2026 | unknown | Login/app/NSFW friction removal |
| 45 | **Reddit Multi Column (c6p)** | Userscript | 2,043 | Apr 2025 | unknown | Multi-column on new reddit |
| 46 | **Reddit Promotion Blocker (Aidenster)** | Userscript | 1,081 | Mar 2026 | unknown | Promoted-post hide |
| 47 | **PlumFont (Fibert Loyee)** | Userscript | 1,683 | Jan 2024 | unknown | Font replacement (Roboto/Segoe/Arial override) |
| 48 | **Reddit Toggle Custom CSS (chocolateboy)** | Userscript | 708 | Nov 2020 | unknown | Per-sub CSS persistent toggle |
| 49 | **Reddit Inline Gallery (Jakob Kruse)** | Userscript | 1,193 | Sep 2014 | unknown | Inline gallery on submission listing |
| 50 | **Catppuccin for Reddit** | Stylus userstyle | active | active 2025–2026 | CC0-1.0 | Theme reference (both layouts) |

Long tail of 106 additional tools captured in the source-index footer covers: every promoted-hider, every sidebar-toggle, every redirect, every dark-mode userstyle, every Cobalt/yt-dlp bridge, every mass-delete, every age-bypass. They reinforce the commodity-feature list and add no new moats.

### 1.2 Community request signal — unbuilt by every tool

Mined from RES GitHub issues + r/Enhancement threads + Sink It reviews + Reveddit issues:

- Time-of-day automatic dark mode toggle for old.reddit
- Nitter / BlueSky / Mastodon / Threads expandos (RES PR #5560 open since Jan 2025)
- Move comment actions to top of comment header (RES PR #5515 open since Apr 2024)
- Mute expando video (RES PR #5500 open)
- NSFW-style filter with custom subs (RES Issue #548 open since 2013)
- Disable night mode in specific subs (RES Issue #1029 open since 2014)
- Subreddit-sidebar search sort + time-range dropdowns (RES #460)
- Reddit logo links to /r/all instead of frontpage (RES #1028)
- Color picker for theme tokens (RES #925)
- CSS3 disable toggle (RES #1058)
- Cross-browser settings sync (only Reddit Enhancer ships it)
- Multi-window / split-pane Reddit
- Volume buttons / scroll-wheel auto-scroll (Infinity mobile pattern)
- Adaptive AMOLED true-black mode that respects sub-CSS overrides
- AutoModerator sticky comment auto-collapse (only REL + a single medium-post script)
- Per-sub default sort memory (e.g. "always sort r/AskReddit by new")
- Comment-page thread minimap (we built it v0.8.0 — competitors have none)
- Inline cross-post indicator + original-post jump
- "Already saw this in another sub" detector
- Smart vote-weight visualisation (only REL, only on user's own users)
- In-thread mod-action log feed (Reveddit covers monitoring, no in-thread badge)
- Local-first archival of own saved posts
- Account-history shadowban detector inline (web-only today)
- CSP-safe inline OAuth-less media for v.redd.it
- Sub topic auto-tagging from rules + flairs
- AI summarisation of long threads on-page
- TLDR for linked articles browser-side
- Anti-rage-bait / anti-engagement heuristics
- Per-user "rate this comment quality" with local-only persistence
- Subreddit-specific muting (mute X *in sub Y only*)
- AutoModerator authorship attribution display

These are the gap-fill targets that turn a parity build into a category-killer.

### 1.3 Abandoned-tool successor opportunities

| Tool | License | Status | What we resurrect |
| --- | --- | --- | --- |
| Moderator Toolbox | Apache-2.0 | Archived 2026-03-04 | Usernotes wiki protocol, queue tools, ModMail Pro patterns, removal reasons |
| Unedit-and-Undelete | MIT | Broken since Pushshift lockdown | "View deleted" surface — replace plumbing with Arctic Shift |
| Reddit Reveal (creesch) | unknown | Dormant 2015 | Hidden-info reveal logic |
| Reddit-Plus (noplanman) | unknown | Repo moved | Inline-comment-loader innovation |
| Hover Zoom+ | MIT | CWS-delisted | Mouseover image preview (first-class replacement opportunity) |
| Power Delete Suite | open | Maintained but bookmarklet | Re-house in MV3 with proper undo toasting |
| RES Image Auto Expand (fazacon) | unknown | 2014 | Auto-expand inside threads |
| Uppers and Downers Enhanced (fazacon) | unknown | 2014 | Reddit removed the up/down counts from API — re-derive via heuristic |
| Old Reddit Mobile / Compact | unknown | Mostly dormant | `.i` URL pattern for mobile Safari |

---

## Phase 2 — Feature Catalog and Gap Analysis

### 2.1 Master feature list — categorised

The union of every feature observed plus every unmet community request. Final scope = build all of them unless legally blocked, platform-blocked, or proven impossible against current Reddit behaviour.

#### A. Theming & UI

A1. OLED true-black theme. A2. Catppuccin Mocha / Tokyo Night / Rose Pine / Gruvbox / Dracula / Nord / Solarized Dark / Synthwave / Kanagawa / Everforest / GitHub Dark / One Dark presets. A3. Custom accent color + scrollbar. A4. Glass settings panel. A5. Dense / compact mode. A6. Full-width feed and thread. A7. Multi-column feed (per-page toggle). A8. Hide sidebar / collapsible rail. A9. Hide awards / flair / link-flair / icons / avatars. A10. Post numbers. A11. OP / admin / mod / friend highlight refresh. A12. Color-coded comment depth (HSL stripe per depth). A13. Cake-day animation. A14. Particle burst on vote. A15. Vote-weight colour ranges. A16. Background image / wallpaper / blur. A17. Custom header logo. A18. Font replacement (browser font override). A19. Bionic reading toggle. A20. Underline-links accessibility toggle. A21. Modern card layouts (opt-in bridge). A22. Sub-CSS-preserving toggle. A23. Per-sub style override allow/deny.

#### B. Content Filtering & Moderation

B1. Subreddit filter (literal + regex). B2. User filter / ignore list. B3. Domain filter. B4. Keyword / regex filter. B5. Flair filter (user + link). B6. Score / comment-count threshold filters. B7. Promoted-post nuke (`data-promoted`, `data-whitelist-status^="promo_"`, `data-recommendation-source` pre-empt). B8. NSFW / spoiler hide. B9. NSFW / spoiler unblur (opt-in inverse). B10. AutoModerator + custom-bot auto-collapse with reveal toggle. B11. Low-score auto-collapse with threshold. B12. Duplicate / crosspost detector with inline map. B13. Engagement-bait / ragebait classifier ("AITA", "Am I wrong for", "[Serious]", numbered listicles). B14. AI / bot prose signal (local heuristics only — burstiness, contraction rate, em-dash density, "it's not X, it's Y", bullet-list fetish). B15. Stylometry profile (rolling 20-comment fingerprint cached in IDB). B16. Karma-farm detector (>70% crosspost/repost, >50% template replies). B17. Per-sub muting (mute X only in sub Y). B18. Block-by-URL-substring (affiliate / spam patterns).

#### C. Media & Downloads

C1. Inline image expandos (kept). C2. Inline video expandos (kept). C3. Full-height image option. C4. Image overlay viewer (Esc / click-outside to close, no dialog). C5. Native browser video controls. C6. Image download buttons. C7. Video download buttons. C8. **v.redd.it DASH audio + video merge** via `ffmpeg.wasm` or optional local companion. C9. Gallery ZIP export (images + captions.txt). C10. RedGifs v3 layout fix. C11. Imgur album flatten (rimgo-style routing). C12. GIF → WebM transcode (>N MB). C13. Hover zoom preview (Hover-Zoom+-style). C14. Drag-to-resize expandos. C15. Inline search-result gallery carousel. C16. Inline tweet rendering (BlueSky / Nitter / Mastodon / Threads). C17. Thumbnail scale controls. C18. Cobalt API bridge (optional). C19. Local companion bridge for yt-dlp / ffmpeg (optional, localhost-only). C20. Display-direct image (skip Reddit viewer chrome).

#### D. Automation & Power Tools

D1. Mark-all-read button. D2. Auto-refresh comments (token-bucket-paced, 30s→300s backoff). D3. Auto-expand media in thread. D4. Auto-load-more comments. D5. Comment draft restore (local). D6. Markdown toolbar with live preview. D7. Copy code block button. D8. Default sort (per-sub memory). D9. Sticky sort. D10. **Power-Delete-Suite-style own-history sweep** (multi-sort × multi-timeframe, overwrite-then-delete via Reddit API, undo via toast where the endpoint allows). D11. Bulk hide / unhide. D12. Saved-content bulk download. D13. "View context" (kept). D14. "Continue this thread" inline loader (kept).

#### E. Navigation & Layout

E1. Old-Reddit redirect (opt-in). E2. Host toggle pill (old / www / sh). E3. Infinite scroll. E4. Scroll restore per permalink. E5. Scroll position memory across reloads. E6. Comment navigator (button surface, no shortcuts). E7. Thread minimap / heatmap. E8. Search filter persistence (sort + time window). E9. Search dispatcher (Reddit / sub / Google / DuckDuckGo / custom). E10. Top-comments preview from listings. E11. Subreddit shortcut bar. E12. Floating scroll-to-top button. E13. Per-sub default sort memory. E14. Logo link target override (frontpage → /r/all).

#### F. Privacy & Anti-Tracking

F1. Outbound URL cleanser (click + copy + mouseover + contextmenu + focus). F2. Event-tracking sabotage (`sendBeacon` / `fetch` / `XMLHttpRequest` page-world wrappers). F3. App-install prompt killer. F4. Mature / age-gate friction kill (opt-in). F5. Quarantine auto-confirm (opt-in). F6. Alternate-frontend redirect (Nitter / Libreddit / Redlib / Old Reddit) optional. F7. Username hider (header + every `.author`). F8. Karma hider (anti-anxiety). F9. CCP/personalisation toggle (one-click opt-out via Reddit preferences API). F10. Disable Reddit auto-translate. F11. Strip cookie banners.

#### G. Data Export & Backup

G1. Comment-tree export (JSON / Markdown / HTML). G2. Saved-content backup (JSON). G3. Settings backup (JSON, schema-versioned, unknown-key-preserving). G4. Filter / user-tag import / export. G5. Vote / read history local log (IDB). G6. Media archive manifest (downloaded URL + sha256 + post permalink). G7. Bulk own-comments backup before delete.

#### H. Archival & Recovery

H1. **Arctic Shift restoration** of deleted posts and comments inline. H2. PullPush fallback (still useful for limited cases). H3. Wayback / archive.today fallback chain. H4. Snapshot-now button (push current page to Wayback). H5. **In-thread mod-action log** (Reveddit-style real-time push). H6. Removed-content badge with provenance + timestamp.

#### I. Author Intelligence

I1. Inline age + karma badge next to every username (rAger-style). I2. Granular timestamp tooltip (1y 11mo instead of "1 year ago"). I3. Username hover card (RES-kept). I4. Local user tags + colours + ignore list. I5. Per-user vote-weight tracking (every up/downvote we cast). I6. Shadowban detector inline (via `about.json` vs `comments.json` delta). I7. Account-history scoring (karma breakdown by sub, peak posting hours, recent history). I8. OP-context-sidebar widget (Redbar-style: OP karma / cake-day / recent activity). I9. Cake-day animation. I10. AutoModerator authorship attribution display.

#### J. Accessibility

J1. Reduced-motion respect. J2. WCAG AA contrast (locked across all themes). J3. Screen-reader labels on every injected control. J4. Font sizing / readability slider. J5. Dyslexia-readable font option. J6. Tab / focus trap in overlays. J7. High-contrast outline mode. J8. Bionic-reading toggle.

#### K. Integrations (all opt-in, all rate-limited, all default off)

K1. Reddit preferences API (`/api/v1/me/prefs`). K2. Arctic Shift. K3. PullPush. K4. Wayback. K5. archive.today. K6. Cobalt media. K7. KarmaDecay (reverse-image repost detection — bookmarklet-style). K8. Local companion (yt-dlp / ffmpeg / Ollama bridge on localhost). K9. **Local LLM summary** via Ollama for: long threads, AutoMod sticky comments, linked-article TLDR.

#### L. Quality of Life

L1. Subscriber / member counts restore. L2. Disable auto-translate. L3. Base64 decoder for post/comment text. L4. Banned-banner removal. L5. Login autofill repair. L6. Restore the old `data-res-slim-ups` per-user upvote count display. L7. r/place template overlay (optional, gated). L8. Sub topic auto-tagging from rules + flairs. L9. Comment-page top-level reply jump. L10. Mark-read on expando open.

#### M. Moderator Workbench (Toolbox successor; opt-in, parent-gated)

M1. Modbar (sub-status, recent actions, per-sub config). M2. Queue tools (modqueue / unmoderated / reports / spam batch actions). M3. Usernotes (versioned JSON in subreddit wiki — Toolbox-compatible). M4. Personal notes. M5. Removal reasons. M6. Ban macros / mute macros. M7. ModMail Pro (threaded view, macros, snippets, search). M8. Mod action logs viewer. M9. Comment nuke (remove a thread; undo toast for the next 30s). M10. CSS syntax highlighter. M11. AutoModerator config editor. M12. Domain history tracker. M13. User history analyser. M14. Spam button.

### 2.2 Feature matrix

`Y` = directly observed. `P` = partial / adjacent. `R` = unmet community request. `Plan` = roadmap-net-new beyond competitors. Empty = none.

| Category | Feature | RSM (today) | RES | REnh | REL | Sink | TB | Reveddit | Uncens | PDS | Redd-Eye | GF/OUJ | US | Best ref | RSM Max decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Core | Feature registry w/ reversible destroy | Y | P | P | Y | P | P | P | P | P | P | | | REL | Keep + extend |
| Core | Settings import/export | Y | Y | P | P | P | Y | | | | | | | RSM v0.6 | Keep + extend |
| Core | Immediate apply, no dialogs | Y | P | Y | Y | Y | P | Y | Y | Y | Y | P | | RSM | Keep |
| Core | Toast feedback | Y | P | P | Y | Y | P | Y | Y | Y | Y | | | RSM v0.6 | Keep |
| Core | Userscript single-file | | | | Y | | | | | Y | Y | Y | Y | REL | Build v0.14 |
| Core | Browser extension | Y | Y | Y | | Y | Y | Y | Y | | Y | | | RES | Keep |
| Core | Cross-browser settings sync | | | Y | | | | | | | | | | REnh | Plan v0.16 |
| Theme | Dark theme | Y | Y | Y | Y | Y | | | | | | Y | Y | REL/userstyles | Keep |
| Theme | OLED true-black | Y | P | P | Y | P | | | | | | P | Y | RSM v0.6 | Keep |
| Theme | Theme presets (Catppuccin etc) | | | | Y | | | | | | | | Y | REL | Build v0.17 |
| Theme | Custom accent + scrollbar | Y | P | Y | Y | | | | | | | P | P | RSM | Extend |
| Theme | Glass panels | Y | | P | | | | | | | | | | RSM | Keep |
| Theme | Dense / compact mode | Y | P | Y | Y | | | | | | | Y | Y | RSM | Keep |
| Theme | Full-width feed | Y | P | Y | Y | | | | | | | Y | Y | RSM v0.9 | Keep |
| Theme | Multi-column feed | | | | | | | | | | | Y | P | c6p | Build v0.10.x |
| Theme | Hide sidebar | Y | P | Y | Y | | | | | | | Y | Y | RSM v0.9 | Keep |
| Theme | Collapsible sidebar rail | | P | P | Y | | | | | | | P | | REL | Build v0.10.x |
| Theme | Hide awards / flair / icons | Y | P | Y | Y | | | | | | | P | Y | RSM v0.9 | Keep |
| Theme | Post numbers | Y | P | Y | Y | | | | | | | P | | RSM v0.9 | Keep |
| Theme | OP/admin/mod/friend highlight | P | Y | Y | Y | | P | | | | | P | | RES/REL | Refresh v0.10.x |
| Theme | Color-coded depth | Y | P | | Y | Y | | | | | | Y | Y | RSM v0.9 | Keep |
| Theme | Username hider | Y | Y | Y | P | | | | | | | P | Y | RSM v0.7 | Keep |
| Theme | Karma hider | | | | | | | | | | | Y | | karmaless | Build v0.16 |
| Theme | Cake-day animation | | | | Y | | | | | | | | | REL | Build v0.17 |
| Theme | Particle burst on vote | | | | Y | | | | | | | | | REL | Build v0.17 |
| Theme | Vote-weight colour ranges | | | | Y | | | | | | | | | REL | Build v0.16 |
| Theme | Background image / blur | | | Y | | | | | | | | | P | REnh | Build v0.17 |
| Theme | Custom header logo | | | Y | | | | | | | | | P | REnh | Build v0.17 |
| Theme | Font replacement | | | | | | | | | | | Y | | PlumFont | Build v0.17 |
| Theme | Bionic reading | | | Y | | | | | | | | | | REnh | Build v0.18 |
| Theme | Per-sub CSS allow/deny | P | P | | Y | | | | | | | Y | | REL / chocolateboy | Build v0.10.x |
| Nav | Old-Reddit redirect | Y | | Y | Y | | | | | | | Y | | ORR | Keep |
| Nav | Old/www/sh toggle pill | Y | | P | | | | | | | | Y | | RSM v0.7 | Keep |
| Nav | Infinite scroll | Y | Y | P | Y | | | | | | | Y | | RES | Keep + harden |
| Nav | Scroll restore | Y | P | | Y | | | | | | | P | | RSM v0.8 | Keep |
| Nav | Comment navigator buttons | Y | Y | | Y | | | | | | | P | | RES | Keep |
| Nav | Thread minimap | Y | | | | | | | | | | | | RSM v0.8 | Keep — unique |
| Nav | Search filter persist | Y | | | | | | | | | | R | | RSM v0.8 | Keep |
| Nav | Search dispatcher | Y | P | | | | | | | | | P | | RSM v0.8 | Keep |
| Nav | Top-comments preview | Y | | | | | | | | | | Y | | RSM v0.8 | Keep |
| Nav | Auto-refresh comments | Y | | | | | | | | | | Y | | RSM v0.8 | Keep |
| Nav | Continue-thread inline | Y | P | | Y | | | | | | | Y | | RSM v0.8 | Keep |
| Nav | Floating scroll-to-top | | | Y | Y | | | | | | | P | | REnh | Build v0.17 |
| Nav | Per-sub default sort memory | | | | | | | | | | | R | | (none) | Build v0.10.x |
| Nav | Sub shortcut bar | | P | | Y | | | | | | | P | | REL | Build v0.17 |
| Filter | Subreddit filter | Y | Y | P | Y | Y | | | | | | Y | | RES filteReddit | Keep + extend |
| Filter | User filter / ignore | | Y | P | Y | Y | P | | | | | Y | | RES user tagger | Build v0.10.x |
| Filter | Domain filter | P | Y | P | Y | | | | | | | Y | | RES | Build v0.10.x |
| Filter | Keyword / regex filter | Y | Y | Y | Y | Y | | | | | | Y | | Reddit++ / REL | Keep + extend |
| Filter | Flair filter | Y | Y | P | Y | | | | | | | P | | RES | Keep |
| Filter | Score / comment-count threshold | Y | Y | | Y | | | | | | | P | | RES | Keep |
| Filter | Promoted nuke | Y | P | Y | Y | Y | | | | | | Y | Y | RSM v0.7 | Keep + extend |
| Filter | NSFW / spoiler hide | Y | Y | Y | Y | Y | | | | | | Y | P | RES | Keep |
| Filter | NSFW / spoiler unblur | | | Y | | | | | | | | Y | P | hdyzen | Build opt-in v0.11 |
| Filter | AutoMod + bot collapse | | P | | Y | | P | | | | | P | | REL | Build v0.10.x |
| Filter | Low-score collapse | Y | P | | Y | | P | | | | | P | | RSM | Extend v0.10.x |
| Filter | Duplicate / crosspost map | | P | | | | P | | | | | | | RES /duplicates | Build v0.10.x |
| Filter | AI / bot prose signal | | | | | | | | | | Y | | | Redd-Eye | Build local v0.16 |
| Filter | Stylometry fingerprint | | | | | | | | | | P | | | Plan | Build v0.16 |
| Filter | Karma-farm detector | | | | | | | | | | P | | | Plan | Build v0.16 |
| Filter | Ragebait classifier | | | | | | | | | | | | | Plan | Build v0.16 |
| Filter | Per-sub muting | | | | | Y | | | | | | | | Sink It / Plan | Build v0.10.x |
| Filter | Block-by-URL-substring | | | Y | | | | | | | | | | REnh | Build v0.10.x |
| Media | Inline image expandos | Y | Y | P | Y | | | | | | | Y | | RSM | Keep |
| Media | Inline video expandos | Y | Y | Y | Y | | | | | | | Y | | RSM | Keep |
| Media | Full-height images | | P | Y | Y | | | | | | | P | Y | REnh | Build v0.11 |
| Media | Overlay viewer | | P | Y | | | | | | | | P | | REnh | Build v0.11 |
| Media | Native video controls | P | P | Y | Y | | | | | | | P | | REnh | Build v0.11 |
| Media | Download buttons | Y | | Y | Y | | | | | | | Y | | RSM v0.4 | Extend v0.11 |
| Media | v.redd.it DASH mux | | | P | P | | | | | | | P | | Cobalt / yt-dlp | Build v0.11 |
| Media | Gallery ZIP export | | P | | | | | | | | | P | | Plan | Build v0.11 |
| Media | Hover zoom preview | | | | | | | | | | | P | | Hover Zoom+ | Build v0.11 |
| Media | Drag-resize expandos | | | | Y | | | | | | | | | REL | Build v0.11 |
| Media | RedGifs v3 layout | P | P | | | | | | | | | Y | | RSM | Build v0.11 |
| Media | Inline search-gallery carousel | | | | | | | | | | | Y | | GF | Build v0.11 |
| Media | Inline tweet / BlueSky / Nitter | | R | P | | | | | | | | Y | | RES PR #5560 | Build v0.11 |
| Media | Display-direct image | | P | | | | | | | | | Y | | View Reddit Images | Build v0.11 |
| Mod | Modbar | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Queue tools | | | | | | Y | P | | | | | | Toolbox | Build v0.13 |
| Mod | Usernotes (wiki-versioned) | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Personal notes | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Removal reasons | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Ban / mute macros | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | ModMail Pro | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Mod action logs viewer | | | | | | Y | Y | | | | | | Reveddit / TB | Build v0.13 |
| Mod | Comment nuke + undo | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | AutoModerator config editor | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | CSS syntax highlighter | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Mod | Spam button | | | | | | Y | | | | | | | Toolbox | Build v0.13 |
| Privacy | Outbound cleanser | Y | P | | | Y | | | | | | Y | | RSM v0.7 | Keep |
| Privacy | Event-tracker sabotage | Y | | | | P | | | | | | Y | | RSM v0.7 | Keep |
| Privacy | App prompt killer | Y | | P | | Y | | | | | | Y | | RSM v0.7 | Keep |
| Privacy | Age / NSFW friction bypass | Y | | P | | | | | | | | Y | | RSM v0.7 | Keep |
| Privacy | Alt-frontend redirect | | | P | | | | | | | | Y | | Privacy Redirector | Build v0.13 |
| Privacy | Cookie banner kill | | | | | Y | | | | | | Y | | TIGB | Build v0.7-patch |
| Privacy | Reddit prefs one-click ad-opt-out | | | | | | | | | | | | | Plan | Build v0.13 |
| Data | Comment-tree export | | | | | | Y | | | | | | | Comment Exporter | Build v0.12 |
| Data | Settings backup | Y | Y | P | P | | Y | | | | | | | RSM v0.6 | Keep |
| Data | Saved-content backup | P | P | | | | | | | | | Y | | felixire | Build v0.12 |
| Data | Vote / read history log | P | P | | Y | | | | | | | P | | REL | Build v0.12 |
| Data | Filter import/export | P | Y | P | | | Y | | | | | | | RSM v0.6 | Extend |
| Data | Media archive manifest | | | | | | | | | | | | | Plan | Build v0.12 |
| Archive | Arctic Shift restore | | | | | | | | Y | | | | | Uncensored | Build v0.12 |
| Archive | PullPush comment search | Y | P | | | | | | | | | Y | | spiralx / RSM | Keep |
| Archive | Wayback / archive.today | P | P | | | | | | | | | Y | | RSM | Extend v0.12 |
| Archive | Snapshot-now button | | | | | | | | | | | | | Plan | Build v0.12 |
| Archive | In-thread mod-action log | | | | | | | Y | | | | | | Reveddit | Build v0.13 |
| Archive | Removed-content badge | | | | | | | Y | Y | | | | | Reveddit | Build v0.12 |
| Author | Age + karma inline badge | | | P | Y | | | | | | | P | | rAger / REL | Build v0.10.x |
| Author | Granular timestamps | Y | P | | Y | | | | | | | P | | RSM v0.3 | Extend |
| Author | Username hover card | Y | Y | | Y | | | | | | | | | RES | Keep |
| Author | Local user tags / colours | | Y | Y | Y | Y | Y | | | | | P | | RES user tagger | Build v0.10.x |
| Author | Per-user vote-weight log | | | | Y | | | | | | | | | REL | Build v0.16 |
| Author | Shadowban detector | | | | | | | | | | | P | | Plan | Build v0.16 |
| Author | OP context sidebar widget | | | | | | | | | | | | | Redbar | Build v0.16 |
| Author | Account-history score | | | | | | P | | | | | | | User Detective | Build v0.16 |
| Author | AutoMod authorship attribution | | | | | | | | | | | | | Plan | Build v0.16 |
| Integration | Reddit prefs API | | P | | | | P | | | | | | | Plan | Build v0.13 |
| Integration | Arctic Shift | | | | | | | | Y | | | | | Uncensored | Build v0.12 |
| Integration | Cobalt | | | | | | | | | | | Y | | Cobalt | Build v0.11 |
| Integration | Local companion | | | | | | | | | | | | | Plan | Build v0.11 |
| Integration | Local LLM (Ollama) | | | | | | | | | | | | | Plan | Build v0.18 |
| Integration | KarmaDecay reverse-image | | | | | | | | | | | P | | KarmaDecay | Build v0.16 |
| QoL | Markdown toolbar + preview | P | Y | | Y | | | | | | | Y | | RES / REL | Build v0.18 |
| QoL | Copy code block | | R | | | | | | | | | P | | RES issue | Build v0.18 |
| QoL | Comment draft restore | | R | | | | | | | | | P | | RES issue | Build v0.18 |
| QoL | Default sort per-sub | P | P | | | | | | | | | Y | | yodaluca | Build v0.10.x |
| QoL | Disable auto-translate | | | | | | | | | | | Y | | GF script | Build v0.18 |
| QoL | Base64 decoder | | | | | | | | | | | Y | | OUJ DanielBlaze | Build v0.18 |
| QoL | Banned banner removal | | | | | | | | | | | Y | | GF | Build v0.18 |
| QoL | Login autofill repair | | | | | | | | | | | Y | | GF | Build v0.18 if confirmed |
| QoL | Subscriber count restore | Y | R | | | | | | | | | Y | | RSM v0.3 | Keep |
| QoL | Sub topic auto-tagging | | | | | | | | | | | | | Plan | Build v0.18 |
| QoL | r/place template overlay | | | | | | | | | | | Y | | phiresky | Build v0.18 gated |
| QoL | AI thread summary | | | | | | | | | | | | | Plan | Build v0.18 |
| QoL | Linked-article TLDR | | | | | | | | | | | | | Plan | Build v0.18 |
| Power | Power-Delete sweep + undo | | | | | | | | | Y | | Y | | PDS | Build v0.13 |
| Power | Bulk hide / unhide | | P | | | | | | | | | P | | RES | Build v0.13 |
| Power | Saved-content bulk download | | | | | | | | | | | Y | | felixire | Build v0.12 |
| A11y | Reduced motion | Y | P | | | | | | | | | | P | RSM v0.6 | Keep |
| A11y | WCAG AA tokens | Y | P | | | | | | | | | | P | RSM v0.6 | Keep + extend |
| A11y | Screen-reader labels | Y | P | | | | | | | | | | | RSM | Keep |
| A11y | Font size slider | | P | Y | | | | | | | | Y | Y | oldlander | Build v0.10.x |
| A11y | Dyslexia-readable font | | | | | | | | | | | | | Plan | Build v0.10.x |
| A11y | Focus trap in overlays | Y | P | | | | | | | | | | | RSM | Keep |

### 2.3 Gap analysis — pick-by-pick rationale

- **Commodity table-stakes** (in ≥5 tools): old-reddit redirect, promoted-post hider, NSFW unblur, app-banner kill, new-comment highlight, inline expandos, sidebar toggle, infinite scroll, dark theme, user tagger, keyword/domain/sub filter, mass-delete, video downloader, sub-CSS toggle, click-tracking strip. Every one is already shipped or scheduled.
- **Single-tool moats** (in 1–2 tools): bionic reading (REnh), AI/bot detection (Redd-Eye), toxicity scoring (Reddit Insights — privacy tradeoff, build local-only), per-user vote weight + particle burst (REL), OP sidebar widget (Redbar), real-time mod-action push (Reveddit), Arctic-Shift restoration (Uncensored), API-driven multi-sort sweep (PDS), browser sync (REnh), arbitrary "top of last N" (Custom Top Sort), background image (REnh), drag-resize expandos (REL), cake-day animation (REL), font replacement (PlumFont), bare-image-URL auto-convert (REL), markdown preview (RES + REL only), bot-comment auto-collapse (REL), scroll position memory (REL), granular timestamps (rAger + REL), karma hider (karmaless), JSON/CSV thread export (Comment Exporter), anti-procrastination focus mode (Sink It), multi-column post listing (c6p), r/place overlays (phiresky), block-by-URL-substring (REnh). Every one is on the matrix.
- **Unmet community requests** (in zero tools): time-of-day auto-dark, Nitter/BlueSky/Mastodon/Threads expandos, per-sub default sort memory, comment-page minimap (we already built it), in-thread mod-action log feed, local-first own-saved archival, shadowban detector inline, sub topic auto-tagging, AI thread summary, linked-article TLDR, anti-ragebait, "already saw in another sub" detector, AutoMod authorship attribution, per-sub muting. Every one is scheduled below.

Final scope decision: build all matrix rows with `Build` or `Plan`. The only legitimate omissions are features blocked by Chrome Web Store policy that we won't compromise on (then ship them as userscript-only) and features that require credentials we don't have (then mark as opt-in and document the credential setup).

---

## Phase 3 — Technical Reconnaissance

### 3.1 Selector strategy

**Stable first, fragile fallback always.** Every surface in `lib/core/dom/selectors.js` exposes both layers. Selector contract tests run against the captured MHTML fixtures at `tests/fixtures/mhtml/{frontpage,thread}.html` and any new captures dropped into the fixtures directory.

| Surface | Stable | Fragile fallback | Notes |
| --- | --- | --- | --- |
| Page root | `body.listing-page` / `body.comments-page` / `body.profile-page` / `body.search-page` / `body.wiki-page` | `body.res-v0-*-*` | page-kind tokens |
| Auth state | `body.loggedin` | (absent → logged out) | |
| Header | `#header[role="banner"]` | `#header-bottom-left .tabmenu` | |
| Subreddit drawer | `#sr-header-area`, `#sr-header-area ul.sr-bar`, `#sr-more-link` | `.sr-list` | |
| Userbar | `#header-bottom-right` | `.user .userkarma` | username hider attaches here |
| Mail / chat | `#mail`, `#chat`, `#notifications` | `.havemail` / `.nohavemail` | |
| Beta-opt-in button | `#redesign-beta-optin-btn` | `button.redesign-beta-optin` | hide via frictionRemovers |
| Search input | `#search[role="search"] input[name="q"]` | `.side #search input[type="text"]` | |
| Listing feed | `#siteTable.sitetable.linklisting` | `.linklisting .thing.link` | observe added children only |
| Post row | `.thing[data-type="link"][data-fullname]` | `.thing.link[data-permalink]` | use `data-fullname` as durable key |
| Promoted row | `.thing[data-promoted="true"]`, `.thing[data-whitelist-status^="promo_"]`, `.thing[data-recommendation-source]` | `.thing.promoted` | pre-empt the recs surface |
| NSFW row | `.thing[data-nsfw="true"]` | `.thing.over18` | |
| Spoiler row | `.thing[data-spoiler="true"]` | `.thing.spoiler` | |
| Sticky | `.thing[data-stickied="true"]` | `.thing.stickied` | |
| Self post | `.thing[data-domain^="self."]` | `.thing.self` | |
| Gallery | `.thing[data-is-gallery="true"]` | n/a | |
| Vote column | `.thing > .midcol .arrow[role="button"]` | `.midcol .arrow.up / .down` | preserve `aria-label="upvote"/"downvote"` |
| Score | `.thing .midcol .score` | `.score.unvoted / .likes / .dislikes` | three-state |
| Thumbnail | `.thing > a.thumbnail` | `.thumbnail.self / .default` | |
| Expando button | `.thing .expando-button[data-host]` | `.expando-button.collapsed / .expanded` | high-churn |
| Expando body | `.thing .expando` | `.expando.expando-uninitialized` | media insertion point |
| Self-text body | `.thing .expando .usertext-body .md` | `.usertext.usertext-body` | |
| Title link | `.thing .entry p.title a.title[data-event-action="title"]` | `a.title.may-blank` | |
| Domain | `.thing .entry .domain a` | `.domain` | |
| Tagline | `.thing .entry p.tagline` | `.tagline` | |
| Author link | `.thing .tagline a.author[href*="/user/"]` | `a.author.may-blank` | OP/mod/admin variants |
| Subreddit link | `.thing .tagline a.subreddit[href*="/r/"]` | `a.subreddit.hover` | |
| Live timestamp | `.thing .tagline time.live-timestamp[datetime]` | `time.live-timestamp` | |
| Edited timestamp | `.thing .tagline time.edited-timestamp` | `time.edited-timestamp` | |
| User attrs (flair) | `.thing .tagline .userattrs` | `.userattrs` | |
| Buttons row | `.thing .entry ul.flat-list.buttons` | `.flat-list.buttons` | |
| Comments link | `.thing ul.buttons a.bylink.comments[data-event-action="comments"]` | `a.bylink.comments` | |
| Save / hide / report / share | `li.link-save-button > a`, `form.hide-button[action$="/post/hide"]`, `li.report-button a.reportbtn`, `li.share a.post-sharing-button`, `li.crosspost-button a.post-crosspost-button` | (same) | |
| Sidebar | `body > .side` | `.content + .side` | |
| Subscribe button | `.titlebox .fancy-toggle-button.subscribe-button[data-sr_name]` | `.fancy-toggle-button.subscribe-button` | |
| Sidebar title | `.titlebox h1.redditname > a` | `h1.redditname` | |
| Mod box | `.side .sidecontentbox` (title text contains "MODERATORS") | `.sidecontentbox` | |
| Comment area | `body.comments-page .commentarea` | `.commentarea` | |
| Sort dropdown | `.commentarea .menuarea .dropdown.lightdrop` | `.drop-choices.lightdrop` | |
| Nested listing | `#siteTable_t3_<id>.sitetable.nestedlisting` | `.sitetable.nestedlisting` | observe added children only |
| Comment node | `.thing[data-type="comment"][data-fullname]` | `.thing.comment` | use `data-fullname` |
| Comment collapse state | `.thing.comment.collapsed`, `.collapsed-for-reason` | `.comment.noncollapsed` | |
| Comment expand control | `.thing.comment .entry .tagline > a.expand` | `a.expand` | |
| Comment author | `.tagline a.author` (variants: `.submitter`, `.moderator`, `.admin`) | `a.author.may-blank` | OP / mod / admin |
| Comment body | `.thing.comment .entry .usertext-body .md` | `.md-container .md` | |
| Edit form | `.thing.comment form.usertext-edit` | `.usertext-edit` | |
| Reply button | `.buttons li.reply-button a[data-event-action="comment"]` | `.reply-button` | |
| Children | `.thing.comment > .child` | `.child` | high-churn |
| morechildren / morecomments | `.thing.morechildren a.button[onclick]` / `.morecomments a` | (same) | |
| Composer | `.commentarea > form.usertext.cloneable[id^="form-t3_"]` | `form.usertext.cloneable` | |
| Composer textarea | `form.usertext textarea[name="text"]` | `textarea[name="text"]` | |
| Footer / debug | `.footer-parent .bottommenu.debuginfo` | (same) | for build version surfacing |
| HSTS pixel | `#hsts_pixel` | (same) | passive |

**High-churn areas — require self-healing with `waitForElement` + exponential backoff:**

- Media expandos and host-specific inserted DOM.
- Comment continuation loaders and child containers.
- Reply / edit textareas (created lazily).
- Report / mod-action forms (hidden until trigger).
- Subreddit custom CSS that reshapes `.side` / `.entry` / `.buttons`.

**Implementation rule:** `findElement(surface, [stable, fragile])` — first match wins. `MutationObserver` processes `addedNodes` + descendants. Never rescans whole document on mutation.

### 3.2 SPA and page lifecycle

old.reddit is **not** an SPA — server-rendered jQuery + Backbone-style sprinkles. Each full page load is authoritative; targeted observers handle dynamic content (infinite scroll, "continue this thread", reply forms, lazy expandos).

**`document_start`** — critical pre-paint work:

- Anti-FOUC: inject OLED CSS + body classes (`rsm-root`, `rsm-theme-oled`, `res-nightmode`).
- TrustedTypes policy creation.
- declarativeNetRequest registration (extension only) — `out.reddit.com`, `alb.reddit.com` redirect rules.
- Critical click-tracking event capture for outboundCleanser.

**DOM ready (`contentStart` → `go`)** — main mount:

- Feature registry init for enabled features.
- Settings panel mount.
- Page-surface detector (`body.listing-page` / `body.comments-page` / etc).
- Listing observer (`#siteTable`).
- Thread observer (`.commentarea`).

**Per added `.thing`** — adornments and filters:

- filterRules evaluation.
- Author badges + hover cards.
- Media controls.
- Read / save / vote state.
- Promoted nuke.

**Route hooks** — sufficient for old.reddit today; extended for future new/sh:

- Old: full page load + targeted observers; no route-change hook required.
- Settings: keep `popstate`, `hashchange`, patched `history.pushState`.
- Future new/sh: `location.href` polling fallback + MutationObserver route sentinels.

### 3.3 Site APIs, rate limits, auth

| API | Use | Auth | Rate strategy |
| --- | --- | --- | --- |
| `/api/me.json` | identity, hide username, prefs check | Cookie | session-cache, refresh on login |
| `/user/<u>/about.json` | author badges, shadowban | Cookie/anon | token-bucket 1/s, burst 5, 24h cache |
| `/user/<u>/comments.json` | shadowban delta, AutoMod attribution | Cookie/anon | same |
| `/r/<sub>/about.json` | sub cards | Cookie/anon | 24h cache |
| `/r/<sub>/about/rules.json` | inline rules | Cookie/anon | 24h cache |
| `/r/<sub>/about/moderators.json` | mod list | Cookie/anon | 24h cache |
| `/r/<sub>/about/stylesheet.json` | CSS audit | Cookie/anon | on demand |
| `/duplicates/<article>.json` | crosspost map | Cookie/anon | per-article cache |
| `/by_id/<ids>.json` | restore + listing metadata | Cookie/anon | batched, debounced |
| `/api/v1/me/prefs` | ad / personalisation opt-out | Cookie + modhash | manual user action only |
| `/api/hide` / `/api/unhide` | bulk hide / unhide | Cookie + modhash | queue + toast + undo |
| `/api/read_all_messages` | mark all read | Cookie + modhash | preserve existing |
| `/api/del` / `/api/editusertext` | own-history sweep | Cookie + modhash | rate-limited, undo where possible |
| `/comments/<article>/.json?sort=top&depth=1` | top-comments preview | Cookie/anon | per (permalink,count) cache + bucket |
| `<path>.json` | source markdown / snudded | Cookie/anon | per-thing cache |
| `https://api.pullpush.io/reddit/search/comment/?ids=<id>` | legacy restore | External | opt-in, 0.2/s, provenance |
| **Arctic Shift** `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=<id>` | **primary restore for deleted content** | External | opt-in, 0.5/s, provenance |
| Wayback CDX `https://timetravel.mementoweb.org/api/json/<ts>/<url>` + `https://web.archive.org/save/<url>` | archive lookup + snapshot | External | opt-in, 0.2/s |
| archive.today `https://archive.today/newest/<url>` | archive fallback | External | opt-in, manual only |
| Cobalt `https://api.cobalt.tools/api/json` | media download | External | opt-in, permission prompt |
| Local companion `http://127.0.0.1:<port>/health` + `/ytdlp` + `/ffmpeg` + `/ollama` | yt-dlp / ffmpeg / local-LLM bridge | localhost only | opt-in, explicit URL + health gate |

**Known constraint:** community reports cite `100 requests / 10 minutes` as the userscript-API pain point. This roadmap requires caching, batching, and a visible rate-limit queue for author/sub enrichment.

### 3.4 Userscript vs extension split

| Capability | Extension | Userscript |
| --- | --- | --- |
| DOM theming + filters | Y | Y |
| Settings panel | Y | Y |
| Local storage | `chrome.storage.local` | `GM_getValue` / `GM_setValue` |
| Cross-origin fetch | background + host perms | `GM_xmlhttpRequest` with grants |
| Downloads | `chrome.downloads` | anchor download / `GM_download` |
| declarativeNetRequest | Y | N |
| Background queue / API rate | Y (service worker) | page-state only |
| Media muxing / local companion | best | partial |
| Store distribution | Y | N |
| Single-file portability | N | Y |
| Mod write actions | requires perms | requires GM grants |

**Recommendation:** keep the MV3 extension as the complete product and ship a userscript as the portable subset. The userscript should share generated feature modules where possible but omit moderator-write actions, DNR rules, privileged downloads, and the background queue. Both products share the same source tree; the userscript build is a single esbuild target producing `dist/userscript/res-slim-max.user.js`.

### 3.5 Architecture

**Planned file layout** (additions in **bold**):

```
lib/core/registry/featureRegistry.js          (shipped v0.5)
lib/core/registry/featureContext.js           (shipped v0.5)
lib/core/registry/featureLifecycle.js         (shipped v0.5)
lib/core/settings/schema.js                   (shipped v0.5)
lib/core/settings/defaults.js                 (shipped v0.5)
lib/core/settings/migrations.js               (shipped v0.5)
lib/core/options/snapshot.js                  (shipped v0.6)
lib/core/options/stage.js                     (kept)
lib/core/dom/selectors.js                     (shipped v0.5)
lib/core/dom/findElement.js                   (shipped v0.5)
lib/core/dom/waitForElement.js                (shipped v0.5)
lib/core/dom/thingProcessor.js                (shipped v0.5)
lib/core/dom/trustedHtml.js                   (shipped v0.5)
lib/core/dom/toastHost.js                     (shipped v0.6)
lib/core/theme/settingsThemePresets.js        (shipped v0.6)
lib/core/theme/antiFouc.js                    (shipped v0.5)
lib/core/theme/tokens.scss                    (planned v0.10.x — extend to --rsm-*)
**lib/core/api/reddit.js**                   (planned v0.11)
**lib/core/api/arcticShift.js**               (planned v0.12)
**lib/core/api/pullpush.js**                  (planned v0.12)
**lib/core/api/wayback.js**                   (planned v0.12)
**lib/core/api/archiveToday.js**              (planned v0.12)
**lib/core/api/cobalt.js**                    (planned v0.11)
**lib/core/api/localCompanion.js**            (planned v0.11)
**lib/core/api/ollama.js**                    (planned v0.18)
lib/utils/rateLimiter.js                      (shipped v0.8)
lib/utils/filterRules.js                      (shipped v0.10)
lib/utils/outboundCleanser.js                 (shipped v0.7)
**lib/utils/idb.js**                          (planned v0.12 — IDB wrapper for IDB-backed history)
**lib/utils/heuristics/ai.js**                (planned v0.16 — AI prose signal)
**lib/utils/heuristics/stylometry.js**        (planned v0.16)
**lib/utils/heuristics/ragebait.js**          (planned v0.16)
**lib/utils/heuristics/karmaFarm.js**         (planned v0.16)
**lib/utils/usernotesWiki.js**                (planned v0.13 — Toolbox-compatible)
lib/modules/<feature>.js                      (existing 60 modules + new)
**userscript/res-slim-max.user.js**           (planned v0.14)
**userscript/gm-shim.js**                     (planned v0.14)
tests/fixtures/mhtml/frontpage.html           (shipped v0.5)
tests/fixtures/mhtml/thread.html              (shipped v0.5)
tests/unit/*.test.mjs                         (32 suites today)
.research/mhtml-selector-map.md               (shipped 2026-05-22)
.research/parts/{home,comments}/              (decoded MHTML parts)
```

**Feature contract** (already implemented; surfaced here for reference):

```js
export default {
  id: 'category.featureName',
  title: 'Feature name',
  category: 'category',
  defaultEnabled: false,
  permissions: [],
  surfaces: ['listing', 'comments'],
  settings: {},
  init(ctx) {},
  destroy(ctx) {},
};
```

`ctx` includes: settings adapter · storage adapter · scoped CSS manager · DOM selector helpers · toast manager · logger / error panel · rate-limited API clients · observer manager · feature cleanup registry · TrustedTypes policy.

**Lifecycle rules:**

- `init()` registers every cleanup with `ctx.cleanup`.
- `destroy()` is idempotent.
- Disabling a feature runs `destroy()` immediately (no reload).
- Re-enabling runs `init()` and reprocesses currently-visible nodes once.
- Module failure isolates: local error log + concise toast, never cascades.

**CSS strategy:**

- Extension: compiled `res.css` + feature-scoped injected styles when needed.
- Userscript: `GM_addStyle`.
- Scope: every injected UI under `body.rsm-root` and `body.rsm-feature-<id>`.
- Tokens: `--rsm-*` for module CSS; bridge existing `--options-*` only inside the settings console.
- `prefers-reduced-motion` disables shimmer, hover lift, spring transitions, staggered entrances.

**Observer strategy:**

- One root observer per surface: listing (`#siteTable`), comments (`.commentarea`), settings panel.
- Process added nodes only.
- Per-feature WeakSet of processed nodes.
- `IntersectionObserver` for media / author API enrichment.
- `requestIdleCallback` with timeout fallback for non-critical adornments.

---

## Selector & API Reference

### Stable selector map (exported surface names)

The complete map lives in `lib/core/dom/selectors.js`. Required exported surface keys (Phase 3 source of truth):

```
page.root                     listing.feed                  thread.commentArea
page.header                   listing.post                  thread.commentList
page.userbar                  listing.postTitle             thread.comment
page.search                   listing.postMetadata          thread.commentBody
page.subredditDrawer          listing.postActions           thread.commentChildren
page.tabmenu                  listing.voteColumn            thread.collapseControl
page.betaOptin                listing.expandoButton         thread.replyForm
page.mailIcon                 listing.expando               thread.morechildren
page.chatIcon                 listing.thumbnail             composer.form
page.notificationsIcon        listing.tagline               composer.textarea
page.prefsLink                listing.author                composer.submitButton
page.resGearButton            listing.subredditLink         sidebar.root
                              listing.timestamp             sidebar.subscribeBtn
                              listing.flair                 sidebar.titlebox
                              listing.commentsLink          sidebar.modList
                              listing.saveButton            sidebar.relatedSubs
                              listing.hideButton            footer.debugInfo
                              listing.reportButton          footer.hstsPixel
                              listing.shareButton           profile.tabmenu
                              listing.crosspostButton       profile.karmaBoxes
                              listing.reportForm            search.input
                              moderation.modActions         search.sortTabs
                              moderation.distinguishBtn     search.timeTabs
                              moderation.removeBtn          search.resultRow
                              moderation.spamBtn            wiki.root
                              moderation.banBtn             modals.nsfw
                              promoted.row                  modals.quarantine
                              promoted.creative             modals.appInstall
                              recommendations.row           modals.loginPopup
```

### API client contract

Every external client exposes:

- `enabled` (settings-driven)
- `origin` (one host pattern)
- `permissionRequired` (manifest key + UI string)
- `rateLimit` (token bucket config)
- `timeoutMs`
- `failureMode` (`silent` | `toast` | `panel`)
- `lastFailure` (timestamp + reason, queryable from settings)

Cross-origin calls go through:
- Extension: `background.entry.js` messaging with optional host permission.
- Userscript: `GM_xmlhttpRequest` with header grants.

Reddit write endpoints attach `X-Modhash` from page context (not from settings).

External archive / media APIs never run silently in defaults.

CSP: every extension script bundled and self-hosted.

TrustedTypes: every HTML write goes through `lib/core/dom/trustedHtml.js`.

---

## Settings Schema

Storage key convention: `rsm.<category>.<feature>.<setting>`. Feature toggles use `rsm.<category>.<feature>.enabled`.

**Default rule:**

- Existing RES-Slim behaviour defaults to current behaviour (no surprise on update).
- Privacy cleanup + anti-promo defaults may be on if no new network calls.
- External APIs, destructive actions, NSFW/age bypass, moderator writes, media muxing, local-LLM, hover zoom, AI summarisation default off.

See `lib/core/settings/schema.js` for the authoritative shape. The table below documents the user-visible toggles grouped by category (every new feature added below appears here too — keep in sync):

| Category | Feature | Toggle key | Default | Notes |
| --- | --- | --- | --- | --- |
| core | Feature registry | `rsm.core.registry.enabled` | on | Cannot disable in UI |
| core | Toast host | `rsm.core.toasts.enabled` | on | Required (no dialogs) |
| core | Error log panel | `rsm.core.errorLog.enabled` | on | Local only |
| core | Settings import/export | `rsm.core.settingsBackup.enabled` | on | JSON only |
| core | Userscript compat | `rsm.core.userscriptCompat.enabled` | auto | Build-dependent |
| core | Cross-browser settings sync | `rsm.core.sync.enabled` | off | `chrome.storage.sync` |
| theme | OLED theme | `rsm.theme.oled.enabled` | on | Baseline |
| theme | Theme preset | `rsm.theme.preset` | oled | OLED / Catppuccin Mocha / Tokyo Night / Rose Pine / Gruvbox / Dracula / Nord / Solarized Dark / Synthwave / Kanagawa / Everforest / GitHub Dark / One Dark |
| theme | Accent color | `rsm.theme.accent.value` | reddit-orange | Stored token; color-picker UI |
| theme | Dense mode | `rsm.theme.dense.enabled` | off | |
| theme | Glass panels | `rsm.theme.glass.enabled` | on | Disable with reduced motion |
| theme | Branded scrollbar | `rsm.theme.scrollbar.enabled` | on | |
| theme | Full-width content | `rsm.theme.fullWidth.enabled` | off | per-page subkeys |
| theme | Multi-column feed | `rsm.theme.multiColumn.enabled` | off | listing pages |
| theme | Multi-column count | `rsm.theme.multiColumn.count` | 2 | 2..4 |
| theme | Hide sidebar | `rsm.theme.hideSidebar.enabled` | off | per-sub override |
| theme | Collapsible rail | `rsm.theme.sidebarRail.enabled` | off | mutex with hide |
| theme | Hide awards | `rsm.theme.hideAwards.enabled` | off | |
| theme | Hide flair | `rsm.theme.hideFlair.enabled` | off | user / link |
| theme | Hide icons/avatars | `rsm.theme.hideIcons.enabled` | off | |
| theme | Post numbers | `rsm.theme.postNumbers.enabled` | off | |
| theme | Color-coded depth | `rsm.theme.depthColors.enabled` | on | |
| theme | OP highlight | `rsm.theme.opHighlight.enabled` | on | |
| theme | Admin / mod / friend highlight | `rsm.theme.modHighlight.enabled` | on | |
| theme | Username hider | `rsm.theme.hideUsername.enabled` | off | header |
| theme | Karma hider | `rsm.theme.hideKarma.enabled` | off | anti-anxiety |
| theme | Cake-day animation | `rsm.theme.cakeDay.enabled` | on | confetti, no sound |
| theme | Vote particle burst | `rsm.theme.voteBurst.enabled` | off | REL-style |
| theme | Background image | `rsm.theme.backgroundImage.url` | (empty) | local file or URL |
| theme | Background blur | `rsm.theme.backgroundBlur.value` | 0 | 0..40px |
| theme | Custom header logo | `rsm.theme.headerLogo.url` | (empty) | |
| theme | Font replacement | `rsm.theme.fontFamily.value` | (empty) | replace Helvetica stack |
| theme | Per-sub CSS allow/deny | `rsm.theme.subCssRules.json` | `[]` | JSON list |
| nav | Old-Reddit redirect | `rsm.nav.oldRedirect.enabled` | off | |
| nav | Host toggle pill | `rsm.nav.hostToggle.enabled` | on | button only |
| nav | Infinite scroll | `rsm.nav.infiniteScroll.enabled` | on | existing |
| nav | Continue thread inline | `rsm.nav.continueInline.enabled` | on | |
| nav | Comment navigator | `rsm.nav.commentNavigator.enabled` | on | buttons only, no shortcuts |
| nav | Scroll restore | `rsm.nav.scrollRestore.enabled` | on | per-permalink |
| nav | Scroll memory across reloads | `rsm.nav.scrollMemory.enabled` | off | LRU sessionStorage |
| nav | Thread minimap | `rsm.nav.threadMinimap.enabled` | off | |
| nav | Search filter persist | `rsm.nav.searchPersist.enabled` | on | |
| nav | Search dispatcher | `rsm.nav.searchDispatcher.enabled` | off | external engines optional |
| nav | Top-comments preview | `rsm.nav.topCommentsPreview.enabled` | off | API use |
| nav | Auto-refresh comments | `rsm.nav.autoRefreshComments.enabled` | off | backoff |
| nav | Floating scroll-to-top | `rsm.nav.scrollToTop.enabled` | off | bottom-right |
| nav | Sub shortcut bar | `rsm.nav.subShortcutBar.enabled` | off | configurable |
| nav | Logo link target | `rsm.nav.logoTarget` | frontpage | frontpage / r-all / custom |
| nav | Per-sub default sort | `rsm.nav.perSubSort.enabled` | off | local memory |
| filters | Subreddit filter | `rsm.filters.subreddit.enabled` | on | (existing) |
| filters | User filter | `rsm.filters.user.enabled` | off | local-only |
| filters | Domain filter | `rsm.filters.domain.enabled` | off | |
| filters | Keyword regex | `rsm.filters.keyword.enabled` | off | hide/dim/collapse |
| filters | Flair filter | `rsm.filters.flair.enabled` | off | |
| filters | Score threshold | `rsm.filters.score.enabled` | off | |
| filters | Promoted nuke | `rsm.filters.promoted.enabled` | on | DOM removal + count |
| filters | NSFW / spoiler hide | `rsm.filters.nsfwHide.enabled` | off | |
| filters | NSFW / spoiler unblur | `rsm.filters.nsfwUnblur.enabled` | off | mutex with hide |
| filters | Bot collapse | `rsm.filters.botCollapse.enabled` | off | AutoMod + configurable list |
| filters | Low-score collapse | `rsm.filters.lowScoreCollapse.enabled` | off | threshold |
| filters | Duplicate / crosspost map | `rsm.filters.duplicates.enabled` | off | /duplicates.json |
| filters | AI / bot prose signal | `rsm.filters.aiSignal.enabled` | off | local heuristics |
| filters | Stylometry profile | `rsm.filters.stylometry.enabled` | off | IDB cache |
| filters | Karma-farm detector | `rsm.filters.karmaFarm.enabled` | off | |
| filters | Ragebait classifier | `rsm.filters.ragebait.enabled` | off | title patterns |
| filters | Per-sub muting | `rsm.filters.perSubMute.enabled` | off | mute X only in sub Y |
| filters | URL-substring block | `rsm.filters.urlSubstring.enabled` | off | affiliate patterns |
| media | Inline images | `rsm.media.inlineImages.enabled` | on | existing |
| media | Inline videos | `rsm.media.inlineVideos.enabled` | on | existing |
| media | Post media toggle | `rsm.media.posts.enabled` | on | |
| media | Comment media toggle | `rsm.media.comments.enabled` | on | community-requested split |
| media | Full-height images | `rsm.media.fullHeight.enabled` | off | |
| media | Overlay viewer | `rsm.media.overlay.enabled` | off | Esc / click-out to close |
| media | Native video controls | `rsm.media.nativeVideo.enabled` | on | |
| media | Download buttons | `rsm.media.downloadButtons.enabled` | on | existing |
| media | DASH mux | `rsm.media.dashMux.enabled` | off | wasm or local-companion |
| media | Gallery ZIP | `rsm.media.galleryZip.enabled` | off | downloads permission |
| media | Hover zoom | `rsm.media.hoverZoom.enabled` | off | image + video |
| media | Drag-resize expandos | `rsm.media.dragResize.enabled` | off | |
| media | RedGifs v3 | `rsm.media.redgifsV3.enabled` | on | |
| media | Search gallery carousel | `rsm.media.searchGallery.enabled` | off | search pages |
| media | Inline tweet / BlueSky / Nitter | `rsm.media.socialEmbeds.enabled` | off | optional hosts |
| media | Display-direct image | `rsm.media.directImage.enabled` | off | skip Reddit viewer |
| media | Imgur album flatten | `rsm.media.imgurAlbumFlatten.enabled` | off | rimgo routing |
| media | GIF → WebM transcode | `rsm.media.gifWebm.enabled` | off | wasm |
| moderation | Workbench (parent) | `rsm.moderation.workbench.enabled` | off | gates all below |
| moderation | Modbar | `rsm.moderation.modbar.enabled` | off | sub-status, recent actions |
| moderation | Queue tools | `rsm.moderation.queueTools.enabled` | off | batch actions |
| moderation | Usernotes (wiki-versioned) | `rsm.moderation.usernotes.enabled` | off | Toolbox-compatible |
| moderation | Personal notes | `rsm.moderation.personalNotes.enabled` | off | local |
| moderation | Removal reasons | `rsm.moderation.removalReasons.enabled` | off | write endpoint |
| moderation | Ban / mute macros | `rsm.moderation.banMacros.enabled` | off | write endpoint |
| moderation | ModMail Pro | `rsm.moderation.modmailPro.enabled` | off | threaded view, macros, snippets, search |
| moderation | Mod action log viewer | `rsm.moderation.actionLog.enabled` | off | |
| moderation | Comment nuke + undo | `rsm.moderation.commentNuke.enabled` | off | toast-undo window |
| moderation | AutoMod editor | `rsm.moderation.automodEditor.enabled` | off | wiki edit |
| moderation | CSS syntax highlighter | `rsm.moderation.cssHighlighter.enabled` | off | |
| moderation | Spam button | `rsm.moderation.spamButton.enabled` | off | |
| moderation | Domain history | `rsm.moderation.domainHistory.enabled` | off | |
| moderation | User history analyser | `rsm.moderation.userHistory.enabled` | off | |
| moderation | In-thread mod-action log | `rsm.moderation.inThreadModLog.enabled` | off | Reveddit-style |
| privacy | Outbound cleanser | `rsm.privacy.outboundCleanser.enabled` | on | |
| privacy | Event-tracker sabotage | `rsm.privacy.eventSabotage.enabled` | on | |
| privacy | App prompt killer | `rsm.privacy.appPromptKiller.enabled` | on | |
| privacy | Age / NSFW bypass | `rsm.privacy.ageBypass.enabled` | off | opt-in |
| privacy | Alt-frontend redirect | `rsm.privacy.altFrontends.enabled` | off | per service |
| privacy | Username hider | `rsm.privacy.usernameHider.enabled` | off | |
| privacy | Cookie banner kill | `rsm.privacy.cookieBanner.enabled` | on | |
| privacy | Reddit ads opt-out | `rsm.privacy.adsOptOut.enabled` | off | one-click via prefs API |
| data | Comment-tree export | `rsm.data.commentExport.enabled` | off | JSON / MD / HTML |
| data | Saved-content backup | `rsm.data.savedBackup.enabled` | off | API use |
| data | Vote / read history | `rsm.data.historyLog.enabled` | off | local IDB |
| data | Filters import/export | `rsm.data.filterBackup.enabled` | on | JSON |
| data | Media archive manifest | `rsm.data.mediaManifest.enabled` | off | sha256 |
| archive | Arctic Shift | `rsm.archive.arcticShift.enabled` | off | external |
| archive | PullPush | `rsm.archive.pullpush.enabled` | off | external |
| archive | Wayback | `rsm.archive.wayback.enabled` | off | external |
| archive | archive.today | `rsm.archive.archiveToday.enabled` | off | external |
| archive | Snapshot-now button | `rsm.archive.snapshotNow.enabled` | off | requires Wayback |
| archive | Removed-content badge | `rsm.archive.removedBadge.enabled` | off | inline |
| author | Age + karma badge | `rsm.author.ageKarmaBadge.enabled` | off | rate-limited |
| author | Granular timestamps | `rsm.author.granularTimestamps.enabled` | on | tooltip |
| author | Username hover card | `rsm.author.hoverCard.enabled` | on | existing `hover` |
| author | User tags + colours | `rsm.author.userTags.enabled` | off | local-only |
| author | Per-user vote-weight log | `rsm.author.voteWeight.enabled` | off | IDB |
| author | Shadowban detector | `rsm.author.shadowbanDetector.enabled` | off | api delta |
| author | OP context sidebar | `rsm.author.opContext.enabled` | off | Redbar-style widget |
| author | Account history score | `rsm.author.historyScore.enabled` | off | api summary |
| author | AutoMod authorship | `rsm.author.automodAttribution.enabled` | off | |
| a11y | Reduced motion | `rsm.a11y.reducedMotion.enabled` | auto | mirror OS |
| a11y | Contrast guard | `rsm.a11y.contrastGuard.enabled` | on | token tests |
| a11y | Font size | `rsm.a11y.fontSize.value` | default | slider |
| a11y | Dyslexia-readable font | `rsm.a11y.dyslexiaFont.enabled` | off | |
| a11y | High-contrast outline | `rsm.a11y.highContrast.enabled` | off | |
| integrations | Reddit prefs API | `rsm.integrations.prefsApi.enabled` | off | one-click toggles |
| integrations | Cobalt | `rsm.integrations.cobalt.enabled` | off | external |
| integrations | Local companion | `rsm.integrations.localCompanion.enabled` | off | localhost only |
| integrations | Ollama (local LLM) | `rsm.integrations.ollama.enabled` | off | localhost only |
| integrations | KarmaDecay | `rsm.integrations.karmaDecay.enabled` | off | reverse-image link |
| qol | Markdown toolbar + preview | `rsm.qol.markdownToolbar.enabled` | on | no shortcuts |
| qol | Copy code block | `rsm.qol.copyCode.enabled` | on | toast |
| qol | Comment draft restore | `rsm.qol.commentDrafts.enabled` | on | local |
| qol | Default sort | `rsm.qol.defaultSort.enabled` | off | per-sub |
| qol | Auto-translate disable | `rsm.qol.disableAutoTranslate.enabled` | on | if detected |
| qol | Subscriber counts restore | `rsm.qol.memberCounts.enabled` | on | existing |
| qol | Base64 decoder | `rsm.qol.base64Decoder.enabled` | off | |
| qol | Banned banner removal | `rsm.qol.bannedBannerRemoval.enabled` | off | |
| qol | Login autofill repair | `rsm.qol.loginAutofillRepair.enabled` | off | |
| qol | Sub topic auto-tagging | `rsm.qol.subTopicTagging.enabled` | off | from rules + flairs |
| qol | r/place template overlay | `rsm.qol.rplaceOverlay.enabled` | off | gated |
| qol | AI thread summary | `rsm.qol.aiThreadSummary.enabled` | off | Ollama-only |
| qol | Linked-article TLDR | `rsm.qol.articleTldr.enabled` | off | Ollama-only |
| power | Own-history sweep | `rsm.power.historySweep.enabled` | off | overwrite-then-delete + undo |
| power | Bulk hide / unhide | `rsm.power.bulkHide.enabled` | off | API queue |
| power | Saved-content bulk download | `rsm.power.savedDownload.enabled` | off | |

---

## Phased Build Plan

Each phase must ship a usable product slice and update `README.md`, `CHANGELOG.md`, repo `CLAUDE.md`, the memory file, version strings, and ROADMAP checkboxes on landing. Acceptance criteria gate the phase bump.

### v0.5.0 — Core Engine and Capture Contracts ✅ shipped 2026-05-19

- ✅ Feature registry with `init()` / `destroy()`.
- ✅ Settings schema, defaults, migration layer.
- ✅ Selector map (stable + fallback) + MHTML fixtures.
- ✅ TrustedTypes helper + policy.
- ✅ Toast host + local error log.
- ✅ Document-start anti-FOUC OLED class.
- ✅ Acceptance: every migrated feature toggles cleanly, selector tests green, immediate apply, inactive overlay `pointer-events: none`, no keyboard shortcuts, no primary-class dependence.

### v0.6.0 — Settings Panel and Dark/OLED Design System ✅ shipped 2026-05-19

- ✅ Settings categories rebuilt from schema.
- ✅ OLED default + 4 alternate presets.
- ✅ Dense mode, branded scrollbar, reduced-motion override.
- ✅ Settings search/filter, JSON import/export with unknown-key preservation.
- ✅ Toast feedback wired into every preference change path.
- ✅ WCAG AA contrast contract green across all themes.
- ✅ Acceptance: no light theme, contrast tests pass, motion override works, snapshot round-trips.

### v0.7.0 — Privacy, Redirect, Anti-Promo Suite ✅ shipped 2026-05-19

- ✅ `removePromoted`, `outboundCleanser`, `eventTrackingSabotage`, `frictionRemovers`, `oldRedditRedirect`, `hideUsername`.
- ✅ Pure helpers extracted (`lib/utils/outboundCleanser.js`).
- ✅ Privacy URL snapshot reviewed.
- ✅ Acceptance: no new external network call in defaults, redirect disable is immediate, promoted count surfaced.

### v0.8.0 — Navigation and Comment Workflow ✅ shipped 2026-05-19

- ✅ `continueThreadInline`, `scrollRestore`, `threadMinimap`, `searchFilterPersist`, `searchDispatcher`, `topCommentsPreview`, `autoRefreshComments`.
- ✅ `lib/utils/rateLimiter.js` token bucket shared by polling modules.
- ✅ Acceptance: observers process added nodes only, API calls cached + rate-limited, continue-thread reversible, minimap doesn't block scroll.

### v0.9.0 — Theming and Layout Superset ✅ shipped 2026-05-19

- ✅ `layoutTweaks` (full-width, hide-sidebar, post-numbers, hide-awards/flair/link-flair/avatars).
- ✅ `commentDepthColors` HSL stripe per depth + saturation + max-depth knobs.
- ⏳ Multi-column feed → moved to v0.10.x.
- ⏳ OP/admin/mod/friend highlight refresh → moved to v0.10.x.
- ⏳ Per-sub custom-style override → moved to v0.10.x.
- ✅ Acceptance: all layout toggles per-page + reversible, no nested cards, no pill backdrops, sub-CSS cannot permanently hide settings.

### v0.10.0 — Filters: Foundation ✅ shipped 2026-05-19

- ✅ `lib/utils/filterRules.js` pure schema + evaluator (7 fields × 5 ops × 4 actions, optional target).
- ✅ `lib/modules/filterRules.js` wires into `watchForThings` (added nodes only).
- ✅ Regex fail-closed; JSON round-trip via settings snapshot.
- ✅ Acceptance: no full-thread rescans, evaluator pure + test-contracted, schema flows through import/export.

### v0.10.x — Filter Consumers + Layout Tail (next, in flight)

Single minor stream layering the consumers on the v0.10 foundation. Each lands as a patch (v0.10.1, v0.10.2, ...). All `Build` rows from the matrix labelled v0.10.x:

- ✅ **v0.10.1 — Local user tagger.** Persistent JSON list of `{user, color, tag, ignore}` records. Inline tag badge on every `.author`. `lib/modules/userTagger.js` + pure helpers `lib/utils/userTags.js`. Popover editor (click the `+` next to an author). Storage via `Storage.wrapBlob('RESmodules.userTagger.tags', ...)`. JSON import-merge on contentStart. 12-assertion contract test. Test count: 163.
- ✅ **v0.10.2 — Bot collapse / AutoMod attribution.** New `botCollapse` module with editable list of 20 default bots. Click-based collapse triggers reddit's native one-line stub; `[reveal]` toggle bypasses per-comment. AutoMod stickies get an orange badge, other bots a slate badge. Pure helpers in `lib/utils/botList.js`. 8-assertion contract test. Test count: 171.
- ✅ **v0.10.3 — Duplicate / crosspost map.** New `crosspostMap` module. Hits `/duplicates/<id>.json` behind a dedicated 2-token / 1.5s rate limiter; cached per article ID. Inline widget injected after `#siteTable` on comments pages. Pure helpers in `lib/utils/crosspostMap.js`. 7-assertion contract test. Test count: 178.
- ✅ **v0.10.4 — Author context badge.** New `authorContextBadge` module. Inline `[age · karma]` chip after every `.author`. `/user/<u>/about.json` behind a dedicated 5-token/1s rate limiter, 2 concurrent max. `Storage.wrapBlob` cache with configurable TTL (default 24h). Optional age-risk colour bands. 10-assertion contract test. Test count: 188.
- ✅ **v0.10.5 — OP/admin/mod/friend highlight refresh.** New `roleHighlights` module. Body-class-gated CSS lanes (`rsm-role-op/mod/admin/friend`); per-role colour pickers, optional backdrop-tint left stripe (`:has()`), optional animated role-flair shimmer with reduced-motion guard. Style mounted at `beforeLoad` to avoid first-paint flash. 7-assertion contract test. Test count: 195.
- ✅ **v0.10.6 — Per-sub default sort memory.** New `perSubSort` module. `Storage.wrapBlob` keyed by sub. Redirect at `beforeLoad` on bare `/r/<sub>/` URLs. Inline `★ remember sort` button next to the tabmenu. Pure helpers in `lib/utils/perSubSort.js`. 9-assertion contract test. Test count: 204.
- ✅ **v0.10.7 — Multi-column feed.** New `multiColumnFeed` module. CSS-grid layout for `#siteTable.linklisting` at 2/3/4 columns. Non-thing children span row; self-text option, full-width option. Scoped to `isPageType('linklist')`. 7-assertion contract test. Test count: 211.
- ✅ **v0.10.8 — Per-sub CSS allow/deny.** New `perSubCss` module with three modes (allow-all/deny-all/per-list). Pure helpers in `lib/utils/perSubCss.js`. Same strip mechanic + mutation observer as `disableSubredditStyles`. Mutually exclusive with that hard-kill. 7-assertion contract test. Test count: 218.
- ✅ **v0.10.9 + v0.10.10 — `scopedFilters` module.** Combined the two filter extensions. Per-sub muting via `user|sub` syntax (with `*` wildcard); URL substring block matches against post URL, domain, title link, and comment-body anchors. Pure helpers in `lib/utils/scopedFilters.js`. 6-assertion contract test. Test count: 224.
- ✅ **v0.10.11 — A11y triple.** New `a11yTriple` module bundles font-size scaling (100/110/125/140), dyslexia-readable font swap (OpenDyslexic/Atkinson Hyperlegible/Lexend/System UI, must be installed locally — never downloaded), and a collapsible sidebar rail with `prefers-reduced-motion` guard. 7-assertion contract test. **v0.10.x patch series complete: 10 modules + 80 new assertions on top of v0.10.0. Test count: 231.**

Acceptance for the v0.10.x stream: every consumer extends the existing schema, every new module has a contract test, no full-thread rescans, all settings round-trip through snapshot export/import.

### v0.11.0 — Media and Downloads (planned)

Features:

- ✅ **v0.11.12 — Post / comment media toggle split.** New `mediaScopeToggle` module. Body-class-gated CSS for `rsm-mediaScope-noPosts` / `rsm-mediaScope-noComments` / `rsm-mediaScope-noThumb`. `collapseLoadedExpando` + watchForThings handle late-init expandos. 7-assertion contract test. Test count: 310.
- ✅ **v0.11.8 — Full-height images + overlay viewer.** New `overlayViewer` module. ARIA-modal lightbox for images inside expandos / selftext / comment bodies. Esc + outside-click + close-button close paths. Modifier-key clicks bypass to preserve "open in new tab". Configurable backdrop opacity. 7-assertion contract test. Test count: 281.
- Native video controls (where safe).
- Download buttons extended to gallery + audio + DASH.
- **v.redd.it DASH mux** via `ffmpeg.wasm` lazy-load OR optional local companion (chosen per-asset).
- ✅ **v0.11.6 — Gallery ZIP export.** New `galleryZip` module. Lazy-load JSZip via `import('jszip')`. Pure helpers parse `gallery_data` + `media_metadata`. Captions sidecar. Per-image failure resilience. 6-assertion contract test. Test count: 268.
- ✅ **v0.11.3 — Hover zoom preview.** New `hoverZoom` module for direct image/video URLs. Pure helpers in `lib/utils/hoverZoom.js` with viewport-aware positioning. Host-brokered embeds stay with `showImages`. 7-assertion contract test. Test count: 250.
- ✅ **v0.11.4 — Drag-to-resize expandos.** New `dragResize` module; pointer-capture-based drag handle on inline media; sizes persisted per data-domain via `Storage.wrapBlob`. Pure helpers (clampSize, applyAspectRatio, computeNextSize with dominant-axis lock). 6-assertion contract test. Test count: 256.
- ✅ **v0.11.2 — RedGifs v3 layout fix.** New `redgifsLayoutFix` module; body-class CSS + observer-driven param rewrites (controls/autoplay/related). 6-assertion contract test. Test count: 243.
- ✅ **v0.11.7 — Inline search-result gallery carousel.** New `searchGallery` module; reuses `parseGalleryFromJson`; IntersectionObserver-gated fetches with 300px rootMargin; non-gallery image-post fallback via `preview.images[0].source.url`. 6-assertion contract test. Test count: 274.
- ✅ **v0.11.11 — Mastodon + Threads expandos.** New `mastodon.js` (federated oembed for 7 known instances) + `threads.js` (Meta `/embed/` iframe) host handlers. Closes RES PR #5560 for Mastodon/Threads. BlueSky / Twitter already shipped. 8-assertion contract test. Test count: 303.
- Display-direct image (skip Reddit viewer chrome).
- ✅ **v0.11.5 — Imgur album flatten.** New `imgurFlatten` module; rewrites imgur `/a/<id>` and `/gallery/<id>` through a configurable rimgo mirror. Pure helpers in `lib/utils/imgurFlatten.js`. 6-assertion contract test. Test count: 262.
- GIF → WebM client-side transcode for files >N MB (wasm).
- ✅ **v0.11.9 — Cobalt API bridge.** New `cobaltDownloader` module. Pure helpers in `lib/utils/cobalt.js` (DEFAULT_HOSTS × 20, isCobaltEligible, parseHostList, buildRequestBody, sanitizeInstance, looksLikeStreamUrl). Strictly opt-in click-only. Configurable instance for self-hosted deployments. 7-assertion contract test. Test count: 288.
- ✅ **v0.11.10 — Local-companion bridge.** New `localCompanion` module. Localhost-only URL validation (`127.0.0.1` / `localhost` / `[::1]` only). Pure helpers in `lib/utils/localCompanion.js`. Health-badge pill in userbar. 7-assertion contract test. Test count: 295.

Acceptance:

- All existing showImages host tests stay green.
- Download features degrade to "open source" when permissions missing.
- External media APIs never run by default.
- Hover zoom respects RedGifs rate limit; doesn't fire on Tab focus.
- Drag-resize persists per-host preference.
- Destroying a media feature removes all injected buttons / overlays / handlers.
- New contract tests for: dash-mux, gallery-zip, hover-zoom, drag-resize, social-embeds, search-gallery, imgur-flatten, gif-webm.

### v0.12.0 — Archival, Recovery, and Export (planned)

Features:

- **Arctic Shift** as the primary deleted-content restoration source (replaces broken Pushshift dependence).
- PullPush as legacy fallback.
- Wayback / archive.today fallback chain.
- Snapshot-now button (push current page to Wayback).
- Removed-content badge with provenance (source + timestamp + restoration latency).
- Comment-tree export: JSON (full fidelity), Markdown (human-readable), HTML (offline-viewable).
- Saved-content backup (paginate `/user/<me>/saved` + dump).
- Vote / read history local log (IDB schema versioned; per-vote: fullname, score-at-time, sub, timestamp, snippet).
- Media archive manifest (URL + sha256 + post permalink + downloaded timestamp).
- Local-first own-saved archival (every saved post snapshotted to IDB + optional file dump).

Acceptance:

- Every external archive source is opt-in and rate-limited (Arctic Shift 0.5/s, Wayback 0.2/s).
- Exports include schema/version metadata.
- Restore views label source + timestamp visibly.
- IDB schema documented + migratable.
- New contract tests for: arctic-shift, wayback, archive-today, snapshot-now, comment-tree-export, saved-backup, vote-history-log, media-manifest.

### v0.13.0 — Moderator Workbench (planned — Toolbox successor)

**Strategic priority:** Moderator Toolbox was archived 2026-03-04. This phase delivers a Toolbox-compatible successor as an optional category gated behind `rsm.moderation.workbench.enabled`. Toolbox-compatible means it reads and writes the same usernotes wiki schema (versioned JSON in `/r/<sub>/wiki/usernotes`) so subs migrating from Toolbox lose nothing.

Features:

- Modbar (sub-status, recent actions, per-sub config, version badge).
- Queue tools (modqueue / unmoderated / reports / spam — batch actions with toast-undo where possible).
- **Usernotes** wiki-versioned JSON (Toolbox-compatible read + write).
- Personal notes (local).
- Removal reasons (template-driven, configurable per-sub).
- Ban / mute macros (template + macro library).
- **ModMail Pro** — threaded view, macros, snippets, search.
- Mod action log viewer (combined Reveddit-real-time + own-sub log).
- Comment nuke (remove subtree; 30s undo toast).
- AutoModerator config editor (wiki edit with CSS-style highlight).
- CSS syntax highlighter (sub `stylesheet` page).
- Spam button.
- Domain history tracker.
- User history analyser.
- In-thread mod-action log feed (real-time push from Reveddit endpoint).
- Reddit prefs API one-click toggles (personalisation, ad partners, sensitive ads).
- Alt-frontend redirect (Nitter / Libreddit / Redlib) optional.
- Power-Delete-Suite-style own-history sweep (multi-sort × multi-timeframe; overwrite-then-delete; undo via toast within window).
- Bulk hide / unhide.

Acceptance:

- Entire category defaults off; parent toggle gates everything.
- Write actions require explicit permissions + immediate toast.
- Destructive actions provide undo where endpoint allows.
- Workbench never appears to non-mod users unless demo mode is enabled.
- Toolbox-compatible usernotes JSON round-trips (import + export tested).
- ModMail Pro composer routes through TrustedTypes.
- In-thread mod-log feed is rate-limited and never auto-polls without explicit enable.
- New contract tests for: modbar, queue-tools, usernotes-wiki, removal-reasons, ban-macros, modmail-pro, mod-action-log, comment-nuke-undo, automod-editor, css-highlighter, spam-button, domain-history, user-history, in-thread-modlog, prefs-api, alt-frontends, history-sweep, bulk-hide.

### v0.14.0 — Userscript Parity (planned)

Features:

- Single-file userscript bundle (`dist/userscript/res-slim-max.user.js`).
- GM storage adapter (`GM_getValue` / `GM_setValue`).
- GM style adapter (`GM_addStyle`).
- GM fetch / download adapter (`GM_xmlhttpRequest` / `GM_download`).
- Portable subset settings (extension-only features marked disabled with concise reason).
- Build artifact + install metadata header.
- Per-host `@grant` declarations.
- `@updateURL` / `@downloadURL` pointing at the GitHub raw URL.
- `@require` for any vendored helpers that survive single-file (lodash-es bundled inline; jQuery only if needed).

Acceptance:

- Installs in Violentmonkey and Tampermonkey.
- Core theming, filters, navigation, non-privileged media features work.
- Extension-only features (DNR, background queue, downloads, mod writes) visible as disabled with reason.
- Userscript has no build-time dependency on extension-only globals.
- `@version` syncs to package.json on build.
- New contract test: userscript-build-contract (loads the file in a sandbox and checks GM API usage + grants).

### v0.15.0 — Reliability, CI, Release Pipeline (planned)

Features:

- GitHub Actions: `yarn lint`, `yarn test`, `yarn build` for chrome + firefox + userscript.
- Bundle budget contract (extension < 1.5 MB unpacked, userscript < 600 KB).
- Secret scan contract.
- Visual smoke screenshots (settings panel + two captured surfaces) regenerated on UI change.
- Error log panel polish (filter, export, clear).
- README rewritten as user-facing deliverable with: feature catalogue, install paths (load-unpacked ZIP + CRX + userscript), privacy promises, screenshots.
- CRX3 packer wired to release workflow.
- Per-release SHA256SUMS emitted.

Acceptance:

- `yarn test` + `yarn lint` + both builds + userscript build green in CI.
- Release artifact hashes emitted in release notes.
- README covers extension and userscript install paths.
- No unreviewed network origin enters the privacy snapshot.
- Branch protection enabled with `enforce_admins: true`.
- New contract test: ci-build-contract (parses workflow yaml + checks job graph).

### v0.16.0 — Author Intelligence and Anti-Manipulation (planned, new)

Features:

- Inline age + karma badge (rAger-style, NER-compatible).
- Granular timestamps (1y 11mo style; UTC tooltip).
- Per-user vote-weight log (every up/downvote we cast, IDB, sortable).
- Shadowban detector inline (cron-paced delta between `/about.json` and `/comments.json`).
- OP context sidebar widget (Redbar-style: OP karma / cake-day / sub recency).
- Account history score (karma breakdown, top subs, peak posting hours, recent controversy rate).
- AutoMod authorship attribution display.
- **Local AI / bot prose signal** (heuristics only — no model load): burstiness, contraction rate, em-dash density, "it's not X, it's Y", bullet-list fetish, opener-template patterns. 3-tier confidence outline (red / yellow / off).
- Stylometry profile (rolling 20-comment fingerprint cached in IDB per user; flag tight-cluster anomalies).
- Karma-farm detector (>70% crosspost/repost OR >50% template replies).
- Ragebait classifier (title-pattern grade).
- Karma hider (anti-anxiety; own karma masked).
- KarmaDecay reverse-image bookmarklet integration (right-click → search).
- Toxicity scoring **local only** (offline rule-set, not Perspective API). Privacy promise: never sends content off-host.

Acceptance:

- All scoring runs locally; no third-party send.
- Sliders for sensitivity (independent for AI vs bot, like Redd-Eye).
- Hovercard breaks down score signals.
- Can be fully disabled with immediate DOM cleanup.
- IDB schemas versioned + migratable.
- New contract tests for: age-karma-badge, granular-timestamps, vote-weight-log, shadowban-detector, op-context, history-score, ai-prose-signal, stylometry, karma-farm, ragebait, karma-hider, automod-attribution.

### v0.17.0 — Visual Power Suite (planned, new)

Features:

- Theme preset library (Catppuccin Mocha + Tokyo Night + Rose Pine + Gruvbox + Dracula + Nord + Solarized Dark + Synthwave + Kanagawa + Everforest + GitHub Dark + One Dark + OLED + Reddit Classic).
- Cake-day animation (confetti, no sound).
- Vote particle burst (REL-style; off by default for performance).
- Background image / wallpaper with blur slider.
- Custom header logo override.
- Font replacement (replace Helvetica stack with user-chosen system or web font).
- Custom accent picker with HSL slider + named token presets.
- Branded scrollbar with shimmer on active drag (toggle).
- Sub shortcut bar (configurable; persistent).
- Floating scroll-to-top button.
- Sticky sort widget (per-page).
- Compact / standard / spacious density (three-state, replaces binary).
- Hover lifts + staggered entrance refinements (driven by reduced-motion).
- Branded focus ring.

Acceptance:

- All visual features off by default except OLED + branded scrollbar.
- Background image is local-file-or-URL (URL only with explicit user input; no auto-fetch).
- Font replacement respects `font-display: swap`.
- Cake-day animation respects reduced-motion.
- All animations have spring-easing tokens not hard-coded.
- New contract tests for: theme-preset-library, cake-day, vote-burst, background-image, header-logo, font-replacement, accent-picker, density-three-state, sub-shortcut-bar, scroll-to-top, sticky-sort.

### v0.18.0 — Local Intelligence and Unmet Requests (planned, new)

Features:

- **Markdown toolbar + live preview** (closes RES legacy gap; no shortcuts).
- Copy code block button (closes long-open RES request).
- Comment draft restore (per-form, local).
- Disable auto-translate.
- Base64 decoder in post / comment body.
- Banned-banner removal.
- Login autofill repair.
- Sub topic auto-tagging (parse `/r/<sub>/about/rules.json` + flairs into local tag chips).
- r/place template overlay (optional, gated).
- **Local LLM thread summary** via Ollama (opt-in, localhost-only, configurable model name).
- **Linked-article TLDR** via Ollama (opt-in, fetches article text through extension-permitted host, summarises locally).
- Time-of-day automatic dark mode toggle.
- Comment-actions-at-top of comment header option (closes RES PR #5515).
- "Mute expando video" toggle (closes RES PR #5500).
- Logo-target override (frontpage / r-all / custom).

Acceptance:

- Markdown toolbar has no keyboard shortcut wiring whatsoever.
- LLM features fully gated; default off; explicit health check on enable.
- Article TLDR uses a single host permission grant (one consented site fetcher).
- No external network call outside `*.reddit.com` + `*.redditstatic.com` + `127.0.0.1` in any default setting.
- r/place overlay respects sub rules + can be killed instantly.
- New contract tests for: markdown-toolbar, copy-code-block, comment-drafts, base64-decoder, banned-banner, login-autofill, sub-topic-tagging, rplace-overlay, ollama-thread-summary, ollama-article-tldr, auto-dark-time-of-day, comment-actions-top, mute-expando-video.

### v0.19.0 — Performance, Polish, Bug Bash (planned)

Features:

- Performance budget contracts: feed-paint < 80 ms, thread-paint < 120 ms, settings-open < 200 ms.
- Bundle analyser snapshot.
- WeakSet hygiene audit.
- Observer leak audit.
- Cleanup function audit (every module's `destroy()` exercised by an automated dry-run).
- Theme contrast re-audit with new presets.
- Selector contract re-run against fresh MHTML captures of every page kind (frontpage / thread / profile / search / wiki / submit / modqueue / messages / saved).
- Optional `chrome.declarativeNetRequest` migration for outboundCleanser (faster than capture-phase listeners).

Acceptance:

- Memory after 1h of browsing within +20 MB vs baseline.
- No detached DOM nodes after disable-all → enable-all cycle.
- All contract tests + lint + builds green.
- Fresh capture set committed to `tests/fixtures/mhtml/`.

### v1.0.0 — Beats Every Competitor

Final scope gate.

- All default-on safe features stable.
- All optional / external / moderator / destructive features documented and gated.
- Complete feature matrix implemented or each remaining row has a documented hard blocker.
- README + screenshots + changelog + release artifacts complete.
- Branch protection enforced.

Acceptance:

- Every feature has an automated destroy/lifecycle test or targeted manual QA checklist.
- Selector contracts pass against every captured surface.
- Extension build + userscript build both work.
- No light theme, no feature keyboard shortcuts, no confirmation dialogs, no telemetry, no pill backdrops anywhere in the project.
- User can disable any feature and see DOM cleanup immediately.
- Privacy URL snapshot reviewed by the user and signed off.
- CI green; release artifacts signed.
- Memory file + repo `CLAUDE.md` reflect v1.0.0.

---

## Settings Panel Spec

**Information architecture**

- Left category rail: Core · Theme · Navigation · Filters · Media · Moderation · Privacy · Data · Archive · Author · A11y · Integrations · Power · Quality of Life.
- Right pane: dense setting rows with icon, title, current state, inline controls.
- Top bar: search, profile selector, import / export, error log, reset-current-category.
- Bottom toast stack.

**Visual rules**

- Dark / OLED only.
- Glass-style elevated surfaces with restrained radii (≤ 12 px).
- Branded accent line, scrollbar, focus ring.
- Hover lifts + staggered entrances only when reduced-motion is off.
- Toggles are clear switch controls — never ambiguous pill labels.
- No instructional marketing text inside the app.
- No modal confirmation dialogs.

**Behaviour**

- Every toggle applies immediately.
- Toast reports `Enabled` / `Disabled` / `Imported` / `Exported` / `Reverted` / `Failed: <reason>`.
- Inactive overlay: `pointer-events: none`.
- Category reset applies immediately and shows an undo toast.
- External integrations show origin, permission, last failure, rate-limit state.
- Permission requests fire only on direct user action.
- Every settings row maps to one schema key.
- Search box matches title, description, category, key.
- "Modified only" filter chip shows rows that diverge from default.
- "Off" filter chip shows currently-disabled rows.
- Module-level enable/disable toggle in sidebar (not just right-pane) — single shared `toggleModuleEnabled(id)` code path.

---

## Risks and Open Questions

**DOM risks**

- Additional captures needed for: profile page, messages, search results, submit page, modqueue, wiki, Reddit-hosted media pages, saved-feed.
- Subreddit custom CSS can heavily alter `.side`, `.entry`, `.buttons` — selectors must self-heal.
- Media expandos have the highest churn (Reddit + host both vary).
- Reddit's `data-recommendation-source` attribute is *not currently populated* on old.reddit captures but pre-empt by filtering on it anyway.
- New/sh.reddit support requires separate selector maps + TrustedTypes validation.

**API and rate risks**

- Reddit API request limit (100 / 10 min) breaks uncached enrichment.
- Arctic Shift, PullPush, Wayback, archive.today, Cobalt, alt-frontends can change or disappear; each integration must surface `lastFailure` and degrade gracefully.
- Moderator write endpoints behave differently across old and newer Reddit — workbench writes must verify endpoint health before claiming success.

**Store-review risks**

- NSFW / age bypass, promoted removal, media download, moderation automation may trigger CWS or AMO review concerns.
- Keep controversial capabilities opt-in + documented.
- Userscript distribution carries more capability but less user trust — duplicate functionality so each artifact stays usable in isolation.
- Hover Zoom+ was delisted; modern hover-zoom needs careful permission model (image hosts only, no global capture).

**Legal / source risks**

- GPL-3.0 inheritance permits this repo's existing code but requires care when borrowing from scripts.
- Do **not** paste unlicensed or AGPL userscript code; reimplement from feature spec.
- MIT / BSD / Apache patterns OK with attribution; license noted in each module header where lifted.
- Toolbox is Apache-2.0 — compatible with GPL-3 + Apache cross.
- Sink It is proprietary; ideas only, no code lifting.
- Reddit Enhancer source visibility: confirm license file before lifting any code.

**Architecture risks**

- Legacy RES module shape resists clean `destroy()` migration in places; v0.5 fixed the registry but some kept modules still rely on go() patterns.
- Flow-era code + jQuery utilities complicate shared userscript / extension bundling.
- Heavy media muxing via wasm can bloat bundle size; prefer optional lazy loading or local companion.
- IDB schemas need migration plans; lock contract tests around shape.

**Open questions**

- Should moderator features be a separate extension package if store review becomes difficult? (Lean: same package, parent-gated.)
- Should external integrations be grouped behind a single "external services" parent switch? (Lean: per-service toggles with category-level master.)
- Should userscript be generated from the same source or a curated subset? (Lean: same source, build-flag-driven.)
- How much of legacy `filteReddit` should be restored versus rewritten around the new JSON schema? (Lean: rewrite; `caseBuilder.js` stays as utility for `commentNavigator`.)
- Which local-companion protocol for yt-dlp / ffmpeg / Ollama? (Lean: REST with explicit health check.)
- How to keep Toolbox usernotes wiki forward-compatible if the schema evolves? (Lean: schema-version field, refuse to write unknown versions.)
- Should AI / bot signal use a small local model (transformers.js) or pure heuristics? (Lean: heuristics v0.16, model deferred unless quality demands.)

---

## Definition of Done

`RES-Slim Max v1.0.0` beats every competitor when **all** of the following hold:

- Covers the union of RES + Reddit Enhancer + REL + Sink It + Moderator Toolbox (read+write parity) + Reveddit Real-Time + Reddit Uncensored + Power Delete Suite + Redd-Eye + Old Reddit Redirect + Reddit Comment Collapser + Photon Reddit ideas + Hover Zoom+ pattern + Custom Top Sort + every notable Greasy Fork / OpenUserJS utility + every notable userstyle pattern + every unmet community request the matrix labels `R` or `Plan`.
- Every feature governed by the settings schema and toggleable immediately.
- Every feature has a complete `destroy()` path verified by automated test or manual QA.
- Default experience is premium dark / OLED, dense, fast, accessible, old-Reddit-native.
- No telemetry. No light theme. No keyboard shortcuts. No confirmation dialogs. No pill / oval / stadium-shape backdrops.
- External services are opt-in, visibly labelled, rate-limited, with surfaced last-failure state.
- MHTML selector contracts protect every page-kind surface.
- CI validates: tests, lint, builds, bundle size, privacy origins, selector contracts, settings schema, userscript-build contract.
- MV3 extension + Firefox MV2 extension + userscript all build and install.
- `README.md` updated as build deliverable: install paths, feature catalogue, privacy promises, screenshot set.
- Branch protection on main with `enforce_admins: true`.
- Repo `CLAUDE.md`, memory file, `CHANGELOG.md`, all version strings, and ROADMAP.md checkboxes synced.

---

## Source Index

### Local

- `README.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `RESEARCH-FINDINGS.md`
- `package.json`
- `chrome/manifest.json` · `firefox/manifest.json`
- `lib/modules/index.js` · `lib/modules/hosts/index.js`
- `lib/core/registry/featureRegistry.js`
- `lib/core/settings/{schema,defaults,migrations}.js`
- `lib/core/options/{snapshot,stage}.js`
- `lib/core/dom/{selectors,findElement,waitForElement,thingProcessor,trustedHtml,toastHost}.js`
- `lib/core/theme/{settingsThemePresets,antiFouc}.js`
- `lib/utils/{rateLimiter,filterRules,outboundCleanser,watchers,pagePhases}.js`
- `lib/environment/foreground/ajax.js` · `lib/environment/background/{ajax,download,messaging,permissions}.js`
- `lib/options/{options.scss,settingsConsole.js,templates.js}`
- `tests/unit/*.test.mjs` (32 suites today)
- `tests/fixtures/mhtml/{frontpage,thread}.html`
- `.research/mhtml-selector-map.md` (decoded MHTML report)
- `.research/parts/{home,comments}/` (decoded MHTML parts + `decode_mhtml.py`)

### Competitive (full list of 156 surveyed tools in the research run; canonical baselines below)

- Reddit Enhancement Suite — https://github.com/honestbleeps/Reddit-Enhancement-Suite
- Reddit Enhancement Continued (REL) — https://github.com/SysAdminDoc/Reddit-Enhancement-Continued
- Reddit Enhancer (joelacus) — https://github.com/joelacus/RedditEnhancer
- Sink It for Reddit — https://chromewebstore.google.com/detail/sink-it-for-reddit/cjkclcbbldkmaifjlbnjlpkfigpeckkg
- Old Reddit Redirect (tom-james-watson) — https://github.com/tom-james-watson/old-reddit-redirect
- Reddit Comment Collapser — https://github.com/tom-james-watson/reddit-comment-collapser
- Moderator Toolbox for Reddit — https://github.com/toolbox-team/reddit-moderator-toolbox
- Reveddit Real-Time — https://github.com/reveddit (FF: https://addons.mozilla.org/en-US/firefox/addon/reveddit-real-time/ · Chrome: https://chromewebstore.google.com/detail/reveddit-real-time/ickfhlplfbipnfahjbeongebnmojbnhm)
- Reddit Uncensored (Fubs) — https://github.com/Fubs/reddit-uncensored
- Power Delete Suite (j0be) — https://github.com/j0be/PowerDeleteSuite
- Reddit AI BotBuster / Redd-Eye (RootThePlanet) — https://github.com/RootThePlanet/Reddit_AI_BotBuster
- Custom Top Sort (arvidsandin) — https://github.com/arvidsandin/custom-top-sort-for-reddit
- Unedit and Undelete (DenverCoder1) — https://github.com/DenverCoder1/unedit-for-reddit
- reddit-comment-highlights (aesy) — https://github.com/aesy/reddit-comment-highlights
- Reddit Plus (noplanman) — https://github.com/noplanman/Reddit-Plus
- Photon Reddit — https://photon-reddit.com/
- Hover Zoom+ — https://github.com/extesy/hoverzoom
- Reddit Redux — https://chromewebstore.google.com/detail/reddit-redux/fkolapbngadmcfanajioddpjlaglakem
- Reddit Insights — https://chromewebstore.google.com/detail/reddit-insights/oehlhkdmigpcpcjkpfklbmnppiddhgfi
- rAger (rDevCoder) — https://chrome.google.com/webstore/detail/rager/fohlpjahcdbkpcckapphhpahbiajccmj · https://gitlab.com/rDevCoder/rAger
- Redbar (Sidebar for Reddit) — https://chromewebstore.google.com/detail/redbar-sidebar-for-reddit/gkclfabkdcgimggblodknofgkigbfcid
- Reddit Comment Exporter — https://chromewebstore.google.com/detail/reddit-comment-exporter/mhophmekcaellddobbhpnagdanpplghb
- KarmaDecay browser tools — http://karmadecay.com/browser-tools
- Greasy Fork — Reddit user scripts (by total installs) — https://greasyfork.org/en/scripts/by-site/reddit.com?sort=total_installs
- Greasy Fork — Reddit user scripts (by daily installs) — https://greasyfork.org/en/scripts/by-site/reddit.com?sort=daily_installs
- OpenUserJS — Reddit user scripts — https://openuserjs.org/?q=reddit
- Catppuccin for Reddit (userstyle hub) — https://userstyles.catppuccin.com/

### Decoded MHTML inputs (this repo)

- `reddit_ the front page of the internet.mhtml` — logged-in homepage `/` (captured 2026-05-19 09:54:55 −0400)
- `This has to stop, They are taking our limits with each free limit resets _ codex.mhtml` — comments page `/r/codex/comments/1th66mb/...` (captured 2026-05-19 09:55:09 −0400)
- Decoded report — `.research/mhtml-selector-map.md`
