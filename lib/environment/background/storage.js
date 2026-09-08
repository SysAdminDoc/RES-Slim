/* @flow */

import { keyedMutex } from '../../utils/async';
import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

const __set = apiToPromise((items, callback) => chrome.storage.local.set(items, callback));
const _set = (key, value) => __set({ [key]: value });
const __get = apiToPromise((keys, callback) => chrome.storage.local.get(keys, callback));
const _get = async (key, defaultValue = null) => (await __get({ [key]: defaultValue }))[key];

// Key order does not survive a round trip through storage or the message
// bridge, so two maps holding the same tags can serialise differently. Sorting
// the keys is what makes "unchanged" mean unchanged rather than "written in the
// same order".
function stableJson(value: mixed): string {
	// No depth bound. A cyclic or absurdly deep value runs the stack out, and the
	// caller catches that and answers "it changed" -- which is the same answer a
	// bound would have given, through one mechanism instead of two. A bound whose
	// branch nothing can reach is a branch nothing can test.
	if (typeof value === 'number') {
		// NaN and the infinities have no JSON spelling of their own -- all three
		// stringify as `null`, which would make them equal to each other and to a
		// stored null.
		if (!Number.isFinite(value)) return `\u0000number:${String(value)}`;
		// -0 and 0 are the same stored number and JSON agrees.
		return JSON.stringify(value);
	}
	if (value === null || typeof value !== 'object') return JSON.stringify(value) || '\u0000undefined';
	// The type is part of the answer: `[1,2]` and `{0:1,1:2}` are different values
	// that a key-sorted object spelling would otherwise render alike.
	if (Array.isArray(value)) return `[${value.map(entry => stableJson(entry)).join(',')}]`;
	const object = (value: any);
	// `toJSON` is what storage would have applied on the way in, so applying it
	// here is what compares like with like -- a Date stored as a string must not
	// compare equal to every other Date.
	if (typeof object.toJSON === 'function') {
		try { return stableJson(object.toJSON()); } catch { return '\u0000unserialisable'; }
	}
	return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

// Structural, not by identity.
//
// Everything here has been through JSON on its way from the caller, so an object
// `oldValue` is never the same object as the one storage hands back, and a `!==`
// test could only ever answer "it changed". That is why this primitive had no
// callers for as long as it did: it worked for strings and numbers and silently
// refused every object, which is the shape anything worth comparing and setting
// actually has.
function sameStoredValue(left: mixed, right: mixed): boolean {
	// No special cases for null or for primitives: `stableJson` already gives
	// each of them a distinct spelling, and a guard whose branch nothing can
	// reach is a branch nothing can test.
	return left === right || stableJson(left) === stableJson(right);
}

addListener('storage-cas', keyedMutex(async ([key, defaultValue, oldValue, newValue]) => {
	const storedValue = await _get(key, defaultValue);
	// A comparison that cannot be made is not a comparison that succeeded.
	// A comparison that cannot be made is not a comparison that succeeded. This
	// is also the whole of the guard against a cyclic or unserialisable value:
	// the walk runs the stack out or throws, and "it changed" is a reply the
	// caller knows what to do with where an exception is not.
	let same;
	try { same = sameStoredValue(storedValue, oldValue); } catch { same = false; }
	if (!same) return false;
	await _set(key, newValue);
	return true;
}, ([key]) => key));
