/* @flow */

import {
	loggedInUser,
	loggedInUserHash,
} from '../../utils/user';
import { contentStart } from '../../utils/pagePhases';
import { isTrustedConsoleOrigin, sanitizeContext } from '../../utils/trustedOrigin';
import { getOptionsURL } from './id';

export const data: {|
	userHash: ?string,
	username: ?string,
	origin: string,
	pathname: string,
|} = {
	userHash: null,
	username: null,
	origin: 'https://www.reddit.com',
	pathname: location.pathname,
};

if (location.protocol.startsWith('http')) {
	data.origin = location.origin;

	contentStart.then(() => {
		data.username = loggedInUser();
		// Fire-and-forget, so it needs its own rejection handler: without one an
		// unexpected throw here becomes an unhandled rejection in the page.
		// userHash simply stays null, which is the same state as logged out.
		loggedInUserHash()
			.then(hash => { data.userHash = hash; })
			.catch(e => {
				console.error('RES-Slim: could not resolve the user hash', e);
			});
	});
}

// How long to wait for the embedding page to hand us its context before giving
// up and loading with the built-in defaults. Hanging forever would be a worse
// failure than a console whose links point at www.reddit.com.
const CONTEXT_TIMEOUT_MS = 10000;

export function retrieveFromParent(): Promise<void> {
	if (window === window.parent) return Promise.resolve();

	return new Promise(resolve => {
		let optionsOrigin = null;
		try {
			optionsOrigin = getOptionsURL().origin;
		} catch (e) {
			// getURL is unavailable outside an extension context; the reddit-origin
			// check below still applies.
		}

		const done = () => {
			window.removeEventListener('message', onMessage);
			clearTimeout(timer);
			resolve();
		};

		// Deliberately not `waitForEvent`: that resolves on the *first* message
		// from anyone, which is the whole bug. An untrusted or unrecognised
		// message is ignored and we keep listening.
		function onMessage(event: MessageEvent) {
			if (!isTrustedConsoleOrigin(event.origin, optionsOrigin)) return;
			const context = sanitizeContext(event.data);
			if (!context) return;
			Object.assign(data, context);
			done();
		}

		const timer = setTimeout(() => {
			console.warn('RES-Slim: no trusted context arrived from the embedding page; loading with defaults');
			done();
		}, CONTEXT_TIMEOUT_MS);

		window.addEventListener('message', onMessage);
	});
}
