# CLAUDE.md - RES-Slim

## Scope
Private fork of Reddit Enhancement Suite v5.24.8, stripped to comment tweaks and media expandos. Targets old.reddit.com. Chrome MV3 + Firefox MV2.

## Build
- `yarn install`
- `yarn once` — dev build to `dist/chrome/`
- `yarn build` — production build, zips to `dist/zip/`
- Load unpacked from `dist/chrome/` in Chrome.

## Kept modules
Comment: `hideChildComments`, `commentNavigator`, `commentPreview`, `commentTools`, `commentQuickCollapse`, `commentSortBy`, `commentStyle`, `commentDepth`, `commentHidePersistor`, `saveComments`, `hover`, `showParent`, `readComments`, `newCommentCount`, `spoilerTags`, `noParticipation`, `sourceSnudown`, `context`.
Media: `showImages` + all 87 `lib/modules/hosts/` handlers.
Appearance: `nightMode` (minimal — just the body class toggle + FOUC guard; upstream sunrise/sunset/subreddit-whitelist stripped).
Infra: `menu`, `notifications`, `settingsNavigation`, `selectedEntry`, `version`, `requestPermissions`, `search` (hidden via `module.hidden = true` so the sidebar entry is gone but the in-console search box still functions).

## Key files
- `lib/modules/index.js` — single aggregator. Add/remove a module by toggling its import + export here.
- `lib/modules/hosts/index.js` — media host aggregator. To trim a host: delete its import + export line and delete the file.
- `build.js` — esbuild driver. Strips flow types, sass-compiles, replaces manifest tokens.
- `package.json` — `title` / `name` / `version` flow into manifests at build time via `__name__` etc. tokens.
- `chrome/manifest.json`, `firefox/manifest.json` — token templates. Cloud OAuth host permissions removed.

## Notes / gotchas
- `hosts/youtube.js` contains a hardcoded Google API key for read-only video metadata. Not tracking, not changed.
- Modules deleted from `lib/modules/index.js` but their supporting folders in `lib/modules/<name>/` were also wiped where present (`filteReddit/`, `backupAndRestore/`).
- `core/migrate/migrate.js` retains migration step records — RES upstream branding strings in older entries were updated only where user-facing.
- Other locale files (`locales/locales/*.json`) left as-is. Missing keys fall back to `en.json`.
- Extension ID differs from upstream RES (new `package.json` name) — existing RES users will not inherit settings.
- No CI workflow. Build locally and load unpacked / side-load zip.

## Trimming host handlers later
Each host is one file in `lib/modules/hosts/` and one import+export line in `lib/modules/hosts/index.js`. To drop a host: remove both. No other wiring.

## Version
- v0.1.0 — initial fork
- v0.2.0 — gear icon opens settings console directly; removed About/Search-RES-Settings sidebar entries; removed troubleshooter; restored minimal nightMode (dark theme) as default landing
- v0.3.0 — 16 new modules ported from the old.reddit userscript ecosystem: commentHighlights, autoExpand, nextTopComment, hideGifComments, absoluteTimestamps, reddEye, viewDeleted, fixImageLinks, fixProcessingImg, downloadButtons, restoreSubCounts, archiveLinks, infiniteScroll, markAllRead, userProfileSearch, subredditBlacklist. All fresh rewrites — AGPL sources used as reference only. Module count: 43.
- v0.3.1 — settings console UX improvements: module enable/disable toggle with permission prompts, disabled-module scrim, category-panel navigation tweaks, search input tightening, console restyling.
- v0.3.2 — two new appearance modules (classicFavicon, disableSubredditStyles) + stability fixes across the v0.3.0 ecosystem ports + substantial options.scss restyling pass. Module count: 45.
- v0.3.3 — fresh extension icon set: minimalist RS monogram on dark charcoal circle with Reddit-orange accent bar. Toolbar action icons redesigned to match. New build/generate-icons.py (Pillow) regenerates the full set.
- v0.3.4 — settings workspace UX refinement (Codex): ~500 lines of options.scss updates, templates.js and settingsConsole.js polish, search.js simplification, stage.js staging additions.
