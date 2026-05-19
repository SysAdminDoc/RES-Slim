# Changelog

All notable changes to RES-Slim will be documented in this file.

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
