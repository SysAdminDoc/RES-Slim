# RES-Slim

![Version](https://img.shields.io/badge/version-0.15.1-blue) ![License](https://img.shields.io/badge/license-GPL--3.0-green) ![Platform](https://img.shields.io/badge/platform-JavaScript-lightgrey)

A stripped-down private fork of [Reddit Enhancement Suite](https://github.com/honestbleeps/Reddit-Enhancement-Suite) (upstream v5.24.8), targeting **old.reddit.com** only.

Only the features actually used are kept. Everything else — including all promotional, sponsorship, announcement, and cloud-backup code — has been removed.

## What's kept

**Comment tweaks**: hideChildComments, commentNavigator, commentPreview, commentTools, commentQuickCollapse, commentSortBy, commentStyle, commentDepth, commentHidePersistor, saveComments, hover, showParent, readComments, newCommentCount, spoilerTags, noParticipation, sourceSnudown.

**Media tweaks**: `showImages` inline expando engine plus all 73 host handlers (imgur, youtube, reddit-native, Mastodon, Threads, etc.).

**Appearance**: `pageTheme` — an opt-in dark/OLED skin for old.reddit with selectable palettes (OLED Black, Graphite, Midnight, Catppuccin Mocha, Tokyo Night, Rosé Pine), accent colour, declutter, rounded corners, and a collapse-to-hover sidebar.

**Infrastructure only**: menu, notifications, settingsNavigation, selectedEntry, version, requestPermissions.

**Settings console**: command-center layout with module library, focused workspace, staged-change controls, theme/density/motion controls, and portable data actions.

## Build

```bash
yarn install
yarn test       # focused fixture checks
yarn test:show-images
yarn test:privacy
yarn once       # dev build -> dist/
yarn build      # production build + zip -> dist/zip/
```

Load unpacked from `dist/chrome/` in Chrome, or `dist/firefox/` in Firefox.

## Project planning

- [Roadmap](ROADMAP.md)
- [Completed work](COMPLETED.md)
- [Research report](RESEARCH_REPORT.md)
- [Archived roadmap](docs/archive/roadmap/ROADMAP-2026-05-22.md)

## License

GPL-3.0 — inherited from upstream RES. See `LICENSE`.
