# Changelog

All notable changes to RES-Slim will be documented in this file.

## Unreleased

### Removed

- The twenty-two orphaned SCSS partials, 1,659 lines that no entry point has
  imported since v0.1.0 stripped the upstream modules they styled. Nothing
  compiled them, so `res.css`, `options.css` and `prompt.css` are byte-identical
  without them; what they did affect was every reading of this tree, the z-index
  audit being the measured case — five of twelve tokens looked live and were
  referenced only from stylesheets that never shipped. Re-porting one of those
  features copies its implementation out of upstream's GPL-3.0 tree with its
  stylesheet beside it, so nothing here is lost.

### Added

- `scss-reachability-contract` walks the import graph from the three stylesheet
  entry points `build.js` compiles and fails on any `.scss` file it cannot
  reach, so the orphan class cannot come back. A commented-out `@import` counts
  as absent, which is the direction the check must not be wrong in.

### Security

- The four third-party API keys inherited from upstream are gone. They were live
  quota credentials this project neither owns nor can restrict, published in a
  public GPL-3.0 repository, and revocable without notice by owners who have no
  idea this fork exists - at which point the features would have broken with
  nothing to diagnose them by. One decision per key:

  - **YouTube** - deleted outright. The key fed `getVideoData`, which was
    declared on `Host`, assigned by the constructor, and read by no file in the
    repo. It shipped in the foreground bundle of every release for a code path
    that never ran. The caller-less plumbing went with it.
  - **Giphy** - no longer calls the API at all. `dc6zaTOxFJmzC` is the
    well-known public beta key, and the request bought nothing: the response's
    media URLs are exactly the paths the id already determines.
  - **Google Maps** - previews render through OpenStreetMap, which needs no key
    and no quota. Google's Embed API requires one, so the trade is tiles and the
    satellite layer for a feature that does not depend on a stranger's
    credential.
  - **Tumblr** - the one host with no key-less path; its oEmbed endpoint no
    longer returns JSON. The key is now yours to supply in the host's settings,
    and until one is set the host does not claim the link at all rather than
    offering an expando that can only fail.

  `no-inherited-credentials-contract` fails on any hardcoded key shape, baited in
  both directions so it matches a real credential and not ordinary code.

### Fixed

- A hover card could paint on top of the open image viewer. `.RESHover` carries
  10,300,000 and the viewer carried 100,000, two orders of magnitude apart, and
  the pairing is reachable in ordinary use: `hover` is always enabled and its
  card lingers for half a second plus a fade after the pointer leaves, which is
  long enough to click an image. Confirmed in Chromium with
  `document.elementFromPoint` before anything was changed.

  The viewer is a native `<dialog>` opened with `showModal()` now, so it lives
  in the browser's top layer where no stacking value can reach it, and the top
  layer brings the focus trap, the inertness of the page behind, and Escape with
  it — forty lines of hand-rolled Tab cycling went away. The hover-zoom preview
  moved to the top layer too, via `popover="manual"`: it follows the cursor and
  owns neither Escape nor light-dismiss, so `auto` would have been wrong.

### Changed

- The z-index scale describes roles rather than modules, and every page-level
  stacking value comes from it. Six of its twelve tokens were referenced only
  from stylesheets no entry point compiled; the ad-hoc values that had grown up
  beside it — 1000 on four different surfaces, 2001, 9999 on four more, 99999,
  100000, 10000000 and 99999999 — are now slots in one ladder, and the two
  panels that tied at exactly 1000 no longer depend on source order. Three
  contracts hold it: no unreferenced token, no page-level literal outside the
  scale, and no stacking value written from JS. `nextTopComment` wrote
  `z-index: 9999` into an inline style attribute, where no stylesheet audit
  could see it; its layout is a stylesheet now.

## v0.39.0 - 2026-08-18

### Fixed

- `waybackSnapshot` tells an archive.org outage apart from a URL that was never
  archived. Every failure used to collapse to the same value, so the module
  opened Save Page Now for pages that may already have had a snapshot and then
  reported success. Found live: archive.org answered 200 and the Wayback machine
  itself 302 while `/wayback/available` returned 502 for minutes. An unreachable
  API now archives nothing and says so.

- The 4/6/8/10/12 radius scale is enforced for real. `CLAUDE.md` and the project
  notes both said a contract already scanned every shipped stylesheet; what
  existed were four inconsistent pill greps over disjoint file subsets, one
  matching the literal `999px` only — so `9999px` passed — while about fifty
  off-scale literals shipped underneath them. Those are snapped onto the scale
  (each moved at most 4px, most by 1), circles are allowlisted one site at a
  time, and the three token scales are checked against each other.

- Every option control in the settings console now has an accessible name.
  `<label for>` pointed at elements that cannot be labelled — an enum rendered a
  div, a button option rendered a div, and a keycode pointed the label at a
  `display: none` input while the field the user can see and focus had nothing —
  so a screen-reader user got an unnamed control in each case. Enums are
  radiogroups and button options are groups, both named by `aria-labelledby`;
  keycodes label the visible field. Table cells, which had no label of their own
  at all, take their column name. Option ids are namespaced by module, so two
  modules sharing an option key no longer collide (and, for enums, no longer
  render one merged radio group); which option a control belongs to is stated in
  `data-option-key` rather than parsed back out of its id.

- `Alert` is a native `<dialog>` opened with `showModal()`. It was a hand-rolled
  overlay with no role, no `aria-modal`, no focus trap and no focus restore —
  and its Escape handler *confirmed* when the dialog was not cancelable, so the
  gesture every user reads as "no" could mean "yes". Escape now always cancels a
  cancelable dialog, closing it by any other means is not agreement either, and
  focus returns to whatever opened it. The backdrop and the stacking are the
  platform's now, so the second fixed-position div and the z-index token are
  gone.

- Importing a settings file written by a newer build is refused instead of
  applied. `migrate.js` is a 937-line ladder that only runs forward, so a layout
  this build has never seen cannot be interpreted — only written over a working
  configuration. The message names both format versions, says to update, and
  says that nothing was changed. A `formatVersion` that is present but not a
  whole number is treated as corruption rather than coerced to the current one;
  an absent one still reads as the current layout, since that is what files
  written before the field existed are. An import from a different build now
  says so in the result toast, which is what explains an unfamiliar module
  appearing in the diff.

### Changed

- The e2e suite no longer touches the network. One outbound request remained —
  a CSP reachability check against reddit — which coupled the suite's result to
  a third party's availability and to whether reddit's anti-automation layer
  lets a fresh automation profile out at all. It is now intercepted, which
  proves the same thing more precisely: a request the CSP refuses never leaves
  the worker, so reaching the interceptor *is* the evidence. The browser is
  launched with DNS for everything but localhost pointed at a dead address, so
  an un-routed request fails loudly instead of working on a good day.

## v0.38.0 - 2026-08-18

### Changed

- esbuild 0.25.10 -> 0.28.2. Three miscompile fixes, and it steps over the
  0.25.11-0.27.4 CSS media-query regression window. Landing on 0.28.2 rather
  than 0.27.x is deliberate: the dev-server advisory GHSA-g7r4-m6w7-qqqr was
  introduced in 0.27.3 and fixed in 0.28.1. Bundle sizes did not move.
- `fast-levenshtein` replaced with `fastest-levenshtein`. The former was a thin
  wrapper that delegated to the latter, so the tree already shipped both; the
  wrapper's repo has been dead since the day it was published. Its one extra
  option, `useCollator`, was unused here.
- `yarn verify` gained an advisory `metadata` gate that compares the published
  GitHub repo description and topics against the README. The description read
  "Stripped-down private fork" while a contract asserted the README does not say
  "private fork" — the third time in this repo a contract has been bound to one
  copy of a duplicated fact. It reports rather than fails, because it needs a
  network and a `gh` login.

### Security

- The version beacon RES-Slim writes into reddit's own DOM now carries a
  per-session nonce instead of the extension ID. For an unpacked install Chrome
  derives that ID from the install path, so it was a stable per-machine
  identifier handed to the page by a product that ships no telemetry precisely
  so it has nothing to hand over. Its only consumer needs two installs to look
  different from each other, which a nonce does just as well.
  `data-fork-version`, which published the exact build, is gone too.
- `continueThreadInline` validates the URL before it sends credentials. It is
  the one credentialed fetch in the tree built from page markup, and the URL
  came from an `a.href` — which resolves against the document, so a `<base>`
  element is enough to move it off reddit while the attribute still reads
  `/r/…`. It must now be https, same-origin, and shaped like a comment
  permalink.

### Fixed

- `fixImageLinks` carried an unreachable `observer.disconnect()` sitting after an
  early return on the same condition, with a comment describing a leak the guard
  above it already prevented.

### Added

- Selector drift now has its own view in the settings console: which surfaces
  fell back or went missing, on which kind of page, and since when, with a
  one-click copyable report. It was previously one line in the module error log,
  which is a textarea of everything that has ever gone wrong. The panel is
  hidden entirely while every selector matches. The record keeps page kind,
  surface names and dates and nothing else — no URLs, no subreddits, no times of
  day — and the report says so.

- `frictionRemovers` can dismiss reddit's mandatory-login interstitial, off by
  default. It matches on shape rather than on class names — a nearly
  full-viewport fixed or absolutely positioned element that is not ours, plus
  the scroll lock on the document — because the wall rolled out geographically
  and gradually from 2026-06-30, so there is no single DOM to write a selector
  list against. If reddit sent no content behind the overlay there is nothing to
  uncover, and hiding it would leave a blank page that looks like success; that
  case records a diagnostic entry naming the page instead.

- A media-host penalty box. RES-Slim ships 74 media host handlers and had no
  shared failure policy: `linkScanner` logged each failure, destroyed the
  expando and moved on with no memory that it had just done the same for the
  previous twenty links, so a host that was down cost one dead network
  round-trip per link, on every page, indefinitely. A host that fails three
  times within five minutes is now skipped for five minutes, doubling on each
  repeat up to six hours, and is let back in automatically. One success clears
  the record. Each suspension is recorded once in the diagnostics log, and the
  state survives a page load.

### Changed

- `galleryZip` no longer bundles JSZip. It reached the library with
  `await import('jszip')`, which reads as a lazy load and is not one: the build
  is `format: 'iife'` with no code splitting, so esbuild inlined all 153KB into
  the content script — parsed on every Reddit page, for a module that is
  disabled by default. JSZip now ships as a separate file injected on first use,
  the same way `showImages` already loads dashjs. Production bundles shrank 12%:
  `foreground.entry.js` 819KB -> 719KB, `options.entry.js` 884KB -> 784KB. The
  build refuses to bundle a vendored library at all, so the next one cannot
  arrive the same way, and every vendored file carries a pinned digest.

## v0.37.0 - 2026-08-18

### Removed

- The `geolocation` optional permission. It was declared in both manifests and
  requested by nothing — its only other appearance in the tree was a label in the
  permission prompt. Dead surface on the trust prompt of an extension whose whole
  pitch is that it collects nothing. A contract now fails on any optional API
  permission no code path asks for.
- `firefox/beta/`. Nothing built it, so it was a manifest only the test suite
  read, and it had drifted: it declared `cookies`, `identity` and `history` plus a
  Google Drive host the shipped manifests do not, set `all_frames: true`, and
  carried a `__browser_mobile_min_version__` token the build never substitutes —
  so building it would have shipped that literal.

### Fixed

- Escape inside a text field no longer closes the settings console. The handler
  was on `document.body` with no target guard, so clearing the search box or a
  mistyped option value threw away the whole workspace, staged changes included,
  for the keystroke that normally undoes one field.
- Bulk actions are survivable. Two features could lose work and neither could be
  stopped once started.
  - `commentShredder` ran inside a notification that closed after fifteen
    minutes while `maxPerRun` is free text against a listing that reaches 1000 —
    so a long run lost its Stop button and its progress line while the loop kept
    deleting. Each progress tick now keeps the panel open for the whole run.
    A throw out of the run stranded the panel on "Shredding…" forever, and the
    call site had no `.catch` at all, so the error reached nobody; it now reports
    that the run stopped part-way and the comments should be checked. A second
    run in the same tab is refused rather than racing the first through reddit's
    per-account write limiter.
  - `hideAll` kept its undo in memory and offered it from a notification that
    closes after fifteen seconds, so hiding a listing by accident was recoverable
    for fifteen seconds and not at all after a reload or a click into a thread —
    which is exactly what a user does next. The undo set now persists for thirty
    minutes and reappears as an "undo hide all" link in the tab menu, surviving
    navigation. The run also gained a way out: clicking the link during a run
    stops it, and the summary says how many were skipped.

### Added (accessibility)

- Windows High Contrast support. The UA forces every author colour, drops
  `box-shadow`, and drops any non-`url()` `background-image` — which is the entire
  vocabulary a restyler is built from, making it the one environment where this
  extension could render a page worse than not running at all. Neither
  `forced-colors` nor `prefers-contrast` appeared anywhere in the 76 stylesheets.
  Every RES-Slim control and floating surface now keeps a real edge, and every
  selected state is restated with `Highlight` rather than a hue that gets forced
  away. Drawn with `outline` and a negative offset so nothing reflows.
- `prefers-contrast: more` promotes the decorative border to the measured 3:1
  control border, drops the translucent elevation, and thickens the focus ring, in
  both the page theme and the settings console.

### Fixed (accessibility)

- Placeholder and hint text now clears 4.5:1 on every surface it lands on, in all
  nine console themes. `--options-text-soft` was measured only against the page
  background and panel before, and the failures were on the surfaces nothing
  reached: Rosé Pine 2.94:1, Tokyo Night 3.56:1, Catppuccin 3.77:1, with Graphite,
  Midnight and Ember all a hundredth or two under the line.
- Disabled controls are no longer faded with `opacity`. A `.72` multiplier
  composited the already-soft text down to 2.37-3.40:1 — under AA in all nine
  themes and under 3:1 in four — and faded the boundary that identifies the
  control along with it. Disabled state is now carried by an explicit colour,
  surface and dashed boundary, which also survives Windows High Contrast.
- Form controls have a visible edge. Text fields, selects, buttons, toggle tracks
  and radio chips drew their boundary from `--options-border`, which measured
  1.09-1.50:1 against the surfaces behind it in every theme — below the 3:1 WCAG
  1.4.11 asks of anything that identifies a component. A new
  `--options-control-border` carries controls at 3:1 while `--options-border`
  stays where it is for panel dividers and card outlines, which are decoration.
  The old-Reddit theme gains the same split as `--rsm-th-control-border`, where
  the composited border measured 1.17-1.48:1 across all ten palettes.
- The page-theme contrast contract can now read the borders it is supposed to
  check. Its colour helper accepted hex only and threw on anything else, and eight
  of the ten palettes write `--rsm-th-border` as `rgba()` — so those borders were
  never measured, and the gap read as coverage.

### Added

- The accent colour now has a contrast floor. It is a free colour picker, so
  `#333` was a legal choice — about 1.2:1 against every shipped palette, which
  makes visited post titles unreadable and the `:focus-visible` outline invisible.
  Readability is a property of the colour *and* the palette, which is why syntax
  validation could never catch it. Visited titles and the focus outline are now
  painted from corrected shades that clear 4.5:1 and 3:1 respectively, keeping the
  hue the user chose; the raw accent still drives the decorative blends, which are
  legible at any darkness. The settings console says so inline and offers the
  nearest compliant shade rather than rewriting the value behind the user.
- Options can declare inline advice, rendered under the control. It exists for
  values that are only wrong in combination with another setting, which type
  validation cannot see.

### Changed

- The default accent moved from `#5aa9ff` to `#82bfff`. Measured against the
  lightest surface each palette paints behind it, the old default was 3.75:1 on
  Nord and 4.30:1 on Solarized Dark — below AA on two of the ten shipped palettes.
  The new one clears 4.5:1 on all ten.

### Fixed

- Imgur album flatten works again. It has never worked: rimgo instances send no
  `Access-Control-Allow-Origin` and the extension held no host permission for
  them, so the service worker's probe fetch was CORS-blocked before it left the
  browser. Every mirror therefore read as dead and the module rewrote nothing,
  reporting "none of the configured mirrors responded" as though the hosts were
  down. The two shipped mirrors are now declared as optional host permissions and
  requested when an imgur album is actually encountered; a mirror the extension
  cannot read is reported as a permission problem rather than as an outage,
  because the remedies are different.
- The mirror probe now judges the response body, not just its status code. A
  status code cannot tell a working instance from an anti-bot interstitial, which
  is how `imgur.artemislena.eu` stayed the first-choice default while answering
  200 with "Making sure you're not a bot!". A 200 must now contain rimgo's own
  markup to count as healthy, so a challenge page falls through to the next
  mirror instead of being selected.

## v0.36.0 - 2026-08-18

### Changed

- MutationObservers can now be turned off. `Expando` created an anonymous
  observer per expando button with no reference held, so it could never be
  disconnected — on a listing that appends 25 more buttons per infinite-scroll
  page, each observer also pinned its own detached button. It is now held on the
  instance and disconnected in `destroy()`. Four modules declared a
  `MutationObserver | null` slot — a field whose only purpose is teardown — and
  never disconnected, so a second setup call would orphan the first observer while
  leaving it running; they now disconnect before reassigning.
  `observer-teardown-contract` accepts either that pattern or `classicFavicon`'s
  idempotent `if (observer) return;` guard, and rejects reassigning over a live
  observer.
- Every scroll listener is now passive, and the two that measure layout are
  throttled. A non-passive scroll listener makes the compositor wait for the
  handler before scrolling, and none of these ever call `preventDefault` — they
  close a hover, re-anchor a popover, clear a zoom preview, or pick the selected
  Thing. `selectedEntry` was the worst case: `SelectedThing.selectClosestInView()`
  walked Things and measured rectangles synchronously on every scroll event, with
  no throttle at all; it now runs through `idleThrottle` like `showImages`.
  `scroll-listener-contract` keeps every future listener passive.
- Production builds are minified. `minify` was simply never set, so every release
  shipped the foreground content script — parsed at `document_start` on every
  Reddit page — as full-width readable source. `foreground.entry.js` drops from
  1,433,172 to 811,627 bytes (-43%), `options.entry.js` from 1,540,578 to 874,830
  (-43%), and `background.entry.js` from 167,527 to 104,210 (-38%). Development
  builds are unchanged, so stack traces still point at readable source. The e2e
  suite was run against the minified production build to confirm it behaves
  identically.
- The bundle budget is now a ratchet instead of a ceiling. The old limits sat
  ~400KB above reality, so the foreground entry could have grown by a third
  without tripping them. Recorded sizes live in
  `tests/fixtures/lint/bundle-baseline.json` and fail in both directions — growth
  is a regression, a shrink is a win worth banking — matching how the eslint and
  flow baselines already work. `yarn bundle:baseline` re-records them.

### Added

- `yarn verify` runs every gate in one command — lint, Flow, unit suite, production
  build, e2e, and the endpoint probe — in cheapest-first order, stopping at the
  first failure and printing a per-gate summary. `--skip-network` omits the
  endpoint probe. A `.githooks/pre-push` hook runs it, enabled per clone with
  `git config core.hooksPath .githooks`.
  Every one of those gates already existed and nothing ran them together: `yarn
  test` invoked only the unit suite, there were no git hooks, there is no CI by
  charter, and `check:endpoints` was referenced by nothing at all. That is how a
  dead third-party default survived three releases and six versions shipped
  without a tag.
- `verify-gate-contract` asserts the gate list in `scripts/verify.mjs` matches
  package.json, so a new gate cannot be defined and then never run — and forces
  any new script to be classified as a gate or explicitly exempt.

### Fixed

- Settings import is no longer able to destroy a configuration. It was the one
  irreversible action in the product with neither a guard in front of it nor a way
  back: `applySnapshot` overwrote each module blob in a sequential loop with no
  backup and no rollback, so a failure partway through left settings half-imported
  while the user was told the import had failed. Import now writes a restore point
  before the first mutation, rolls every module back if any write fails, says so
  precisely when the rollback itself cannot run, and reports what actually changed
  ("4 options changed, 2 modules updated, 1 left as-is") instead of a bare module
  count. Because import reloads the page, the undo is offered on the next console
  load rather than in a toast the reload would destroy.
- `viewDeleted` told you a comment was "not in archive" whenever anything went
  wrong — every failure collapsed to `null`, so a rate limit, a server error and a
  genuinely unarchived comment were indistinguishable. pullpush rate-limits
  readily, so the misleading branch was the common one. Failures are now typed the
  way `arcticShift` already types them, each gets its own label, and only "not in
  archive" is terminal: transient failures restore the actionable label so the
  link is visibly worth clicking again.
- `imgurFlatten` shipped two non-working mirrors. `rimgo.ducks.party` was gone
  outright, and `imgur.artemislena.eu` — the first-choice default — answered 200
  with an anti-bot challenge page rather than rimgo, so the module resolved it as
  healthy and rewrote album URLs to a host that never returns album HTML. Defaults
  are now `rimgo.reallyaweso.me` and `rmgur.com`, both verified serving rimgo.
- `check:endpoints` gained `anyOf` groups and body assertions. An ordered fallback
  list is now one gate that fails only when every member fails, instead of a
  per-URL gate that failed the run — and claimed the module was "broken out of the
  box" — whenever any single mirror died. Where a host has a recognisable body,
  the probe asserts against it, so a 200 that is really a bot challenge no longer
  reads as healthy.
- `check:endpoints` probed `/api/comments/search` for Arctic Shift, an endpoint
  the extension never calls; it began answering 422 and would have reported a
  broken module. It now probes the `/api/comments/ids` and `/api/posts/ids` routes
  that `buildCommentUrl` and `buildPostUrl` actually construct.

- `chrome/manifest.json` hardcoded `minimum_chrome_version: "114"` while esbuild
  compiled for the browserslist floor of Chrome 125 — a third, unsynchronised copy
  of the supported-browser floor. Chrome 114–124 could install a build transpiled
  for 125 and silently receive no-ops from `@starting-style` and
  `transition-behavior` (both Chrome 117): the same class of failure as the
  `:has()`/`roleHighlights` bug that `browser-targets-contract` was written to
  prevent. The manifest now carries `__browser_min_version__` like the Firefox one,
  so both shipped floors derive from `browserslist` alone.
- `browser-targets-contract` only ever asserted the Firefox half of that claim, so
  the drift it exists to catch was invisible on the Chrome side. It now asserts the
  Chrome manifest uses the token, rejects any bare version literal, and checks that
  both substituted floors resolve to the browserslist value.

## v0.35.1 - 2026-08-14

### Changed

- Old Reddit's sidebar search is now a compact 38px control with a clean
  theme-aware icon, an inline destination picker, and a fully themed focus
  helper instead of the native sprite and orange infobar.
- Header, sidebar, listing, discussion, and combined-search spacing has been
  tightened into a denser desktop rhythm while preserving readable targets and
  the existing content hierarchy.

### Verified

- Signed-in visual audits covered the front page, a focused sidebar search,
  combined search results, and a discussion page at desktop and 1100px widths;
  all audited states remained free of horizontal overflow.
- Browser contracts now pin the search field, action, destination picker,
  helper surface, and combined-search geometry. All 937 unit tests and 16
  extension browser tests pass.

## v0.35.0 - 2026-08-14

### Changed

- Opened old-Reddit posts now use an article hierarchy instead of repeating the
  listing layout: titles are larger, duplicate thumbnails are removed, text
  posts use a comfortable reader measure, and full media previews are centred
  without being stretched.
- Discussion pages now provide a surfaced sort toolbar, a responsive 960px
  composer with a full-width textarea and clearer save action, calmer top-level
  comment cards, accent-tinted nested depth guides, highlighted submitter
  identity, and themed quote/code treatment.
- Community rails now use deliberate join/leave controls, cleaner post metadata,
  stronger sidebar headings and tables, and simplified moderator cards while
  preserving subreddit-authored content and old Reddit's desktop density.

### Verified

- Signed-in live audits covered r/codex listings, a long self-post, nested
  comments, an expanded media post, and r/technology's custom sidebar at
  1440x900, plus the discussion layout at 1100x900. All audited states remained
  free of horizontal overflow; the sort menu opened and closed normally and
  only the active join/leave action remained visible.
- The sanitized discussion fixture now carries real sort, composer, and media
  structure. Chromium contracts pin opened-post hierarchy, preserved and
  centred media, composer/action geometry, sort treatment, and nested depth;
  all 937 unit tests and 16 extension browser tests pass.

## v0.34.0 - 2026-08-13

### Changed

- Old Reddit's combined-search template now uses the refined Graphite hierarchy
  instead of a narrow native results column. The query surface, subreddit and
  post results, filters, highlights, collapsed excerpts, pagination, and empty
  states share one centered 1100px desktop measure and the established card
  system. With decluttering enabled, search-only submission chrome is removed
  and its column is reclaimed; disabling decluttering restores it.
- Search thumbnails now own their block/float/flex geometry instead of depending
  on old Reddit's native stylesheet, including its flex-row shrink behavior.
  Collapsed text results fade into the active theme surface rather than the
  native white gradient.

### Verified

- A signed-in live combined search was compared before and after at 1440×900
  and 1920×1080. The current page returned 25 results, all controls and cards
  aligned without horizontal overflow, long text excerpts stayed compact, and
  the no-results query rendered two deliberate empty surfaces.
- Chromium coverage now drives the real combined-search body class with the
  extension loaded, proves focused mode is reversible, pins query/result and
  thumbnail geometry, rejects a white excerpt fade, and verifies empty-state
  treatment.

## v0.33.0 - 2026-08-13

### Changed

- The opt-in `www.reddit.com` → `old.reddit.com` preference now uses a dynamic
  main-frame request rule, replacing only the scheme and host before modern
  Reddit returns document bytes. Path, query, and fragment survive intact;
  account, login, and advertising routes are explicitly allowed; and the host
  toggle’s **www** link provides a one-page escape. Disabling either the option
  or its module removes the persistent rule.
- Required listing and discussion surfaces now report selector drift through the
  existing local module-error log. Stable matches stay silent, fallback and
  missing matches are aggregated by page type, and repeat visits do not create
  duplicate entries or page toasts.
- Authenticated Reddit JSON reads now share one credentials, content-type, and
  response-shape policy across previews, exports, galleries, saved content,
  author context, crossposts, live comments, and subreddit rules. HTTP 429
  responses retry twice with bounded `Retry-After`/exponential backoff; page
  navigation and caller-owned request scopes can abort in-flight work.
- Applicable RES v5.24.9–v5.24.10 fixes were selectively reimplemented without
  merging the broader upstream fork. Combined-search text posts now expose their
  canonical entry and title link, Bluesky accepts DID/trailing-slash post URLs
  and degrades unavailable oEmbeds cleanly, and the retained Babel/lodash/
  flatted/immutable toolchain packages carry the upstream updates.
- Fresh old-Reddit HTML or MHTML captures can now be imported through a
  deterministic privacy gate. The importer rejects private surfaces, removes
  executable and secret-shaped data, normalizes identities, content, routes,
  and element IDs, preserves only bounded listing/discussion structure, and
  replaces the May fixtures with sanitized August captures.
- The refined old-Reddit skin now removes sidebar cards whose decluttered child
  is hidden, contains the native search sprite in a compact icon target, and
  replaces doubled nested-comment rails with one tighter depth guide.

### Verified

- Chromium accepted all three dynamic rules in the unpacked build. Browser
  coverage toggles the preference on and off, confirms protected and escape
  routes resolve through higher-priority allow rules, verifies old/sh hosts do
  not match, and follows a real main-frame redirect with no `www.reddit.com`
  document response before the old-Reddit fixture loads.
- Canonical, fallback-only, and missing fixture variants exercise selector
  classification. Chromium confirms one fallback warning persists locally,
  remains deduplicated after navigation, and never appears as a toast.
- Response fixtures cover valid JSON, wrong content types, malformed bodies,
  shape mismatches, 401/403, bounded 429 retries, and abort during backoff. A
  Chromium module exercise confirms the helper sends a credentialed, body-free
  GET to a read-only Reddit endpoint; the signed-in live browser independently
  returned HTTP 200 `application/json` for public subreddit metadata.
- Executable module contracts cover combined-search normalization and Bluesky's
  unavailable-oEmbed path. A signed-in live old-Reddit search returned 22
  combined-search rows with `a.search-title` and no native `.entry` class,
  matching the repaired fallback contract.
- Identity/secret bait, raw quoted-printable MHTML, deterministic output,
  private-surface refusal, reviewed URL/ID allowlists, and current selector
  surfaces are enforced in unit tests. The refreshed fixtures retain three
  listing posts plus a non-archived thread composer and four nested comments;
  all 15 extension e2e checks pass against them.
- A signed-in live listing hid both obsolete sidebar wrappers, kept the search
  action at 22×22, and rendered 25 cards without horizontal overflow. A current
  100+ comment discussion retained its composer, top-level cards, and one guide
  per nested depth without horizontal overflow.

## v0.32.0 - 2026-08-13

### Changed

- **Old Reddit now opens in a refined Graphite desktop skin by default.** The
  familiar server-rendered routes and controls remain intact, while the header,
  feed, sidebar, post body, composer, and comments now share one restrained
  dark-surface hierarchy. Users can disable the refined layout independently or
  switch to any of the existing dark palettes.
- The header is compact and sticky; listing Things render as readable cards;
  redundant ordinal ranks and low-value sidebar chrome are removed; metadata and
  actions remain visible but quiet; the subreddit sidebar uses coherent cards;
  and comments use top-level surfaces with lightweight nested reply guides.
- Graphite avoids crushed OLED black and uses a cooler blue accent. Typography,
  form controls, buttons, scrollbars, hover states, reduced-motion behavior, and
  keyboard focus now follow the same page token system.

### Verified

- A fresh signed-in old.reddit home feed, subreddit listing, and discussion were
  audited at desktop size. The compiled theme was injected locally into the same
  live DOM for visual comparison without changing Reddit account data.
- `yarn test`: 918/918; `yarn test:e2e`: 12/12. New browser coverage asserts the
  default Graphite canvas, sticky header, post-card hierarchy, decluttering,
  visible focus ring, and discussion-card rendering. Every palette's body text,
  links, and small metadata clear the WCAG AA contrast contract.
- `yarn lint` matches the recorded 96-error ESLint baseline with clean Stylelint
  and i18n gates. `yarn flow` matches the recorded 124-error baseline across 54
  files.

## v0.31.0 - 2026-08-13

### Added

- **Request-time Reddit ad blocking.** Chrome MV3 and Firefox MV2 now package an
  always-enabled static `declarativeNetRequest` ruleset scoped to Reddit
  initiators. It blocks the observed ad click/measurement hosts, first-party
  analytics paths, ad pixels, and `about-this-ad` assets without intercepting
  requests in the extension process or touching top-level navigation.
- **Paper settings theme.** The complete desktop settings console now has a
  warm light option alongside its eight dark themes. Thirteen selected
  1440×900 ImageGen references cover every category, Console preferences, and
  the global-search state in `design/mockups/`.
- Real-browser regression coverage now proves the packaged ruleset is enabled,
  a Reddit-origin `alb.reddit.com` probe fails with
  `ERR_BLOCKED_BY_CLIENT`, server-rendered and asynchronously inserted promoted
  records remain hidden, ordinary posts survive, and every mockup has the
  expected dimensions.

### Changed

- **Promoted records cannot flash or return on appended listings.** Stable old
  Reddit ad hooks are suppressed by the document-start stylesheet, while the
  always-enabled `removePromoted` module counts and marks those records and
  catches nested promoted labels or `alb.reddit.com` links added later.
- **Settings parity refinement.** Module rails expose explicit On/Off state,
  option controls use matching state labels, related settings are grouped into
  bordered rows, Console preferences fit its Advanced control in the initial
  1440×900 viewport, and global search spans the workspace without an unrelated
  module rail. The same structure was checked at 1920×1080.

### Fixed

- Returning from Console preferences to the already-selected module no longer
  leaves the Console breadcrumb and header behind.
- Settings search no longer reports missing English locale keys for deviantART
  and 500px host modules.

### Verified

- `yarn test`: 917/917 unit tests; production-build Chromium e2e: 11/11.
  The e2e pass covers service-worker aliveness, DNR blocking, initial and async
  promoted records, every settings destination, keyboard operation, first run,
  page-theme rendering, frame scoping, and old-Reddit content-script startup.
- `yarn lint` matches the recorded 96-error ESLint baseline with clean Stylelint
  and i18n gates (571 keys, 0 missing, 1 unused). `yarn flow` matches the
  recorded 124-error baseline across 54 files.
- Production Chrome MV3 and Firefox MV2 archives both report v0.31.0, contain
  the six-rule `ad-block.json` static ruleset, contain no sourcemaps, and build
  successfully. Firefox runtime behavior remains explicitly unverified.

## v0.30.0 - 2026-08-08

### Fixed

- **The module error log rendered in the wrong font entirely.** The v0.29.0
  settings redesign styled it with `font: 11px/1.45 var(--options-font-mono)`,
  and no such custom property is defined anywhere in the tree. A `var()` with no
  fallback and no definition makes the whole declaration invalid at
  computed-value time, and `font` is inherited, so the textarea silently took the
  console's 13px proportional Segoe UI instead of the 11px monospace it asks for.
  Measured in a real browser before and after: `iiiiiiiiii` and `WWWWWWWWWW`
  advanced 31.5px vs 121.4px before the fix and 60.5px vs 60.5px after.
- **A test wrote a bait file into the live source tree and raced the suite.**
  `injected-controls-a11y-contract` proved its scan can fail by writing
  `lib/modules/__a11y_bait__.js` and deleting it. Node runs test files in
  parallel, and `microcopy-contract` lists the same directory, so roughly one run
  in three it listed the bait and then read it after the delete — failing with
  `ENOENT` in a file that has nothing to do with accessibility. The scan already
  took a directory argument, so the bait now goes to a temp directory; a crash no
  longer leaves it in the repo either. Six consecutive clean runs, against three
  failures in nine before.
- The same scan's real-tree run had no guard that it found any files, so an empty
  offender list was indistinguishable from an empty directory.

### Added

- **A gate for the whole class of bug.** `css-custom-property-contract` walks
  every stylesheet, separates `var(--a)` from `var(--a, fallback)` by finding the
  closing paren rather than by regex — `var(--a, var(--b))` nests, and a
  top-level comma is the only thing distinguishing the two forms — and fails when
  a hard dependency has no definition. Neither stylelint nor the build reports
  this: an undefined property is valid CSS, it just does nothing. Bait-verified
  against the shipped v0.29.0 stylesheet, which it fails on.

### Changed

- Two third-party reference files (`CSS.txt`, the 2010 `Reddit_Hide_All.user.js`
  that `hideAll` was rewritten from) moved out of the repo root into
  `.research/source-userscripts/`, where the rest of the reference captures live.

### Verified

- `yarn test`: 911/911 unit tests; headless `yarn test:e2e`: 9/9. `yarn lint`
  remains at the recorded 96 pre-existing ESLint errors with clean style/i18n
  gates, and `yarn flow` remains at its 124-error baseline.
- The settings console was driven in a real browser and the error log's computed
  font measured directly, rather than inferred from the stylesheet.
- Production Chrome MV3 and Firefox MV2 unsigned packages build successfully.

### Note

- v0.28.0 and v0.29.0 were committed but never tagged or published. Both tags now
  exist at their release commits; this release carries the artifacts for
  everything since v0.27.0.

## v0.29.0 - 2026-08-08

### Changed

- **Imagegen-led settings redesign.** All 11 settings categories plus Console
  preferences now share a coordinated three-column system: persistent category
  navigation, a focused module rail, a compact command bar, and an editorial
  settings workspace. The implementation follows a dedicated mockup for every
  menu page rather than applying a single generic restyle.
- **Purpose-built page states.** Privacy modules expose a local-only trust row,
  optional permissions have a deliberate control state, optionless modules have
  an intentional empty state, and disabled modules remain configurable so a
  setup can be prepared before enabling it.
- **Responsive parity.** At compact widths the primary rail becomes icon-only;
  at narrow widths the module rail collapses behind a keyboard-accessible menu
  control while the workspace remains free of horizontal overflow.

### Verified

- Every page was rendered and reviewed headlessly at 1440x900, with additional
  960px and 700px responsive captures and permanent geometry/overflow assertions.
- `yarn test`: 909/909 unit tests; headless `yarn test:e2e`: 9/9. `yarn lint`
  remains at the recorded 96 pre-existing ESLint errors with clean style/i18n
  gates, and `yarn flow` remains at its 124-error baseline.
- Production Chrome MV3 and Firefox MV2 unsigned packages build successfully.

## v0.28.0 - 2026-08-08

### Added

- **Local module error log.** Module stage failures now write a capped, local
  plain-text log that can be copied or cleared from the settings console and
  inspected from the storage dashboard. It never sends errors over the network.
- **Local saved-content manager.** The disabled-by-default saved backup module
  now explicitly syncs the logged-in user's saved posts/comments into an
  IndexedDB index, with local search, user tags, browsing, and JSON export.
  Existing tags survive subsequent syncs; no saved content is transmitted beyond
  the explicit Reddit request.
- **Audit coverage.** The settings console now has a headless browser contract
  for all eight themes, dense/comfortable density, reduced motion, roving tab
  navigation, and keyboard-only activation of controls.

### Verified

- All 73 host handlers were inventoried individually: registration and manifest
  permission coverage remain complete, no host contains a direct dangerous DOM or
  script primitive, and captions/credits/text are sanitized by the shared media
  renderer. The migration list was run against fresh-install, numeric legacy
  version, and first-run-marker upgrade fixtures; each reached
  `5.17.0-firstRun-to-last` without leftover first-run markers.
- `yarn test`: 908/908 unit tests; headless `yarn test:e2e`: 9/9. `yarn lint`
  remains at the recorded 96 pre-existing ESLint errors with clean style/i18n
  gates, and `yarn flow` remains at its 124-error baseline.
- Production Chrome MV3 and Firefox MV2 unsigned packages build successfully.

### Blocked

- Firefox MV2 runtime driving remains in `Roadmap_Blocked.md`: the available
  headless Firefox loader rejected the command-line add-on route, and its
  temporary-addon WebDriver route hung before loading the built zip. No claim of
  Firefox runtime coverage is made from the Chromium checks.

## v0.27.0 - 2026-08-07

### Fixed

- **The comment navigator's condition builder had never worked.** Clicking "by
  conditions" called `.on('change input', …)` and `.get(0)` on the block it had just
  built — jQuery methods, on a library removed in v0.1.0, applied to a plain DOM
  element. It threw `.on is not a function` immediately; and because the click
  handler was wrapped in `once()`, the click was already spent, so a second click
  did nothing at all. The feature was dead in every build since the fork began.

  Both calls replaced with the DOM equivalents. Note that jQuery's
  `.on('change input')` is **two** listeners: a select fires `change`, a text field
  fires `input`, and the builder has both — collapsing it to one would have
  half-fixed it.

### Changed

- **Flow runs now, and the roadmap item's premise was wrong.** It had been
  installed and never invoked, on the recorded grounds that the 2018 `flow-bin`
  "cannot parse what the build strips". It parses the entire tree — zero
  unreadable files across 405 annotated ones — and reported 197 type errors.

  One was the live bug above, which nothing else could have found: eslint does
  not know the type of an expression. That settles the run-or-remove question in
  favour of running it. `yarn flow` holds the count to a committed **per-file**
  baseline and fails in both directions, the same shape as the eslint gate.

  Five libdefs deleted for libraries this fork no longer depends on (jquery,
  lodash, suncalc, favico.js, escape-string-regexp), which took the count 197 →
  177. The parse guard distinguishes the two things Flow files under its `parse`
  kind: a file it genuinely cannot read — which contributes zero errors and looks
  clean, so it must never be baselined — from 0.84 not supporting optional
  chaining with a call, which affects one expression and is counted normally.
  Bait-verified three ways: a new error, a fixed one, and an unreadable file.

- **The Flow libdef knows about DOM APIs from after 2018.** Roughly 20 of the 177
  errors were the bundled `flow/lib/dom.js.flow` not knowing `replaceChildren`,
  `toggleAttribute`, `InsertPosition`, `ParentNode`, `indexedDB` or `CSS.escape` —
  noise that hid the real findings. Baseline 177 → 164.

  Declared as narrowly as the code needs. `indexedDB` is `any` on purpose: a
  detailed-but-wrong libdef is worse than an honest opaque one, and the wrappers
  around it carry their own types.

  What is left is not noise. The `style`/`dataset`/`draggable`/`offset*`
  "missing in `Element`" errors are genuine — those live on `HTMLElement`, and the
  DOM really does not put them on `Element`, so each is a missing narrowing.
  Filed as its own item rather than smuggled into a libdef change.

- **`dragResize`'s whole-body attribute observer was measured and left alone.** It
  was the last observer under suspicion — `{subtree: true, attributes: true,
  attributeFilter: ['class']}` on `document.body` means every class mutation
  anywhere enters JS, and unlike the others its cost scales with page *activity*
  rather than with added content.

  Attaching and detaching the identical observer on the same document, five
  interleaved rounds each way, over 20,000 class mutations on a 3,000-element
  thread: **129.7 ms without, 136.8 ms with** (medians; the runs spread 118–138
  and 128–144, so they overlap). About 0.00035 ms per mutation. A real page does
  not do twenty thousand class mutations.

  Caveat recorded rather than hidden: the callback body never matched, because
  it only fires for elements losing `expando-uninitialized`. So this measures the
  per-mutation dispatch overhead — which is exactly what the item was about, the
  concern being the breadth of the subscription rather than the work it triggers.

  The fixture is a skeleton, so the DOM was grown to a realistic size by cloning.
  Stated because a measurement on 98 elements would have understated it.

- **Two latent crashes fixed, narrowing the `Element` dereferences Flow was
  flagging.** Baseline 164 → 124.

  `hover`'s `_render()` returned `temp.firstElementChild` — nullable — and passed it
  straight to `temp.removeChild()`, which throws on null. An empty or
  whitespace-only template would have failed with a DOM error naming nothing.
  It now refuses with the instance id and the template text. Declaring the
  return type as `HTMLElement` also unblocked **24** errors on its own: the field
  said `HTMLElement` while the method returned `Element`, so every
  `getContainer().style` and `.classList` in the class was unchecked.

  `sourceSnudown` called `button.closest('.thing').querySelector(…)` — a button
  outside a `.thing` would have thrown rather than done nothing.

  The rest was one idiom written out at five call sites:
  `e.target instanceof Element && e.target.closest(sel)`, followed by `.dataset`,
  `.style` or `.offsetTop` on the result — none of which exist on `Element`. The DOM
  is right to withhold them (an SVG element has no `.dataset`), so the fix is a
  shared `closestHtml()` that narrows once and returns null rather than an element
  the caller cannot use.

  `nativeSortable` was a different failure of the same kind: its `instanceof` guard
  did not survive into the listener closures, because the value was a parameter
  and could in principle be reassigned, so every `.draggable` inside a listener
  was unchecked. Bound to a `const` after the guard.

- **The locale file is 1,631 keys → 545.** The rest were upstream RES strings for
  modules this fork deleted.

  The interesting part is what nearly went wrong. Three separate checks said the
  prune was safe, and each was wrong in a different way:

  1. The first scan reported **all 1,631 keys as used** — because it read
     `tests/unit/.tmp-bundle-*/background.entry.js`, the bundler's own scratch
     output, which inlines the whole locale file. A scan reading its own build
     output cannot fail.
  2. `scripts/i18n-lint.mjs` resolves keys the narrow way — explicit `i18n('k')` and
     key-shaped module fields — which is right for catching a *missing* key and
     wrong for deciding deletions. 63 of the `i18n()` calls take a variable
     (`i18n(mod.moduleName)`), so trusting its unused list would have deleted **435
     live keys**. It now uses the opposite, over-inclusive definition for that
     count: a key is used if it appears anywhere at all.
  3. The e2e console check used a *shape* regex for raw keys, which has a blind
     spot by construction — it required a Category/Name/Desc/Title suffix and so
     could not see `settingsConsoleTabAbout`, a tab label and about the most
     visible string in the console. It now compares against the real key list.

  And the root cause behind all of it: `i18n()` echoes an unknown key silently.
  In development it now says so — but only for values actually shaped like keys,
  since this fork passes literal English through the same function on purpose and
  a string with a space in it was never a key. That report is what finally caught
  the `settingsConsoleTabAbout` bait, which reaches `i18n()` as the *value* of a map
  in `lib/constants/` — a route no reasonable source scan resolves.

  The console check also walks every category tab now, not just the one the
  console opens on.

- **A fresh install now says something.** It used to land on old.reddit with 61
  modules already active, no confirmation anything had happened, and no route to
  the settings console. One dismissible toast, once, with a settings link — not
  an auto-opened tab, which is what an extension hijacking a page on install
  feels like.

  The first implementation **could never fire**. It inferred "fresh install" from
  an empty local store, and `migrate()` writes keys in the background before the
  first page finishes loading, so the condition was false on the very first load
  and every load after. Every unit assertion on the predicate passed. Driving the
  extension in a browser is what showed it, and that check now lives in the e2e
  suite — the harness makes a fresh profile per launch, so `onInstalled` fires
  with reason `install` every run, which is exactly the condition under test.

  Now keyed off `chrome.runtime.onInstalled`, filtered to reason `install` —
  it also fires with `update` and `chrome_update`, on every release, for every
  existing user. The handler lives in `lib/environment/background/` rather than
  the entrypoint, because that is where direct `chrome.*` access belongs; the
  nested eslintrc scoping the `webextensions` env is what caught the first draft
  reaching outside the boundary.

  One assertion in the unit contract was rewritten after baiting: it checked that
  the flag is cleared *before* the toast — two tabs opening together would
  otherwise both greet — but searched the whole function body and found the
  early-return path's write, which always precedes the toast. It passed against
  the bug it exists to catch.

- **Four more page-theme palettes — and the discovery that none of them painted
  anything.** Nord, Dracula, Gruvbox Dark and Solarized Dark join the six
  existing ones.

  Driving them found a defect the module has carried since it shipped. The
  `document_start` anti-FOUC style sets `:root.rsm-theme-oled body` to a hardcoded
  OLED background so the page is not white before the theme loads. That selector
  has the **same specificity** as `html.res-pageTheme body`, and it is appended to
  `<head>` after the content-script stylesheet, so it won on source order: every
  palette's background was silently replaced with OLED black. Measured — with the
  early style removed, gruvbox paints #282828 and solarized #002b36; with it
  present, both paint #050608. It is now dismissed once a real palette applies.

  No unit test could have seen that. Both rules are present and correct in the
  stylesheet, the class list is right, and the cascade decides. It is an e2e test
  now, bait-verified by restoring the bug.

  The acceptance said each palette should "pass the existing WCAG AA contrast
  contract". **There was no such contract** — `settings-console-contrast` covers
  the console themes, a different token set on a different surface. Six palettes
  had shipped unchecked and four more were about to. There is one now, over text
  *and* links against all three surfaces, and it caught four genuine failures in
  the new palettes before they shipped.

  Solarized deviates from canon deliberately: its own spec targets a lower
  contrast than AA — base1 measures 3.6:1 on base02, and the canonical blue link
  is 3.1:1 on a raised surface — so the surfaces are kept and the foregrounds
  lightened until they clear.







## v0.26.0 - 2026-08-07

### Changed

- **The options page now has a test proving which modules run on it.** The
  registry contract had claimed an `include`-less module "runs on every page
  including the extension's own options page", which is where two shipped bugs
  (v0.3.5, v0.4.0) came from. That is no longer true: `options.entry.js` pushes an
  allowlist into `allowedModules` and `isRunning()` checks it ahead of `include`,
  `exclude` and `shouldRun` — a fourth gate, and the tightest. Driving the real
  page confirms only the two allowlisted modules run.

  The allowlist itself was untested — one unguarded line no unit contract can
  reach, since `allowedModules` is empty at import time and only the options
  entrypoint fills it. A new e2e test reads the module profiler
  (`window.rsmDiagnostics`) and pins the exact set. It also pins the one real
  leak: the `onInit` and `always` stages are dispatched with
  `skipEnabledCheck: true` and bypass every gate, so three further modules reach
  the options page and must gate themselves. All three do today
  (`pageTheme.always` and `systemThemeSync.always` re-check `Modules.isRunning`;
  `showImages.onInit` checks `isAppType('r2')`) — a new handler that forgets now
  fails the test instead of arriving unannounced.

- **The declared network surface now has a contract, and `connect-src` stays
  `https:` on purpose.** The roadmap asked for a fixed origin allowlist; that is
  not achievable, and the reason is now pinned in a test rather than rediscovered
  each audit. Six surfaces fetch an origin the *user* supplies at runtime — the
  roadmap had recorded four, missing both Arctic Shift `instance` fields — and
  the mastodon handler asks whichever fediverse server the clicked link names.
  No CSP written at build time can enumerate those.

  What is enforceable now is: every `optional_host_permissions` entry must be
  reachable from code (a permission nothing uses is an over-request, which is
  what Chrome Web Store Limited Use targets — all 13 currently are); the Chrome
  and Firefox manifests must declare the same origins, since they spell the
  field differently and a one-sided edit is invisible; reddit must remain the
  only up-front grant; the only cleartext `connect-src` entries must remain the
  two localhost ones; and every free-text option holding a URL must be
  classified as a fetch destination or not. All four manifest assertions were
  bait-verified against a deliberately broken manifest.

- **`yarn test` was a hand-maintained list of 105 file paths.** A new test file ran
  never until someone remembered to append it to a single line in
  `package.json`, and nothing would have reported the omission — the suite just
  stays green with less in it. Replaced by a runner that globs the directory.

  Not a glob passed to `node --test`, which would have been worse: a glob matching
  nothing prints `tests 0` and **exits 0**, and the quoting that would break it
  differs between the shell yarn uses on Windows and the one it uses elsewhere.
  The runner globs in Node, where there is no shell, and refuses to start if it
  finds implausibly few files.

- **`yarn lint` exits 0 for the first time, and can now gate.** It had always
  failed — 166 eslint errors, 1 stylelint error — so it could never be used as a
  check, and a genuinely new violation was invisible against the backlog. Recent
  passes counted the total by hand to prove they had not regressed it, which is
  a habit, not a check.

  Stylelint is at zero. Eslint is at **96**, down from 166: `--fix` took the 62
  mechanical ones (import order, aligned-comment spacing, arrow parens) and eight
  dead imports and one write-only variable were deleted. The remaining 96 are
  deliberate idioms and hot-path choices — `== null` for null-or-undefined,
  C-style loops in `functional.js` and the diff matrix, `.apply` for spreads — so
  they are frozen rather than churned.

  Frozen means `scripts/lint-baseline.mjs` compares **per-rule** counts against a
  committed baseline and fails in **both** directions: a count that rose is a new
  violation, and a count that fell is work to bank with
  `yarn lint:baseline` rather than headroom that silently absorbs the next
  regression. Per-rule matters — the bait run that suppressed one violation and
  introduced another held the total at exactly 96 while the check still fired.

  It also refuses to pass on an empty result, a zero-file run, or any message
  with no rule id, since a parse failure must not be baselinable.

  Two autofixes were reverted by hand: `brace-style` collapsed a three-branch
  if/else in `textDiff` onto one 150-character line. Reformatting is not
  improvement.

- **The whole-document observers were measured and left alone.** A roadmap item
  asked for the two default-ON `MutationObserver`s to be debounced. They were —
  behind `requestIdleCallback` with ancestor collapsing — measured, and the change
  reverted, because it moved nothing.

  Driving the built extension against the captured frontpage with
  infiniteScroll-shaped growth: total wall time 83ms → 89ms paged and 448ms → 461ms
  over 4,500 small appends, both inside a run-to-run spread of 57–111 and 276–933.
  Time-to-paint after a page append, which is the metric batching should actually
  move: p50 10.5ms → 9.2ms, p90 15.5ms → 15.3ms — under one frame either way.

  The premise was wrong. Both handlers scan the *added* nodes, not the document,
  so they are O(added content); and both already had a guard against rescanning
  (`outboundCleanser` a dataset flag, `fixImageLinks` a selector that stops matching
  once the href is rewritten). Complexity that buys nothing measurable is not an
  improvement, so none shipped.

- **`commentShredder` now shows progress and can be stopped.** It runs one request
  at a time at 1–2 per second with a default cap of 100, so a normal run is a
  minute or more of permanent, irreversible deletion — and the only feedback was
  a button whose label changed to "Shredding…". There was no count, no way to
  stop, and if the plan notification hit its two-minute timeout the run continued
  invisibly with nothing left to report into.

  The panel now carries a live "n of N" and a **Stop** button, and the
  notification stays open long enough to outlive a full run. Stopping is checked
  at the **top** of each iteration, never between a comment's overwrite and its
  delete — a stop landing there would manufacture the stranded state (content
  destroyed, comment still visible) that the split try blocks exist to report
  rather than cause. That placement is bait-verified: moving the check one line
  down fails the test.

  A stopped run no longer reads like a finished one. `summariseOutcome` leads with
  "Stopped." and names what was never attempted, because the counts alone cannot
  distinguish "finished, nothing else matched" from "stopped with most of the run
  still ahead". The outcome is written into the panel as well as a toast, since
  the toast can be dismissed mid-run.

  Five executing tests, including one that drives the panel in a real DOM:
  confirming shows the status, the count advances, Stop is what the loop reads,
  and the typed DELETE confirmation is still case-sensitive.

- **The bundle no longer loads in reddit-origin subframes.** `all_frames` was `true`,
  inherited from upstream RES, which used it for an embedded-comments mode this
  fork never enters: `foreground.entry.js` refuses to initialise in any subframe
  unless the URL carries `embedded=true`, and **nothing in this repo ever sets that
  parameter**. So every reddit-origin subframe was parsing 1.36 MB of JavaScript
  for a script that bailed on line 30, and receiving a 287 KB stylesheet that had
  no guard of its own.

  Now `false` in both manifests. The runtime guard is deliberately kept — it is
  what made the change safe, and it is the backstop if the manifest regresses.

  Finding the honest assertion took two attempts. Whether the subframe carries
  the `res` class does not discriminate: the guard already bailed there under
  `all_frames: true`. Neither does `document.styleSheets.length` — content-script
  CSS is injected into an isolated origin and never appears in it, so a count of
  zero was true either way. What does discriminate is the guard announcing
  itself: under `true` the frame logs "Preventing initalization of RES", which is
  proof the bundle was evaluated. That is what the test reads.

- **The buttons injected into reddit's own markup have names now.** The polish
  passes covered the settings console and the newer overlays; the controls pushed
  into the page were never looked at, so several reached a screen reader as an
  unnamed button.

  The scan written to find them turned up **seven the audit had not listed** —
  the six icon-only media-expando controls (settings, rotate both ways, download,
  reverse image search, clippy), which had a `title` and nothing else, and every
  stripe in `threadMinimap`, whose only content is its colour and position, so a
  tooltip was the whole of its name. The media control strip is also a named
  `role="group"` now rather than six loose buttons.

  Also: the two `nextTopComment` jump buttons, whose entire visible content is a
  triangle; `codeBlockCopy`, where every block on the page produced a button
  reading "copy" and the outcome was announced to nobody; `botCollapse`, which
  said what a click would do but never whether the comment was currently open;
  and two buttons with no `type`, which submit whatever form they land in.

  The contract is a source scan, which is normally the shape being removed here.
  It earns it in two ways. Naming is attributed to the **identifier**, not to a
  window of nearby lines — a "next N lines mention textContent" check passes as
  soon as a neighbouring element is named, and N ends up chosen to make the
  current tree green. And it follows one level of same-file indirection, because
  `autoRefreshComments` names its button inside a helper. Both baits verified: an
  unnamed button is reported, and a helper that decorates without naming does not
  launder it.

- **The i18n lint runs now, and checks the direction that matters.** `i18n()` echoes
  an unknown key rather than throwing, so a missing string does not crash — it
  renders as its own name. That is how `privacyCategory` shipped visible as a
  sidebar heading in v0.19.0.

  The check that would have caught it existed in `build/i18nLint.js`, was wired to
  nothing, and looked the **other way** — it reported unused keys, not missing
  ones. Unused keys are untidy; missing keys are a visible defect. The
  replacement (`scripts/i18n-lint.mjs`, wired into `yarn lint`) fails on a key
  referenced in source but absent from en.json, and reports the unused count as
  information. It covers both routes a key takes: an explicit `i18n('…')` call,
  and a module field the console resolves later. Both baits verified — deleting a
  used key and inventing an unknown one each fail the build.

  Single-locale is now the explicit decision, not an accident: `locales/locales/`
  has only en.json and the fork has been replacing keys with literal English as
  it goes, so the layer stays for the console shell only.

  Seven dead upstream build scripts deleted with it — the Travis deploy, the
  changelog deployer, the jscodeshift codemod with no jscodeshift dependency, the
  CRX packer, and the old lint. Nothing referenced any of them.








## v0.25.0 - 2026-08-07

### Fixed

- **One failed request permanently disabled infinite scrolling for the page.**
  `loadNextPage`'s catch set the same `stopped` flag as the two legitimate
  end-of-listing paths, so a transient failure was indistinguishable from having
  reached the last page — scrolling just stopped working, with no retry and
  nothing to explain it. Reddit rate-limits aggressively, so this was routine
  rather than an edge case.

  Failures now retry with a doubling backoff (2s, 4s, 8s) and only give up after
  three consecutive ones, at which point the listing gets a "Could not load more
  posts" notice with a **Try again** button — a rate limit clears on its own, so
  a dead end was the wrong shape. A recognisable API status is passed to
  `notifyRedditApiBlocked`, which is already throttled, so a long scroll cannot
  produce a stream of toasts. Any successful page clears the failure count.

### Changed

- **Unit tests can no longer reach the network.** The jsdom document is served
  from `https://old.reddit.com/`, so any module fetching a reddit URL takes
  `ajax`'s *same-origin* branch — which calls global `fetch` directly instead of
  proxying through the stubbed background. Node has had a global fetch since 18,
  so the request simply went out: a contract written to exercise a failure path
  was quietly succeeding against live reddit, at ~600ms a call and dependent on
  someone else's uptime. `installDom` now installs a guard that rejects with the
  attempted URL named; a test that wants to control the response sets
  `globalThis.__fetchHook`. Suite runtime is unchanged and the failure-path tests
  went from ~600ms to ~2ms each.

### Changed

- **`hover`, `version`, `infiniteScroll` and `newCommentCount` have executing
  contracts**, closing the coverage gap on the inherited modules the README lists
  first. Coverage had been tracking modules added since v0.10 while the ones the
  product exists for had none at all.

  The `version` beacon is the sharpest of them: old reddit blocks expandos for
  anything reporting an upstream RES version below 4.3.2.1, and this fork numbers
  itself far below that — so the beacon publishes a compatibility floor with the
  real version carried alongside in `data-fork-version`. Reporting the fork
  version as the beacon text would silently disable every expando on the site,
  which is now a failing test rather than a footnote in a comment.

- **The three highest-risk security contracts now execute the code they guard**
  instead of pattern-matching it. All three asserted that a call *appears* in
  source, which proves the code is written and nothing else — the same shape of
  contract that let `eventTrackingSabotage` ship a fetch blocker that blocked
  nothing.

  **`download-contract`** drives the real background listener. A `javascript:`,
  `file:`, `data:`, `blob:`, `chrome-extension:` or `ftp:` URL must return an error
  and never reach `chrome.downloads` — asserted by counting calls to a recording
  stub, not by reading the guard. A legitimate download still gets through with
  its filename, and the Chrome build is checked not to forward an `incognito`
  option the API would reject.

  **`notifications-sanitize-contract`** runs eight real payloads through
  `showNotification` in a live DOM and asserts no `<script>`, no inline event
  handler and no `javascript:` URL survives — while `<b>` and a normal link do,
  because callers rely on that. The string shorthand and the HTMLElement branch
  are pinned separately, so only the untrusted branch is the sanitised one.

  **`background-service-worker-safety`** was the weakest of the three: it grepped
  a single file, `migrate.js`, for `document.` and `window.`. The background graph
  is several hundred modules. It now bundles the real entrypoint and evaluates it
  in a sandbox shaped like an MV3 worker global — no `document`, no `window` —
  and additionally asserts the bundle registers a message listener, since a
  silently inert bundle would otherwise pass. Verified by injecting a DOM
  reference into a background module the old contract never looked at.

## v0.24.0 - 2026-08-07

### Fixed

- **Three settings descriptions named controls by their internal option key.**
  "…use the nightModeOn switch below", directly above a toggle labelled **Night
  Mode On**. Inherited upstream copy that was never adapted; it reads as leaked
  developer detail on the one surface a user spends deliberate time in. All three
  now name the visible title, and a contract fails on any string containing a
  known option key.

  One of them was also **untrue**. The NSFW description still said links were
  "added to your browser history" — behaviour that stopped existing when v0.23.0
  removed the `history` permission. It now describes the local visited set it
  actually controls, and a second assertion fails on any string claiming RES-Slim
  writes to browser history.

- **The userbar rendered a dangling separator on logged-out pages.** The floater’s
  `userMenu` container appended a `|` before every item unconditionally. Against
  reddit’s own userbar that reads correctly, because it already has items — but
  the v0.22.0 fallback creates an *empty* `ul` when reddit has not provided one,
  which is exactly the logged-out case the fallback exists to survive, so the
  first item rendered as `| storage` with nothing to its left. A separator now
  only appears between items. Caught in the committed e2e screenshot and pinned
  by an assertion on the rendered userbar, since no unit contract can see it.

- **Expanding one YouTube video marked every YouTube link as visited.**
  `normalizeUrl` dropped the query string wholesale, so every
  `youtube.com/watch?v=<id>` collapsed into the single key `youtube.com/watch`.
  `showImages` ships a YouTube handler, so this was reachable rather than
  theoretical, and the same collision hit any query-keyed host.

  The rule is now a denylist rather than a blanket drop: params survive unless
  they are known-volatile (tracking, CDN signatures, and the sizing hints
  `preview.redd.it` rotates between renders of the same image). Anything
  unrecognised is assumed to identify the resource, because keeping a junk param
  costs one duplicate entry while dropping a meaningful one marks unrelated media
  as seen. Params are sorted into the key so ordering cannot split one resource
  in two.

- **The visited mark no longer dims the link text.** It was `opacity: 0.65`, and
  opacity blends text toward the background, cutting contrast directly:
  old.reddit’s link blue went 4.49:1 → **2.58:1** and nightMode’s 8.02:1 →
  **4.24:1**, both below WCAG AA. Opacity is also the one property a theme cannot
  correct for. It is now a small square drawn in `currentColor` before the link —
  costs the text nothing, needs no per-skin variant, and does not rely on colour
  alone to carry the meaning. Radius comes from the shared scale
  (`--rsm-radius-xs`); the repo forbids fully-rounded backdrops on shipped in-page
  surfaces and an existing contract caught the first attempt at a circle.

- **The visited-link set was write-only, so v0.23.0's replacement for `:visited`
  painting did not survive a page load.** The `.res-visited-link` class was only
  ever applied at the moment a link was expanded, and nothing read the store back
  — it accumulated entries, pruned them, and was never consulted. Reload the page
  and every previously-expanded link came back unmarked, which is not a
  replacement for anything. `checkElementForMedia` now restores the mark for every
  link it examines, via `markVisitedIfKnown`. The read goes through the memoised
  page cache, so a listing of a hundred links costs one storage read.

  The gap existed because the pure helpers were tested and the wiring was not.
  `visited-link-marking-contract` now executes the seam: the class lands on a
  fresh anchor for a URL seen on an earlier load, the option gates reading as well
  as writing, and the scanner is asserted to call it before any early return can
  skip it.

  Two test-harness defects surfaced while writing it, both of the "check that
  always passes" family. `loadModule`'s `chrome.storage.local` stub discarded every
  write and returned `{}` from every read, which makes any storage-backed
  assertion vacuous; it is now a real in-memory store. And two `loadModule` calls
  build two independent bundles, so a module object reached through one is a
  different object from the one the other bundle closes over — setting an option
  on it changed nothing. The registry is now re-exported as `__registry` so a test
  can reach the module the code under test actually reads.

- **`commentShredder` told users a comment had been left alone after irreversibly
  destroying it.** The overwrite and the delete shared one `try`, so a comment
  whose overwrite succeeded and whose delete then failed was counted only as
  "failed" and reported as "left alone". It was not: its original text had been
  permanently replaced with the tombstone and the comment was still publicly
  visible. That is the likely failure shape, not an exotic one — a run makes
  hundreds of writes at 1–2/s and reddit rate-limits writes hard.

  The two failure modes are now distinct and named. *Stranded* means overwritten
  but not deleted: the content is gone and the comment is still there, and the
  summary says exactly that and tells you to run again to finish. *Untouched*
  means the overwrite itself failed and the comment is genuinely unmodified. The
  message is built by `summariseOutcome` in `lib/utils/commentShredder.js` so it
  can be executed by a test rather than assembled inline.

## v0.23.0 - 2026-08-07

### Fixed

- **Three modules that only make sense on old reddit ran on every page**, the
  extension's own options page included: `commentDepth`, `sourceSnudown` and
  `subredditBlacklist` declared no `include`, and `matchesPageLocation()`
  short-circuits to true when the include list is empty. Each now declares
  `include = ['r2']` — the same omission fixed one module at a time in v0.3.5
  and again in v0.4.0.

- **`module-registry-contract` was over-reporting.** It flagged any module with
  no `include` and no `exclude`, but there is a third scoping mechanism:
  `module.shouldRun`, which the framework checks before running any stage.
  `noParticipation` is gated that way (`isNpHostname(location.hostname)`) and was
  being reported as unscoped. That is not a harmless false positive — it sent an
  audit chasing a bug that did not exist, and a list that cries wolf stops being
  read. The check now recognises all three mechanisms, and the pinned list is
  nine modules rather than thirteen.

  Worth recording how that was caught: reading the source suggested
  `noParticipation` would fire a notification on every non-comments page, and
  driving the real extension against a captured listing showed no notification
  at all — twice. The browser was right and the source reading was incomplete.

### Changed

- **Documentation counts are now checked, not maintained by hand.** README, CLAUDE.md
  and ROADMAP.md had each drifted from the tree — 87 host handlers against an
  actual 73, `99 modules` against 98 and then 113 — and every correction so far
  came from a human noticing. A stale count is worse than none: it is the number
  the next reader trusts instead of counting. `docs-drift-contract` pins the
  host-handler count, every module count, and the version badge in README against
  the tree.

- **README no longer calls a public repository private.** It also now says plainly
  that this is one person’s fork with no support commitment, which is the honest
  framing for something published as-is.

### Changed

- **One authoritative supported-browser floor, raised to Chrome 125 / Firefox
  130.** It was declared twice and the two disagreed: `build.js` hardcoded
  chrome 114 / firefox 115, while `package.json`'s `browserslist` said chrome 114 /
  firefox 119 and nothing read it. Only the `build.js` copy reached esbuild's
  `target` and the Firefox manifest's `strict_min_version`, so the package.json
  numbers were decoration and any support claim resting on them was unverified.
  `build.js` now derives both from `browserslist`, and a contract fails if it
  starts hardcoding one again.

  One consequence had already shipped. `roleHighlights` injects a `:has()` rule
  as a runtime CSS string — invisible to esbuild, which is why nothing warned —
  and `:has()` did not reach Firefox until 121, inside the range the project
  claimed to support. It was a silent no-op there. The contract now checks the
  declared floor against the minimum version of every such feature, so a rule
  that would quietly do nothing on a supported browser fails the build instead.

  The raise also brings `popover`, `@starting-style` and `transition-behavior`
  inside the floor, which is what would let the overlay viewer and settings
  console drop their hand-rolled focus-trap and z-index code later.

### Fixed

- **`localCompanion` could never have worked.** Two independent gates stood
  between it and the helper it exists to talk to, and both fail as the same
  `TypeError: Failed to fetch` — indistinguishable from the helper simply not
  running, which is why this went unnoticed.

  First, every cross-origin request in this extension is proxied through the
  background service worker, so the `extension_pages` CSP governs all of them —
  including ones that look like they come from a content script. That CSP said
  `connect-src https:`, which forbids http outright, and the module talks to
  `http://127.0.0.1:7860` by design. Second, a worker fetch to an origin the
  extension holds no host permission for is still subject to CORS, so it would
  only have worked if the user’s helper happened to send
  `access-control-allow-origin`.

  Both manifests now permit `http://localhost:*` and `http://127.0.0.1:*` in
  `connect-src`, and the module requests the localhost origins as an *optional*
  host permission — it is disabled by default, and nobody who is not running a
  companion should be asked for localhost access at install time.

  Only a real browser can show this: jsdom has no CSP. `yarn test:e2e` now
  fetches from the live service worker against a local server, and asserting it
  meant separating the CSP gate from the CORS gate — the first draft failed
  because the test server sent no CORS header, not because of the CSP it was
  written to test.

### Removed

- **The `history` permission is gone from both manifests.** It bought exactly one
  thing: `showImages` called `chrome.history.addUrl()` when you expanded a media
  link, so the browser would repaint that link in its visited colour. Reading and
  writing the real browsing history is a wildly disproportionate price for a
  colour — and "Read and change your browsing history" is the scariest line in
  the Chrome install prompt, the one most likely to make someone cancel.

  The set is now local: `chrome.storage.local` (which needs no permission), keyed
  by a normalised host+path, capped at 5,000 entries and pruned at 90 days.
  Normalisation collapses scheme, `www.`, fragment and query, because the same
  image arrives through a rotating `?utm_source=` and would otherwise miss; path
  case is preserved, since imgur ids are case-sensitive. Private browsing still
  records nothing — a local file is a record too. Writes go through a shallow
  patch rather than a read-modify-write, so two tabs expanding images at the
  same moment cannot clobber each other.

  The one honest regression: these links no longer participate in the browser’s
  native `:visited` painting, because Chrome deliberately hides `:visited` from
  script. `showImages` marks the anchor with `.res-visited-link` instead, styled by
  opacity so it inherits whatever colour the current theme uses and needs no
  variant per skin.

### Fixed

- **A readonly textarea still got the comment toolbar.** `commentTextareaSelector` was built with `join(":not([readonly]),")`, and a join separator goes *between* items, not after each of them — so the last entry, `textarea[name=title]`, carried no readonly guard at all. RES attached its edit bar, character counter and Ctrl+Enter submit handler to readonly title fields. The suffix is now mapped onto every entry, so adding a name to the list cannot silently move the unguarded slot somewhere else.

### Added

- **`commentTools` has a contract.** At 1,222 lines it was the largest module in the repo with no test; the selector above, the character counter (including that it clears `tooLong` again when text is deleted) and the Ctrl+Enter binding are now executed against a real DOM.

## v0.22.0 - 2026-08-07

### Added

- **Modules can now be executed by tests, not just regexed.**
  `tests/unit/helpers/loadModule.mjs` bundles a real `lib/modules/<id>.js` with
  the real `lib/environment` over a stubbed `chrome` surface and a jsdom
  document, and returns its live exports. Before this the only executable code
  was the pure helpers in `lib/utils/`; modules themselves could only be
  pattern-matched, which is how a privacy module that blocked nothing stayed
  green for its whole life.

  The awkward part is a genuine import cycle: `lib/core/modules/modules.js`
  builds its registry from `Object.values()` of the module index at module-body
  time, and the modules in that index import the registry back. The product
  survives it only because esbuild emits in depth-first *post* order, so entering
  at the registry emits the whole index first. Entering at a module file — or at
  the index — arrives from the wrong side and every module reads back as
  `undefined`. The loader therefore enters exactly where `lib/core/init.js`
  does.

- **The wiki-TOC XSS contract now executes instead of pattern-matching.** It
  used to assert that `commentPreview.js` *contained* the string
  `document.createElement('textarea')`, which proves the code is written and
  nothing else — the same shape of contract that let a fetch blocker that blocked
  nothing stay green. The decode step moved to `lib/utils/html.js` as
  `decodeEntitiesAsText` so it can be called, and the contract now runs real
  attack strings through it in a real DOM and counts the live elements in the
  document.

  Writing it surfaced how easy the useless version is: the first draft fed the
  decoder **entity-encoded** input (`&lt;img&gt;`), which is harmless in a
  `<div>` too, because `innerHTML` resolves a character reference into a text
  node rather than a tag — so it would have passed against the vulnerable code.
  The input is `header.textContent`, which is *raw* markup by that point, and
  only the raw form distinguishes the two elements. The contract also covers
  `</textarea>`, the one input that could plausibly break out of RCDATA.

- **A registry-wide contract over all 113 modules.** Rather than 33 bespoke
  files for the 33 untested modules, `module-registry-contract` loads the real
  registry and asserts what must hold for every module: unique ids, metadata the
  console needs, a category the console knows how to sort, enum defaults that are
  actually among their own values, option types the console can draw, and that
  the index and the registry agree on how many modules there are. Each assertion
  matches a bug this repo has shipped.

  The first version of the category check **passed while checking nothing** — it
  imported the wrong export name from a Flow-annotated file, caught the failure,
  and returned early. It now fails if the constant does not load, and both gates
  were confirmed by breaking a module and watching them go red.

- **`settingsNavigation` has a contract**, the first of the 33 untested modules
  to get one. It is `alwaysEnabled` and owns every route into the settings
  console, and it had no test at all.

### Fixed

- **`isSettingsUrl` and `parseHash` disagreed about what a settings URL is.**
  v0.3.8 taught `parseHash` that the settings prefix must be followed by `/` or
  end-of-string — otherwise a route like
  `#res:settings-redirect-standalone-options-page/…`, which merely starts with
  the same literal, parses as a module named after the remainder. That fix never
  reached `isSettingsUrl`, which the click handler uses to decide whether to
  intercept. So a click on such a route *was* intercepted, then parsed to no
  module, and the navigation was swallowed. Both now share one `isSettingsHash`
  helper so they cannot drift apart again.

- **`makeUrlHashLink` interpolated three values into markup unescaped.**
  `displayText`, `cssClass` and the `optionKey` inside the `title` attribute all
  went in raw, and both callers wrap the result in `string.safe()` — so whatever
  it returns is trusted as HTML and inserted into reddit's own pages. Escaped at
  the source rather than at the call sites.

### Added

- **A real browser harness — `yarn test:e2e`.** Three roadmap items and a parked
  Nightwatch suite all rested on the belief that automated extension loading was
  unavailable. It is available; it just is not Chrome. Chrome stable silently
  ignores `--load-extension` (no error, no extension, an empty target list that
  reads exactly like a broken build), but Playwright's bundled Chromium still
  honours it, and `channel: 'chromium'` selects the build whose headless mode
  loads extensions — so the suite runs headless with no display at all.
  `tests/e2e/` asserts the MV3 service worker registers, the settings console
  renders in the options page, and the content script initialises on a served
  old.reddit document, screenshotting the last two.

  Each gate was verified by breaking the thing it watches. That immediately paid
  for itself: **asserting only that a `serviceworker` event fired passes against
  a completely dead background**, because Chromium registers and exposes the
  worker target even when the script throws on its first line. The test now
  performs a message round-trip through the worker's own listener registry, which
  a throwing worker cannot serve.

### Fixed

- **Both MHTML fixtures were classified as *new* reddit.** `appType()` reports
  `'r2'` purely on the presence of `<html xmlns>` and otherwise falls back to
  `'d2x'`; the committed fixtures had no such attribute, although the real
  captures they were derived from do. Around 40 modules declare
  `module.include = ['r2']` and are skipped entirely on `'d2x'`, so every
  selector contract in the suite was describing a document the product would have
  treated as the redesign. Both fixtures now carry the attribute, and
  `selector-map-contract` pins it.

- **The floater's `userMenu` container threw on every logged-out page.** Its
  `isAvailable()` checks only the app type, so it ran on all of old reddit, but
  `go()` dereferenced `document.body.querySelector('#header-bottom-right ul')`
  unconditionally — and a logged-out userbar holds a login form with no `ul`. The
  `TypeError` escaped from inside a `contentStart.then()` with nothing to catch
  it, taking down every floater consumer on the page. The sibling `tabMenu`
  container in the same file has always handled this case; `userMenu` is the copy
  that never got it. Found the moment the fixtures started classifying correctly.

  Two more null dereferences of the same shape are fixed alongside it:
  `inNavbar.updateHeaderWidth` reads `.header-user-dropdown` in a throttled frame
  long after `isAvailable()` saw it, on a surface that re-renders its own header,
  and `visibleAfterScroll` called `IntersectionObserver.observe(null)` when
  `#header` was absent.

## v0.21.0 - 2026-08-07

### Changed

- **The orphaned Phase-5 engine is resolved.** A reachability walk from the
  four esbuild entrypoints found a whole second feature engine with zero
  importers, kept alive only by contract tests — so the suite counted coverage
  of code that could never run. `lib/core/registry/`, `lib/core/settings/`,
  `lib/core/errors/`, `lib/core/dom/{findElement,toastHost,waitForElement}.js`,
  `lib/utils/idbBackup.js` and `lib/vendor/guiders.js` (617 lines) are deleted
  along with their three contract tests.

  `lib/core/dom/selectors.js` was kept and **wired in** instead: it is the
  resilience asset for the DOM churn Reddit has announced, and it was built and
  left unused. It gained `findSurface()` / `matchedSelectorFor()`, which try the
  stable selector then each fallback in order, and `hideAll` and
  `randomSubreddit` now resolve their injection points through it — a module
  that hardcodes one selector silently no-ops when a class is renamed, with
  nothing thrown and the feature simply absent. The resolver identifies elements
  by `nodeType` rather than `instanceof HTMLElement`, which is false for a
  perfectly good element handed across realms from an iframe document.

  Test count drops 685 → 674 and now reflects only executing code.


- **Upstream v5.24.9 / v5.24.10 fixes cherry-picked.** Upstream revived after
  14 months; these are the changes that apply to code this fork also ships.
  `snudown-js` 4.0.1 → 4.1.0 (#5589) for spoiler-tag rendering against current
  old.reddit output, which `spoilerTags` and `sourceSnudown` both depend on.
  Pastebin embeds (#5583): the `embed_iframe.php?i=` form now 404s, pastebin
  moved it to a path segment. Bluesky (#5561): the profile segment of the
  detect regex was `[\w.-]`, which excludes the colons in a DID — so every
  DID-addressed post URL went undetected. Bluesky oembed HTML is also now
  styled, since a content script cannot load bsky.app's embed.js and the
  expando rendered as an unstyled wall of text.

  Not taken: #5570 (gallery expandos), which upstream reverted the same day in
  #5595. #5574 (Firefox legacy favicon) patches `orangered.js`, a module this
  fork stripped — but its finding, that Firefox re-resolves the favicon at load
  without mutating the DOM, does apply to `classicFavicon`, whose
  MutationObserver cannot see that. A one-shot `load` re-apply was added.
  Everything else since v5.24.8 is dependency bumps or account-switcher work on
  a module this fork does not ship.

- Deleted `lib/css/modules/_styleTweaks.scss`, which `res.scss` never imported
  — the same dead-partial class as the two removed in v0.17.0.


- **`fencedCodeBlocks` is on by default.** Triple-backtick rendering is the
  most-requested unshipped old.reddit feature in upstream's tracker (issue
  #5223, open since 2020), old.reddit renders a fenced block as literal text
  with the backticks showing, and the fork already implemented it — behind a
  default-off toggle, so the differentiator shipped invisible. Syntax
  highlighting stays opt-in: rendering the block is a fix, colouring it is a
  preference.
- **The Firefox build has its own add-on ID** (`res-slim@sysadmindoc`). It was
  shipping upstream RES's AMO ID, so it collided with an installed RES and the
  two could not be side-loaded together.
- **Both Firefox manifests declare `data_collection_permissions: ["none"]`.**
  AMO has auto-rejected submissions without the key since 2025-11-03; a
  no-telemetry extension is the trivial case, so its absence was pure paperwork
  blocking any Firefox distribution.

### Tests

- **The ten `lib/utils/__tests__/` specs run for the first time.** They were
  written for ava, which is not installed, and `ava.config.mjs` pointed at
  `dist/transpiled/**` — a path nothing produces — so roughly 800 lines of
  genuine assertions covering `array`, `async`, `color`, `escapeHTML`,
  `generator`, `location`, `math`, `object`, `string` and `value` had never
  executed. Rather than rewrite them, `tests/unit/utils-specs.test.mjs` adapts
  them: a shim supplies ava's assertion surface on top of `node --test`, and
  `lib/utils` and `lib/core/dom` are mirrored to a temp tree at their real
  relative depth with Flow stripped, so the specs’ own imports resolve
  unchanged. A spec that fails to load is reported as a failure, not skipped.

  Two things had to be modelled properly to make them pass, and both are why a
  naive port would have quietly dropped cases: ava's **test macros**
  (`test(title, implementation, ...args)`), which `location.js` uses for every
  one of its cases, and `throwsAsync`, whose expected `message` may be a RegExp
  rather than a string.

- Deleted `ava.config.mjs`, `nightwatch.conf.js`, and the 32 Selenium specs in
  `tests/*.js` — neither runner was installed, 17 of the specs targeted modules
  stripped in v0.1.0, and they drove live reddit URLs.

  Test count 674 → 762.

### Build

- **`yarn build` now produces both targets.** `--browsers` defaulted to Chrome
  alone, so the documented release command emitted a Chrome-only artifact.
- **Production emits no sourcemaps.** The condition was
  `!isProduction || !noSourcemap`, which is true for any target that does not
  set `noSourcemap` — i.e. Chrome — so the Chrome package shipped `.map` files
  carrying every original source. `chrome.zip` drops from 2.4 MB to 1.1 MB,
  matching Firefox. Dev builds keep their sourcemaps.
- **A build that fails a gate no longer leaves a shippable zip on disk.**
  Zipping was an esbuild `onEnd` plugin registered *before* the bundle-budget
  and dashjs-integrity gates, and esbuild runs every `onEnd` callback and
  aggregates their errors — so reordering the plugins would not have been
  enough. Zipping moved out of the plugin list to after `esbuild.build()`
  resolves. Verified by making a budget fail and confirming no zip is written.
- **The bundle budget covers `res.css`, `options.css` and the vendored dash
  player**, which together were larger than everything it did cover, and a
  budgeted file that is missing now fails instead of being skipped.

### Security

- **Dependency advisories patched.** `postcss` 8.4.45 → 8.5.26, with a
  `resolutions` entry so stylelint's transitive `postcss@8.4.38` is gone too —
  `yarn why postcss` now reports a single resolved version. Clears
  GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 and GHSA-fxqj-rqcc-2cmp, all of which
  allow arbitrary `.map` file reads when compiling attacker-influenced CSS, and
  the build compiles `lib/**/*.scss` through `esbuild-sass-plugin`.
  `dompurify` 3.4.11 → 3.4.13 clears GHSA-c2j3-45gr-mqc4 (allowed custom elements
  bypassed the `afterSanitizeElements` hook); DOMPurify is the sanitizer behind
  comment preview, notifications and oembed host HTML.

### Fixed

- **Both dead third-party defaults replaced.** `imgurFlatten` shipped
  `ri.bcow.xyz`, which returns 403 — the second dead default in a row after
  `rimgo.totaldarkness.net` went to 502 — so imgur album expansion was broken
  out of the box. The setting is now an ordered list, probed at first use, and
  the first host that answers wins; a 429 counts as alive (rate-limited is not
  dead), and a toast appears only when every mirror is down. Shipped defaults
  were probed on 2026-08-07 and only hosts that actually answered are included
  — `rimgo.privacyredirect.com`, which several published instance lists carry,
  did not resolve and was left out. `cobaltDownloader` shipped
  `api.cobalt.tools`, which cobalt documents as bot-protected and not intended
  for use by other projects, and which is YouTube-blocked, so it both violated
  the operator’s terms and did not work. The default is now empty and an
  unconfigured module says so with a link to the self-hosting guide, instead of
  reporting a request it never had an instance for as "all instances failed".

- **The options-page bootstrap adopted its origin and user hash from any
  sender.** `retrieveFromParent()` resolved on the *first* `message` event it
  received, with no origin or shape check, and `Object.assign`ed the payload onto
  the shared context. `options.html` is web-accessible and runs as an iframe
  inside reddit pages, so any cross-origin frame there — a media embed, an ad
  frame — could win the race and set both. The attacker-controlled `origin` then
  became the base URL for every options-page request (sent with
  `credentials: 'include'` and an `X-Modhash` header) and the base every console
  link was rewritten through. The bootstrap now ignores untrusted senders and
  keeps listening, validates the payload shape, re-validates `origin` even from a
  trusted sender, copies only known fields, and falls back to defaults after 10s
  rather than hanging. The sender predicate moved to `lib/utils/trustedOrigin.js`
  so the console handler and the bootstrap cannot drift apart.

- **`oldRedditRedirect`’s auto-redirect was inert.** `module.include` was
  `['r2']`, and `appType()` returns `'r2'` only when `<html>` carries old
  reddit's `xmlns` attribute — on www.reddit.com it returns `'d2x'`. So the
  module never ran on the host it exists to redirect away from, and the
  `location.host === 'www.reddit.com'` guard inside `maybeRedirect()` was
  unreachable code. The include now covers both; the host-toggle pill stays
  r2-only, since it mounts into old.reddit's userbar.
- **Migration checkpoints are awaited.** `Storage.set('RESOptionsVersion', …)`
  was fire-and-forget despite the adjacent comment calling it a crash
  checkpoint. `migrate()` runs on every MV3 service-worker start, and the worker
  can be torn down mid-loop, so the checkpoint could fail to land and
  already-applied migrations would replay on the next wake.
- **The first-paint watcher queue no longer drops Things.** It was an array plus
  a counter that a 30-second `setInterval` reset to zero, while each pending
  `check` closure held its own index `n` and ran `delete queue[n]` when it
  fired. After a reset that index belonged to a *different*, newly-enqueued
  Thing, which was then removed without ever running its tasks — rendering with
  no expando and no filtering, silently. The queue is now a `Map` keyed by the
  Thing itself, and the reset swaps the map rather than clearing it, so a stale
  closure can only ever remove its own entry.

- **`eventTrackingSabotage`'s fetch blocker had never blocked anything.** The
  wrapper answered a matched tracker request with
  `new Response('', { status: 204 })`; 204 is a null-body status, so that
  constructor always throws, the surrounding `catch (_) {}` swallowed it, and
  execution fell through to the real `fetch`. Every `fetch`-based beacon this
  default-ON privacy module claimed to block had been going out since the module
  shipped. The `sendBeacon` and XHR paths use different mechanisms and did work.
  The body is now `null`, a block that cannot be faked rejects rather than
  forwarding, and every previously-silent `catch` reports. The page script moved
  to `lib/utils/eventTrackingSabotage.js` so the contract can build it and *run*
  it in a `node:vm` sandbox against stub globals — a source-regex assertion is
  what let this ship, and the new tests fail if the bug is restored.

## v0.20.0 - 2026-08-06

Fifteen new modules, rewritten from the highest-install reddit userscripts on
Greasy Fork. The landscape was surveyed properly for the first time (618 scripts,
450 reddit-relevant, ranked by total installs) and every module below closes a
gap that survey found — not a reimplementation of something already shipped.

Nothing is vendored. Each module is a fresh implementation; the header of every
file names the script whose idea it carries and, where relevant, what that script
got wrong and why this one differs.

### Privacy and account

- **`commentShredder`** — bulk overwrite-and-delete of your own comments,
  filtered by age, score, subreddit and award status. The largest gap in the
  ecosystem by installs, and the only irreversible thing in the extension, so:
  preview-first (`dryRun` defaults on), overwrite always precedes delete, an
  empty allow list selects *nothing*, there is a per-run cap, and arming it
  requires typing `DELETE`. Every skip carries a reason the preview shows.
  Off by default; the control only appears on your own profile.
- **`visitedPosts`** — dims or hides posts you have already opened, from a local
  store of post IDs. The comparable userscripts request the browsing-history
  permission to do this; this asks for nothing, and is the local visited-set the
  roadmap needs in order to drop `history` from both manifests.
- **`preventAutoTranslate`** — strips reddit's `?tl=` machine-translation
  parameter from the address bar *and* from every link on the page, because a
  translated page renders every link carrying it. On by default.

### Reading and comments

- **`autoLoadMoreComments`** — clicks the "load more comments" stubs. Capped,
  rate-limited, and it stops when two consecutive rounds add no comments, which
  is what a rate-limit response looks like from the DOM.
- **`usernameColors`** — a stable colour per author. Only the hue comes from the
  name; saturation and lightness are fixed per band so every generated colour
  clears WCAG AA against its background, checked across all 360 hues at every
  saturation. Reddit's own submitter/mod/admin/friend colours are left alone.
- **`brokenLinkFixer`** — repairs links whose target reddit escaped incorrectly,
  the reason some links with underscores or parentheses 404 while the link text
  looks right. Only a backslash in front of a character snudown would have
  escaped is treated as an escape, and `javascript:`/`data:` URLs are never
  rewritten. On by default.

### Appearance

- **`systemThemeSync`** — follows the OS light/dark preference and keeps
  following it while the tab is open, with a dark-only mode for people whose OS
  flips during the day.
- **`karmaHide`** — hides scores and karma with CSS, so voting still works and
  score-based filters still see real values. Reveal-on-hover is scoped to exactly
  the elements that were hidden.
- **`restoreVoteArrows`** — forces arrows visible in subreddits that hide them,
  cancelling all four techniques their stylesheets use rather than just
  `display`, which is why the single-rule userscripts fail half the time.

### Navigation and search

- **`searchScope`** — one module for three long-standing single-purpose scripts:
  keep a subreddit search inside the subreddit, stop excluding adult results,
  request the legacy search backend. `restrict_sr` is deliberately *not* applied
  to a site-wide search, where reddit answers it with zero results. Written as
  form fields, not just the action URL, because the form submits as a GET.
- **`flairLinkify`** — post flair becomes a `flair_name:"…"` subreddit search;
  user flair links to that author's posts in the same subreddit. Quotes in a
  label are stripped rather than escaped — reddit's query parser has no escape
  character, so a quote silently truncates the query.
- **`randomSubreddit`** — a "random" link in the subreddit bar. Points at
  reddit's own `/r/random`; the comparable script routes the pick through a
  third-party host.
- **`loginRedirectFix`** — returns you to the page you were reading after login.
  The `dest` value is built from location parts and refuses absolute URLs,
  protocol-relative paths, backslash-prefixed paths and control characters,
  because `dest` is an open redirect if it can name a host.

### Media

- **`reverseImageSearch`** — Google Lens / Yandex / TinEye / Bing / SauceNAO
  links on image posts. Link construction only: nothing is uploaded and no engine
  is contacted until you click. Prefers the post's own image over the ~70px
  thumbnail, which is what makes the userscript versions return nothing.
- **`nsfwThumbnails`** — replaces the flat NSFW placeholder tile with the preview
  reddit already sent in the row's markup. No fetch, no age-gate bypass; restored
  thumbnails are outlined so they are not mistaken for ordinary ones.

### Tests

650 unit tests, up from 545. Every new module's logic that can be executed is
executed rather than pattern-matched — the pure core of each lives in
`lib/utils/` and the contract imports and runs it through a shared
`tests/unit/helpers/loadFlowModule.mjs`.

Two bugs the new tests caught before release:

- The first username palette put yellow at **3.96:1** on a white page, and raising
  saturation dropped it to 3.2:1. The band is now derived from the worst hue, not
  the average, and the light band clamps saturation.
- The comment-stripping helper both this suite and `hide-all-contract` use was
  **disarmed on a CRLF checkout**: `//.*$` never matches when a `\r` sits at the
  end of the line, so every "this module never calls X" assertion silently passed
  against unstripped source. Both now split on `\r?\n` and strip with an explicit
  character class.

## v0.19.0 - 2026-08-06

### Settings console navigation

- **Category tabs replace the single scrolling module list.** All 99 modules
  used to sit in one accordion column; the sidebar now lists only the open
  category (14 rows instead of 95 on first paint), and a `role="tablist"` strip
  across the top carries every category with its module count. Arrow keys,
  Home/End and a roving tabindex work as the role promises; the strip scrolls
  sideways below 960px and the selected tab is scrolled into view.
- **The right-hand utility rail is gone.** Console-level controls (theme,
  density, motion, import/export, advanced options, build) moved into a
  dedicated **Console** tab, taking the console from three columns and four
  control regions down to two columns and one. Save/Revert and the staged-change
  status moved into the header, where they stay visible from every tab.
- **Categories with unsaved changes stay marked** while you are on another tab,
  so Save no longer looks like it only applies to what is on screen.
- Filter chips (All/On/Off/Modified) now count and filter within the open
  category, and reopening a category returns to the module you left.
- The Console tab is addressable at `#res:settings/console`.

### Fixed

- **Privacy and About were sorted to the top of the module list** ahead of
  Comments and Appearance: neither category appeared in the console's sort
  order, and a missing entry resolves to index -1. All eleven categories are now
  listed in `lib/constants/settingsCategories.js`, with a test that fails if a
  module ever declares a category the list has not got.
- **The Privacy category rendered as the raw string `privacyCategory`** — it had
  no locale entry, and `i18n()` falls back to echoing the key.
- **Night mode repainted the console's own buttons.** `.res-nightmode button` in
  `res.css` is meant for Reddit's form controls, but the options page loads
  res.css and carries `res-nightmode`, and at specificity (0,1,1) the rule
  outranked every class-based button style in `options.scss` — the filter chips,
  theme swatches, Export/Import, Dense and Reduce-motion buttons all rendered as
  grey outset UA buttons. The rule now excludes `#RESConsoleContainer` via
  `:where()`, so Reddit's buttons keep both their look and their specificity.
- **The console scrolled the page sideways** at narrow widths: its single grid
  column was implicit, so it sized to the widest row's min-content instead of
  the viewport.

## v0.18.0 - 2026-08-06

**New module: `hideAll`** (disabled by default). Adds a "hide all" link to the
listing tab menu that hides every post on the page in one action.

Rewritten from Douglas Beck's 2010 "Reddit Hide All" userscript (Greasy Fork
6544), kept in the repo root for provenance. Only the idea carried over — the
original appended a `<script>` element to the page so it could borrow reddit's
own jQuery internals (`$.thing_id()`, `get_form_fields`, `reddit.modhash`), fired
one unthrottled POST per post, and reported through `alert()`. This version:

- talks to `/api/hide` through RES-Slim's own ajax helper, with no page-world
  injection — reddit's internals are not an API, and a page CSP can refuse the
  injected script outright
- reads the modhash through the shared `loggedInUserHash()` helper, which falls
  back to `/api/me.json` on pages where reddit renders no hide form, and refuses
  to run without one rather than leaving posts visible after an apparent success
- throttles through the shared rate limiter at a configurable 2/3/6 requests per
  second — the original author's own source comment complained about the request
  volume
- is reversible: the result notification offers Undo, which calls `/api/unhide`
  and reports its own partial failures instead of reading as a clean restore
- skips stickied posts by default, and anything reddit has already hidden
- reports through the notification surface, never a blocking dialog

Verified against a captured old.reddit listing served offline: 25 posts hidden
with correct `id`/`uh` bodies, "Hid 25 posts." with a working Undo, all 25
restored, zero uncaught exceptions. The no-modhash refusal path was exercised
too.

Also adds `/*.user.js` to `.eslintignore`: reference userscripts are provenance,
not source, and linting this one added 79 errors to the baseline.

Test count 535 (was 525).

## v0.17.0 - 2026-08-06

Roadmap drain of the items v0.16.0 left open. The v0.16.0 pass verified CSS and
measured chips on a synthetic fixture; this one ran the extension against real
captured old.reddit pages, which found four bugs source review could not.

**Bugs found by driving the real thing:**
- **userTagger rendered nothing on a normal page load** — no `[+]` triggers and
  no tag badges. `watchForThings` appends to a list and never replays, and the
  things already on the page are walked once during `contentStart`, so
  registering the watcher after two `await`s installed it too late to see any of
  them. It still worked for things added later by ajax, which is why it looked
  healthy in isolation. `dragResize` had the same shape and skipped every expando
  present at load.
- **The user tagger popover was clipped and its Save button unclickable.** reddit
  gives `.entry` `overflow: hidden` and the entry is shorter than the popover, so
  the colour row, the ignore checkbox and the whole Save / Clear / Cancel row fell
  outside the clip — in the DOM, invisible, unhittable. The popover is fixed
  positioned now and anchored in viewport coordinates.
- **searchDispatcher was unreadable at 1.1:1** with nightMode on. nightMode
  declares `.res-nightmode #search select { color: #1a1a1a }` to keep reddit's own
  select legible on its white field background, and that outranks a bare class, so
  the v0.16.0 ink token never applied. A form control cannot lean on the page
  ground either, since the browser paints a `<select>` on its own field
  background, so it now sets an opaque background and foreground together via a
  new `--rsm-page` token.
- **An offline user-info lookup threw an uncaught rejection** on every page load
  without network. `loggedInUserInfo()` rejected and its only caller fires it
  without awaiting. A failed lookup is the same outcome as a logged-out one, which
  the return type already allowed, so it resolves to `undefined` and logs once.

**Coherence:**
- The permissions prompt follows the theme picked in the settings console instead
  of always painting graphite blue, and draws the RS monogram rather than the
  upstream RES alien bitmap it was inheriting from `res.css`. The theme table
  moved to `lib/constants/settingsThemes.js` so one file feeds both surfaces —
  `lib/environment` may not import from `lib/core`, and this is dependency-free
  data.
- Removed the two SCSS partials for modules stripped in v0.1.0, after confirming
  nothing imports them.
- README no longer links four planning files that are gitignored and so were dead
  links on GitHub; `COMPLETED.md` is gone.

**Verified:** modules driven against captured old.reddit listing and thread pages
served offline through request interception, with zero uncaught exceptions; the
console's table option exercised end to end (add, fill, delete, stage, save,
storage round-trip) and the keycode modal confirmed to capture on focus and
disarm on blur; Firefox MV2 built and Firefox 153 confirmed to resolve the whole
token layer — `color-mix()`, `:focus-visible`, the radius scale, ink and severity
tints.

Test count 525 (was 520), including a contract that scans every module for a
watcher registered after an `await` in a racing phase and self-tests that the
detector fires on that shape.

## v0.16.0 - 2026-08-06

Premium polish pass across every user-facing surface. Most of what follows are
defects that only appeared once the extension was actually rendered — the code
and CSS read as correct in all of these cases.

**Broken features fixed:**
- **Settings search returned nothing, ever.** Three independent faults: the
  results container was hidden by a stylesheet rule that the module tried to
  clear with an inline style; result descriptions containing `<a>` tags (several
  modules have them) made a nested anchor, so the HTML parser split the template
  and `string.html` threw once per result; and zero matches left a blank box.
  Search now renders, has a real empty state naming the query, and no longer
  paints an empty options card beneath the results.
- **The permissions prompt shipped with no styling at all.** The manifest
  declares `script-src` but no `style-src`, so `default-src 'self'` blocked the
  page's inline `<style>` outright. The screen that asks for browser access
  rendered as raw HTML. Styles now build as their own stylesheet entry point —
  not by adding `unsafe-inline` to the policy.
- **17 of 97 module summaries were cut mid-word** in the sidebar, because the
  first-sentence split treated every full stop as a sentence end. `fixImageLinks`
  read "Rewrites i"; `pageTheme` read "Dark / OLED skin for old".

**Contrast — the in-page UI was authored against dark reddit only:**
- Every injected chip used near-white text on a translucent white fill, so on a
  default (light) install they were invisible. The worst was arcticShift's
  restored comment body — the recovered text the module exists to show — at
  about 1.4:1. Also affected: author badge, per-sub sort, auto-refresh status,
  comment-tree export, user tagger trigger, local companion, bait/filter/repost
  badges, promoted counter, search dispatcher, edited-comment diff.
- All 20 inline surfaces now clear WCAG AA on white *and* on a dark page,
  measured by compositing against the real stacked backgrounds rather than by
  eye. A contract recomputes both grounds from the tokens.

**Theming:**
- The settings console hardcoded graphite's blue in fifteen places — selected
  category, active filter chip, staged-change highlight, module toggles, save
  button, search panel — almost always as the border around a fill that *did*
  follow the accent. Seven of the eight themes drew blue outlines around
  accent-coloured fills; the default OLED theme was the worst case. Focus ring,
  text selection and tap highlight were blue in every theme.
- Accent tints are now derived once from `--options-accent`, so a theme sets one
  colour. The contrast contract covers all three tints across all eight themes
  (24 checks, up from 8) and fails if a theme opts out by redeclaring one.

**Accessibility:**
- Several modules collapsed `:hover, :focus-visible` into one rule and then set
  `outline: none`, leaving keyboard users with no focus indicator. Focus is now
  one outline defined once for every RES-Slim surface, and hover no longer fires
  the focus ring on pointer users.
- Status is never carried by colour alone: toasts gained a severity glyph and a
  screen-reader-only severity word, auto-refresh gained a state dot, the edited
  diff underlines insertions and strikes deletions.
- The user tagger's 14px trigger now carries a 24px hit area without disturbing
  reddit's tagline layout. `prefers-reduced-motion` is honoured once globally.

**Interaction and states:**
- `storageDashboard` purged a database irreversibly on a single click with no
  Escape, no click-outside and no focus handling. It now arms and confirms
  inline, reports failures with a retry, and explains what it holds.
- Toasts auto-dismissed after 4.2s regardless of what the user was doing; hover
  and focus now hold them open and release resumes the remaining time.
- The notification panel rendered a 40px empty dark bar whenever it had no title
  — which is the case for the console's own "enabled X" messages, the most
  frequently seen notification in the product.
- Loading states now read differently from empty ones (shimmer/pulse), the image
  viewer shows a loading sweep and says what to try when an image fails, and
  open menus no longer look identical to hovered ones.

**Foundations:**
- New `lib/css/_tokens.scss`: one palette for every injected surface, split into
  overlay tokens (floating panels, always dark) and ink tokens (inline chips,
  flip with nightMode/pageTheme). Radii come from a 4/6/8/10/12 scale; the only
  remaining circular radii are loading spinners.
- Microcopy pass: permissions are described in words rather than raw host
  patterns, failure messages say what state the data is in and what to do, and
  the upstream `/r/Enhancement` link was dropped.

Test count 520 (was 495), including new contracts for search rendering, inline
chip contrast, module summaries, prompt-page CSP, and a no-pill-radius sweep.

## v0.15.2 - 2026-07-09

**Features:**
- The `filterRules` module now ships with a default rule that hides submission posts whose titles begin with "I built" (case-insensitive, whole-word, post-only — comments are untouched). The rule is plain data in the module's Rules JSON option, so it can be edited, disabled, or removed from the settings console like any user-authored rule. Test count 495.

## v0.15.1 - 2026-07-08

**Removed:**
- Removed the `.res-commentNavToggle` "Navigate by" hover button that `commentNavigator` injected into comment pages (and all of its CSS across `_commentNavigator.scss` / `_nightMode.scss`, plus the now-unused `installEntryElement` function and `waitForDescendant` import). It was unwanted chrome. The comment navigator panel itself is unchanged and still appears when its "show by default" option is enabled.

## v0.15.0 - 2026-07-08

**Features:**
- New `pageTheme` module (disabled by default): an opt-in dark/OLED skin for old.reddit itself, combined and cleaned up from a few community Stylus userstyles into one coherent, settings-driven theme. Options: a **Palette** enum (OLED Black, Graphite, Midnight, Catppuccin Mocha, Tokyo Night, Rosé Pine), an **Accent colour** (visited links / flair outlines, hex-validated), **Declutter chrome** (hide ads, banners, redesign opt-in, gold prompts, promoted posts), **Rounded corners** (subtle 6px), and **Collapse sidebar to hover** (shrinks the right sidebar to a corner tab that expands on hover). Palette is CSS-variable-driven; the stylesheet ships in the `document_start` content CSS and is gated by `<html>` classes with a localStorage-cached early apply to avoid a flash of un-themed Reddit. Fully reversible. Pure helpers in `lib/utils/pageTheme.js` with contract coverage. (The source userstyle's multi-column listing was intentionally left to the existing `multiColumnFeed` module, and its external header image / thumbnail-circle hacks were dropped.) Test count 494.

## v0.14.2 - 2026-07-08

**Fixes:**
- `scrollRestore` no longer restores a saved scroll position on listing pages, which could land you at the bottom of a subreddit / home feed on load. Scroll memory is now scoped to comment threads only (where "return to where you left off" is the useful behavior); subreddit fronts, the home feed, and user/search pages always load at the top. Test count 488.

## v0.14.1 - 2026-07-08

**Fixes:**
- `commentHighlights` no longer highlights every comment on the first visit to a thread. It was falling back to a last-visit timestamp of `0`, so every comment (all newer than epoch 0) read as "new". Highlighting now only happens on a genuine revisit; the first visit is silently recorded so subsequent visits highlight comments posted since. Decision logic extracted to pure helpers in `lib/utils/commentHighlights.js` (`isRevisit`, `isNewComment`) with contract coverage. Test count 487.

## v0.14.0 - 2026-07-08

Resilience, security, and feature pass driven by the 2026-07-08 research report. Reddit's 2026 platform changes (unauthenticated `.json` 403, `.rss` throttle, old.reddit login wall) made fetch-path resilience the theme; two source-verified security bugs led. Five new modules (fencedCodeBlocks, editedCommentDiff, repostDedupe, cleanLinkCopy) plus hardening across the media/host, storage, and background layers. Test count 482.

**Fixes:**
- `streamable` and `redditgallery` media host handlers no longer throw a raw TypeError on a degraded API response (a Streamable video auto-deleted after 90 days / still processing, or a Reddit gallery item with missing metadata). They now bail cleanly so showImages skips the expando instead of leaving a broken shell. Verified `redgifs` already degrades to a fixed-ratio embed when its (deprecated v1) metadata API fails.

**Audit:**
- Confirmed `newCommentCount` and `readComments` use the comment/post fullname only as an opaque storage/set key — no base36 arithmetic or ID-ordering — so Reddit's move away from monotonic comment IDs does not affect them. Documented the finding inline.

**Features:**
- New `cleanLinkCopy` module (disabled by default): adds a "clean link" button to posts and comments that copies the permalink with tracking parameters (`utm_*`, `ref`, `share_id`, `out.reddit.com` wrappers) stripped. Reuses the `outboundCleanser` param list via a new `toCleanLink` helper with contract coverage.
- New `repostDedupe` module (disabled by default): collapses repeat appearances of the same media in a feed (crossposts, karma-farm reposts) by normalizing each post's link/thumbnail to a stable key — i.redd.it/preview.redd.it/imgur permutations of one upload collapse together. First appearance is untouched; later duplicates are dimmed, hidden, or badged. Fully local, no network, O(n). Pure helpers in `lib/utils/repostDedupe.js` with contract coverage. (Perceptual-hash matching of visually-identical-but-different-URL images is a possible future extension; this pass covers URL/thumbnail keys.)

**Fixes / features:**
- Gallery slideshow expandos now show `current / total` (e.g. `3 / 8`) instead of just the current index.
- `restoreSubCounts` now surfaces a Reddit block (403 anonymous-access removal / 429) through the shared notice instead of silently rendering nothing.

**Features:**
- `cobaltDownloader` now accepts multiple comma/newline-separated Cobalt instances and tries them in order (health-check by attempt), so a degraded public instance falls through to the next. Added an optional localhost yt-dlp companion fallback that kicks in when every Cobalt instance fails or Cobalt returns an error (e.g. YouTube blocked on the public instance). New `parseInstanceList` helper with contract coverage.
- New `editedCommentDiff` module (disabled by default): on comments marked "edited", adds a `[show original]` link that fetches the archived original from Arctic Shift (PullPush fallback) and renders a word-level diff (`<ins>`/`<del>`) against the current text. Extends the existing deleted-content restoration to the far more common quiet-edit case. Pure LCS diff helpers in `lib/utils/textDiff.js` with contract coverage.
- New `fencedCodeBlocks` module (disabled by default): renders triple-backtick ` ```fenced``` ` code blocks as real `<pre><code>` on old.reddit, which otherwise shows them as literal text (the top-upvoted upstream RES request, issue #5223). Optional dependency-free local syntax highlighting (strings/comments/numbers/keywords). Conservative — only comment/selftext bodies that are entirely one fenced block are rewritten, so links, lists, and other formatting are never clobbered. Pure helpers in `lib/utils/fencedCode.js` with contract coverage.

**Reliability:**
- The shared token-bucket rate limiter no longer wedges if a scheduled job throws synchronously: the job is now wrapped so it always releases its concurrency slot and rejects its promise. Previously a sync throw left `active` pinned and starved every following job.

**Security:**
- User-authored filter regexes in `filterRules` now pass a fail-closed ReDoS guard: over-long patterns and common nested-quantifier shapes (`(a+)+`, `(a*)*`, `(.+)*`) are rejected before compilation, so a pathological pattern can't hang the tab. A rejected rule simply never matches (no filter bypass).
- The background ajax and download proxies now reject non-http(s) URLs (`file:`, `data:`, `blob:`, `javascript:`, `chrome-extension:`, …) as defense-in-depth against a content-script XSS using them as a confused deputy. The host boundary is already enforced by the browser's permission model. New pure `isProxyableUrl` guard with contract coverage.
- `notifications.showNotification()` now sanitizes string messages through DOMPurify before insertion. Benign markup (links, emphasis) still renders; a future caller interpolating remote text can no longer inject scripts or event handlers.
- CSV exports (vote history) now neutralize spreadsheet formula injection. Remote-controlled fields (usernames, comment snippets) beginning with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` so Excel/LibreOffice can't evaluate `=HYPERLINK(...)` / `=cmd|...` payloads on open; plain numbers (including negative scores) are preserved. New shared `lib/utils/csv.js` encoder with contract coverage.

**Fixes:**
- `imgurFlatten` default rimgo mirror changed from the dead `rimgo.totaldarkness.net` (502, delisted) to the live `ri.bcow.xyz`. Users on the old default silently got no album flattening.

**Dependencies:**
- Bumped esbuild 0.23.1 → 0.25.10 (clears the dev-server CORS advisory GHSA-67mh-4wv8-2f99) and dayjs 1.11.13 → 1.11.21. Chrome and Firefox production builds and the bundle-budget gate verified green.
- Upgraded DOMPurify 3.1.6 → 3.4.11, clearing three post-3.1.6 sanitizer-bypass CVEs (CVE-2025-15599 textarea rawtext, CVE-2026-0540 additional rawtext elements, CVE-2025-26791 SAFE_FOR_TEMPLATES mXSS). DOMPurify is the primary sanitizer for oembed/host HTML; oembed contract tests and the production bundle-budget gate remain green.

**Reliability:**
- Reddit `.json` requests that come back blocked (403, anonymous-access removed 2026-05-30) or rate-limited (429) now surface a single throttled notice instead of failing silently. New pure helper `lib/utils/redditApiStatus.js` classifies the failure; `notifications.notifyRedditApiBlocked()` shows at most one toast per 30s across all callers. Wired into commentTreeExport, crosspostMap, topCommentsPreview, searchGallery, galleryZip, savedBackup, authorContextBadge, and autoRefreshComments. The auto-refresh poller now jumps straight to its maximum interval on a 429. Added contract coverage.

**Security:**
- Hardened the settings console `message` listener to reject cross-origin senders. The privileged options page is embedded as an iframe on the Reddit page; its handler now accepts `load`/`close` only from the extension's own origin or a `reddit.com` origin, closing a channel any other frame on the page (media embed, ad iframe) could previously drive. Added a contract test.
- Fixed a stored DOM-XSS in the wiki comment-preview table-of-contents builder. Heading text from third-party wiki pages was round-tripped through a live `div.innerHTML` to decode HTML entities, which instantiated markup like `<img onerror=…>` in the page origin. Entity decoding now uses a `<textarea>` (RCDATA content model), so markup is decoded as inert text and never executed. Added a contract test.

## v0.13.0 - 2026-07-08

Settings console command-center redesign.

**Settings console UX:**
- Rebuilt the options shell into a three-zone desktop layout: module library, focused workspace, and persistent utility rail.
- Moved staged-change save/revert controls, theme selection, density/motion controls, import/export actions, and build/version context into the right rail.
- Modernized sidebar filtering, module rows, workspace panels, option cards, focus states, dark surfaces, and responsive spacing.
- On narrow viewports, the module library now starts collapsed so status controls and the active workspace remain immediately usable.
- Fixed a stale table-option class hook left over from the old jQuery-style settings renderer.

**Contracts and QA:**
- Added a settings-console contract covering the new rail template, responsive CSS, localized labels, and narrow default collapse.
- Re-rendered desktop and mobile options screenshots with a Chrome API shim and verified theme switching plus filter interaction.

Expected unit count 431.

## v0.12.9 - 2026-06-26

Second premium-polish pass focused on page-level extension surfaces and inline widgets.

**Inline UX polish:**
- `overlayViewer` now opens as a structured modal surface with a title, original-image action, loading/error live status, focus containment, and focus restoration on close.
- `topCommentsPreview` now renders a labeled preview region with explicit loading, empty, error, expanded, and collapsed states instead of relying on terse link text changes.
- `crosspostMap` now uses a labeled region with live status feedback, busy state, clearer empty/success/error treatment, and retry copy.
- `autoRefreshComments` now includes a compact live status companion showing paused, scheduled, checking, added-comments, and retry states.
- `userTagger` popovers now expose dialog labels/status text, trigger expanded state, save/clear busy handling, storage failure feedback, and viewport-aware placement.
- `commentTreeExport` menu now advertises controlled menu state, Escape dismissal, focused menu entry on open, and per-format busy state while exports run.

**Visual refinement:**
- Restyled the overlay viewer, preview card, crosspost card, auto-refresh control, user-tagger dialog, and export menu with cohesive dark surfaces, clearer focus rings, consistent border rhythm, responsive constraints, and reduced-motion guards.

Test count: 420 -> 430 (+10 assertions). Focused page-surface contracts, focused JS lint, focused SCSS lint, full unit suite, full stylelint, and Chrome/Firefox production builds pass.

## v0.12.8 - 2026-06-26

Research-driven hardening pass — 14 commits shipping security, bundle, UX, and feature work.

**Security & reliability:**
- Migrated all 8 raw `innerHTML` writes to `setTrustedHTML()` wrapper for TrustedTypes compliance.
- Added IDB pre-migration backup helper (`lib/utils/idbBackup.js`). voteHistory and mediaArchiveManifest now use `oldVersion` guards for safe schema evolution.
- Added SHA-256 integrity verification for vendored `dash.mediaplayer.min.js` at build time.

**Bundle health:**
- **Removed jQuery** (279KB) — all 22 files migrated to native DOM APIs. Foreground bundle: 1659KB → 1315KB (-21%).
- **Removed lodash-es** — all 49 files migrated to `lib/utils/functional.js` (native replacements for 33 lodash functions). ~105KB savings per entry point.
- **Removed 15 dead host handlers** (LiveLeak, Gfycat, VLive, Google Poly, Tuckbot, streamvi/streamja/streamwo, livememe/memecrunch/memedad, snag/simplecove/supgif/supload). Host count: 88 → 73.
- Added production bundle size regression gate (foreground 1.8MB / options 1.9MB / background 400KB limits).
- Rebranded 86 locale strings from "Reddit Enhancement Suite" / "RES" to "RES-Slim".

**New modules:**
- `codeBlockCopy` — hover-revealed copy-to-clipboard button on `<pre><code>` blocks. Disabled by default.
- `engagementBaitFilter` — dims/badges/hides posts matching configurable ragebait patterns (AITA, ALL CAPS, listicles, contrarian bait, etc.). 10 default patterns. Disabled by default.
- `subRulesInline` — hover a subreddit link to see its posting rules in an inline popover. Fetches `/about/rules.json` with 24h cache. Disabled by default.

**Settings themes:**
- Added Catppuccin Mocha, Tokyo Night, and Rose Pine dark theme presets. All three pass WCAG AA contrast tests. Theme count: 5 → 8.
- Completed swatch styling for all eight theme presets and grouped theme/display/file/change controls in the settings console header.

**Premium polish:**
- Replaced the settings-console close confirmation with inline live-region feedback. Close attempts with staged edits keep the console open, focus Save, and surface "Save or revert changes before closing." in the global status area.
- Added refined disabled control styling and upgraded enum/radio options into accessible segmented controls with clear checked, focus, hover, and disabled states.
- Polished `storageDashboard` into a semantic, responsive panel with accessible trigger state, a close action, structured loading/empty/error states, and clearer purge progress/success/failure feedback.
- Polished `subRulesInline` hovercards with keyboard-focus support, tooltip semantics, viewport-aware placement, and refined loading/error/rule item surfaces.

**Diagnostics:**
- Added module performance self-measurement. `window.rsmDiagnostics()` in console. Modules >50ms trigger a console warning after load.

**Architecture:**
- Split `showImages.js` (2338 lines) into 4 focused sub-modules: `linkScanner.js` (376), `mediaTypes.js` (1100), `mediaControls.js` (169). Main file reduced to 751 lines.
- **Removed SortableJS** (116KB) — replaced with native HTML5 drag-and-drop (`lib/utils/nativeSortable.js`). Three call sites (table rows, builder items, builder blocks) use the same `Sortable.create()` API via a thin wrapper. Foreground bundle: 1315KB → 1239KB.

**New modules:**
- `storageDashboard` — userbar "storage" link opens a panel showing IDB record counts (voteHistory, mediaManifest) with cap percentages and per-store purge buttons.

**Infrastructure:**
- Added `Roadmap_Blocked.md` for items with hard blockers. CLAUDE.md updated with roadmap management rules.

Test count: 370 → 420 (+50 assertions). Foreground bundle: 1659KB → 1239KB (-25%). Chrome + Firefox builds clean.

## v0.12.7 - 2026-05-22

Senior-engineer refactor pass — bug hunt + hardening + UX consistency, no new modules.

- **New `lib/utils/buttonStatus.js`** — shared `flashStatus(el, message, { restore, durationMs })` helper. WeakMap-tracked per-element timer so repeated clicks never race conflicting setTimeouts to flip the label back. All seven status-flashing modules now route through it: `cobaltDownloader`, `galleryZip`, `localCompanion`, `savedBackup`, `voteHistory`, `mediaArchiveManifest`, `commentTreeExport`.
- **`lib/utils/rateLimiter.js`** — refill interval now starts lazily on first `schedule()` and stops when the bucket is full + queue + active are all empty. Previously a module's `createRateLimiter(...)` ran the refill `setInterval` for the lifetime of the page even when the user never triggered the feature. Closes a per-page background-tick leak.
- **`cobaltDownloader`** — fixed `eligibleHosts()` so the default host set is merged with the user's custom list instead of being replaced when only custom hosts were entered. Wrapped `res.json()` in a try/catch so a malformed Cobalt response surfaces "bad response" instead of throwing past the try-with-resource.
- **`galleryZip`** — `loadJszip()` now resets the cached promise on rejection so a transient CDN hiccup doesn't permanently break the gallery-zip button until full page reload.
- **`voteHistory`, `mediaArchiveManifest`** — `dbPromise` is reset on IndexedDB open failure (was previously sticky, meaning one transient IDB error broke the module until reload).
- **`arcticShift`** — failure label now distinguishes `rate-limited`, `network`, `server-error`, `bad archive response`, and `not in archive` instead of folding everything into a flat "not in archive" string. Helps the user know whether to retry or give up.
- **`dragResize`** — drag teardown is now centralised. Added `pointercancel` and `window.blur` handlers so a tab switch or an OS-level pointer steal during a drag no longer leaves dangling `pointermove`/`keydown` listeners on `window`. Consolidated the cleanup logic into a single `teardown()` closure.
- **`userTagger`** — popover now closes on Esc. Only one popover can be open at a time; opening a new one tears down the previous. The deferred outside-click handler now checks that the same popover instance is still active before doing anything (avoids a tear-down racing the click).
- **`commentTreeExport`** — removed the dead `includeAllChildren: false` option branch. The fetch path was always the same; the option just confused the settings UI.
- **`filterRules`** — `collapse` action now degrades to `dim` for posts (posts have no native collapse on old.reddit). `data-rsm-filter-hit` is now space-separated and dedupes hit IDs instead of producing leading whitespace and duplicate IDs across re-scans.
- **`botCollapse`** — reveal button now drives its label off the live `.collapsed` class instead of a separate `data-rsm-bot-collapsed` attribute, so reddit's native `[-]` / `[+]` toggle stays in sync with the button text. A scoped MutationObserver on the comment element refreshes the label automatically.
- **`redgifsLayoutFix`** — replaced the document-body-wide MutationObserver with per-Thing scoped observers on the post's `.expando` container. Same coverage, dramatically less work on busy listings. Also stamps a `data-rsm-redgifs-fixed` attribute so each iframe is processed exactly once even if multiple observers fire.
- **Fixture hygiene** — privacy outbound-URL snapshot regenerated against the current `lib/` (`scripts/regen-privacy-snapshot.mjs` shipped so this is repeatable). `expectedHostCount` bumped 86 → 88 for the `mastodon` and `threads` handlers shipped in v0.11.11. `threads` host permissions added to both chrome + firefox manifests. Cleared two test scratch dirs from the index and added them to `.gitignore`.
- Test count: 358 (all green). Chrome + Firefox builds clean.

## v0.12.6 - 2026-05-22

- New `mediaArchiveManifest` module — records every media download triggered from a reddit post into a local IndexedDB manifest. Source classifier knows about downloadButtons (RES upstream), galleryZip, cobaltDownloader, and localCompanion.
- Pure helpers in `lib/utils/mediaManifest.js`: `buildEntry`, `filterEntries`, `buildExport`, `isDownloadAnchor` (matches `[download]` HTML attribute and the four known RES-Slim download-button classes).
- IDB schema (v1): object store keyed by `${timestamp}::${url}`; indexes on `timestamp`, `source`, `subreddit`. 20k hard cap by default; oldest dropped first.
- Capture-phase document click listener so the recorder works regardless of which module emits the download.
- Userbar `media log` link exports the full manifest as JSON.
- Disabled by default.
- New contract test `tests/unit/media-manifest-contract.test.mjs` — 7 assertions.
- Test count: 358.

## v0.12.5 - 2026-05-22

- New `voteHistory` module — record every vote you cast to IndexedDB. Nothing leaves the browser.
- Pure helpers in `lib/utils/voteHistory.js`: `SCHEMA_VERSION` (locked to 1), `DB_NAME`, `STORE_NAME`, `makeId`, `classifyDirection`, `buildRecord` (kind inferred from fullname prefix; 240-char snippet cap), `filterRecords` (sub/author/direction/time filters), `toCsv` (CSV-RFC-compliant quoting).
- IndexedDB schema: object store keyed by `${fullname}@${timestamp}`, indexes on `timestamp` / `subreddit` / `author`.
- Userbar `vote log` link exports the full log to JSON; Shift+click exports CSV.
- Hard cap default 50,000 records — oldest dropped first when exceeded.
- Disabled by default. Recording is a separate option from the module enable so users can keep the existing log read-only.
- New contract test `tests/unit/vote-history-contract.test.mjs` — 8 assertions including CSV quoting safety.
- Test count: 351.

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

## Roadmap archive — 2026-08-10 — ROADMAP.md

<details>
<summary>Original roadmap snapshot</summary>

```markdown
# RES-Slim Roadmap

RES-Slim is a personal, old.reddit-focused fork of Reddit Enhancement Suite, published publicly. This roadmap tracks actionable pending work only. Blocked items are in `Roadmap_Blocked.md`.

## Planning Docs

- Research synthesis: `RESEARCH.md`
- Blocked items: `Roadmap_Blocked.md`
- Historical roadmap: `docs/archive/roadmap/ROADMAP-2026-05-22.md`
- Archived feature-gap research: `docs/archive/research/RESEARCH-FINDINGS.md`

Shipped state is described by `README.md` and the commit history; there is no
separate summary file.

## Current Baseline

- Current release: v0.30.0.
- Test count: 911 unit + 9 e2e.
- Chrome MV3 and Firefox MV2 extension builds remain the primary artifacts.
- The product is old.reddit-first; new Reddit surfaces are compatibility handoffs only.
- Every new feature must remain reversible, settings-gated where appropriate, privacy-preserving, and compatible with the existing no-light-theme/no-keyboard-shortcut/no-telemetry rules.

## Active Items

See "Research-Driven Additions" below (added 2026-08-06).

## Research-Driven Additions

Added 2026-08-06 from the research pass recorded in `RESEARCH.md`.

### P0

### P1

### P2

## Audit Findings — 2026-08-07

Audit-only pass over v0.23.0. Baseline recorded: `yarn test` 811/811 pass,
`yarn test:e2e` 4/4 pass, `yarn build` succeeds, `yarn eslint` 166 pre-existing
errors, `yarn stylelint` 1 pre-existing error. Most findings below are in code
shipped by v0.22.0/v0.23.0 — the newest code is the least-audited code.

### P0

### P1

### P2

### P3

## Definition of Done

- Active planning remains in this file.
- Completed implementation notes go to `CHANGELOG.md`.
- Blocked items go to `Roadmap_Blocked.md`.
- Research conclusions go to `RESEARCH.md`.
```

</details>
