# Classic Reddit parity QA

## Evidence

- Source visual truth: archived `old.reddit.com` listing and comment pages captured from the Wayback Machine on 2026-08-19.
- Implementation: deterministic current Reddit/Shreddit fixtures rendered with the built Chrome extension.
- Viewport: 1265 × 712 CSS pixels at device scale factor 1 for both source and implementation.
- Listing comparison: [`design/qa/v0.43.0-listing-parity.png`](design/qa/v0.43.0-listing-parity.png). Left is old Reddit; right is current Reddit with RES-Slim. Both halves are 1264 × 426 crops with no density scaling.
- Comment comparison: [`design/qa/v0.43.0-comment-parity.png`](design/qa/v0.43.0-comment-parity.png). Left is the visible old Reddit comment region below the archive toolbar; right is the current Reddit thread fixture. Both halves are 422 px high with no density scaling.
- State: light theme, desktop listing and opened discussion. Content differs deliberately; the comparison targets layout, hierarchy, density, type, colour, and controls.

## Required surfaces

- Listing: 46 px pale-blue header, white page, 300 px right rail, flat 72 px rows, 43 px vote rail, 70 px media, 16 px link titles, 10 px metadata/actions, classic link and visited colours.
- Discussion: full post remains visible, 18 px post title, 14 px comment body, 10 px metadata/actions, flat comment surfaces, 1 px nested depth guide, native collapse state retained.
- Responsive: the right rail is removed below the desktop breakpoint, posts become single-column, and media/title/action geometry resets without horizontal overflow.
- The current Reddit header keeps its live search/account controls; community banners and live content remain Reddit-owned instead of being duplicated by the extension.

## Interaction verification

- Native current Reddit upvote, downvote, comments, share, and collapse controls remain the original elements and listeners.
- Open Shreddit post roots receive one gated Classic stylesheet; streamed posts receive the same bridge.
- SPA URL changes, streamed content, filtering, promoted-post removal, clean outbound links, absolute timestamps, selected-entry navigation, and native comment collapse were exercised in the browser suite.
- Listing and discussion fixtures completed with no uncaught page errors.
- Forced-colour, increased-contrast, focus visibility, target-size, settings-console, and injected-control accessibility checks passed.

## Iteration history

1. Pass 1 — P2: source and implementation viewports differed and clipped the right rail. The browser harness was changed to the source viewport and the comparison was recaptured.
2. Pass 2 — P2: deterministic fixture vote controls lacked visible glyphs and post flair collided with the action line. Existing Batch icon glyphs were applied only to text-only fixture controls, and flair moved to the row's upper-right corner.
3. Pass 3 — no P0, P1, or P2 differences remained. Remaining differences are P3 and intentional: live native header controls, live community-owned banner content, and different fixture copy.

## Result

Automated verification: 1163 unit tests and 33 end-to-end browser tests passed. Style checks passed; the established Flow baseline passed.

final result: passed
