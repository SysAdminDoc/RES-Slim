# Changelog

All notable changes to RES-Slim will be documented in this file.

## v0.10.1 - 2026-05-22

- New `userTagger` module — local-only user tagging with free-text label, hex colour, and ignore flag.
- Click the `+` button next to any username to open the popover editor; tags persist via `Storage.wrapBlob('RESmodules.userTagger.tags', ...)`.
- Pure helpers in `lib/utils/userTags.js`: `normalizeUsername`, `sanitizeTagText`, `sanitizeColor`, `normalizeTag`, `parseTagsJson`, `stringifyTags`, `mergeTags`, `tagBadgeText`.
- Disabled by default; opt-in via settings. Ignored users have their posts and comments hidden (toggleable).
- JSON import box merges into the store on next page load — round-trippable via the settings snapshot.
- New contract test `tests/unit/user-tagger-contract.test.mjs` — 12 assertions on the pure helpers + module registration + SCSS bundle wiring.
- Test count: 163.

## v0.10.0 - 2026-05-19

- Phase 10 foundation: JSON-backed filter builder (`filterRules` module + `lib/utils/filterRules.js`).
- Seven fields, five ops, four actions (hide/dim/collapse/badge), optional post/comment/both target.
- Pure helpers + regex fail-closed; unit test exercises every combination plus malformed JSON.
- Consumers (user tags, bot collapse, dup map, author context, AI prose signal, multi-column feed, OP/mod highlight) scheduled for v0.10.x patch series.
- Test count: 151.

## v0.9.0 - 2026-05-19

- Phase 9 Theming and Layout Superset.
- New `layoutTweaks` module: full-width, hide sidebar, post numbers, hide awards/flair/link-flair/avatars (single body-class-gated stylesheet).
- New `commentDepthColors` module: HSL stripe per comment depth, saturation + max-depth knobs.
- Multi-column feed, OP/admin/mod/friend highlight refresh, and per-sub custom-style override deferred to v0.10 alongside the filter builder.
- Test count: 144.

## v0.8.0 - 2026-05-19

- Phase 8 Navigation and Comment Workflow.
- New modules: continueThreadInline, scrollRestore, threadMinimap, searchFilterPersist, searchDispatcher, topCommentsPreview, autoRefreshComments.
- New `lib/utils/rateLimiter.js` token-bucket helper, shared by topCommentsPreview and autoRefreshComments.
- topCommentsPreview caches per (permalink, count) and pulls top comments via `.json?sort=top&depth=1`.
- autoRefreshComments runs an opt-in 30s -> 300s exponential backoff poll on /comments/ pages.
- threadMinimap paints a fixed depth/score heatmap rail with viewport tracking; pointer-events scoped so page scroll is unaffected.
- scrollRestore persists `window.scrollY` per pathname in an LRU; restores at contentStart (skipping if URL hash is set).
- searchFilterPersist remembers sort + time-window across /search.
- searchDispatcher offers Reddit / sub / Google / DuckDuckGo + custom targets.
- continueThreadInline splices the next slice of nested comments under the link.
- Test count: 138.

## v0.7.0 - 2026-05-19

- Phase 7 Privacy, Redirect, and Anti-Promo Suite.
- New modules: removePromoted, outboundCleanser, eventTrackingSabotage, frictionRemovers, oldRedditRedirect, hideUsername.
- Hide count badge for promoted posts in the page header.
- Outbound URL cleanser strips `out.reddit.com` wrappers and UTM/ref/share-id params on hover, click, copy, contextmenu, and focus.
- Event-tracking sabotage wraps `sendBeacon`, `fetch`, and `XMLHttpRequest` in the page world for Reddit's telemetry hosts and analytics paths.
- Auto-confirms `/over18` and `/quarantine` gates. Hides "use new Reddit" and "open in app" banners.
- Optional `www.reddit.com -> old.reddit.com` redirect (off by default) + always-on `old/www/sh` host toggle pill.
- Logged-in username + (optionally) karma replaced with a configurable placeholder for streaming/screen-share use.
- Privacy URL snapshot updated (reviewed) for the cleanser base URL.
- Test count: 95.

## v0.6.0 - 2026-05-19

- Consolidates Phase 5 (Core Engine + Capture Contracts) and Phase 6 (Settings Panel + Dark/OLED Design System) under one version bump.
- OLED is the default settings theme; presets centralised in `lib/core/theme/settingsThemePresets.js`.
- New header controls: density toggle, reduce-motion override, JSON Export, JSON Import.
- JSON import/export round-trips unknown future module IDs and option keys verbatim.
- Toast feedback for every preference change (theme, density, motion, module enable/disable, save, discard, import, export).
- Branded thin scrollbar scoped to the console container.
- New WCAG AA contrast contract tests covering all five themes (16 token pairs).
- Test count: 64.

## v0.4.0

- v0.4.0: rebuild the settings console with independent panel scrolling, search/staging/mobile fixes, disabled-module accessibility hardening, localization cleanup, right-panel toggle alignment repairs, and a roughly 50KB CSS reduction
- v0.3.9: rewrite nightwatch test fixtures for RES-Slim modules
- v0.3.8: settingsNavigation click handler and URL parser fixes
- v0.3.7: QA audit on v0.3.6 + second-look on v0.3.5 modules
- v0.3.6: settings console UX transformation
- pack-crx: auto-read version from package.json
- v0.3.5: QA audit pass
- v0.3.4: version bump + changelog for settings workspace refinement
- Refine settings workspace UX
- v0.3.3: fresh extension icon set
