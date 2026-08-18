# RES-Slim

![Version](https://img.shields.io/badge/version-0.35.1-blue) ![License](https://img.shields.io/badge/license-GPL--3.0-green) ![Platform](https://img.shields.io/badge/platform-JavaScript-lightgrey)

A stripped-down personal fork of [Reddit Enhancement Suite](https://github.com/honestbleeps/Reddit-Enhancement-Suite) (forked from upstream v5.24.8), targeting **old.reddit.com** on desktop. Built for one person's use and published as-is — there is no support commitment and no release cadence.

Only the features actually used are kept. Upstream self-promotion, sponsorship, announcements, and cloud-backup code have been removed.

## What's kept

**Comment tweaks**: hideChildComments, commentNavigator, commentPreview, commentTools, commentQuickCollapse, commentSortBy, commentStyle, commentDepth, commentHidePersistor, saveComments, hover, showParent, readComments, newCommentCount, spoilerTags, noParticipation, sourceSnudown.

**Media tweaks**: `showImages` inline expando engine plus all 73 host handlers (imgur, youtube, reddit-native, Mastodon, Threads, etc.).

**Appearance**: `pageTheme` — an enabled-by-default Graphite skin that keeps old Reddit's desktop density while adding a compact sticky header, clearer feed cards, calmer metadata, readable discussion surfaces, a focused combined-search workspace, consistent controls, visible keyboard focus, and a debloated sidebar. Open posts gain article-scale titles, wider text and centred media; discussions gain a structured sort toolbar, full-width composer, clearer author/depth states, and polished community and moderator cards. Search uses a centered desktop measure, aligned query and result cards, themed excerpts and highlights, and deliberate empty states. The refined layout is independently reversible, and ten dark palettes, custom accent colour, rounded corners, decluttering, and collapse-to-hover sidebar controls remain available. The settings console has its own themes, including the light Paper theme.

**Browsing**: `hideAll` — a "hide all" link in the listing tab menu that bulk-hides every post on the page, rate-limited, with undo. Disabled by default.

**Ads and measurement**: an always-on static `declarativeNetRequest` ruleset blocks separable Reddit ad assets, click trackers, pixels, and telemetry requests before load. Promoted records embedded in Reddit's essential first-party listing response are suppressed at `document_start`, counted locally, and rechecked as listings append. No claim is made that those inseparable records disappear from the listing response itself.

**Old Reddit routing**: the optional `www.reddit.com` → `old.reddit.com` preference now installs a dynamic request rule, so the modern document does not download before the host changes. It preserves path, query, and fragment; leaves login, account, and advertising routes alone; and the header’s **www** link provides a one-page escape. The preference remains off by default.

**Ecosystem parity (v0.20.0)**: fifteen modules rewritten from the most-installed old.reddit userscripts, all disabled by default except the two that only repair broken behaviour — `commentShredder` (bulk overwrite-and-delete of your own comments, preview-first with a typed confirmation), `usernameColors`, `systemThemeSync`, `autoLoadMoreComments`, `visitedPosts`, `searchScope`, `flairLinkify`, `reverseImageSearch`, `nsfwThumbnails`, `karmaHide`, `restoreVoteArrows`, `randomSubreddit`, `loginRedirectFix`, plus `brokenLinkFixer` and `preventAutoTranslate` on by default.

**Infrastructure only**: menu, notifications, settingsNavigation, selectedEntry, version, requestPermissions.

**Settings console**: three-column desktop command center with a persistent category rail, focused module rail, editorial settings workspace, explicit On/Off labels, staged-change controls, theme/density/motion controls, page-specific privacy and permission states, and portable data actions. Global search and Console preferences use the full workspace instead of retaining an unrelated empty module rail.

![RES-Slim settings console in the Paper theme](images/settings-console-paper.png)

The selected 1440×900 design references for all 11 categories, Console preferences, and search live in [`design/mockups/`](design/mockups/). They are reference images only; the shipped interface is HTML/CSS/JavaScript.

## Permissions and privacy

RES-Slim runs on `https://*.reddit.com/*` and stores settings and optional local feature data in the browser profile. `declarativeNetRequest` is used for the packaged Reddit-scoped block rules and the user-controlled Old Reddit redirect described above. Optional host permissions are requested only when a media provider or localhost companion needs one. The extension contains no analytics and sends no RES-Slim telemetry.

## Build

```bash
yarn install
yarn verify     # every gate, in order, stops at the first failure
yarn test       # focused fixture checks
yarn test:show-images
yarn test:privacy
yarn test:e2e   # loads the built extension in Chromium (headless) and drives it
yarn once       # dev build -> dist/
yarn build      # production build + zip -> dist/zip/
```

`yarn verify` runs lint, Flow, the unit suite, a production build, the e2e suite,
and the third-party endpoint probe — in that order, stopping at the first
failure. It is the one command worth running before a push; the individual
scripts above are for iterating on a single gate. `yarn verify --skip-network`
omits the endpoint probe, which is the only step that can fail for reasons
outside this repository.

To run it automatically before every push, enable the shipped hook once per
clone:

```bash
git config core.hooksPath .githooks
```

`git push --no-verify` skips it when you genuinely need to.

`yarn test:e2e` rebuilds first, then launches Playwright's Chromium with
`dist/chrome/` loaded and checks that the service worker is alive, the packaged
ad rules block a real browser request, all settings states render, promoted
records stay hidden across asynchronous insertion, and the content script
initialises on a served old.reddit document. It also checks the default refined
Graphite layout, keyboard focus treatment, feed hierarchy, opened-post and
media geometry, the discussion composer and sort toolbar, and nested-comment
surfaces. It needs no physical display or
existing browser profile; one CSP reachability check requires outbound Reddit access,
while the product-behavior fixtures are served locally. Screenshots land in
`tests/e2e/screenshots/`. Set `RES_E2E_HEADED=1` to watch it run.

### Refresh old Reddit fixtures

Save a current public old-Reddit listing or discussion as HTML/MHTML, then run:

```bash
yarn fixture:import path/to/capture.html --kind frontpage --captured-at 2026-08-13T12:00:00Z
yarn fixture:import path/to/capture.mhtml --kind thread --captured-at 2026-08-13T12:00:00Z
```

The importer refuses private Reddit surfaces and captures without the old-Reddit
`xmlns` marker. It reduces the page to a deterministic structural fixture,
replaces account/content identifiers and prose, strips executable or secret-
shaped data, and permits only a reserved non-routable fixture host. Run
`yarn test` and `yarn test:e2e` before committing refreshed fixtures.

## Install (Chrome)

The repo ships no loadable extension — `dist/` is generated. Build it first:

```bash
yarn install
yarn once
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/chrome/`.

Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick any file in `dist/firefox/`.

Two things that look like bugs but aren't:

- **Do not point Chrome at the repo's `chrome/` folder.** That manifest is a build template — `"name": "__name__"`, `"version": "__version__"` — and Chrome rejects it with *Invalid value for 'version'*. Only `dist/chrome/` is loadable.
- **`--load-extension` on the command line no longer works** in Google Chrome stable (it logs `--load-extension is not allowed in Google Chrome, ignoring` and continues without the extension). Use the Load-unpacked UI above; for scripted checks use a Chrome for Testing / Chromium build, which still honours the flag.

## Project planning

Planning lives in the working copy, not in git: `README.md` is the only Markdown
file this repo tracks, so `ROADMAP.md`, `CHANGELOG.md`, `RESEARCH.md`,
`Roadmap_Blocked.md` and the `docs/archive/` history are all gitignored. They
are there after a clone only if you created them. Shipped history is in the
commit log.

## License

GPL-3.0 — inherited from upstream RES. See `LICENSE`.
