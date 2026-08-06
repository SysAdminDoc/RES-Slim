/* @flow */

import {
	loggedInUser,
	loggedInUserHash,
} from '../../utils/user';
import { contentStart } from '../../utils/pagePhases';
import { waitForEvent } from '../../utils/dom';

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
				console.error('RES-Slim: could not resolve the user hash', e); // eslint-disable-line no-console
			});
	});
}

export function retrieveFromParent() {
	if (window === window.parent) return Promise.resolve();

	return waitForEvent(window, 'message').then(({ data: { context } }: any) => {
		Object.assign(data, context);
	});
}
