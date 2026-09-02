/* @flow */

/*
 * Roughly equivalent to `$.extend(true, target, source)`
 * Unfortunately lodash does not seem to offer any function that does this:
 * _.assign/_.extend/Object.assign are not recursive
 * _.merge and _.defaultsDeep ignore undefined values
 */
// Keys that write into the prototype rather than into the object. Every caller
// today passes a code-built literal, so this is not reachable now - but the
// function's whole shape invites being handed a parsed blob one day, and then a
// single `{"__proto__": {...}}` in an import file would land on every object in
// the page.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function extendDeep(target: { [string]: mixed }, source: { [string]: mixed }): { [string]: mixed } {
	for (const key of Object.keys(source)) {
		if (UNSAFE_KEYS.has(key)) continue;
		if (
			target[key] && source[key] &&
			typeof target[key] === 'object' && typeof source[key] === 'object' &&
			!Array.isArray(source[key]) && !Array.isArray(target[key])
		) {
			extendDeep(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
	return target;
}
