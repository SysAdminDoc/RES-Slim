/* @flow */

// Runs in the page world, not the extension's. Listed in `web_accessible_resources`
// and injected by `eventTrackingSabotage` as a `<script src>`; nothing else loads
// it, and it imports nothing from `lib/core` or `lib/environment`, because none of
// that exists on the other side of the world boundary.
//
// The only thing the module passes across is the log flag, which rides on a data
// attribute. The tracker lists are compiled in — see the note in
// `lib/utils/eventTrackingSabotage.js` for why they are not passed the same way.

import { installSabotage, TRACKER_HOSTS, TRACKER_PATHS } from '../utils/eventTrackingSabotage';

// `document.currentScript` is the injected element while a classic external
// script executes. The query is for the case where something has already moved
// on — an empty flag is the safe reading, so a miss just means quiet.
const self = document.currentScript || document.querySelector('script[data-res-slim-sabotage]');
const logBlocked = !!(self && self instanceof HTMLScriptElement && self.dataset.resSlimSabotageLog === '1');

installSabotage(window, TRACKER_HOSTS, TRACKER_PATHS, logBlocked);
