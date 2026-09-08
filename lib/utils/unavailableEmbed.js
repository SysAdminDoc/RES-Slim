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

type UnavailableOptions = {|
	// The class the panel carries, so each site keeps its own styling hook.
	className: string,
	// The locale key for the sentence the reader sees.
	messageKey: string,
|};

// The return type is left to inference on purpose. Naming it makes Flow 0.84
// compare a named exact object against `Host`'s inexact media type and refuse
// the `expandoClass` it is perfectly happy with inline, and `Object` is a weak
// type the linter is right to refuse. The three callers all feed it straight to
// `Host`, which checks the shape at each of them.
export function unavailableEmbed({ className, messageKey }: UnavailableOptions) {
	const dummy = document.createElement('blockquote');
	return {
		type: 'GENERIC_EXPANDO',
		muted: true,
		expandoClass: 'selftext',
		generate: () => dummy,
		onAttach: () => {
			dummy.className = className;
			dummy.textContent = i18n(messageKey);
		},
	};
}
