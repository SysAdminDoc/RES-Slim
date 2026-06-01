# RES-Slim Completed Work

This file summarizes shipped state. Release-level details remain in `CHANGELOG.md`.

## Fork Baseline

- Private fork of Reddit Enhancement Suite v5.24.8 targeting old.reddit.com.
- Chrome MV3 and Firefox MV2 manifests retained; dead Edge/Opera/chromebeta targets removed.
- OAuth/cloud backup, promotional, sponsorship, announcement, and unused upstream modules stripped.
- Comment, media, settings, menu, notification, version, permission, hover, and selected-entry infrastructure retained.

## Core Infrastructure

- Reversible feature registry with init/destroy lifecycle tracking.
- Settings schema, defaults, migrations, stage/commit/discard, JSON import/export, and future-key preservation.
- Dark/OLED settings console, anti-FOUC guard, theme presets, contrast contracts, and privacy URL snapshot checks.
- Selector map with stable/fallback layers pinned against captured old.reddit MHTML fixtures.
- TrustedTypes helper for HTML insertion paths.
- Shared rate limiter for Reddit/API polling consumers.

## Shipped Feature Areas

- Comment workflow: navigation, highlighting, quick collapse, timestamps, inline continuation, minimap, top-comment preview, auto refresh, export, and draft-friendly support work.
- Media workflow: showImages host handling, direct image rewrites, RedGifs layout fix, hover zoom, drag resize, Imgur album flattening, gallery zip, search gallery, overlay viewer, Cobalt downloader, local companion, media scope toggle, and media archive manifest.
- Privacy/redirect workflow: promoted removal, outbound cleanser, tracking sabotage, friction removers, old Reddit redirect, and username hiding.
- Navigation/search workflow: search dispatcher, search filter persistence, scroll restore, crosspost map, per-sub sort, and multi-column feed.
- Filtering/author workflow: JSON filter rules, user tagger, bot collapse, scoped filters, author context badge, role highlights, and per-sub CSS.
- Archival/data workflow: Arctic Shift restore, Wayback snapshot, saved backup, vote history, comment-tree export, and media manifest.
- Accessibility/layout workflow: a11y triple, layout tweaks, comment depth colors, media scope controls, and theme/density infrastructure.

## Current Verification Baseline

- Latest changelog baseline: v0.12.7, 358 assertions passing, Chrome and Firefox builds clean.
- Focused tests are wired through `yarn test`; build artifacts are produced with `yarn once` and `yarn build`.

## Documentation Consolidation

- Root planning is consolidated into `ROADMAP.md`, `COMPLETED.md`, and `RESEARCH_REPORT.md`.
- The historical max roadmap is archived at `docs/archive/roadmap/ROADMAP-2026-05-22.md`.
- The older feature-gap research is archived at `docs/archive/research/RESEARCH-FINDINGS.md`.
