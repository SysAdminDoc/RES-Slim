# RES-Slim Max Roadmap

**Artifact:** research and planning only
**Updated:** 2026-05-19
**Baseline repo:** RES-Slim v0.4.0, private stripped fork of Reddit Enhancement Suite v5.24.8
**Target site:** `old.reddit.com` first; `www.reddit.com`, `np.reddit.com`, and redirect handoffs as compatibility surfaces
**Project name/version convention:** `RES-Slim Max v0.0.1`, semantic versions from the first implementation pass

This roadmap specifies the most complete old-Reddit extension/userscript suite to build from this repository: the union of Reddit Enhancement Suite, Reddit Enhancer, Moderator Toolbox, major GreasyFork/OpenUserJS scripts, redirectors, userstyles, and active community feature requests, plus local-first capabilities not covered well by any competitor.

This run produced no feature code. Future implementation should create code only from this plan.

---

## Project Overview

**One-line pitch:** a premium dark-only power suite for old Reddit that combines RES-style browsing, Reddit Enhancer UI controls, Toolbox-grade moderator workflows, one-off userscript utilities, privacy protections, media downloads, archive tools, export/backup, and local-first intelligence behind one reversible feature registry.

**Chosen vehicle:** ship both an MV3 browser extension and a single-file userscript.

| Vehicle | Role | Rationale |
| --- | --- | --- |
| MV3 extension | Primary product | Required for background workers, optional host permissions, downloads, cross-origin fetches, `declarativeNetRequest`, store distribution, long-lived storage, and media/archive integrations. |
| Firefox extension | Supported product | Existing repo already has Firefox manifests. Firefox's MV2 posture remains useful for old-style extension capabilities, but the build should keep a clean migration path. |
| Userscript | Portable companion | Best for single-file installation, fast iteration, private distribution, and users who already rely on Tampermonkey/Violentmonkey. It should omit features requiring background workers unless a GM API can support them. |

**House style baked into every phase:**

- Premium paid-software look: deep dark and OLED palettes only; glass surfaces, subtle shimmer, hover lift, spring easing, staggered entrances, branded accent, branded scrollbar, dense mode.
- Never ship a light theme.
- No keyboard shortcuts. Normal browser focus, Tab navigation, and Enter/Space activation for accessibility remain required.
- No confirmation dialogs. Destructive or irreversible actions use immediate action, toast feedback, and reversible undo where technically possible.
- No pill, oval, or fully rounded GUI backdrops. Controls use restrained radii.
- Every feature has a clean `destroy()` path that removes DOM nodes, listeners, observers, timers, injected styles, body classes, and storage subscriptions.
- Settings overlays use `pointer-events: none` when inactive.
- Injected CSS is scoped to body classes and CSS custom properties.
- On any TrustedTypes-enforcing surface, all HTML injection routes through `trustedTypes.createPolicy()`.
- Target obfuscated or generated classes only as fallback selectors; prefer `data-*`, ARIA, roles, IDs, and structure.
- Plan for a GitHub `README.md` as a later build deliverable, not in this planning-only run.

---

## Phase 0 - Local Repo Ingestion

### Repository State

The repo is a GPL-3.0 private fork of Reddit Enhancement Suite, stripped toward old-Reddit comment ergonomics, media expandos, settings, and reliability. Current branch state at ingestion:

- Branch: `master`
- Remote: `origin/master`
- Last commit: `4bfe1e5c ROADMAP v0.5 planning pass - exhaustive research refresh`
- Tracked files: 496
- Untracked capture files used as DOM ground truth:
  - `reddit_ the front page of the internet.mhtml`
  - `This has to stop, They are taking our limits with each free limit resets _ codex.mhtml`

`rtk` was not available in this PowerShell session, so plain `git` and PowerShell-native commands were used.

### Full Tracked Repo Tree

Generated from `git ls-files` on 2026-05-19:

```text
.babelrc
.codeclimate.yml
.editorconfig
.eslintignore
.eslintrc.json
.flowconfig
.gitignore
.stylelintignore
.stylelintrc.json
CHANGELOG.md
LICENSE
README.md
RESEARCH-FINDINGS.md
ROADMAP.md
ava.config.mjs
build.js
build/deploy.js
build/deployChangelog.js
build/generate-icons.py
build/i18nLint.js
build/i18nTransformer.cjs
build/isBetaVersion.js
build/pack-crx.py
build/travisDeploy.sh
build/utils/changelog.js
build/version.js
changelog/v0.1.0.md
changelog/v0.2.0.md
changelog/v0.3.0.md
changelog/v0.3.1.md
changelog/v0.3.2.md
changelog/v0.3.3.md
changelog/v0.3.4.md
chrome/manifest.json
examples/.eslintrc.json
examples/host.js
examples/module.js
firefox/beta/manifest.json
firefox/manifest.json
flow/.eslintrc.json
flow/lib/.eslintrc.json
flow/lib/chrome.js.flow
flow/lib/core.js.flow
flow/lib/dom.js.flow
flow/lib/escapeStringRegexp.js.flow
flow/lib/favicon.js.flow
flow/lib/jquery.js.flow
flow/lib/lodash.js.flow
flow/lib/snudown.js.flow
flow/lib/suncalc.js.flow
images/beta128.png
images/beta48.png
images/css-off-small.png
images/css-off.png
images/css-on-small.png
images/css-on.png
images/icon128.png
images/icon150.png
images/icon16.png
images/icon256.png
images/icon44.png
images/icon48.png
images/icon50.png
images/icon512.png
images/icon64.png
images/promo1400x560.png
images/promo440x280.png
images/promo920x680.png
images/store1.png
images/store2.png
images/store3.png
images/store4.png
lib/background.entry.js
lib/constants/jsapi.js
lib/constants/localStorage.js
lib/constants/sessionStorage.js
lib/constants/urlHashes.js
lib/core/host.js
lib/core/init.js
lib/core/metadata/index.js
lib/core/migrate/index.js
lib/core/migrate/migrate.js
lib/core/migrate/migrators.js
lib/core/module.js
lib/core/modules/bodyClasses.js
lib/core/modules/index.js
lib/core/modules/modules.js
lib/core/modules/storage.js
lib/core/options/index.js
lib/core/options/modified.js
lib/core/options/options.js
lib/core/options/stage.js
lib/core/options/storage.js
lib/core/options/table.js
lib/css/_zindex.scss
lib/css/modules/_accountSwitcher.scss
lib/css/modules/_betteReddit.scss
lib/css/modules/_commandLine.scss
lib/css/modules/_commentNavigator.scss
lib/css/modules/_commentPreview.scss
lib/css/modules/_commentQuickCollapse.scss
lib/css/modules/_commentStyle.scss
lib/css/modules/_commentTools.scss
lib/css/modules/_dashboard.scss
lib/css/modules/_easterEgg.scss
lib/css/modules/_filteReddit.scss
lib/css/modules/_hover.scss
lib/css/modules/_keyboardNav.scss
lib/css/modules/_modhelper.scss
lib/css/modules/_neverEndingReddit.scss
lib/css/modules/_newCommentCount.scss
lib/css/modules/_nightMode.scss
lib/css/modules/_noParticipation.scss
lib/css/modules/_notifications.scss
lib/css/modules/_orangered.scss
lib/css/modules/_pageNavigator.scss
lib/css/modules/_quickMessage.scss
lib/css/modules/_redditUserInfo.scss
lib/css/modules/_saveComments.scss
lib/css/modules/_searchHelper.scss
lib/css/modules/_selectedEntry.scss
lib/css/modules/_showImages.scss
lib/css/modules/_showParent.scss
lib/css/modules/_sourceSnudown.scss
lib/css/modules/_spoilerTags.scss
lib/css/modules/_styleTweaks.scss
lib/css/modules/_submitIssue.scss
lib/css/modules/_subredditInfo.scss
lib/css/modules/_subredditManager.scss
lib/css/modules/_tableTools.scss
lib/css/modules/_temporaryDropdownLinks.scss
lib/css/modules/_troubleshooter.scss
lib/css/modules/_userInfo.scss
lib/css/modules/_userTagger.scss
lib/css/modules/_userbarHider.scss
lib/css/modules/_version.scss
lib/css/modules/_voteEnhancements.scss
lib/css/modules/_wheelBrowse.scss
lib/css/res.scss
lib/environment/.eslintrc.json
lib/environment/background/ajax.js
lib/environment/background/download.js
lib/environment/background/history.js
lib/environment/background/i18n.js
lib/environment/background/loadScript.js
lib/environment/background/localePersistor.js
lib/environment/background/messaging.js
lib/environment/background/multicast.js
lib/environment/background/pageAction.js
lib/environment/background/permissions.js
lib/environment/background/permissions/prompt.entry.js
lib/environment/background/permissions/prompt.html
lib/environment/background/session.js
lib/environment/background/storage.js
lib/environment/background/tabs.js
lib/environment/background/xhrCache.js
lib/environment/foreground/ajax.js
lib/environment/foreground/context.js
lib/environment/foreground/download.js
lib/environment/foreground/history.js
lib/environment/foreground/i18n.js
lib/environment/foreground/id.js
lib/environment/foreground/loadScript.js
lib/environment/foreground/messaging.js
lib/environment/foreground/multicast.js
lib/environment/foreground/pageAction.js
lib/environment/foreground/permissions.js
lib/environment/foreground/privateBrowsing.js
lib/environment/foreground/session.js
lib/environment/foreground/storage.js
lib/environment/foreground/tabs.js
lib/environment/foreground/xhrCache.js
lib/environment/index.js
lib/environment/utils/__tests__/messaging.js
lib/environment/utils/api.js
lib/environment/utils/messaging.js
lib/fonts/batch-icons-webfont.woff
lib/foreground.entry.js
lib/images/accountSwitcherSnoo.png
lib/images/bacon.png
lib/images/colorblindMail.png
lib/images/commentTools.png
lib/images/dashboardLoader.gif
lib/images/droparrowgray.gif
lib/images/expandoClose-active.svg
lib/images/expandoClose.svg
lib/images/expandoEmpty.svg
lib/images/expandoImage-active.svg
lib/images/expandoImage.svg
lib/images/expandoImageGallery-active.svg
lib/images/expandoImageGallery.svg
lib/images/expandoPadlock-active.svg
lib/images/expandoPadlock.svg
lib/images/expandoVideo-active.svg
lib/images/expandoVideo.svg
lib/images/hosts/giphy-logo.png
lib/images/icon60x30.png
lib/images/legacyFavicon.png
lib/images/mail.png
lib/images/mailgray.png
lib/images/moderatorShield.png
lib/images/nightmode/aboutHeader.png
lib/images/nightmode/arrows.png
lib/images/nightmode/snooBalloons.png
lib/modules/absoluteTimestamps.js
lib/modules/archiveLinks.js
lib/modules/autoExpand.js
lib/modules/classicFavicon.js
lib/modules/commentDepth.js
lib/modules/commentHidePersistor.js
lib/modules/commentHighlights.js
lib/modules/commentNavigator.js
lib/modules/commentPreview.js
lib/modules/commentQuickCollapse.js
lib/modules/commentSortBy.js
lib/modules/commentStyle.js
lib/modules/commentTools.js
lib/modules/context.js
lib/modules/disableSubredditStyles.js
lib/modules/downloadButtons.js
lib/modules/filteReddit/Case.js
lib/modules/filteReddit/browseCases/BrowsingFrontPage.js
lib/modules/filteReddit/browseCases/CurrentLocation.js
lib/modules/filteReddit/browseCases/CurrentMulti.js
lib/modules/filteReddit/browseCases/CurrentSub.js
lib/modules/filteReddit/browseCases/CurrentUserProfile.js
lib/modules/filteReddit/browseCases/Date.js
lib/modules/filteReddit/browseCases/Dow.js
lib/modules/filteReddit/browseCases/LoggedInAs.js
lib/modules/filteReddit/browseCases/index.js
lib/modules/filteReddit/cases.js
lib/modules/filteReddit/commentCases/CommentContent.js
lib/modules/filteReddit/commentCases/CommentLength.js
lib/modules/filteReddit/commentCases/Depth.js
lib/modules/filteReddit/commentCases/IsDeleted.js
lib/modules/filteReddit/commentCases/IsRead.js
lib/modules/filteReddit/commentCases/index.js
lib/modules/filteReddit/postCases/CommentCount.js
lib/modules/filteReddit/postCases/CommentsOpened.js
lib/modules/filteReddit/postCases/Domain.js
lib/modules/filteReddit/postCases/Expando.js
lib/modules/filteReddit/postCases/IsLocked.js
lib/modules/filteReddit/postCases/IsNSFW.js
lib/modules/filteReddit/postCases/IsSpoiler.js
lib/modules/filteReddit/postCases/IsVisited.js
lib/modules/filteReddit/postCases/LinkFlair.js
lib/modules/filteReddit/postCases/NewCommentCount.js
lib/modules/filteReddit/postCases/PostAfter.js
lib/modules/filteReddit/postCases/PostAge.js
lib/modules/filteReddit/postCases/PostTitle.js
lib/modules/filteReddit/postCases/PostType.js
lib/modules/filteReddit/postCases/Score.js
lib/modules/filteReddit/postCases/Selector.js
lib/modules/filteReddit/postCases/Subreddit.js
lib/modules/filteReddit/postCases/UserAttr.js
lib/modules/filteReddit/postCases/UserFlair.js
lib/modules/filteReddit/postCases/Username.js
lib/modules/filteReddit/postCases/VoteType.js
lib/modules/filteReddit/postCases/index.js
lib/modules/fixImageLinks.js
lib/modules/fixProcessingImg.js
lib/modules/hideChildComments.js
lib/modules/hideGifComments.js
lib/modules/hosts/aarli.js
lib/modules/hosts/adultswim.js
lib/modules/hosts/archilogic.js
lib/modules/hosts/archiveis.js
lib/modules/hosts/bime.js
lib/modules/hosts/bluesky.js
lib/modules/hosts/clyp.js
lib/modules/hosts/codepen.js
lib/modules/hosts/coub.js
lib/modules/hosts/dailymotion.js
lib/modules/hosts/defaultAudio.js
lib/modules/hosts/defaultImage.js
lib/modules/hosts/defaultVideo.js
lib/modules/hosts/derpibooru.js
lib/modules/hosts/deviantart.js
lib/modules/hosts/dropbox.js
lib/modules/hosts/facebookvideo.js
lib/modules/hosts/fiveHundredPx.js
lib/modules/hosts/flickr.js
lib/modules/hosts/gamerdvr.js
lib/modules/hosts/getyarn.js
lib/modules/hosts/gfycat.js
lib/modules/hosts/gifyoutube.js
lib/modules/hosts/giphy.js
lib/modules/hosts/github.js
lib/modules/hosts/googlemaps.js
lib/modules/hosts/gyazo.js
lib/modules/hosts/hastebin.js
lib/modules/hosts/iloopit.js
lib/modules/hosts/imgflip.js
lib/modules/hosts/imgur.js
lib/modules/hosts/index.js
lib/modules/hosts/instagram.js
lib/modules/hosts/ireddit.js
lib/modules/hosts/jsfiddle.js
lib/modules/hosts/liveleak.js
lib/modules/hosts/livememe.js
lib/modules/hosts/makeameme.js
lib/modules/hosts/memecrunch.js
lib/modules/hosts/memedad.js
lib/modules/hosts/navertv.js
lib/modules/hosts/onedrive.js
lib/modules/hosts/pastebin.js
lib/modules/hosts/peertube.js
lib/modules/hosts/photobucket.js
lib/modules/hosts/pixiv.js
lib/modules/hosts/poly.js
lib/modules/hosts/pornhub.js
lib/modules/hosts/ppy.js
lib/modules/hosts/redditbooru.js
lib/modules/hosts/redditgallery.js
lib/modules/hosts/redditmedia.js
lib/modules/hosts/redditpoll.js
lib/modules/hosts/reddituploads.js
lib/modules/hosts/redgifs.js
lib/modules/hosts/ridewithgps.js
lib/modules/hosts/simplecove.js
lib/modules/hosts/snag.js
lib/modules/hosts/soundcloud.js
lib/modules/hosts/spotify.js
lib/modules/hosts/steamcommunity.js
lib/modules/hosts/steampowered.js
lib/modules/hosts/strawpollcom.js
lib/modules/hosts/strawpollme.js
lib/modules/hosts/streamable.js
lib/modules/hosts/streamja.js
lib/modules/hosts/streamvi.js
lib/modules/hosts/streamwo.js
lib/modules/hosts/supgif.js
lib/modules/hosts/supload.js
lib/modules/hosts/tenor.js
lib/modules/hosts/tuckbot.js
lib/modules/hosts/tumblr.js
lib/modules/hosts/twimg.js
lib/modules/hosts/twitch.js
lib/modules/hosts/twitchclips.js
lib/modules/hosts/twitter.js
lib/modules/hosts/vidble.js
lib/modules/hosts/vimeo.js
lib/modules/hosts/vlipsy.js
lib/modules/hosts/vlive.js
lib/modules/hosts/vreddit.js
lib/modules/hosts/wikipedia.js
lib/modules/hosts/xboxdvr.js
lib/modules/hosts/xkcd.js
lib/modules/hosts/youtube.js
lib/modules/hosts/znipe.js
lib/modules/hover.js
lib/modules/index.js
lib/modules/infiniteScroll.js
lib/modules/markAllRead.js
lib/modules/menu.js
lib/modules/newCommentCount.js
lib/modules/nextTopComment.js
lib/modules/nightMode.js
lib/modules/noParticipation.js
lib/modules/notifications.js
lib/modules/readComments.js
lib/modules/reddEye.js
lib/modules/requestPermissions.js
lib/modules/restoreSubCounts.js
lib/modules/saveComments.js
lib/modules/search.js
lib/modules/selectedEntry.js
lib/modules/settingsNavigation.js
lib/modules/showImages.js
lib/modules/showImages/expando.js
lib/modules/showImages/templates.js
lib/modules/showParent.js
lib/modules/sourceSnudown.js
lib/modules/spoilerTags.js
lib/modules/subredditBlacklist.js
lib/modules/userProfileSearch.js
lib/modules/version.js
lib/modules/viewDeleted.js
lib/options/handleBlocking.js
lib/options/options.entry.js
lib/options/options.html
lib/options/options.scss
lib/options/settingsConsole.js
lib/options/templates.js
lib/types/events.js
lib/types/reddit.js
lib/utils/Cache.js
lib/utils/Thing.js
lib/utils/__tests__/array.js
lib/utils/__tests__/async.js
lib/utils/__tests__/color.js
lib/utils/__tests__/escapeHTML.js
lib/utils/__tests__/generator.js
lib/utils/__tests__/location.js
lib/utils/__tests__/math.js
lib/utils/__tests__/object.js
lib/utils/__tests__/string.js
lib/utils/__tests__/value.js
lib/utils/alert.js
lib/utils/array.js
lib/utils/async.js
lib/utils/bodyClasses.js
lib/utils/browserDetect.js
lib/utils/caseBuilder.js
lib/utils/color.js
lib/utils/createElement.js
lib/utils/currentLocation.js
lib/utils/dashboard.js
lib/utils/dom.js
lib/utils/floater.js
lib/utils/flow.js
lib/utils/generator.js
lib/utils/hash.js
lib/utils/html.js
lib/utils/index.js
lib/utils/keycode.js
lib/utils/localization.js
lib/utils/location.js
lib/utils/math.js
lib/utils/object.js
lib/utils/options.js
lib/utils/pageContextScript.js
lib/utils/pagePhases.js
lib/utils/profiling.js
lib/utils/selectedThing.js
lib/utils/storage.js
lib/utils/string.js
lib/utils/subreddits.js
lib/utils/table.js
lib/utils/thingHide.js
lib/utils/thingMetadata.js
lib/utils/time.js
lib/utils/user.js
lib/utils/value.js
lib/utils/watchers.js
lib/utils/watchers_d2x.js
lib/vendor/README.md
lib/vendor/guiders.js
lib/vendor/guiders.scss
lib/vendor/index.js
lib/vendor/index.scss
locales/index.js
locales/locales/README.md
locales/locales/en.json
locales/locales/index.js
nightwatch.conf.js
package.json
requirements.txt
tests/.eslintrc.json
tests/Filterline.js
tests/RESTips.js
tests/accountSwitcher.js
tests/commandLine.js
tests/commentDepth.js
tests/commentNavigator.js
tests/commentQuickCollapse.js
tests/commentTools.js
tests/filteReddit.js
tests/fixtures/privacy/outbound-url-snapshot.json
tests/fixtures/showImages/old-reddit-media.html
tests/hideChildComments.js
tests/i18n.js
tests/keyboardNav.js
tests/menu.js
tests/newCommentCount.js
tests/notifications.js
tests/pageNavigator.js
tests/presets.js
tests/readComments.js
tests/saveComments.js
tests/search.js
tests/selectedEntry.js
tests/settingsConsole.js
tests/showImages.js
tests/sourceSnudown.js
tests/spamButton.js
tests/subredditInfo.js
tests/temporaryDropdownLinks.js
tests/unit/background-permissions-contract.test.mjs
tests/unit/background-service-worker-safety.test.mjs
tests/unit/build-release-contract.test.mjs
tests/unit/comment-navigator-contract.test.mjs
tests/unit/download-contract.test.mjs
tests/unit/hide-child-comments-contract.test.mjs
tests/unit/permissions-prompt-contract.test.mjs
tests/unit/premium-polish-contract.test.mjs
tests/unit/privacy-outbound-urls.test.mjs
tests/unit/settings-console-theme.test.mjs
tests/unit/settings-save-contract.test.mjs
tests/unit/show-images-hosts.test.mjs
tests/userHighlight.js
tests/userInfo.js
tests/userTagger.js
tests/voteEnhancements.js
tests/xPostLinks.js
yarn.lock
```

### Current Code Already Built

Registered modules in `lib/modules/index.js` at ingestion:

- Comment/thread: `absoluteTimestamps`, `autoExpand`, `commentDepth`, `commentHidePersistor`, `commentHighlights`, `commentNavigator`, `commentPreview`, `commentQuickCollapse`, `commentSortBy`, `commentStyle`, `commentTools`, `hideChildComments`, `hideGifComments`, `newCommentCount`, `nextTopComment`, `readComments`, `saveComments`, `showParent`, `sourceSnudown`, `viewDeleted`.
- Media: `showImages`, `downloadButtons`, `fixImageLinks`, `fixProcessingImg`, plus 86 host handlers.
- Privacy/safety/layout: `archiveLinks`, `disableSubredditStyles`, `infiniteScroll`, `markAllRead`, `nightMode`, `noParticipation`, `reddEye`, `restoreSubCounts`, `selectedEntry`, `spoilerTags`, `subredditBlacklist`.
- Infrastructure/settings: `classicFavicon`, `context`, `hover`, `menu`, `notifications`, `requestPermissions`, `search`, `settingsNavigation`, `userProfileSearch`, `version`.

Current strengths:

- Old-Reddit DOM assumptions are already present.
- Existing `watchForThings` processing is close to the right mutation pattern.
- Build supports Chrome MV3 and Firefox manifests.
- Settings console already has dark tokens and several theme variants.
- Unit contracts exist for permissions, service-worker safety, downloads, privacy URLs, host parsing, settings theme, save, comment navigator, and `hideChildComments`.

Current gaps against the maximal brief:

- Feature lifecycle is legacy `go()`-style, not a universal `init()/destroy()` registry.
- No userscript single-file build.
- No full competitor-union feature set.
- No comprehensive settings schema.
- No full media-download pipeline for DASH audio/video, galleries, or archive manifests.
- No advanced filtering/tagging restoration comparable to full RES plus modern scripts.
- No Moderator Toolbox-equivalent workbench.
- No data export suite.
- No local-first author intelligence or AI/bot signal surface.
- No first-class selector/API reference generated from live captures.

### MHTML Capture Findings

Two `.mhtml` captures were parsed by decoding MIME and quoted-printable parts, extracting HTML and CSS, and scanning DOM surfaces. Both captures included the current RES-Slim classes, which is useful for compatibility, but the stable plan below avoids relying on those injected classes.

#### Capture A - Front Page

| Field | Value |
| --- | --- |
| File | `reddit_ the front page of the internet.mhtml` |
| URL | `https://old.reddit.com/` |
| Captured | 2026-05-19 09:54:55 -0400 |
| Title | `reddit: the front page of the internet` |
| Body classes | `listing-page`, `loggedin`, `best-page`, `res-showImages`, `res-v0-4-0`, and related RES classes |
| Parts | 1 HTML, 34 CSS, 0 JavaScript |
| DOM counts | 25 `.thing`, 25 link posts, 28 forms, 0 comments |

Important elements:

- Feed: `#siteTable.sitetable.linklisting`
- Post rows: `.thing.link[data-fullname][data-permalink][data-subreddit]`
- Post metadata: `data-author`, `data-subreddit-prefixed`, `data-url`, `data-domain`, `data-comments-count`, `data-score`, `data-promoted`, `data-nsfw`, `data-spoiler`, `data-oc`, `data-num-crossposts`
- Header: `#header[role=banner]`, `#header-bottom-left`, `#header .tabmenu`
- Subreddit bar: `#sr-header-area`, `#sr-header-area .sr-list`, `#sr-more-link`
- Search: `#search[role=search] input[name=q]`
- Sidebar: `.side`, `.side .spacer`
- Vote controls: `.midcol .arrow.up[role=button][aria-label=upvote]`, `.midcol .arrow.down[role=button][aria-label=downvote]`
- Media: `.thumbnail`, `.expando-button`, `.expando`
- Account/userbar: `#header-bottom-right`, `#mail`
- RES settings hook: `#RESSettingsButton`

#### Capture B - Comment Thread

| Field | Value |
| --- | --- |
| File | `This has to stop, They are taking our limits with each free limit resets _ codex.mhtml` |
| URL | `https://old.reddit.com/r/codex/comments/1th66mb/this_has_to_stop_they_are_taking_our_limits_with/` |
| Captured | 2026-05-19 09:55:09 -0400 |
| Title | `This has to stop, They are taking our limits with each free limit resets : codex` |
| Body classes | `comments-page`, `single-page`, `loggedin`, `subscriber`, `res-showImages`, `res-v0-4-0`, and related RES classes |
| Parts | 1 HTML, 34 CSS, 0 JavaScript |
| DOM counts | 77 `.thing`, 1 link post, 75 comments, 78 forms |

Important elements:

- Comment area: `.commentarea`
- Comment listing: `.commentarea .sitetable.nestedlisting`
- Comment rows: `.thing.comment[data-fullname][data-author][data-permalink]`
- Comment child containers: `.thing.comment > .child`, `.thing.comment .child .sitetable`
- Collapse controls: `.thing.comment .expand`
- Composer: `form.usertext`, `.usertext-edit textarea`, `textarea[name=text]`
- Report/mod surfaces: `.reportform`, `.report-button`, `.hide-button`, `.save-button`
- Data attributes: `data-res-slim-ups`, `data-gildings`, `data-replies`, `data-fullname`, `data-author`, `data-subreddit`, `data-permalink`

### CSS Custom Properties and Design Tokens

The MHTML documents contain 515 CSS custom properties, but the visible set is from browser/theme extensions such as DarkReader/D2L rather than first-party old Reddit. Old Reddit itself remains a legacy CSS site with IDs, classes, and inline HTML.

Repo-native tokens live in `lib/options/options.scss`:

- Core settings surface tokens: `--options-bg`, `--options-panel`, `--options-panel-strong`, `--options-field`, `--options-border`, `--options-text`, `--options-muted`, `--options-accent`, `--options-success`, `--options-warning`, `--options-danger`, `--options-shadow`.
- Existing palettes: default/graphite, midnight, forest, ember.

Future injected UI should add `--rsm-*` tokens, not hardcoded raw colors:

- `--rsm-bg`, `--rsm-bg-elevated`, `--rsm-bg-glass`
- `--rsm-text`, `--rsm-text-muted`, `--rsm-border`
- `--rsm-accent`, `--rsm-accent-2`, `--rsm-danger`, `--rsm-warning`, `--rsm-success`
- `--rsm-radius-control`, `--rsm-radius-panel`
- `--rsm-z-toast`, `--rsm-z-overlay`, `--rsm-z-panel`
- `--rsm-motion-fast`, `--rsm-motion-normal`, `--rsm-ease-spring`

### Inline Scripts, APIs, State, Framework Signals

The MHTML captures include no JavaScript parts and no inline scripts, so they do not expose GraphQL query IDs, feature flags, or state-store shapes. The current codebase supplies the reusable API facts:

- Same-origin foreground AJAX appends `app=res` and includes cookies.
- Same-origin non-GET requests attach `X-Modhash` from page context.
- Cross-origin requests route through background messaging.
- Relevant endpoints currently used or planned:
  - `/api/me.json`
  - `/api/read_all_messages`
  - `/api/store_visits`
  - `/api/hide`, `/api/unhide`
  - `/by_id/<ids>.json`
  - `/user/<username>/about.json`
  - `/r/<subreddit>/about.json`
  - `/r/<subreddit>/about/rules.json`
  - `/r/<subreddit>/about/stylesheet.json`
  - `/r/<subreddit>/wiki/pages.json`
  - `/api/search_reddit_names.json`
  - `<path>.json` for source markdown/snudded data
  - `/duplicates/<article>.json`
  - `https://api.pullpush.io/reddit/search/comment/?ids=<id>`
  - Wayback `https://web.archive.org/save/<url>` and CDX APIs
  - Optional Cobalt media API, optional local companion endpoint

SPA framework signals:

- Old Reddit captures are server-rendered legacy pages. No React/Vue/Svelte markers were present in the captures.
- Current code includes `watchers_d2x.js` for newer Reddit signals, but the target remains old Reddit.
- Settings navigation already hooks `popstate`, `hashchange`, and `history.pushState` for internal settings routes.

CSP and TrustedTypes:

- Capture HTML did not expose a page CSP or TrustedTypes policy.
- `chrome/manifest.json` extension CSP is restrictive: self scripts/images, HTTPS connect, font self/data, frame ancestors Reddit.
- Future code must treat TrustedTypes support as mandatory for any optional support on Google/YouTube or modern embeds.

---

## Phase 1 - Competitive Landscape

Rank is based on install/user count first, then active maintenance, breadth, relevance to old Reddit, and feature density.

Source codes used later:

- `RSM`: current RES-Slim repo
- `RES`: upstream Reddit Enhancement Suite
- `REnh`: Reddit Enhancer
- `TB`: Reddit Moderator Toolbox
- `ORR`: Old Reddit Redirect family
- `OL`: oldlander
- `R++`: Reddit++
- `RMod2`: redditmod2
- `UU`: Unedit and Undelete for Reddit
- `GF`: GreasyFork one-off scripts
- `OJ`: OpenUserJS scripts
- `US`: Userstyles/Stylus themes
- `COMM`: community requests and complaint threads

### Ranked Tool Table

| Rank | Tool | Author/source | Footprint | Last updated observed | Feature count used for matrix | What it does best |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | Reddit Enhancement Suite | honestbleeps / RES team | Chrome 1,000,000 users; AMO 305,682 users; GitHub 4,433 stars | Chrome 2025-01-22; AMO 2025-01-23; GitHub pushed 2026-04-13 | 45+ | Deepest old-Reddit browsing, inline media, filters, user tagging, dashboard, settings. |
| 2 | Reddit Enhancer | joelacus | Chrome 10,000 users; AMO 2,619 users; GitHub 213 stars | GitHub/AMO 2026-05-17; Chrome page observed v2.6.1 2026-02-09 | 60+ | Modern UI controls, hiding clutter, video/image controls, feed width, redirects, custom themes. |
| 3 | Old Reddit Redirect | Tom Watson / dessant family / store forks | Chrome 90,000 users; AMO 65,260 users | AMO 2026-03-06; Chrome 2025-07-15 | 3 | Reliable old-reddit URL enforcement. |
| 4 | Reddit Moderator Toolbox | toolbox-team | Chrome 10,000 users; AMO 2,377 users; GitHub 122 stars | AMO 2026-02-05; GitHub pushed 2026-03-04 | 35+ | Moderator queue, user notes, removal reasons, macros, history, modbar. |
| 5 | Unedit and Undelete for Reddit | GreasyFork script author | 10,864 installs | 2023-06-25 | 3 | Restore previous/deleted comment versions from Pushshift-style sources. |
| 6 | Reddit Fix | GreasyFork | 14,012 installs | 2025-02-10 | 8 | Large install signal for one-off UI repair. |
| 7 | Remove Reddit Login Requirement | SoCuul | 10,821 installs | 2025-07-04 | 3 | Bypass forced login. |
| 8 | Reddit NSFW Unblur | hdyzen | 8,456 installs | 2026-05-10 | 4 | Unblur NSFW/spoiler content on current Reddit surfaces. |
| 9 | Privacy Redirector | dybdeskarphet | 8,395 installs | 2025-02-12 | 8 | Redirect privacy-hostile services to alternate frontends. |
| 10 | Reddit Video Downloader | GreasyFork | 7,769 installs | 2022-12-17 | 4 | Simple media download affordance. |
| 11 | delete all reddit comments | GreasyFork | 7,542 installs | 2014-05-30 | 3 | Bulk history cleanup. |
| 12 | Reddit++ | lnm95 | 6,669 installs | 2026-04-29 | 25+ | Current active userscript with UI cleanup, keyword filtering, sidebars, media expansion, themes. |
| 13 | Remove Reddit Over 18 Login Requirement Popup | jeyami | 6,301 installs | 2023-06-22 | 3 | Age gate/popup removal. |
| 14 | Reddit Old Redirect | Agreasyforkuser | 4,783 installs | 2026-05-02 | 2 | Script-level old-reddit enforcement. |
| 15 | Reddit expand media and comments | GreasyFork | 4,640 installs | 2024-11-24 | 6 | Auto expand media and comment continuations. |
| 16 | Reddit Age Bypass | GreasyFork | 4,295 installs | 2024-09-12 | 2 | Age gate bypass. |
| 17 | Reddit spoiler blur remover | GreasyFork | 4,091 installs | 2020-11-16 | 2 | Spoiler blur removal. |
| 18 | Reddit Load Continue thread inline | GreasyFork | 4,075 installs | 2022-10-13 | 2 | Inline continuation loading. |
| 19 | Cobalt Tools Video Downloader | yodaluca23 | 3,374 installs | 2025-01-31 | 5 | Media download through Cobalt-style workflow. |
| 20 | redditmod2 | GreasyFork | 2,960 installs | 2023-09-03 | 20+ | Legacy all-in-one theming, endless scroll, filters, comments, inline post view. |
| 21 | Better Reddit Delete | Tim Linden | 2,930 installs | 2018-07-22 | 3 | Safer deletion workflow for own content. |
| 22 | Reddit highlight newest comments | GreasyFork | 2,979 installs | 2016-01-23 | 2 | New-comment highlighting. |
| 23 | Reddit Bypass Enhancer | UniverseDev | 2,487 installs | 2026-04-17 | 6 | Login/app/NSFW friction removal. |
| 24 | Reddit Multi Column | c6p | 2,043 installs | 2025-04-08 | 2 | Multi-column layout. |
| 25 | Reddit Comment Expander | OpenUserJS / Nascent | 165 installs | 2026-02-18 observed | 2 | Clicks `.morecomments` to expand hidden comments. |
| 26 | oldlander | OctoNezd | AMO 1,627 users; GitHub 178 stars | GitHub 2026-01-13; AMO 2024-12-20 | 12 | Makes old Reddit usable on mobile/tablet. |
| 27 | Reddit Download Buttons | 956MB | 1,362 installs | 2026-04-04 | 4 | Download buttons for images/videos. |
| 28 | Reddit - Hide sidebar | jesuis parapluie | 1,389 installs | 2015-01-24 | 1 | Single-purpose sidebar removal. |
| 29 | Download Media with Cobalt API | tizee | 1,490 installs | 2025-05-10 | 4 | External media download bridge. |
| 30 | Reddit Top Comments Preview | GreasyFork | 1,530 installs | 2023-03-02 | 2 | Preview top comments from listings. |
| 31 | Reddit Unddit Undelete | nazdridoy | 249 installs | 2025-04-30 | 2 | Unddit restore link. |
| 32 | Reddit Default Sort | yodaluca23 | 104 installs | 2025-02-21 | 2 | Persist preferred sort. |
| 33 | Reddit Search Preview Inline Interactive Gallery Carousel | GreasyFork | 68 installs | 2026-05-14 | 3 | Inline media gallery inside search results. |
| 34 | Old Reddit Comment Auto-Refresh Toggle | GreasyFork | 0 installs | 2026-05-17 | 2 | Auto-refresh thread controls. |
| 35 | Reddit Comment Auto-Expander (Smooth) | verydelight | 392 installs | 2025-10-05 | 2 | Smooth expand hidden comments. |
| 36 | Reddit User/Subreddit/Domain Filter | jcunews | 320 installs | 2019-01-26 | 5 | Basic entity filters. |
| 37 | Block reddit click tracking | vacuum | 552 installs | 2018-04-29 | 2 | Link-tracking removal. |
| 38 | reddit: sabotage event tracker | vacuum | 786 installs | 2021-10-31 | 2 | Disable event tracking. |
| 39 | Markdown toolbar for reddit.com | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 3 | Composer affordances. |
| 40 | Reddit Plus | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 5 | General power-user enhancements. |
| 41 | Old Reddit Layout | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 3 | New-to-old layout restoration. |
| 42 | A Better Old Reddit Redirect | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 3 | Redirect logic. |
| 43 | Reddit Base64 Decoder | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 1 | Decode base64 snippets. |
| 44 | Reddit: Highlight New Comments | OpenUserJS | OpenUserJS listing | date not exposed in crawl | 2 | New-comment highlight. |
| 45 | Reddit OLED mode old.reddit.com | Userstyles.org | Userstyle listing | crawled 2026; page date varies | 2 | True-black CSS theme. |
| 46 | Reddit Minimal Dark | Userstyles.org | Userstyle listing | crawled 2026 | 4 | Minimal dark CSS restyle. |
| 47 | Reddit Custom RES Compatible - KMV | Userstyles.org | Userstyle listing | crawled 2026 | 4 | RES-compatible CSS theming. |
| 48 | Old Reddit Dark Mode | Userstyles.org | tanko | created 2020-11-30; updated 2020-12-18 | 2 | Basic old-Reddit dark mode reference. |
| 49 | Edge Add-ons RES | Microsoft Edge listing | listed | count not exposed in crawl | 45+ | Edge distribution parity for RES. |
| 50 | Toggle Old Reddit Redirect | AMO | 16 users | 2024-07-27 | 2 | User-controlled redirect toggle. |
| 51 | Old New Reddit Redirect | AMO | 87 users | 2025-10-14 | 2 | Toggle to `new.reddit.com` as alternate compatibility target. |
| 52 | Oldreddit | Chrome Web Store | 3 users | 2026-05-04 | 2 | Tiny current redirector signal. |

### Community Request Signal

Observed active requests and gaps:

- RES is repeatedly described in `/r/Enhancement` threads as no longer adding new features; users still ask for replacements and snippets.
- API request limits are a live concern for userscripts calling `/user/<name>/about.json`; a rate limiter and cache are mandatory.
- Users want search sort/time filters to persist across searches.
- Users want separate control over post image changes versus comment image changes.
- Users ask for quick old/new/sh Reddit toggles.
- Color-coded comment-depth collapse snippets remain popular because existing controls are visually weak.
- Inline media conflicts are common enough that per-surface media toggles are needed.
- Moderator Toolbox has a maintenance handoff risk; a modern optional moderator workbench is a competitive gap.

---

## Phase 2 - Feature Catalog and Gap Analysis

### Feature Matrix

Legend: `Yes` means directly observed. `Partial` means current implementation covers part of it or an adjacent feature. `Planned` means a net-new improvement beyond competitors.

| Category | Feature | RSM | RES | REnh | TB | GF/OJ | US | Best observed implementation | Max roadmap decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Core | Feature registry with reversible lifecycle | Partial | Partial | Partial | Partial | No | No | None has clean universal destroy | Build required |
| Core | Settings import/export | Partial | Yes | Partial | Yes | No | No | RES backup UX | Build local-only JSON |
| Core | Immediate settings apply | Partial | Partial | Yes | Partial | Partial | No | Reddit Enhancer toggles | Build everywhere |
| Core | Toast feedback, no dialogs | Partial | Partial | Partial | Partial | No | No | None complete | Build as standard |
| Core | Single-file userscript delivery | No | No | No | No | Yes | Yes | Reddit++ | Build companion |
| Core | Browser extension distribution | Yes | Yes | Yes | Yes | No | No | RES/Reddit Enhancer | Keep and expand |
| Theming/UI | Dark theme | Yes | Yes | Yes | No | Yes | Yes | Userstyles and Reddit Enhancer | Build tokenized |
| Theming/UI | OLED true-black theme | No | Partial | Partial | No | Partial | Yes | Userstyles OLED | Build first-class |
| Theming/UI | Custom accent and scrollbar | Partial | Partial | Yes | No | Partial | Partial | Reddit Enhancer | Build |
| Theming/UI | Glass settings panel | Partial | No | Partial | No | No | No | None complete | Build |
| Theming/UI | Dense/compact mode | Partial | Partial | Yes | No | Yes | Yes | redditmod2, Reddit++ | Build |
| Theming/UI | Full-width feed/thread | No | Partial | Yes | No | Yes | Yes | Reddit Enhancer | Build |
| Theming/UI | Multi-column feed | No | No | No | No | Yes | Partial | Reddit Multi Column | Build optional |
| Theming/UI | Hide sidebar | No | Partial | Yes | No | Yes | Yes | Reddit Enhancer | Build per-page |
| Theming/UI | Collapsible sidebar rail | No | Partial | Partial | No | Partial | No | RES-style snippets | Build |
| Theming/UI | Hide awards/flair/avatar/icons | No | Partial | Yes | No | Partial | Yes | Reddit Enhancer | Build granular |
| Theming/UI | Post numbering | No | Partial | Yes | No | Partial | No | Reddit Enhancer | Build |
| Theming/UI | OP/admin/mod/friend highlight | Partial | Yes | Yes | Partial | Partial | No | RES | Build |
| Theming/UI | Color-coded comment depth | Partial | Partial | No | No | Yes | Yes | Community snippet | Build with tokens |
| Theming/UI | Hide username in header | No | Yes | Yes | No | Partial | Yes | RES/Reddit Enhancer | Build |
| Navigation | Old Reddit redirect | No | Partial | Yes | No | Yes | No | Old Reddit Redirect | Build optional |
| Navigation | Toggle old/www/sh host | No | No | Partial | No | Community | No | Community bookmarklet | Build button, no shortcut |
| Navigation | Infinite scroll | Yes | Yes | Partial | No | Yes | No | RES | Keep and harden |
| Navigation | Load continue thread inline | No | Partial | No | No | Yes | No | GreasyFork script | Build |
| Navigation | Comment navigator by buttons | Yes | Yes | No | No | Partial | No | RES | Keep, remove shortcuts |
| Navigation | Scroll restore per thread | No | Partial | No | No | Partial | No | Browser/session snippets | Build |
| Navigation | Thread minimap/heatmap | No | No | No | No | No | No | Net-new | Build |
| Navigation | Search filters persist | No | No | No | No | Community | No | r/Enhancement userscript | Build |
| Navigation | Search dispatcher | Partial | Partial | No | No | Partial | No | RES search + community | Build |
| Navigation | Top comments preview from listing | No | No | No | No | Yes | No | GreasyFork Top Comments Preview | Build |
| Content filtering | Subreddit filter | Yes | Yes | Partial | No | Yes | No | RES filteReddit | Restore/expand |
| Content filtering | User filter/ignore | No | Yes | Partial | Partial | Yes | No | RES user tagger/filter | Build |
| Content filtering | Domain filter | Partial | Yes | Partial | No | Yes | No | RES filteReddit | Build |
| Content filtering | Keyword/regex filter | Partial | Yes | Yes | No | Yes | No | Reddit++ | Build |
| Content filtering | Flair filter | Partial | Yes | Partial | No | Partial | No | RES | Build |
| Content filtering | Score/comment-count filters | Partial | Yes | No | No | Partial | No | RES resident cases | Build |
| Content filtering | Hide promoted posts | No | Partial | Yes | No | Yes | Yes | Reddit Enhancer + scripts | Build default on |
| Content filtering | Hide NSFW/spoiler content | Partial | Yes | Yes | No | Yes | Partial | RES/Reddit Enhancer | Build |
| Content filtering | Unblur NSFW/spoilers | Partial | No | Yes | No | Yes | Partial | Reddit NSFW Unblur | Build opt-in |
| Content filtering | Bot/AutoModerator collapse | No | Partial | No | Partial | Partial | No | RES snippets | Build |
| Content filtering | Low-score/deleted/gif collapse | Yes | Partial | No | Partial | Partial | No | RES-Slim + RES | Expand |
| Content filtering | Repost/duplicate detection | No | Partial | No | Partial | No | No | RES submit warning | Build inline |
| Content filtering | AI/bot prose signal | No | No | No | No | GitHub niche | No | Reddit_AI_BotBuster | Build local-only |
| Media | Inline image expandos | Yes | Yes | Partial | No | Yes | No | RES | Keep |
| Media | Inline video expandos | Yes | Yes | Yes | No | Yes | No | RES/Reddit Enhancer | Expand |
| Media | Full-height images | No | Partial | Yes | No | Partial | Yes | Reddit Enhancer | Build |
| Media | Image overlay viewer | No | Partial | Yes | No | Partial | No | Reddit Enhancer | Build |
| Media | Browser-native video player | Partial | Partial | Yes | No | Partial | No | Reddit Enhancer | Build |
| Media | Download buttons | Yes | No | Yes | No | Yes | No | Reddit Download Buttons | Expand |
| Media | v.redd.it audio+video merge | No | No | Partial | No | Partial | No | Cobalt/yt-dlp scripts | Build optional |
| Media | Gallery ZIP/export | No | Partial | No | No | Partial | No | Downloader scripts | Build |
| Media | RedGifs v3 layout | Partial | Partial | No | No | Yes | No | RedGifs v3 script | Build |
| Media | Inline search gallery carousel | No | No | No | No | Yes | No | GreasyFork search gallery | Build |
| Media | Thumbnail scale controls | No | Partial | Yes | No | Yes | Yes | Reddit Enhancer | Build |
| Moderation | Modbar | No | Partial | No | Yes | No | No | Toolbox | Build optional |
| Moderation | Mod queue tools | No | Partial | No | Yes | No | No | Toolbox | Build optional |
| Moderation | User notes | No | Partial | No | Yes | No | No | Toolbox | Build optional local/cache |
| Moderation | Removal reasons | No | Partial | No | Yes | No | No | Toolbox | Build optional |
| Moderation | Ban macro | No | No | No | Yes | No | No | Toolbox | Build optional |
| Moderation | Comment nuke | No | No | No | Yes | No | No | Toolbox | Build optional with undo toast where possible |
| Moderation | Domain/user history | Partial | Partial | No | Yes | No | No | Toolbox | Build optional |
| Privacy | Outbound click tracking cleanup | Partial | Partial | No | No | Yes | No | vacuum scripts | Build default on |
| Privacy | Event tracking sabotage | No | No | No | No | Yes | No | vacuum script | Build default on where safe |
| Privacy | App/open-login prompt removal | No | No | Partial | No | Yes | No | Reddit Bypass Enhancer | Build |
| Privacy | Mature/age gate bypass | No | No | Partial | No | Yes | No | GF mature/age scripts | Build opt-in |
| Privacy | Alternate frontend redirects | No | No | Partial | No | Yes | No | Privacy Redirector | Build optional |
| Privacy | Hide real username | No | Yes | Yes | No | Yes | Yes | RES/Reddit Enhancer | Build |
| Privacy | No telemetry/offline operation | Yes | Partial | Unknown | Unknown | Varies | Yes | RES-Slim tests | Keep and harden |
| Data/export | Comment tree export JSON/MD/HTML | No | No | No | Partial | No | No | Net-new | Build |
| Data/export | Settings backup | Partial | Yes | Partial | Yes | No | No | RES | Build schema-backed |
| Data/export | Saved content backup | Partial | Partial | No | No | Partial | No | RES saveComments | Build |
| Data/export | Vote/read history local log | Partial | Partial | No | No | GitHub niche | No | Reddit_comment_vote_history | Build |
| Data/export | Filter/user-tag import/export | No | Yes | Partial | Yes | No | No | RES/Toolbox | Build |
| Data/export | Media archive manifest | No | No | No | No | Partial | No | Net-new | Build |
| Accessibility | Reduced motion | Partial | Partial | Unknown | Unknown | No | Partial | Modern CSS practice | Build contract |
| Accessibility | WCAG dark contrast tokens | Partial | Partial | Unknown | Unknown | No | Varies | Userstyles inconsistent | Build contract |
| Accessibility | Screen-reader labels for injected UI | Partial | Partial | Unknown | Unknown | No | No | RES | Build contract |
| Accessibility | Font sizing/readability controls | No | Partial | Partial | No | Partial | Yes | oldlander/userstyles | Build |
| Accessibility | Tab/focus trap in overlays | Partial | Partial | Unknown | Unknown | No | No | RES settings | Build |
| Integrations | PullPush restore | Yes | Partial | No | No | Yes | No | Unedit/Undelete | Build with fallback |
| Integrations | Wayback/archive.ph | Partial | Partial | No | No | Yes | No | archiveLinks scripts | Build |
| Integrations | Cobalt media | No | No | No | No | Yes | No | Cobalt scripts | Build optional |
| Integrations | Local companion/yt-dlp | No | No | No | No | No | No | Net-new | Build optional |
| Integrations | Local LLM/Ollama summary | No | No | No | No | No | No | Net-new | Build optional, off |
| Quality of life | Markdown toolbar | Partial | Partial | No | No | OJ | No | OJ toolbar | Build no shortcuts |
| Quality of life | Copy code block | No | Requested | No | No | Partial | No | Community/RES issue | Build |
| Quality of life | Comment draft restore | No | Requested | No | No | Partial | No | Community/RES issue | Build |
| Quality of life | Default sort | Partial | Partial | No | No | Yes | No | Reddit Default Sort | Build |
| Quality of life | Auto-refresh comments | No | No | No | No | Yes | No | GF auto-refresh toggle | Build |
| Quality of life | Subscriber/member counts | Yes | Requested | No | No | Yes | No | GF member count | Build |
| Quality of life | Disable auto-translation | No | No | No | No | Yes | No | Reddit no auto-translate | Build |
| Quality of life | Base64 decoder | No | No | No | No | OJ | No | OpenUserJS Base64 Decoder | Build |
| Quality of life | Login autofill repair | No | No | No | No | Yes | No | GF Login Autofill Repair | Build if capture proves need |
| Quality of life | Banned banner removal | No | No | No | No | Yes | No | GF Remove banned banner | Build |

### Gap Analysis

Competitor weaknesses to beat:

- RES remains the biggest baseline but is maintenance-mode, carries legacy architecture, and lacks modern lifecycle cleanup.
- Reddit Enhancer is current and polished but focuses on newer Reddit UI surfaces; old-Reddit depth is thinner than RES.
- Moderator Toolbox is broad but moderator-specific and now carries maintenance-handoff risk.
- GreasyFork/OpenUserJS scripts solve narrow problems but conflict with each other, lack a unified settings model, and rarely provide cleanup.
- Userstyles provide theme ideas but cannot coordinate behavior, persistence, accessibility, or per-surface state.
- No competitor has a complete old-Reddit product with a premium dark-only UI, single settings schema, extension/userscript parity, full destroy lifecycle, MHTML-backed selector tests, local-first intelligence, moderator tools, archive diff, and media download workflows.

Final scope:

- Implement every matrix feature unless a later implementation spike proves it legally unsafe, platform-blocked, or impossible against Reddit's current behavior.
- Any feature that uses external services is optional, disabled by default, rate-limited, and visibly marked as external.
- Any destructive workflow uses toast feedback and reversible undo where available, not confirmation dialogs.

---

## Phase 3 - Technical Reconnaissance

### Selector Strategy

Old Reddit has stable IDs, legacy class names, and strong `data-*` attributes. The captures do not show modern hashed/obfuscated app classes. The fragile selector column records fallback/raw class chains that are more likely to churn or overmatch. Stable selectors are preferred.

| Surface | Stable selector | Fragile fallback | Notes |
| --- | --- | --- | --- |
| Page root | `body.listing-page`, `body.comments-page`, `body.single-page` | `body.res-v0-4-0` | Use page-type body classes; do not require RES class. |
| Header/banner | `#header[role="banner"]` | `#header-bottom-left .tabmenu` | Stable old-Reddit ID. |
| Subreddit top bar | `#sr-header-area .sr-list` | `#sr-more-link` | Needs overflow handling. |
| Userbar | `#header-bottom-right` | `.user .userkarma` | Account/user privacy features attach here. |
| Mail/notifications | `#mail`, `#modmail`, `#new_modmail` | `#header-bottom-right .message-count` | Use if present. |
| Search | `#search[role="search"] input[name="q"]` | `.side #search input[type="text"]` | Search persistence/dispatcher. |
| Listing feed | `#siteTable.sitetable.linklisting` | `.linklisting .thing.link` | Observe added children only. |
| Post row | `.thing.link[data-fullname][data-permalink]` | `.linklisting .thing.link.odd, .linklisting .thing.link.even` | Use `data-fullname` as durable key. |
| Post title | `.thing.link[data-fullname] a.title` | `.entry .title` | Title features and filters. |
| Post metadata | `.thing.link[data-subreddit][data-domain][data-author]` | `.tagline .subreddit, .tagline .author` | Prefer data attrs. |
| Post action bar | `.thing.link[data-fullname] .entry .buttons` | `.entry > ul.flat-list.buttons` | Add small text/icon controls here. |
| Vote column | `.thing[data-fullname] .midcol .arrow[role="button"]` | `.midcol .arrow.up, .midcol .arrow.down` | Keep aria labels. |
| Score | `.thing[data-fullname] .score` | `.midcol .score.unvoted` | Score classes can change after voting. |
| Expando button | `.thing[data-fullname] .expando-button` | `.expando-button.video, .expando-button.image` | High-churn media surface. |
| Expando body | `.thing[data-fullname] .expando` | `.entry .expando` | Media features attach here. |
| Thumbnail | `.thing[data-fullname] a.thumbnail` | `.thumbnail.self, .thumbnail.default` | Thumbnail style controls. |
| Sidebar | `.side` | `body > .content + .side` | Old layouts vary by sub CSS. |
| Comment area | `.commentarea` | `div.commentarea > div.sitetable` | Thread-only. |
| Comment listing | `.commentarea .sitetable.nestedlisting` | `.nestedlisting` | Observe added nodes only. |
| Comment row | `.thing.comment[data-fullname][data-author]` | `.comment.noncollapsed, .comment.collapsed` | Use `data-fullname` as durable key. |
| Comment body | `.thing.comment[data-fullname] .usertext-body` | `.comment .md` | Markdown tools. |
| Comment child container | `.thing.comment[data-fullname] > .child` | `.comment .child .sitetable` | High-churn for collapse/load more. |
| Collapse control | `.thing.comment[data-fullname] .expand` | `.comment .entry .tagline .expand` | Color-coded depth, collapse. |
| Composer form | `form.usertext textarea[name="text"]` | `.usertext-edit textarea` | Draft restore and toolbar. |
| Submit buttons | `form.usertext button[type="submit"]` | `.usertext-buttons button.save` | Do not assume text content. |
| Report form | `.reportform` | `.report-button + form` | Modal-ish legacy surface. |
| Save/hide controls | `.save-button`, `.hide-button` | `.buttons .first, .buttons li a` | Use text/action detection fallback. |
| Author links | `.tagline .author` | `a.author` | Author hovercards and badges. |
| Profile listing | `.profile-page .sitetable .thing` | `body.profile-page .thing` | Need extra captures. |
| Mod queue | `body.modqueue-page .thing[data-fullname]` | `.modqueue .thing` | Needs live capture. |
| RES settings button | `#RESSettingsButton` | `.RESSettingsButton` | Existing integration point. |
| RES/options iframe/panel | `#RESConsoleContainer`, `.RESDialogSmall` | RES-specific class chain | Needs adapter during migration. |

High-churn areas needing self-healing:

- Media expandos and host-specific inserted DOM.
- Comment continuation loaders and child containers.
- Reply/edit textareas created lazily.
- Report/mod action forms.
- Subreddit custom CSS that reshapes `.side`, `.entry`, and `.buttons`.
- Any future support for new/sh Reddit, where classes are generated and TrustedTypes is more likely.

Implementation rule:

- Use `findElement(surface, selectorList)` with stable selector first and fallback selector second.
- Use `waitForElement` with exponential backoff only for surfaces that are known to appear late.
- Process `MutationObserver` `addedNodes` and their descendants; never rescan the full document on every mutation.

### SPA and Page Lifecycle Handling

Old Reddit is not an SPA in the captured pages. Treat each full page load as authoritative, with targeted observers for dynamically added content.

Run at `document_start`:

- Critical dark/OLED anti-FOUC body class.
- Token CSS.
- Promoted/link tracking guards that need early event capture.
- TrustedTypes policy creation when available.

Run at DOM ready:

- Settings panel mount.
- Page-surface detector.
- Feature registry init for enabled features.
- Per-page feature gates.

Run per added thing/comment:

- Filters.
- UI adornments.
- Author badges.
- Media controls.
- Read/save/vote state.

Route hooks:

- Old Reddit: no route-change hook required for normal pages.
- Settings: keep `popstate`, `hashchange`, patched `history.pushState`.
- Future new/sh support: add `location.href` polling fallback plus `popstate` and MutationObserver route sentinels.

### Site APIs, Rate Limits, and Auth

| API | Use | Auth | Rate-limit strategy |
| --- | --- | --- | --- |
| `/api/me.json` | identity, username hiding, permissions | Cookie | Cache per session, refresh on login changes. |
| `/user/<name>/about.json` | author badges, shadowban hints | Cookie/anonymous | Token bucket: 1 req/sec, burst 5, 24h cache per user. |
| `/r/<sub>/about.json` | subreddit cards | Cookie/anonymous | Cache 24h per subreddit. |
| `/r/<sub>/about/rules.json` | rules inline | Cookie/anonymous | Cache 24h per subreddit. |
| `/duplicates/<article>.json` | crosspost map | Cookie/anonymous | On demand only, cache by article id. |
| `/by_id/<ids>.json` | restore/listing metadata | Cookie/anonymous | Batch ids, debounce. |
| `/api/hide`, `/api/unhide` | bulk hide/unhide | Cookie + modhash | Queue writes, toast results, undo when possible. |
| `/api/read_all_messages` | mark all read | Cookie + modhash | Existing path; preserve. |
| PullPush comment search | deleted/edited content | External | Disabled default; 0.2 req/sec, visible provenance. |
| Wayback CDX/save | archive lookup/snapshot | External | Disabled default; 0.2 req/sec. |
| archive.today | archive fallback | External | Disabled default; manual action only. |
| Cobalt API | media download | External | Disabled default; permission prompt. |
| Local companion | yt-dlp/ffmpeg bridge | localhost only | Disabled default; explicit URL and health check. |

Known constraint: community reports mention `100 requests per 10 minutes` as a userscript pain point for frequent Reddit API calls. This roadmap therefore requires caching, batching, and a visible rate-limit queue for author/subreddit enrichment.

### Userscript vs Extension Split

| Capability | Extension | Userscript |
| --- | --- | --- |
| DOM theming and filters | Yes | Yes |
| Settings panel | Yes | Yes |
| Local storage | `chrome.storage.local` | `GM_getValue` / `GM_setValue` |
| Cross-origin fetch | Background + host permissions | GM APIs if granted |
| Downloads | `chrome.downloads` | limited; anchor download or GM_download |
| `declarativeNetRequest` | Yes | No |
| External API rate queue | Background worker | page/GM state |
| Media muxing/local companion | Best | Partial |
| Store distribution | Yes | No |
| Single-file portability | No | Yes |

Recommendation: keep extension as the complete product and userscript as the portable subset. The userscript should share generated feature modules where possible, but can omit moderator actions, DNR, privileged downloads, and background queues.

### Architecture

Planned file layout:

```text
lib/core/registry/featureRegistry.js
lib/core/registry/featureContext.js
lib/core/registry/featureLifecycle.js
lib/core/settings/schema.js
lib/core/settings/defaults.js
lib/core/settings/storage-chrome.js
lib/core/settings/storage-gm.js
lib/core/settings/migrations.js
lib/core/dom/selectors.js
lib/core/dom/findElement.js
lib/core/dom/waitForElement.js
lib/core/dom/thingProcessor.js
lib/core/dom/trustedHtml.js
lib/core/dom/toastHost.js
lib/core/api/reddit.js
lib/core/api/rateLimiter.js
lib/core/api/archive.js
lib/core/api/media.js
lib/core/theme/tokens.scss
lib/core/theme/antiFouc.js
lib/features/<category>/<feature>.js
userscript/res-slim-max.user.js
userscript/gm-shim.js
tests/fixtures/mhtml/frontpage.html
tests/fixtures/mhtml/thread.html
tests/unit/selector-map-contract.test.mjs
```

Feature contract:

```js
export default {
  id: 'category.featureName',
  title: 'Feature name',
  category: 'category',
  defaultEnabled: false,
  permissions: [],
  surfaces: ['listing', 'comments'],
  settings: {},
  init(ctx) {},
  destroy(ctx) {},
};
```

`ctx` includes:

- settings adapter
- storage adapter
- scoped CSS manager
- DOM selector helpers
- toast manager
- logger/error panel
- rate-limited API clients
- observer manager
- feature cleanup registry
- TrustedTypes policy

Lifecycle rules:

- `init()` must register every cleanup action with `ctx.cleanup`.
- `destroy()` must be idempotent.
- Disabling a feature from settings must immediately run `destroy()`.
- Re-enabling must re-run `init()` and reprocess current visible nodes only once.
- A module failure must isolate to that module, log locally, and show a concise toast.

CSS strategy:

- Extension: compiled `res.css` plus feature-scoped injected styles when needed.
- Userscript: `GM_addStyle`.
- Scope all injected UI under `body.rsm-root` and feature classes such as `body.rsm-feature-promoted-nuke`.
- Keep theme values in `--rsm-*`; bridge existing `--options-*` tokens into settings only.
- Use `prefers-reduced-motion` to disable shimmer, hover lift, spring transitions, and staggered entrances.

Observer strategy:

- One root observer per page surface: listing, comments, sidebar/settings.
- Process added nodes only.
- Keep WeakSets of processed nodes by feature.
- Use `IntersectionObserver` for expensive media/author/API work.
- Use `requestIdleCallback` with timeout fallback for non-critical adornments.

---

## Selector and API Reference

### Stable Selector Map

The complete implementation selector map should live in `lib/core/dom/selectors.js`, sourced from the table in Phase 3. Required exported surfaces:

- `page.root`
- `page.header`
- `page.userbar`
- `page.search`
- `listing.feed`
- `listing.post`
- `listing.postTitle`
- `listing.postActions`
- `listing.voteColumn`
- `listing.expandoButton`
- `listing.expando`
- `listing.thumbnail`
- `thread.commentArea`
- `thread.commentList`
- `thread.comment`
- `thread.commentBody`
- `thread.commentChildren`
- `thread.collapseControl`
- `composer.form`
- `composer.textarea`
- `sidebar.root`
- `moderation.reportForm`
- `settings.resButton`
- `settings.overlayRoot`

### API Reference

Required clients:

- `redditClient.getMe()`
- `redditClient.getUserAbout(username)`
- `redditClient.getSubredditAbout(name)`
- `redditClient.getSubredditRules(name)`
- `redditClient.getDuplicates(articleId)`
- `redditClient.byId(fullnames[])`
- `redditClient.hide(fullname)`
- `redditClient.unhide(fullname)`
- `redditClient.readAllMessages()`
- `archiveClient.lookup(url)`
- `archiveClient.save(url)`
- `pullpushClient.getCommentsByIds(ids[])`
- `mediaClient.resolve(url)`
- `mediaClient.download(asset)`
- `localCompanionClient.health()`
- `localCompanionClient.ytdlp(url)`

Every external client must expose:

- `enabled`
- `origin`
- `permissionRequired`
- `rateLimit`
- `timeoutMs`
- `failureMode`
- `lastFailure`

Known constraints:

- Cross-origin calls require extension permissions or GM grants.
- Reddit write endpoints require modhash where old Reddit still expects it.
- External archive/media APIs must never run silently in default settings.
- CSP means all extension scripts must be bundled and self-hosted.
- TrustedTypes support must be centralized in `trustedHtml.js`.

---

## Settings Schema

Storage key convention: `rsm.<category>.<feature>.<setting>`. Feature toggles use `rsm.<category>.<feature>.enabled`.

Default rule:

- Existing safe RES-Slim behavior defaults to current behavior.
- Privacy cleanup and anti-promo defaults may be on if they do not create new network calls.
- External APIs, destructive actions, NSFW/age bypass, moderator writes, media muxing, and local LLM features default off.

| Category | Feature | Toggle key | Default | Notes |
| --- | --- | --- | --- | --- |
| core | Feature registry | `rsm.core.registry.enabled` | on | Cannot be disabled in UI. |
| core | Toast host | `rsm.core.toasts.enabled` | on | Required no-dialog feedback. |
| core | Error log panel | `rsm.core.errorLog.enabled` | on | Local only. |
| core | Settings import/export | `rsm.core.settingsBackup.enabled` | on | JSON only. |
| core | Userscript compatibility mode | `rsm.core.userscriptCompat.enabled` | auto | Build-dependent. |
| theme | OLED theme | `rsm.theme.oled.enabled` | on | Default visual baseline. |
| theme | Accent color | `rsm.theme.accent.value` | reddit-orange | Stored token. |
| theme | Dense mode | `rsm.theme.dense.enabled` | off | User opt-in. |
| theme | Glass panels | `rsm.theme.glass.enabled` | on | Disable for reduced motion/perf if needed. |
| theme | Branded scrollbar | `rsm.theme.scrollbar.enabled` | on | Scoped to Reddit pages. |
| theme | Full-width content | `rsm.theme.fullWidth.enabled` | off | Per-page subkeys. |
| theme | Multi-column feed | `rsm.theme.multiColumn.enabled` | off | Listing pages only. |
| theme | Hide sidebar | `rsm.theme.hideSidebar.enabled` | off | Per subreddit override. |
| theme | Collapsible sidebar rail | `rsm.theme.sidebarRail.enabled` | off | Mutually exclusive with hide sidebar. |
| theme | Hide awards | `rsm.theme.hideAwards.enabled` | off | Listing/thread. |
| theme | Hide flair | `rsm.theme.hideFlair.enabled` | off | User/link flair subkeys. |
| theme | Hide avatars/icons | `rsm.theme.hideIcons.enabled` | off | Mostly new/sh compatibility. |
| theme | Post numbers | `rsm.theme.postNumbers.enabled` | off | Listing. |
| theme | Color-coded depth | `rsm.theme.depthColors.enabled` | on | Old-Reddit thread. |
| navigation | Old Reddit redirect | `rsm.navigation.oldRedirect.enabled` | off | Optional. |
| navigation | Host toggle button | `rsm.navigation.hostToggle.enabled` | off | Button only, no shortcut. |
| navigation | Infinite scroll | `rsm.navigation.infiniteScroll.enabled` | current | Existing module. |
| navigation | Continue thread inline | `rsm.navigation.continueInline.enabled` | on | Thread. |
| navigation | Comment navigator buttons | `rsm.navigation.commentNavigator.enabled` | current | Remove feature shortcuts. |
| navigation | Scroll restore | `rsm.navigation.scrollRestore.enabled` | on | Per permalink. |
| navigation | Thread minimap | `rsm.navigation.threadMinimap.enabled` | off | Dense panel. |
| navigation | Search filters persist | `rsm.navigation.searchPersist.enabled` | on | Search pages. |
| navigation | Search dispatcher | `rsm.navigation.searchDispatcher.enabled` | off | External engines optional. |
| navigation | Top comments preview | `rsm.navigation.topCommentsPreview.enabled` | off | API use. |
| filters | Subreddit filter | `rsm.filters.subreddit.enabled` | current | Restore resident cases. |
| filters | User filter | `rsm.filters.user.enabled` | off | Local-only. |
| filters | Domain filter | `rsm.filters.domain.enabled` | off | Local-only. |
| filters | Keyword regex filter | `rsm.filters.keyword.enabled` | off | Weights: hide/dim/collapse. |
| filters | Flair filter | `rsm.filters.flair.enabled` | off | Link/user flair. |
| filters | Score filters | `rsm.filters.score.enabled` | off | Existing cases. |
| filters | Promoted nuke | `rsm.filters.promoted.enabled` | on | DOM removal plus count. |
| filters | NSFW/spoiler hide | `rsm.filters.nsfwHide.enabled` | off | Privacy preference. |
| filters | NSFW/spoiler unblur | `rsm.filters.nsfwUnblur.enabled` | off | Opt-in. |
| filters | Bot collapse | `rsm.filters.botCollapse.enabled` | off | Configurable names. |
| filters | Low-score collapse | `rsm.filters.lowScoreCollapse.enabled` | off | Threshold setting. |
| filters | Duplicate detector | `rsm.filters.duplicates.enabled` | off | API use. |
| filters | AI/bot prose signal | `rsm.filters.aiSignal.enabled` | off | Local heuristics only. |
| media | Inline images | `rsm.media.inlineImages.enabled` | current | Existing showImages. |
| media | Inline videos | `rsm.media.inlineVideos.enabled` | current | Existing showImages. |
| media | Post media toggle | `rsm.media.posts.enabled` | on | Separate from comments. |
| media | Comment media toggle | `rsm.media.comments.enabled` | on | Community-requested split. |
| media | Full-height images | `rsm.media.fullHeight.enabled` | off | Listing/thread. |
| media | Overlay viewer | `rsm.media.overlay.enabled` | off | Escape/click close; no dialog. |
| media | Native video player | `rsm.media.nativeVideo.enabled` | on | When safe. |
| media | Download buttons | `rsm.media.downloadButtons.enabled` | current | Existing plus expansion. |
| media | Gallery ZIP | `rsm.media.galleryZip.enabled` | off | Downloads permission. |
| media | DASH mux | `rsm.media.dashMux.enabled` | off | Local/Cobalt/wasm strategy. |
| media | RedGifs v3 | `rsm.media.redgifsV3.enabled` | on | Host-specific. |
| media | Search gallery | `rsm.media.searchGallery.enabled` | off | Search pages. |
| moderation | Mod workbench | `rsm.moderation.workbench.enabled` | off | Parent gate. |
| moderation | Modbar | `rsm.moderation.modbar.enabled` | off | Requires mod surface. |
| moderation | Queue tools | `rsm.moderation.queueTools.enabled` | off | Optional permissions. |
| moderation | User notes | `rsm.moderation.userNotes.enabled` | off | Local plus import. |
| moderation | Removal reasons | `rsm.moderation.removalReasons.enabled` | off | Write endpoint. |
| moderation | Ban macros | `rsm.moderation.banMacros.enabled` | off | Write endpoint. |
| moderation | Comment nuke | `rsm.moderation.commentNuke.enabled` | off | Destructive, toast undo where possible. |
| privacy | Outbound link cleanser | `rsm.privacy.outboundCleanser.enabled` | on | Mouseover/click. |
| privacy | Event tracker sabotage | `rsm.privacy.eventSabotage.enabled` | on | Safe only. |
| privacy | App prompt killer | `rsm.privacy.appPromptKiller.enabled` | on | No external calls. |
| privacy | Mature/age bypass | `rsm.privacy.ageBypass.enabled` | off | Opt-in. |
| privacy | Alternate frontends | `rsm.privacy.altFrontends.enabled` | off | Per service. |
| privacy | Username hider | `rsm.privacy.usernameHider.enabled` | off | Header. |
| data | Comment tree export | `rsm.data.commentExport.enabled` | off | JSON/MD/HTML. |
| data | Saved backup | `rsm.data.savedBackup.enabled` | off | API use. |
| data | Vote/read history | `rsm.data.historyLog.enabled` | off | Local IDB. |
| data | Filters import/export | `rsm.data.filterBackup.enabled` | on | JSON. |
| data | Media manifest | `rsm.data.mediaManifest.enabled` | off | Download workflows. |
| accessibility | Reduced motion | `rsm.a11y.reducedMotion.enabled` | auto | Mirrors OS by default. |
| accessibility | Contrast guard | `rsm.a11y.contrastGuard.enabled` | on | Token tests. |
| accessibility | Font size | `rsm.a11y.fontSize.value` | default | Range. |
| accessibility | Dyslexia-readable font | `rsm.a11y.readableFont.enabled` | off | Optional. |
| integrations | PullPush | `rsm.integrations.pullpush.enabled` | off | External. |
| integrations | Wayback | `rsm.integrations.wayback.enabled` | off | External. |
| integrations | archive.today | `rsm.integrations.archiveToday.enabled` | off | External. |
| integrations | Cobalt | `rsm.integrations.cobalt.enabled` | off | External. |
| integrations | Local companion | `rsm.integrations.localCompanion.enabled` | off | localhost only. |
| integrations | Local LLM summary | `rsm.integrations.localLlm.enabled` | off | localhost/Ollama. |
| qol | Markdown toolbar | `rsm.qol.markdownToolbar.enabled` | on | No shortcuts. |
| qol | Copy code block | `rsm.qol.copyCode.enabled` | on | Toast. |
| qol | Comment drafts | `rsm.qol.commentDrafts.enabled` | on | Local. |
| qol | Default sort | `rsm.qol.defaultSort.enabled` | off | Per subreddit. |
| qol | Auto-refresh comments | `rsm.qol.autoRefresh.enabled` | off | Backoff. |
| qol | Member counts | `rsm.qol.memberCounts.enabled` | on | Existing restore. |
| qol | Disable auto-translation | `rsm.qol.disableAutoTranslate.enabled` | on | If detected. |
| qol | Base64 decoder | `rsm.qol.base64Decoder.enabled` | off | Comment/post text. |
| qol | Login autofill repair | `rsm.qol.loginAutofillRepair.enabled` | off | Needs capture. |
| qol | Banned banner removal | `rsm.qol.bannedBannerRemoval.enabled` | off | If detected. |

---

## Phased Build Plan

Each phase must ship a usable product slice and update `README.md`, changelog, tests, and version surfaces when implementation begins. This planning run intentionally did not write those files.

### v0.5.0 - Core Engine and Capture Contracts

Features:

- [x] Add feature registry with `init()`/`destroy()`.
- [x] Add settings schema/defaults/migration layer.
- [x] Add selector map from this roadmap.
- [x] Add MHTML-derived HTML fixtures for front page and thread.
- [x] Add `trustedHtml` helper and TrustedTypes policy.
- [x] Add toast host and local error log panel.
- [x] Add anti-FOUC dark/OLED class at `document_start`.

Progress:

- 2026-05-19: Added the old-Reddit selector map, frontpage/thread MHTML-derived fixtures, selector contract coverage, `findElement`/`waitForElement` helpers, and TrustedTypes HTML helpers.
- 2026-05-19: Added standalone reversible feature registry/context infrastructure plus the roadmap-backed settings schema, defaults, migration helpers, and static contract tests.
- 2026-05-19: Added the dark-only toast host, local error log panel, registry error-log handoff, document-start OLED anti-FOUC hook, and inactive-overlay pointer-event guard.

Dependencies:

- Current `watchForThings`.
- Current options storage.
- Current build pipeline.

Acceptance criteria:

- [x] Every migrated feature can be toggled off and back on without duplicate DOM.
- [x] Selector tests pass against both captured pages.
- [x] Settings changes apply immediately.
- [x] Inactive settings overlay has `pointer-events: none`.
- [x] No keyboard shortcuts are added.
- [x] No feature code relies on hashed or generated classes as primary selectors.

### v0.6.0 - Settings Panel and Dark/OLED Design System

Features:

- [x] Rebuild settings categories from schema (handled by the v0.4.0 console rebuild + the v0.6.0 design system pass).
- [x] OLED, graphite, midnight, forest, ember, and accent token presets.
- [x] Dense mode, branded scrollbar, reduced-motion support.
- [x] Search/filter within settings.
- [x] JSON import/export.
- [x] Toast feedback for every setting change.

Progress:

- 2026-05-19: OLED palette landed as default; presets centralised in `lib/core/theme/settingsThemePresets.js`.
- 2026-05-19: Density toggle + branded scrollbar + reduce-motion override shipped.
- 2026-05-19: JSON import/export with snapshot round-trip + forward-compat contract test (`tests/unit/settings-snapshot-contract.test.mjs`).
- 2026-05-19: Toast helper `settingsToast()` wired into theme/density/motion/module/save/discard paths.
- 2026-05-19: WCAG AA contrast contract added (`tests/unit/settings-console-contrast.test.mjs`); all five themes pass 16 token pairings.

Acceptance criteria:

- [x] No light theme exists.
- [x] WCAG contrast tests pass for all tokens.
- [x] Disabling reduced motion removes shimmer/lifts/stagger.
- [x] Settings can import/export and round-trip without losing unknown future keys.

### v0.7.0 - Privacy, Redirect, and Anti-Promo Suite

Features:

- [x] Promoted post removal by `.promoted` and `data-promoted`.
- [x] Outbound URL cleanser for click and copy/mouseover.
- [x] Event tracking sabotage where safe.
- [x] App prompt, login wall, mature/age friction handling.
- [x] Optional old-Reddit redirect and host toggle button.
- [x] Username hider.

Progress:

- 2026-05-19: removePromoted shipped with header count badge.
- 2026-05-19: outboundCleanser shipped — pure helpers in `lib/utils/outboundCleanser.js`, DOM glue + capture-phase event handlers in `lib/modules/outboundCleanser.js`. Privacy URL snapshot updated.
- 2026-05-19: eventTrackingSabotage injects page-world wrappers for `sendBeacon` / `fetch` / `XMLHttpRequest` against curated tracker hosts + Reddit analytics paths.
- 2026-05-19: frictionRemovers auto-submits `/over18` and `/quarantine` forms; hides "use new Reddit" and "open in app" banners via single injected `<style>`.
- 2026-05-19: oldRedditRedirect adds opt-in `www -> old` redirect + always-on `old/www/sh` host toggle pill in the userbar.
- 2026-05-19: hideUsername masks the userbar entry and every `.author` link matching the logged-in user, with optional karma masking.

Acceptance criteria:

- [x] Privacy URL snapshot updated and reviewed.
- [x] No new external network call happens with default settings.
- [x] Redirect can be disabled immediately without reload when technically possible.
- [x] Removed promoted count is visible in a small status surface.

### v0.8.0 - Navigation and Comment Workflow

Features:

- [x] Continue-thread inline loader.
- [x] Scroll restore per permalink.
- [x] Comment navigator button surface with no feature shortcuts. (Existing `commentNavigator` module — no changes needed for this phase.)
- [x] Thread minimap/heatmap.
- [x] Search filter persistence.
- [x] Search dispatcher.
- [x] Top-comments preview.
- [x] Auto-refresh comments with backoff.

Progress:

- 2026-05-19: continueThreadInline + scrollRestore landed.
- 2026-05-19: threadMinimap + searchFilterPersist landed.
- 2026-05-19: searchDispatcher + topCommentsPreview landed (introduces `lib/utils/rateLimiter.js` token bucket).
- 2026-05-19: autoRefreshComments landed (uses the shared rate limiter; 30s -> 300s exponential backoff).

Acceptance criteria:

- [x] MutationObserver processes added nodes only.
- [x] API calls are cached and rate-limited.
- [x] Continue-thread loader can be destroyed and restores original link.
- [x] Thread minimap does not block comment scrolling.

### v0.9.0 - Theming and Layout Superset

Features:

- [x] Full-width content.
- [ ] Multi-column feed. (Deferred to v0.10 alongside the filter builder so column eviction shares a pass.)
- [x] Hide/collapse sidebar.
- [x] Post numbers.
- [x] Hide awards/flair/icons/avatar controls.
- [ ] OP/admin/mod/friend highlight refresh. (Existing `commentHighlights` covers OP; admin/mod/friend lanes scheduled with the v0.10 user-tagger work.)
- [x] Color-coded comment depth.
- [ ] Custom subreddit style override. (Binary kill switch already in `disableSubredditStyles`; per-sub allow/deny list scheduled with the v0.10 filter builder.)

Progress:

- 2026-05-19: `layoutTweaks` ships seven body-class-gated CSS toggles (full-width, hide-sidebar, post-numbers, hide-awards, hide-flair, hide-link-flair, hide-avatars). All `!important` so subreddit CSS cannot override them.
- 2026-05-19: `commentDepthColors` ships HSL stripe rotation per comment depth with saturation + max-depth knobs; rules scoped behind `body.rsm-depth-colors`.

Acceptance criteria:

- [x] All layout toggles are per-page and reversible.
- [x] No nested cards inside cards.
- [x] No fully rounded/pill UI surfaces.
- [x] Subreddit custom CSS cannot permanently hide settings access.

### v0.10.0 - Filters, Tags, and Author Intelligence

Features:

- [x] Restore/expand filteReddit cases as a modern filter builder. (Foundation shipped as `lib/utils/filterRules.js` + `lib/modules/filterRules.js`.)
- [x] User, subreddit, domain, keyword, flair, score, comment-count filters. (All seven fields wired.)
- [x] Rule weights: hide, dim, collapse, badge only. (All four actions wired.)
- [ ] Local user tags. (v0.10.x — depends on the now-shipped filter engine.)
- [ ] Bot/AutoModerator collapse. (v0.10.x — ships as a preset rule list.)
- [ ] Duplicate/crosspost map. (v0.10.x — depends on /duplicates/<id>.json fetch behind the v0.8 rate limiter.)
- [ ] Author context badge. (v0.10.x.)
- [ ] Local AI/bot prose signal. (v0.10.x — opt-in, browser-side only.)

Progress:

- 2026-05-19: filterRules foundation shipped. Pure schema + evaluator with regex fail-closed. Module hooks into watchForThings (added nodes only). 7-assertion contract test.

Acceptance criteria:

- [x] No full-thread rescans per mutation.
- [x] User/subreddit API enrichment uses cache and rate limiter. (`lib/utils/rateLimiter.js` from v0.8.0 is ready for the v0.10.x consumers.)
- [ ] AI/bot signal runs locally and can be fully disabled. (v0.10.x consumer; default-off contract recorded in plan.)
- [x] Import/export for filters and tags works. (filterRules schema is a single `rulesJson` text option, so the v0.6.0 settings snapshot import/export round-trips it verbatim.)

### v0.11.0 - Media and Downloads

Features:

- Separate post/comment media toggles.
- Full-height images.
- Overlay viewer.
- Native video controls.
- Download buttons for images/videos.
- Gallery ZIP/export.
- RedGifs v3 handling.
- Search result gallery carousel.
- Optional Cobalt and local companion hooks.

Acceptance criteria:

- Existing `showImages` host tests remain green.
- Download features degrade to "open source" when permissions are missing.
- External media APIs never run by default.
- Destroying media features removes all injected buttons/overlays.

### v0.12.0 - Archival, Recovery, and Export

Features:

- PullPush restore with provenance.
- Wayback/archive.today fallback chain.
- Snapshot-now button.
- Comment tree export to JSON, Markdown, and HTML.
- Saved content backup.
- Vote/read history log.
- Media archive manifest.

Acceptance criteria:

- Every external archive source is opt-in and rate-limited.
- Exports include version/schema metadata.
- No export contains hidden extension UI unless requested.
- Restore/diff views label source and timestamp.

### v0.13.0 - Optional Moderator Workbench

Features:

- Modbar.
- Queue filters and batch queue tools.
- User notes import/export.
- Removal reasons.
- Domain/user history.
- Ban macros.
- Comment nuke.

Acceptance criteria:

- Entire category defaults off.
- Write actions require explicit permissions and show immediate toast.
- Destructive actions provide undo where Reddit endpoints allow it.
- Moderator UI never appears to non-mod users unless demo mode is enabled.
- Toolbox-compatible imports are documented.

### v0.14.0 - Userscript Parity

Features:

- Single-file userscript bundle.
- GM storage adapter.
- GM style adapter.
- GM fetch/download adapter.
- Portable subset settings.
- Build artifact and install metadata.

Acceptance criteria:

- Userscript installs in Violentmonkey/Tampermonkey.
- Core theming, filters, navigation, and non-privileged media features work.
- Unsupported extension-only features are visible as disabled with a concise reason.
- Userscript has no build-time dependency on extension-only globals.

### v0.15.0 - Reliability, CI, and Release Pipeline

Features:

- GitHub Actions validation.
- Chrome/Firefox build artifacts.
- Optional CRX/ZIP packaging.
- Bundle budget.
- Secret scan.
- Visual smoke screenshots for settings and two captured surfaces.
- Error log panel polish.
- README deliverable.

Acceptance criteria:

- `yarn test`, `yarn lint`, and both builds pass in CI.
- Release artifact hashes are emitted.
- README explains extension and userscript install paths.
- No unreviewed network origin enters the privacy snapshot.

### v1.0.0 - Beats Every Competitor

Features:

- All default-on safe features stable.
- All optional/external/moderator/destructive features documented and gated.
- Complete feature matrix implemented or documented with a hard blocker.
- README, screenshots, changelog, and release artifacts complete.

Acceptance criteria:

- Every feature has an automated destroy/lifecycle test or targeted manual QA checklist.
- Selector contracts pass against the captured front page and thread.
- Extension build and userscript build both work.
- Product has no light theme, no feature keyboard shortcuts, no confirmation dialogs, and no telemetry.
- User can disable any feature and see DOM cleanup immediately.

---

## Settings Panel Spec

Information architecture:

- Left category rail: Core, Theme, Navigation, Filters, Media, Moderation, Privacy, Data, Accessibility, Integrations, Quality of Life.
- Right pane: dense setting rows with icon, title, current state, optional inline controls.
- Top bar: search, profile selector, import/export, error log, reset-current-category.
- Bottom toast stack: immediate feedback.

Visual rules:

- Dark/OLED only.
- Glass-style elevated surfaces with restrained radius.
- Branded accent line, scrollbar, and focus ring.
- Hover lifts and staggered entrances only when reduced motion is off.
- Toggles use clear switch controls, not ambiguous pill labels.
- No instructional marketing text inside the app.
- No modal confirmation dialogs.

Behavior:

- Toggle applies immediately.
- A toast reports `Enabled`, `Disabled`, `Imported`, `Exported`, `Reverted`, or error.
- Inactive overlay has `pointer-events: none`.
- Category reset applies immediately and shows an undo toast.
- External integrations show origin, permission, last failure, and rate-limit state.
- Permission requests are initiated only by direct user action.
- Every settings row maps to one schema key.

---

## Risks and Open Questions

DOM risks:

- Additional captures are needed for profile pages, messages, search results, submit page, modqueue, wiki, and Reddit-hosted media pages.
- Subreddit custom CSS can heavily alter `.side`, `.entry`, and `.buttons`.
- Media expandos have the highest churn because host handlers and Reddit markup both vary.
- New/sh Reddit support would need separate selector maps and TrustedTypes validation.

API and rate risks:

- Reddit API request limits can break author enrichment if uncached.
- PullPush, Wayback, archive.today, Cobalt, and privacy frontends can change or disappear.
- Moderator write endpoints may behave differently across old and newer Reddit.

Store review risks:

- NSFW/age bypass, ad/promoted removal, media download, and moderation automation may trigger store review concerns.
- Extension should keep controversial capabilities opt-in and documented.
- Userscript distribution can carry more capability but less user trust.

Legal/source risks:

- GPL-3.0 inheritance permits this repo's existing code but requires care when learning from scripts.
- Do not paste unlicensed or AGPL userscript code.
- MIT/BSD/Apache ideas can be reimplemented with attribution where needed.

Architecture risks:

- Legacy RES module shape may resist clean `destroy()` migration.
- Flow-era code and jQuery utilities make modern shared userscript/extension bundling harder.
- Heavy media muxing via wasm can bloat bundle size; prefer optional lazy loading or local companion.

Open questions:

- Should moderator features be a separate extension package if store review becomes difficult?
- Should external integrations be grouped behind a single "external services" parent switch?
- Should the userscript be generated from the same source or maintained as a curated portable subset?
- How much of `filteReddit` should be restored directly versus rewritten around the new schema?
- Which local companion protocol should be standardized for yt-dlp/ffmpeg and local LLM features?

---

## Definition of Done

`RES-Slim Max v1.0.0` beats every competitor when:

- It covers the union of RES, Reddit Enhancer, Moderator Toolbox, Old Reddit Redirect, oldlander layout ideas, major GreasyFork/OpenUserJS utilities, and notable userstyles.
- Every feature is governed by the settings schema and can be enabled/disabled immediately.
- Every feature has a complete `destroy()` path.
- The default experience is premium dark/OLED, dense, fast, accessible, and old-Reddit-native.
- No telemetry exists.
- No light theme exists.
- No feature keyboard shortcuts exist.
- No confirmation dialogs exist.
- External services are opt-in, visibly labeled, and rate-limited.
- MHTML selector contracts protect the front page and comment thread DOM surfaces.
- CI validates tests, lint, builds, bundle size, privacy origins, selector contracts, and settings schema.
- MV3 extension and userscript artifacts are both built and documented.
- `README.md` is updated as a build deliverable with install, feature, privacy, and screenshot sections.

---

## Source Index

Primary local sources:

- `README.md`
- `RESEARCH-FINDINGS.md`
- `CLAUDE.md`
- `package.json`
- `chrome/manifest.json`
- `firefox/manifest.json`
- `lib/modules/index.js`
- `lib/modules/hosts/index.js`
- `lib/environment/foreground/ajax.js`
- `lib/utils/watchers.js`
- `lib/options/options.scss`
- `tests/unit/*.mjs`
- MHTML captures listed in Phase 0

External sources:

- GreasyFork Reddit scripts: <https://greasyfork.org/en/scripts/by-site/reddit.com>
- OpenUserJS Reddit search: <https://openuserjs.org/?q=reddit>
- Reddit Enhancement Suite features: <https://redditenhancementsuite.com/features/>
- RES GitHub: <https://github.com/honestbleeps/Reddit-Enhancement-Suite>
- RES Chrome Web Store: <https://chromewebstore.google.com/detail/reddit-enhancement-suite/kbmfpngjjgdllneeigpgjifpgocmfgmb>
- RES Firefox Add-ons: <https://addons.mozilla.org/en-US/firefox/addon/reddit-enhancement-suite/>
- RES Edge Add-ons: <https://microsoftedge.microsoft.com/addons/detail/reddit-enhancement-suite/jlhgedjpndhblehblebhncfmkkpngiep?hl=en-en>
- Reddit Enhancer GitHub: <https://github.com/joelacus/RedditEnhancer>
- Reddit Enhancer Chrome Web Store: <https://chromewebstore.google.com/detail/reddit-enhancer/onglbklimdjicpdadjieknodkkmjldoa>
- Reddit Enhancer Firefox Add-ons: <https://addons.mozilla.org/en-US/firefox/addon/reddit-enhancer/>
- Moderator Toolbox GitHub: <https://github.com/toolbox-team/reddit-moderator-toolbox>
- Moderator Toolbox Firefox Add-ons: <https://addons.mozilla.org/en-US/firefox/addon/reddit-moderator-toolbox/>
- Old Reddit Redirect Chrome Web Store: <https://chromewebstore.google.com/detail/old-reddit-redirect/dneaehbmnbhcippjikoajpoabadpodje>
- Old Reddit Redirect Firefox Add-ons: <https://addons.mozilla.org/en-US/firefox/addon/old-reddit-redirect/>
- oldlander GitHub: <https://github.com/OctoNezd/oldlander>
- oldlander Firefox Add-ons: <https://addons.mozilla.org/en-US/firefox/addon/oldlander/>
- Reddit++ GreasyFork: <https://greasyfork.org/en/scripts/490046-reddit>
- Unedit and Undelete for Reddit: <https://greasyfork.org/en/scripts/407466-unedit-and-undelete-for-reddit>
- Reddit NSFW Unblur: <https://greasyfork.org/en/scripts/485608-reddit-nsfw-unblur>
- Reddit Download Buttons: <https://greasyfork.org/en/scripts/501718-reddit-download-buttons>
- redditmod2: <https://greasyfork.org/en/scripts/29724-redditmod2>
- Reddit New Comment Highlighting: <https://greasyfork.org/en/scripts/1522-reddit-new-comment-highlighting>
- OpenUserJS Reddit Comment Expander: <https://openuserjs.org/scripts/nascent/Reddit_Comment_Expander>
- Userstyles Reddit browse: <https://userstyles.org/styles/browse/reddit>
- Userstyles old reddit dark mode: <https://userstyles.org/styles/193553>
- r/Enhancement API limit thread: <https://www.reddit.com/r/Enhancement/comments/1k5eo97/need_advice_about_how_res_handle_the_api_requests/>
- r/Enhancement search persist userscript thread: <https://www.reddit.com/r/Enhancement/comments/1q67esu/userscript_reddit_search_options_persist_keeps/>
- r/Enhancement image-control complaint: <https://www.reddit.com/r/Enhancement/comments/1tdg0va/how_to_disable_res_post_image_changes/>
- r/Enhancement old/new toggle request: <https://www.reddit.com/r/Enhancement/comments/1qn726l/quick_toggle_for_new_and_old_reddit/>
- r/Enhancement color-coded comment collapse thread: <https://www.reddit.com/r/Enhancement/comments/1rnypci/colorcoded_comment_quick_collapse/>
