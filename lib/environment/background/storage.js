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
	if (value === null || typeof value !== 'object') return JSON.stringify(value) || 'undefined';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	const object = (value: any);
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
	if (!sameStoredValue(storedValue, oldValue)) return false;
	await _set(key, newValue);
	return true;
}, ([key]) => key));
