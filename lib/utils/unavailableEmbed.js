/* @flow */
// What a social embed hands back when there is nothing to show.
//
// Returning `undefined` from a `handleLink` is not "no media": `completeExpando`
// reads `mediaOptions.title` straight off the result, so it is a TypeError, and
// the catch above it feeds that to `PenaltyBox.noteFailure`. A run of private,
// deleted or sign-in-walled posts therefore suspends a host that is working
// perfectly, and the reader loses every embed from it for the rest of the
// suspension.
//
// `bluesky` got this right on its own and the other two did not, which is the
// usual reason to have one of these rather than three.

import { i18n } from '../environment';

// Whether a failed request means "this post is gone" or "this host is broken".
//
// The difference decides who is told. A panel saying the post is unavailable is
// right for the first and wrong for the second -- and a panel counts as success,
// so answering one for a dead instance hides it from the penalty box, and the
// reader pays a failed round trip per link on every page for as long as it stays
// down. That is the cost the penalty box exists to stop.
//
// A status is what separates them: 4xx is an answer about the post, and anything
// else -- a 5xx, a refused connection, a DNS failure, a timeout -- is the host.
export function isPostLevelFailure(error: mixed): boolean {
	if (!error || typeof error !== 'object') return false;
	const status = (error: any).status;
	if (typeof status !== 'number' || !Number.isFinite(status)) return false;
	return status >= 400 && status < 500;
}

type UnavailableOptions = {|
	// The class the panel carries, so each site keeps its own styling hook.
	className: string,
	// The locale key for the sentence the reader sees.
	messageKey: string,
	// Which expando button the link gets. It should be the one the working media
	// would have had: the same link showing a video icon when it plays and a text
	// icon when it does not is a difference the reader has to explain to
	// themselves.
	expandoClass?: string,
|};

// The return type is left to inference on purpose. Naming it makes Flow 0.84
// compare a named exact object against `Host`'s inexact media type and refuse
// the `expandoClass` it is perfectly happy with inline, and `Object` is a weak
// type the linter is right to refuse. The three callers all feed it straight to
// `Host`, which checks the shape at each of them.
export function unavailableEmbed({ className, messageKey, expandoClass = 'selftext' }: UnavailableOptions) {
	const dummy = document.createElement('blockquote');
	return {
		type: 'GENERIC_EXPANDO',
		muted: true,
		expandoClass,
		generate: () => dummy,
		onAttach: () => {
			dummy.className = className;
			dummy.textContent = i18n(messageKey);
		},
	};
}
