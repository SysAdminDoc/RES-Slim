# Changelog

All notable changes to RES-Slim will be documented in this file.

## v0.12.4 - 2026-05-22

- New `savedBackup` module — paginates the logged-in user's `/user/<me>/saved.json` and downloads a single JSON file containing the entire saved list.
- Pure helpers in `lib/utils/savedBackup.js`: `parseSavedPage` (handles t1 + t3, falls back to selftext for posts), `buildSavedUrl` (URI-encoded username, limit clamp 1-100, optional `after` cursor), `mergeAndDedupe` (by fullname), `buildExport` (schema-versioned).
- Dedicated 2-token / 1.5s rate limiter so pagination doesn't burst.
- Inline "backup saved" link in the userbar (`#header-bottom-right`). Filename format `saved-<username>-<YYYY-MM-DD>.json`.
- Max 100 pages by default (10,000 items at 100/page) as a runaway safeguard.
- Disabled by default.
- New contract test `tests/unit/saved-backup-contract.test.mjs` — 6 assertions.
- Test count: 343.

## v0.12.3 - 2026-05-22

- New `commentTreeExport` module — export the current thread as JSON, Markdown, or HTML. Dropdown menu next to the sort dropdown on every comments page.
- Pure helpers in `lib/utils/commentTreeExport.js`: `parsePostFromListing`, `parseCommentsFromListing` (recursive walk with depth + parent tracking, skips `more` placeholders), `buildTree`, `toJson`, `toMarkdown`, `toHtml`.
- HTML output is a self-contained dark-themed page that opens offline. Escapes user content via HTML entity escapes.
- Markdown output uses `> ` indentation per depth so the tree shape is preserved in any Markdown viewer.
- Re-fetches the thread via `<permalink>.json?limit=500&depth=10` by default so the export includes comments that haven't yet loaded on screen.
- Disabled by default.
- New contract test `tests/unit/comment-tree-export-contract.test.mjs` — 10 assertions including HTML escape safety.
- Test count: 337.

## v0.12.2 - 2026-05-22

- New `waybackSnapshot` module — `archive` button on every post. Three modes: manual (open save in new tab), check (availability lookup + save if stale beyond N days), force (always save).
- Pure helpers in `lib/utils/wayback.js`: `SAVE_BASE`, `AVAILABILITY_BASE`, `buildSaveUrl`, `buildAvailabilityUrl`, `parseAvailabilityResponse`, `isWaybackUrl`, `formatTimestamp` (14-digit Wayback ts → ISO).
- Configurable target: permalink, linked URL (data-url), or both.
- Dedicated 3-token / 2s rate limiter so availability checks don't burst.
- Pairs with `archiveLinks` (links to existing snapshots) — this module CREATES snapshots.
- Disabled by default.
- New contract test `tests/unit/wayback-snapshot-contract.test.mjs` — 8 assertions.
- Test count: 327.

## v0.12.1 - 2026-05-22 — Phase 12 opens (Archival, Recovery, Export)

- New `arcticShift` module — restore `[removed]` / `[deleted]` comments inline via the Arctic Shift API. Successor path to the broken Pushshift dependency that crippled the legacy `viewDeleted` (pullpush) module.
- Pure helpers in `lib/utils/arcticShift.js`: `DEFAULT_INSTANCE`, `sanitizeInstance`, `buildCommentUrl`, `buildPostUrl`, `parseCommentResponse` (handles both `data` and `results` envelopes), `parsePostResponse`, `isDeletedBody`.
- Dedicated 3-token / 2s rate limiter (2 concurrent max).
- `autoLoad` (default off) with a configurable max-per-thread cap (default 25) to avoid hammering the archive.
- Inline render carries an "Arctic Shift" provenance pill so the restoration source is always visible.
- Pairs with `viewDeleted` (pullpush fallback) — both can be enabled at once.
- New contract test `tests/unit/arctic-shift-contract.test.mjs` — 9 assertions.
- Test count: 319.

## v0.11.12 - 2026-05-22

- New `mediaScopeToggle` module — independently disable inline media on posts only, on comments only, or both. Closes a long-running r/Enhancement request.
- Pure-CSS body-class scoping (`rsm-mediaScope-noPosts`, `rsm-mediaScope-noComments`, `rsm-mediaScope-noThumb`). Style mounts at `beforeLoad`.
- Optional `collapseLoadedExpando` snaps shut any already-open expando on the suppressed surface; `watchForThings` re-collapses late-initialising expandos from `showImages`.
- `keepThumbnail` (default on) preserves the small left-rail thumbnail even when post media is suppressed.
- Defaults: comments suppressed, posts not suppressed — the noisier surface is the comment tree. Module itself disabled by default.
- New contract test `tests/unit/media-scope-toggle-contract.test.mjs` — 7 assertions.
- Test count: 310.

## v0.11.11 - 2026-05-22

- New `mastodon` host handler — federated oembed expando. Detects `<instance>/@<user>/<id>` and `<instance>/users/<user>/statuses/<id>` URL shapes. Calls the post-instance's own `/api/oembed?url=...` and inlines the returned iframe HTML.
- Default permissions ship for 7 well-known instances: mastodon.social, mastodon.online, fosstodon.org, hachyderm.io, mas.to, infosec.exchange, mstdn.social. Niche servers can be added via the extension permissions surface.
- New `threads` host handler — meta.com/threads embed via the documented `/embed/` URL suffix. Pure iframe, no API calls. Supports both `threads.com` and `threads.net` domains.
- Closes RES PR #5560 for the Mastodon/Threads portion. BlueSky already had a handler since the v0.1.0 fork.
- New contract test `tests/unit/social-hosts-contract.test.mjs` — 8 assertions on URL pattern detection, permissions, embed URL construction, and failure-safe oembed.
- Test count: 303.

## v0.11.10 - 2026-05-22

- New `localCompanion` module — optional localhost-only bridge to a user-run helper that wraps yt-dlp, ffmpeg, and ollama. Adds a `local DL` button next to posts; a tiny health badge sits next to the userbar showing whether the companion is reachable.
- Pure helpers in `lib/utils/localCompanion.js`: `isLocalhostUrl` (matches 127.0.0.1 / localhost / [::1] with optional port + path), `sanitizeCompanionUrl` (rejects non-localhost), `buildHealthUrl`, `buildYtdlpUrl`, `buildOllamaUrl`, `parseHealth` (flat or nested `tools` shape), `buildYtdlpBody`.
- Strictly opt-in. Non-localhost URLs are rejected at runtime; the option silently reverts to the localhost default.
- Configurable yt-dlp format selector with sensible presets and an audio-only toggle.
- Disabled by default.
- New contract test `tests/unit/local-companion-contract.test.mjs` — 7 assertions.
- Test count: 295.

## v0.11.9 - 2026-05-22

- New `cobaltDownloader` module — optional Cobalt API bridge. Adds a `cobalt` button to posts on supported hosts (YouTube, TikTok, Twitter/X, BlueSky, Reddit, SoundCloud, Vimeo, Twitch, Streamable, Instagram, Bilibili, Tumblr, Pinterest, Facebook, Rumble, VK, Dailymotion, OK, Loom, Snapchat). Click POSTs the URL; the returned tunnel/redirect/stream/picker is downloaded.
- Pure helpers in `lib/utils/cobalt.js`: `DEFAULT_HOSTS` (20 hosts), `isCobaltEligible` (case-insensitive + suffix match), `parseHostList`, `buildRequestBody` (matches cobalt v10 schema), `sanitizeInstance`, `looksLikeStreamUrl`.
- Strictly opt-in: nothing fires without an explicit click. Instance URL is configurable for self-hosted cobalt deployments.
- Configurable video quality (360→2160p, max), audio format (best/mp3/opus/m4a/wav), download mode (auto/audio/mute).
- Picker responses (multi-asset hosts) trigger one download per item.
- Disabled by default.
- New contract test `tests/unit/cobalt-downloader-contract.test.mjs` — 7 assertions.
- Test count: 288.

## v0.11.8 - 2026-05-22

- New `overlayViewer` module — click any inline expanded image (post expando, selftext markdown, or comment body) to open a viewport-sized overlay viewer.
- Closes on Esc, click-outside, or the close button. ARIA-modal dialog with focus moved to close. No keyboard shortcuts beyond standard Esc / Tab cycle.
- Ctrl/Cmd/Shift/Alt-clicks bypass the overlay so "open original in new tab" still works.
- Backdrop opacity configurable (60/75/85/95%). Reduced-motion-aware (fade-in disabled).
- Selftext images and comment-body images are independently toggleable (default on).
- Disabled by default.
- New contract test `tests/unit/overlay-viewer-contract.test.mjs` — 7 assertions.
- Test count: 281.

## v0.11.7 - 2026-05-22

- New `searchGallery` module — inline thumbnail strip on `/search` result rows. Image posts get a single preview; gallery posts get a configurable strip (default 4, max 10).
- Reuses `lib/utils/galleryZip.js`'s `parseGalleryFromJson` plus a dedicated 2-token rate limiter (1.5s refill). Falls back to `preview.images[0].source.url` for non-gallery image posts, then to `url_overridden_by_dest` when the post is a direct media link.
- IntersectionObserver gates fetches to visible rows (default on) with a 300 px rootMargin so scrolling pre-loads a row ahead.
- Disabled by default. Strips scroll horizontally when wider than the row.
- Reduced-motion-aware (hover-lift transitions suppressed).
- New contract test `tests/unit/search-gallery-contract.test.mjs` — 6 assertions.
- Test count: 274.

## v0.11.6 - 2026-05-22

- New `galleryZip` module — `ZIP gallery` button next to gallery posts. Downloads every image plus a `captions.txt` sidecar in one archive.
- Pure helpers in `lib/utils/galleryZip.js`: `parseGalleryFromJson` (decodes `&amp;`, infers ext from MIME), `safeFilename`, `paddedIndex`, `formatCaptionsText`.
- Fetches `<permalink>.json?raw_json=1`, extracts `media_metadata` + `gallery_data.items`. Caps at 50 by default (configurable).
- JSZip loaded lazily via dynamic `import('jszip')` so it isn't bundled into the foreground content script until first use.
- Failures per-image fall back to a sidecar `.failed.txt` so partial archives still ship.
- New contract test `tests/unit/gallery-zip-contract.test.mjs` — 6 assertions.
- Test count: 268.

## v0.11.5 - 2026-05-22

- New `imgurFlatten` module — rewrite imgur `/a/<id>` and `/gallery/<id>` URLs through a configurable rimgo mirror so albums browse correctly after imgur paywalled the direct HTML in 2025.
- Pure helpers in `lib/utils/imgurFlatten.js`: `isImgurAlbumUrl`, `extractAlbumId`, `sanitizeMirror`, `rewriteAlbumUrl`, `rewriteImageUrl`.
- Default mirror: `https://rimgo.totaldarkness.net`. Users can swap to any rimgo-compatible instance (see `https://github.com/rimgo/instances`).
- Rewrites both the post title `href` and `data-url`/`data-domain` so downstream modules (showImages, downloadButtons, hoverZoom) follow the mirror.
- Only `/a/` and `/gallery/` URLs are touched — bare `i.imgur.com` direct uploads are untouched (handled by `directImage` / showImages).
- New contract test `tests/unit/imgur-flatten-contract.test.mjs` — 6 assertions.
- Test count: 262.

## v0.11.4 - 2026-05-22

- New `dragResize` module — bottom-right corner handle on inline expandos for image, video, and iframe content. Shift toggles the keepAspect default during a drag.
- Pure helpers in `lib/utils/dragResize.js`: `clampSize`, `applyAspectRatio`, `computeNextSize` (dominant-axis aspect lock).
- Sizes persist per host (data-domain) via `Storage.wrapBlob('RESmodules.dragResize.sizes', ...)`. Future expandos open at the saved size.
- Mutation observer re-attaches the handle when `showImages` flips `.expando-uninitialized` off.
- Pointer Events API + pointer capture so the drag survives the cursor leaving the handle. Reduced-motion-aware (handle has no animations).
- New contract test `tests/unit/drag-resize-contract.test.mjs` — 6 assertions.
- Test count: 256.

## v0.11.3 - 2026-05-22

- New `hoverZoom` module — hover preview popover for direct image/video links (jpg/png/gif/webp/mp4/webm/imgur gifv). Host-brokered embeds (gfycat, redgifs, youtube) continue to use `showImages`.
- Pure helpers in `lib/utils/hoverZoom.js`: `classifyUrl`, `normalizePreviewUrl`, `inferUrlFromAnchor`, `placePopover` (smart viewport-aware positioning with left/right flip + edge clamping).
- Configurable hover delay (default 180ms), max width (480px), max height (540px), mute toggle, "require direct URL" guard.
- Videos autoplay muted (Chrome autoplay policy) and loop. Reduced-motion-aware fade-in.
- Scoped to `r2` (old.reddit). Disabled by default. Mouseover/mouseout listeners attached in capture phase; clears on scroll + blur.
- New contract test `tests/unit/hover-zoom-contract.test.mjs` — 7 assertions.
- Test count: 250.

## v0.11.2 - 2026-05-22

- New `redgifsLayoutFix` module — normalises RedGifs v3 iframe embeds. Body-class-gated CSS sizes the iframe to the available width (with a configurable height cap: 400/500/600/720/unlimited), removes the wrapper padding, and hides the legacy toggle leftovers.
- Mutation observer rewrites iframe URLs to append `controls=1`, `autoplay=1`, `related=0` so RedGifs's documented embed-control parameters take effect.
- Three options: `enabled`, `maxHeight`, `hideRelated`. Module disabled by default; once enabled, `enabled` lets the user toggle the fix without unloading the module.
- New contract test `tests/unit/redgifs-layout-fix-contract.test.mjs` — 6 assertions.
- Test count: 243.

## v0.11.1 - 2026-05-22 — Phase 11 opens (Media & Downloads)

- New `directImage` module — first v0.11 consumer. On posts whose `data-domain` is in the configured direct-host list AND whose `data-url` points at a direct image/video URL, the post title link is rewritten to open the raw media. Comments link untouched.
- Pure helpers in `lib/utils/directImage.js`: `parseDomainList`, `isDirectMediaUrl`, `shouldRewrite`, `normalizeImgurGifv`.
- Imgur `.gifv` URLs are normalised to `.mp4` (the sibling resolves to a direct video).
- Defaults: `i.redd.it`, `i.imgur.com`, `v.redd.it`, `preview.redd.it`. Opens in new tab with `rel="noopener noreferrer"`.
- Disabled by default. Marks rewritten anchors with `data-rsm-direct-image="1"` so the change is observable.
- New contract test `tests/unit/direct-image-contract.test.mjs` — 6 assertions on the helpers + module registration.
- Test count: 237.

## v0.10.11 - 2026-05-22 — v0.10.x patch series complete

- New `a11yTriple` module — bundles three accessibility levers:
  1. **Font size scale** — 100% / 110% / 125% / 140% applied to titles, comment bodies, taglines.
  2. **Dyslexia-readable font** — OpenDyslexic / Atkinson Hyperlegible / Lexend / System UI. The font must already be installed locally; the extension never downloads fonts.
  3. **Collapsible sidebar rail** — narrows `.side` to a 16-px hover-expandable rail. Mutex with `layoutTweaks.hideSidebar`.
- Pure-CSS body-class scoping (`rsm-a11yTriple`, `rsm-a11yTriple-font`, `rsm-a11yTriple-rail`). Style mounts at `beforeLoad`.
- Rail uses `prefers-reduced-motion: reduce` to suppress the expand transition.
- Disabled by default. Each lever is independent.
- Closes the v0.10.x patch series: 10 modules + 80 new assertions added since v0.10.0.
- New contract test `tests/unit/a11y-triple-contract.test.mjs` — 7 assertions.
- Test count: 231.

## v0.10.10 - 2026-05-22

- New `scopedFilters` module combining v0.10.9 (per-sub muting) and v0.10.10 (URL substring block) — two filter capabilities that didn't fit into the v0.10.0 `filterRules` flat schema.
- Per-sub muting: list of `user|sub` pairs. The user is hidden only when browsing that sub. `*` as the sub wildcards across all subs.
- URL substring block: comma-separated substrings hide any post URL, post domain, or comment-body URL containing the substring. Catches affiliate spam patterns that flat domain filters cannot express.
- Pure helpers in `lib/utils/scopedFilters.js`: `parsePerSubMutes`, `muteApplies`, `parseUrlSubstrings`, `urlMatchesAny`.
- `hideCompletely` toggles between `display:none` (default) and dim-by-opacity.
- Disabled by default. Skipping the version jump from v0.10.8 directly to v0.10.10 since this single module fulfils both roadmap items.
- New contract test `tests/unit/scoped-filters-contract.test.mjs` — 6 assertions on the helpers + module registration.
- Test count: 224.

## v0.10.8 - 2026-05-22

- New `perSubCss` module — granular per-sub CSS allow/deny lists. Successor to the binary `disableSubredditStyles`.
- Pure helpers in `lib/utils/perSubCss.js`: `parseSubList` (handles `/r/` prefix, dedupes), `normalizeMode`, `currentSubFromPath`, `shouldStripStyles` (three modes).
- Three modes: `allow-all` (deny list strips), `deny-all` (allow list keeps), `per-list` (default keep, deny strips).
- Mutation observer keeps stripping if reddit re-injects the stylesheet after the initial render.
- Disabled by default. Mutually exclusive with `disableSubredditStyles` (don't enable both unless you want the hard global kill).
- New contract test `tests/unit/per-sub-css-contract.test.mjs` — 7 assertions on the helpers + module registration.
- Test count: 218.

## v0.10.7 - 2026-05-22

- New `multiColumnFeed` module — lay out the listing feed in 2, 3, or 4 columns via CSS grid.
- Listing pages only via `isPageType('linklist')`; thread / profile / wiki untouched.
- Non-thing children (pagers, panestack-title, nav-buttons) span the full row.
- `includeSelfPosts` (default on) lets you keep self-text rows in a single column at the top.
- `useFullWidth` (default on) stretches the feed to viewport width so columns get breathing room.
- New contract test `tests/unit/multi-column-feed-contract.test.mjs` — 7 assertions on schema, scope, body class, and grid plumbing.
- Test count: 211.

## v0.10.6 - 2026-05-22

- New `perSubSort` module — remember the preferred sort per subreddit. Bare `/r/<sub>/` URLs redirect to the saved sort (and time-window for top/controversial).
- Pure helpers in `lib/utils/perSubSort.js`: `parseSubListingPath`, `buildSortedPath`, `shouldRedirect`, `normalizePreference`, plus the canonical `SUPPORTED_SORTS` / `SUPPORTED_TIME_WINDOWS` arrays.
- Storage via `Storage.wrapBlob('RESmodules.perSubSort.prefs', ...)` keyed by lowercased sub.
- Inline `★ remember sort` button injected next to the tab menu; one click saves the current view.
- Redirect runs at `beforeLoad` so navigation happens before any other module mounts.
- Disabled by default. Redirect-on-entry and save-button are independent toggles.
- New contract test `tests/unit/per-sub-sort-contract.test.mjs` — 9 assertions on the pure helpers + module registration + SCSS bundle wiring.
- Test count: 204.

## v0.10.5 - 2026-05-22

- New `roleHighlights` module — refresh OP / moderator / admin / friend highlight lanes via body-class-gated CSS.
- Per-role colour pickers; defaults: OP `#3b82f6`, mod `#22c55e`, admin `#ef4444`, friend `#a855f7` (off by default).
- Optional backdrop tint paints a left-border stripe on each role's entry.
- Optional animated role-flair shimmer (reduced-motion aware via `prefers-reduced-motion`).
- Style injected at `beforeLoad` to avoid the brief default-colour flash on slow first paints.
- New contract test `tests/unit/role-highlights-contract.test.mjs` — 7 assertions on option schema, body-class convention, stable author selectors, and motion safety.
- Test count: 195.

## v0.10.4 - 2026-05-22

- New `authorContextBadge` module — inline `[age · karma]` chip after every `.author` link.
- Pure helpers in `lib/utils/authorContext.js`: `parseAuthorAbout`, `formatAccountAge`, `formatKarma`, `formatBadge`, `isFresh`, `ageRiskClass`.
- Fetches `/user/<u>/about.json?raw_json=1` behind a dedicated 5-token / 1s rate limiter (2 concurrent max); cached via `Storage.wrapBlob('RESmodules.authorContextBadge.cache', ...)` with a configurable TTL (default 24h).
- Optional `colorByAge` tints accounts younger than 30d red and younger than 180d amber.
- `[deleted]` and `[removed]` authors are skipped by default.
- Disabled by default. In-memory dedup + inflight guard so repeat authors in a single page only fire one request.
- New contract test `tests/unit/author-context-badge-contract.test.mjs` — 10 assertions on the pure helpers + module registration + SCSS bundle wiring.
- Test count: 188.

## v0.10.3 - 2026-05-22

- New `crosspostMap` module — on a comments page, lists every other subreddit the same post appears in via `/duplicates/<id>.json`.
- Pure helpers in `lib/utils/crosspostMap.js`: `extractArticleId`, `buildDuplicatesUrl`, `parseDuplicatesResponse` (excludes the self-post, sorts newest first), `relativeAge`.
- Rate-limited via its own 2-token bucket (1.5s refill); cached per article ID for the session.
- Inline widget injected after `#siteTable`; `Find crossposts` button + `auto-load` toggle. `hide when empty` defaults on so quiet posts don't show an empty box.
- Disabled by default. Max 50 items, configurable (default 10).
- New contract test `tests/unit/crosspost-map-contract.test.mjs` — 7 assertions on the pure helpers + module registration + SCSS bundle wiring.
- Test count: 178.

## v0.10.2 - 2026-05-22

- New `botCollapse` module — auto-collapse comments by known bots (AutoModerator, RemindMeBot, sneakpeekbot, etc.) and badge AutoMod sticky comments.
- Pure helpers in `lib/utils/botList.js`: `DEFAULT_BOTS` (20 common bots), `normalizeBotName`, `parseBotList` (accepts JSON array OR comma/newline-separated), `isBot`, `isAutoModSticky`.
- Collapse via existing `.expand` click pattern so reddit's native one-line stub fires; a `[reveal]` button is injected for one-click bypass.
- Disabled by default. Sticky-AutoMod collapse and other-bot collapse are independent toggles.
- New contract test `tests/unit/bot-collapse-contract.test.mjs` — 8 assertions on the pure helpers + module registration + SCSS bundle wiring.
- Test count: 171.

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
