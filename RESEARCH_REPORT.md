# RES-Slim Research Report

This report summarizes the research that drives the active roadmap. Full historical artifacts are archived under `docs/archive/`.

## Product Direction

RES-Slim should become a dense, privacy-preserving old.reddit power suite rather than a general Reddit redesign tool. The strongest direction is to combine:

- RES-style old.reddit browsing.
- Modern reversible feature lifecycle and settings infrastructure.
- Media/export/archive tooling.
- Local-only author intelligence and anti-manipulation signals.
- Optional moderator workbench features that can replace the archived Moderator Toolbox workflow.

## Competitive Findings

- Upstream RES is maintenance-only and remains the architectural baseline.
- Moderator Toolbox was archived, creating a strategic opening for usernotes/removal-reason/queue-tool compatibility.
- Reddit Enhancer and Sink It set the modern polish bar, but old.reddit depth remains thinner than RES.
- Arctic Shift is the durable replacement path for deleted-content restoration after Pushshift access restrictions.
- Many useful Greasy Fork/OpenUserJS ideas are unlicensed, AGPL, or one-off; they should be reimplemented from behavior, not copied.

## Local DOM and Architecture Findings

- old.reddit `data-*` attributes on posts/comments are more stable than class strings and should remain the primary selector layer.
- `data-event-action` is the best behavioral hook for action buttons.
- Body page-kind tokens are stable enough for page routing and feature gating.
- Captured pages do not currently enforce TrustedTypes, but centralized trusted HTML remains required for future/new Reddit compatibility and MV3 hardening.
- MutationObservers should process added nodes only, with WeakSet dedup and IntersectionObserver gates for expensive media/API work.

## Rules and Constraints

- No telemetry.
- No feature keyboard shortcuts beyond normal browser accessibility behavior.
- No confirmation-dialog UX; use immediate action, toast feedback, and undo where endpoint behavior allows.
- No light theme.
- No fully rounded pill/oval/stadium backdrops.
- No external network calls outside Reddit/Redditstatic or explicitly enabled integrations.
- No AGPL or unlicensed code lifting.

## Research-Backed Priorities

- Moderator Workbench is the highest strategic phase because Toolbox is archived.
- Userscript parity matters for portability, but must clearly mark extension-only features.
- CI/release reliability should land before v1.0 because the repo now has a large module/test surface.
- Author intelligence and anti-manipulation features should be local-only and explainable.
- Visual polish should stay dark/OLED and respect reduced motion.
- Local AI features should be localhost-only, opt-in, and health-checked.

## Archived Source Material

- `docs/archive/roadmap/ROADMAP-2026-05-22.md`
- `docs/archive/research/RESEARCH-FINDINGS.md`
