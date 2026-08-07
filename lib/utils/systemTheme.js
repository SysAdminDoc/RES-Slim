/* @flow */

// The system-theme decision, kept out of the module so it can be executed by a
// test rather than pattern-matched: the DOM half needs a browser, this half is
// where the behaviour actually lives.

export type ThemeDirection = 'both' | 'darkOnly';

export function decideNightMode(prefersDark: boolean, direction: string, current: boolean): boolean {
	// darkOnly is for people whose OS flips to light during the day but who never
	// want a light reddit — so it may only ever turn night mode on.
	if (direction === 'darkOnly') return prefersDark ? true : current;
	return prefersDark;
}
