/* @flow */

import { transform, once } from '../../utils/functional';
import { extendDeep } from '../../utils/object';
import { batch, keyedMutex } from '../../utils/async';
import { apiToPromise } from '../utils/api';
import { sendMessage } from './messaging';
import { guardFeatureDataMutation } from './privateBrowsing';
import type { FeatureDataStoreId } from './privateBrowsing';

const __set = apiToPromise((items, callback) => chrome.storage.local.set(items, callback));
const _set = (key, value) => __set({ [key]: value });
const __get = apiToPromise((keys, callback) => chrome.storage.local.get(keys, callback));
const _get = async (key, defaultValue = null) => (await __get({ [key]: defaultValue }))[key];
const _delete = apiToPromise((keys, callback) => chrome.storage.local.remove(keys, callback));
const _clear = apiToPromise(callback => chrome.storage.local.clear(callback));

const withLockOn = keyedMutex(<T>(key: string, fn: () => T): T => fn());
const neverAllowPrivate = () => false;

type FeatureStorageOptions = {|
	allowPrivate?: () => boolean,
|};

type FeaturePrefixStorageOptions = {|
	allowPrivate?: () => boolean,
	destructiveKeyMapper?: (key: string) => string,
	batching?: boolean,
|};

export function get(key: string): Promise<any | null> {
	return withLockOn(key, () => _get(key, null));
}

export function getAll(): Promise<{ [string]: mixed }> {
	return __get(null);
}

export function getMultiple<T: string>(keys: T[]): Promise<{ [T]: any | null }> {
	const defaults = {};
	for (const k of keys) {
		defaults[k] = null;
	}
	return __get(defaults);
}

export function set(key: string, value: mixed): Promise<void> {
	return withLockOn(key, () => _set(key, value));
}

export function setMultiple(valueMap: { +[string]: mixed }): Promise<void> {
	return __set(valueMap);
}

function compareAndSet(key: string, defaultValue: mixed, oldValue: mixed, newValue: mixed): Promise<boolean> {
	// Redirect to the background instance as it allows for a common mutex,
	// preventing race conditions when several tabs invokes this function around the same time
	return sendMessage('storage-cas', [key, defaultValue, oldValue, newValue]);
}

/*
 * Deeply patches an object in storage, like extendDeep().
 */
function patch(key: string, value: { [string]: mixed }): Promise<void> {
	return withLockOn(key, async () => {
		const extended = extendDeep(await _get(key) || {}, value);
		return _set(key, extended);
	});
}

/*
 * Shallowly patches an object in storage, like Object.assign().
 */
function patchShallow(key: string, value: { [string]: mixed }): Promise<void> {
	return withLockOn(key, async () => {
		const extended = Object.assign(await _get(key) || {}, value);
		return _set(key, extended);
	});
}

/*
 * Deletes a property on a value in storage.
 * i.e. `deletePath('userTaggerStorageKey', 'username', 'tag')`
 * will `delete userTaggerStoredValue.username.tag`
 */
function deletePaths(key: string, paths: string[][]): Promise<void> {
	return withLockOn(key, async () => {
		const stored = await _get(key);
		if (!stored) return;
		for (const path of paths) {
			path.reduce((obj, key, i, { length }) => {
				if (!obj) return;
				if (i < length - 1) return obj[key];
				delete obj[key];
			}, stored);
		}
		return _set(key, stored);
	});
}

function delete_(key: string): Promise<void> {
	return withLockOn(key, () => _delete(key));
}
export { delete_ as delete };

export function deleteMultiple(keys: string[]): Promise<void> {
	return _delete(keys);
}

export function has(key: string): Promise<boolean> {
	return withLockOn(key, async () => {
		const sentinel = Math.random();
		return (await _get(key, sentinel)) !== sentinel;
	});
}

export async function keys(): Promise<string[]> {
	return Object.keys(await __get(null));
}

export function clear(): Promise<void> {
	return _clear();
}

class Wrapper<T> {
	_key: () => string;
	_default: T;
	_featureStoreId: ?FeatureDataStoreId;
	_allowPrivate: () => boolean;

	constructor(key: $PropertyType<this, '_key'>, def: T, featureStoreId: ?FeatureDataStoreId = null, allowPrivate: () => boolean = neverAllowPrivate) {
		this._key = key;
		this._default = def;
		this._featureStoreId = featureStoreId;
		this._allowPrivate = allowPrivate;
	}

	_mutate<R>(mutation: () => Promise<R>, blockedValue: R): Promise<R> {
		if (!this._featureStoreId) return mutation();
		return guardFeatureDataMutation(this._featureStoreId, mutation, blockedValue, this._allowPrivate());
	}

	get(): Promise<T> {
		return get(this._key()).then(val => (val === null ? this._default : val));
	}

	set(value: T): Promise<void> {
		return this._mutate(() => set(this._key(), value), undefined);
	}

	patch(value: $Shape<T>): Promise<void> {
		return this._mutate(() => patch(this._key(), (value: any)), undefined);
	}

	compareAndSet(oldValue: T, newValue: T): Promise<boolean> {
		return this._mutate(() => compareAndSet(this._key(), this._default, oldValue, newValue), false);
	}

	deletePath(...path: string[]): Promise<void> {
		return this._mutate(() => deletePaths(this._key(), [path]), undefined);
	}

	delete(): Promise<void> {
		return this._mutate(() => delete_(this._key()), undefined);
	}

	has(): Promise<boolean> {
		return has(this._key());
	}
}

export function wrap<T>(key: string | () => string /* pure */, defaultValue: T): Wrapper<T> {
	const keyGenerator = typeof key === 'string' ? () => key : once(key);
	// $FlowIssue
	return new Wrapper(keyGenerator, defaultValue);
}

export function wrapFeature<T>(storeId: FeatureDataStoreId, key: string | () => string /* pure */, defaultValue: T, options?: FeatureStorageOptions): Wrapper<T> {
	const keyGenerator = typeof key === 'string' ? () => key : once(key);
	// $FlowIssue
	return new Wrapper(keyGenerator, defaultValue, storeId, (options && options.allowPrivate) || neverAllowPrivate);
}

class PrefixWrapper<T> {
	_prefix: string;
	_keyMapper: (key: string) => string;
	_default: () => T;
	_get: *;
	_featureStoreId: ?FeatureDataStoreId;
	_allowPrivate: () => boolean;

	constructor(prefix: string, def: () => T, keyMapper: (key: string) => string, batching: boolean, featureStoreId: ?FeatureDataStoreId = null, allowPrivate: () => boolean = neverAllowPrivate) {
		this._prefix = prefix;
		this._default = def;
		this._keyMapper = keyMapper;
		this._featureStoreId = featureStoreId;
		this._allowPrivate = allowPrivate;

		if (batching) {
			this._get = batch(async keys => {
				const v = await this.getMultipleNullable(keys);
				return keys.map(key => v[this._keyMapper(key)]);
			}, { size: Infinity, delay: 0 });
		} else {
			this._get = key => get(this._keyGen(key));
		}
	}

	_mutate<R>(mutation: () => Promise<R>, blockedValue: R): Promise<R> {
		if (!this._featureStoreId) return mutation();
		return guardFeatureDataMutation(this._featureStoreId, mutation, blockedValue, this._allowPrivate());
	}

	_keyGen(key: string): string {
		return this._prefix + this._keyMapper(key);
	}

	get(key: string): Promise<T> {
		return this._get(key).then(val => (val === null ? this._default() : val));
	}

	getNullable(key: string): Promise<T | null> {
		return this._get(key);
	}

	async getAll(): Promise<{ [string]: T }> {
		const everything = await getAll();
		return transform(everything, (acc, v, k) => {
			if (k.startsWith(this._prefix)) {
				acc[k.slice(this._prefix.length)] = v;
			}
		}, {});
	}

	async getMultiple(keys: string[]): Promise<{ [string]: T }> {
		const rawValues = await getMultiple(keys.map(k => this._keyGen(k)));
		return transform(rawValues, (acc, v, k) => {
			acc[k.slice(this._prefix.length)] = (v === null ? this._default() : v);
		}, {});
	}

	async getMultipleNullable(keys: string[]): Promise<{ [string]: T | null }> {
		const rawValues = await getMultiple(keys.map(k => this._keyGen(k)));
		return transform(rawValues, (acc, v, k) => {
			acc[k.slice(this._prefix.length)] = v;
		}, {});
	}

	set(key: string, value: T): Promise<void> {
		return this._mutate(() => set(this._keyGen(key), value), undefined);
	}

	patch(key: string, value: $Shape<T>): Promise<void> {
		return this._mutate(() => patch(this._keyGen(key), (value: any)), undefined);
	}

	deletePath(key: string, ...path: string[]): Promise<void> {
		return this._mutate(() => deletePaths(this._keyGen(key), [path]), undefined);
	}

	delete(key: string): Promise<void> {
		return this._mutate(() => delete_(this._keyGen(key)), undefined);
	}

	deleteMultiple(keys: string[]): Promise<void> {
		return this._mutate(() => deleteMultiple(keys.map(k => this._keyGen(k))), undefined);
	}

	has(key: string): Promise<boolean> {
		return has(this._keyGen(key));
	}
}

export function wrapPrefix<T>(prefix: string, defaultValue: () => T, destructiveKeyMapper: (key: string) => string = x => x, batching: boolean = false): PrefixWrapper<T> {
	return new PrefixWrapper(prefix, defaultValue, destructiveKeyMapper, batching);
}

// FIXME Flow seems to conflate the uses in `newCommentCount.js` and `readComments.js`
export function wrapPrefix2<T>(prefix: string, defaultValue: () => T, destructiveKeyMapper: (key: string) => string = x => x, batching: boolean = false): PrefixWrapper<T> {
	return new PrefixWrapper(prefix, defaultValue, destructiveKeyMapper, batching);
}

export function wrapFeaturePrefix<T>(storeId: FeatureDataStoreId, prefix: string, defaultValue: () => T, options?: FeaturePrefixStorageOptions): PrefixWrapper<T> {
	return new PrefixWrapper(
		prefix,
		defaultValue,
		(options && options.destructiveKeyMapper) || (x => x),
		Boolean(options && options.batching),
		storeId,
		(options && options.allowPrivate) || neverAllowPrivate,
	);
}

// FIXME Flow seems to conflate the uses in `newCommentCount.js` and `readComments.js`
export function wrapFeaturePrefix2<T>(storeId: FeatureDataStoreId, prefix: string, defaultValue: () => T, options?: FeaturePrefixStorageOptions): PrefixWrapper<T> {
	return wrapFeaturePrefix(storeId, prefix, defaultValue, options);
}

class BlobWrapper<T> {
	_rootKey: string;
	_default: () => T;
	_featureStoreId: ?FeatureDataStoreId;
	_allowPrivate: () => boolean;

	constructor(rootKey: string, def: () => T, featureStoreId: ?FeatureDataStoreId = null, allowPrivate: () => boolean = neverAllowPrivate) {
		this._rootKey = rootKey;
		this._default = def;
		this._featureStoreId = featureStoreId;
		this._allowPrivate = allowPrivate;
	}

	_mutate<R>(mutation: () => Promise<R>, blockedValue: R): Promise<R> {
		if (!this._featureStoreId) return mutation();
		return guardFeatureDataMutation(this._featureStoreId, mutation, blockedValue, this._allowPrivate());
	}

	// `Object.hasOwn` rather than `val[key] === undefined` in all five reads
	// below. Every key here comes from the page - a reddit username, a subreddit,
	// a thing id - and reddit allows names like `constructor`, `toString` and
	// `hasOwnProperty`. A plain member read walks the prototype chain, so those
	// returned an Object.prototype function instead of the default, and `has`
	// answered true for a key nothing had ever stored.
	get(key: string): Promise<T> {
		return get(this._rootKey).then(val => (
			(val === null || !Object.hasOwn(val, key)) ? this._default() : val[key]
		));
	}

	getNullable(key: string): Promise<T | null> {
		return get(this._rootKey).then(val => (
			(val === null || !Object.hasOwn(val, key)) ? null : val[key]
		));
	}

	getAll(): Promise<{ [string]: T }> {
		return get(this._rootKey).then(val => (val === null ? {} : val));
	}

	async getMultiple(keys: string[]): Promise<{ [string]: T }> {
		const rawValues = (await get(this._rootKey)) || {};
		return transform(keys, (acc, key) => {
			acc[key] = Object.hasOwn(rawValues, key) ? rawValues[key] : this._default();
		}, {});
	}

	async getMultipleNullable(keys: string[]): Promise<{ [string]: T | null }> {
		const rawValues = (await get(this._rootKey)) || {};
		return transform(keys, (acc, key) => {
			acc[key] = Object.hasOwn(rawValues, key) ? rawValues[key] : null;
		}, {});
	}

	set(key: string, value: T): Promise<void> {
		return this._mutate(() => patchShallow(this._rootKey, { [key]: value }), undefined);
	}

	patch(key: string, value: $Shape<T>): Promise<void> {
		return this._mutate(() => patch(this._rootKey, { [key]: value }), undefined);
	}

	deletePath(key: string, ...path: string[]): Promise<void> {
		return this._mutate(() => deletePaths(this._rootKey, [[key, ...path]]), undefined);
	}

	delete(key: string): Promise<void> {
		return this._mutate(() => deletePaths(this._rootKey, [[key]]), undefined);
	}

	deleteMultiple(keys: string[]): Promise<void> {
		return this._mutate(() => deletePaths(this._rootKey, keys.map(k => [k])), undefined);
	}

	has(key: string): Promise<boolean> {
		return get(this._rootKey).then(val => (val !== null && Object.hasOwn(val, key)));
	}

	clear(): Promise<void> {
		return this._mutate(() => delete_(this._rootKey), undefined);
	}
}

export function wrapBlob<T>(rootKey: string, defaultValue: () => T): BlobWrapper<T> {
	return new BlobWrapper(rootKey, defaultValue);
}

export function wrapFeatureBlob<T>(storeId: FeatureDataStoreId, rootKey: string, defaultValue: () => T, options?: FeatureStorageOptions): BlobWrapper<T> {
	return new BlobWrapper(rootKey, defaultValue, storeId, (options && options.allowPrivate) || neverAllowPrivate);
}
