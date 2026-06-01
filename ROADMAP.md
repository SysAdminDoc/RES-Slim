# RES-Slim Roadmap

RES-Slim is a private, old.reddit-focused fork of Reddit Enhancement Suite. This roadmap tracks pending work only. Historical planning and research artifacts are archived under `docs/archive/`.

## Planning Docs

- Current completed state: `COMPLETED.md`
- Research synthesis: `RESEARCH_REPORT.md`
- Historical roadmap: `docs/archive/roadmap/ROADMAP-2026-05-22.md`
- Historical feature-gap research: `docs/archive/research/RESEARCH-FINDINGS.md`

## Current Baseline

- Current release: v0.12.7.
- Test count recorded in the latest changelog: 358.
- Chrome MV3 and Firefox MV2 extension builds remain the primary artifacts.
- The product is old.reddit-first; new Reddit surfaces are compatibility handoffs only.
- Every new feature must remain reversible, settings-gated where appropriate, privacy-preserving, and compatible with the existing no-light-theme/no-keyboard-shortcut/no-telemetry rules.

## Active Roadmap

### v0.13.0 - Moderator Workbench

- Add a Toolbox-compatible optional moderator category behind a parent enable switch.
- Read/write Toolbox-style usernotes wiki JSON with import/export compatibility.
- Add queue tools, removal reasons, ban/mute macros, ModMail Pro, mod action logs, comment nuke with undo where possible, AutoModerator editor, CSS syntax highlighting, domain/user history, and bulk hide/unhide.
- Keep all write/destructive actions explicit, permission-gated, and toast-reversible when endpoints allow.

### v0.14.0 - Userscript Parity

- Produce a single-file userscript artifact under `dist/userscript/`.
- Add GM storage/style/fetch/download adapters.
- Mark extension-only features as unavailable with concise reasons.
- Add install metadata, grants, update/download URLs, and a userscript build contract.

### v0.15.0 - Reliability, CI, and Release Pipeline

- Add GitHub Actions for lint, tests, Chrome/Firefox builds, and userscript build.
- Add bundle-budget, secret-scan, privacy-origin, and workflow-contract checks.
- Add visual smoke screenshots for settings and representative captured Reddit surfaces.
- Rewrite README as a user-facing release deliverable with install paths, screenshots, feature catalogue, and privacy promises.
- Emit release hashes and wire CRX3 packaging into the release workflow.

### v0.16.0 - Author Intelligence and Anti-Manipulation

- Add local-only age/karma, granular timestamp, OP context, history-score, and shadowban indicators.
- Add AI/bot prose heuristics, stylometry profile, karma-farm detector, ragebait classifier, karma hider, AutoMod attribution, and local-only toxicity rules.
- Keep all scoring local and fully explainable in hovercards.

### v0.17.0 - Visual Power Suite

- Add theme preset library, custom accent picker, density modes, local/explicit background images, custom header logo, font replacement, branded scrollbar, shortcut bar, floating scroll-to-top, sticky sort widget, and reduced-motion-aware animation polish.
- Keep dark/OLED palettes only.

### v0.18.0 - Local Intelligence and Unmet Requests

- Add markdown toolbar/live preview, copy-code buttons, comment draft restore, base64 decoder, banned-banner removal, login autofill repair, subreddit topic tags, r/place overlay, and comment-actions-at-top.
- Add Ollama-backed local thread/article summaries behind explicit localhost-only enablement and health checks.

### v0.19.0 - Performance, Polish, and Bug Bash

- Add feed/thread/settings performance budgets.
- Audit observers, WeakSets, cleanup functions, detached DOM, theme contrast, and selector captures.
- Refresh MHTML fixtures for major page kinds.
- Consider declarativeNetRequest migration for outbound URL cleansing.

### v1.0.0 - Release Gate

- Ship with all default-safe features stable, optional/destructive features documented and gated, README/screenshots/release artifacts complete, and CI/branch protection enforced.
- Every feature must have automated lifecycle coverage or a focused manual QA checklist.

## Definition of Done

- Active planning remains in this file.
- Completed implementation notes go to `COMPLETED.md` and `CHANGELOG.md`.
- Research conclusions go to `RESEARCH_REPORT.md`.
- Historical roadmap/research files stay archived and are not duplicated at the repo root.
