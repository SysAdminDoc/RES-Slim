/* @flow */

// Runs in the page world, not the extension's. Listed in `web_accessible_resources`
// and injected by `nsfwThumbnails` as a `<script src>`; nothing else loads it, and
// it imports nothing from `lib/core` or `lib/environment`, because none of that
// exists on the other side of the world boundary.
//
// Its own entry rather than a branch inside `trackingSabotage.entry.js`: that one
// is on by default and this is off by default, and a reader who has not enabled
// the reveal should not be running its code at all.
//
// The two toggles ride on data attributes, the same way the sabotage passes its
// log flag. Nothing else crosses.

import { installReveal } from '../utils/shredditReveal';

// `document.currentScript` is the injected element while a classic external
// script executes. The query is for the case where something has already moved
// on — an absent flag reads as off, so a miss reveals nothing.
const self = document.currentScript || document.querySelector('script[data-res-slim-reveal]');
const flags = self instanceof HTMLScriptElement ? self.dataset : {};

installReveal(window, {
	nsfw: flags.resSlimRevealNsfw === '1',
	spoiler: flags.resSlimRevealSpoiler === '1',
});
