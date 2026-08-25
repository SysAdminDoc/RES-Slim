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

export type PendingUpdate = {|
	previousVersion: string,
	currentVersion: string,
|};

// `onInstalled` hands us `details.previousVersion` on reason `update`, which is
// the only place either version is known for certain. `semver` is a build-time
// devDependency and is not in any shipped bundle, so the comparison is written
// out here rather than pulled in for three integers.
function parseVersion(value: ?string): ?[number, number, number] {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''));
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Which updates are worth interrupting someone for.
//
// Patch releases are excluded deliberately. They are fixes, and a notice that
// fires on every one of them is a notice people learn to dismiss without
// reading — at which point the one release that does change something visible
// gets dismissed along with the rest. A minor-or-greater boundary is the line
// the release process already treats as "something changed".
//
// Downgrades are excluded because they are not releases. Swapping back to an
// older unpacked build fires `onInstalled` with reason `update` exactly like a
// real one, and announcing "updated to 0.44.0" to a developer who just went
// backwards is worse than saying nothing.
export function shouldAnnounceUpdate(previousVersion: ?string, currentVersion: ?string): boolean {
	const previous = parseVersion(previousVersion);
	const current = parseVersion(currentVersion);
	if (!previous || !current) return false;
	if (previous[0] === current[0] && previous[1] === current[1]) return false;

	for (const i of [0, 1, 2]) {
		if (current[i] > previous[i]) return true;
		if (current[i] < previous[i]) return false;
	}
	return false;
}

// Pure for the same reason `greetingText` is: it is read once, by someone who
// did not ask for it, and cannot be brought back.
export function updateText(previousVersion: string, currentVersion: string): string {
	return `Updated from ${previousVersion} to ${currentVersion}. Your settings carried over.`;
}

// The message. Pure so its wording is testable, and because getting it wrong is
// the whole risk of a first-run greeting: it appears exactly once, to someone who
// has no context, and cannot be re-read.
export function greetingText(moduleCount: number): string {
	// No leading brand: the notification header already says RES-Slim, and the two
	// together rendered as "RES-Slim RES-Slim is running".
	return `Running. ${moduleCount} features are on by default. ` +
		'Everything is configurable, and nothing is sent anywhere.';
}
