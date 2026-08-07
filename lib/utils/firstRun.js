/* @flow */

// Whether to greet a fresh install, kept out of the DOM so it can be executed by
// a test.
//
// The signal is `chrome.runtime.onInstalled` with `reason === 'install'`, which
// the background records as a flag. It is the only honest one available: the
// first attempt at this inferred a fresh install from an empty local store, and
// could never fire, because `migrate()` writes keys before the first page has
// finished loading. That was invisible to a unit test on the predicate and
// obvious the moment the extension was driven in a browser.
//
// `onInstalled` also fires with reason `update` and `chrome_update`, which is why
// the background filters on `install` rather than on the event.

export type FirstRunState = {|
	// Set by the background on `onInstalled` with reason 'install'.
	pendingGreeting: mixed,
|};

export function shouldGreet({ pendingGreeting }: FirstRunState): boolean {
	// Compared strictly: `chrome.storage.local` returns `undefined` for a key that
	// was never set, and a truthiness test would also accept a leftover string from
	// some future change to what the background writes.
	return pendingGreeting === true;
}

// The message. Pure so its wording is testable, and because getting it wrong is
// the whole risk of a first-run greeting: it appears exactly once, to someone who
// has no context, and cannot be re-read.
export function greetingText(moduleCount: number): string {
	// No leading brand: the notification header already says RES-Slim, and the two
	// together rendered as "RES-Slim RES-Slim is running".
	return `Running — ${moduleCount} features are on by default. ` +
		'Everything is configurable, and nothing is sent anywhere.';
}
