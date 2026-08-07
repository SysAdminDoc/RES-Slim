/* @flow */

export function once<T>(fn: () => T): () => T {
	let called = false;
	let result: any;
	return function onceWrapper() {
		if (called) return result;
		called = true;
		result = fn.apply(this, arguments);
		return result;
	};
}

export function memoize<A, R>(fn: (a: A) => R, resolver?: (a: A) => mixed): (a: A) => R {
	const cache = new Map();
	function memoized(arg: A): R {
		const key = resolver ? resolver(arg) : arg;
		if (cache.has(key)) return (cache.get(key): any);
		const result = fn.call(this, arg);
		cache.set(key, result);
		return result;
	}
	memoized.cache = cache;
	return memoized;
}

export function debounce<F:(...args: any[]) => any>(fn: F, wait: number): F {
	let timer;
	return (function debounced(...args) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), wait);
	}: any);
}

export function throttle<F:(...args: any[]) => any>(fn: F, wait: number): F {
	let last = 0;
	let timer;
	return (function throttled(...args) {
		const now = Date.now();
		const remaining = wait - (now - last);
		if (remaining <= 0) {
			clearTimeout(timer);
			last = now;
			fn.apply(this, args);
		} else if (!timer) {
			timer = setTimeout(() => {
				last = Date.now();
				timer = undefined;
				fn.apply(this, args);
			}, remaining);
		}
	}: any);
}

export function sortBy<T>(arr: T[], iteratee: (item: T) => mixed): T[] {
	return [...arr].sort((a, b) => {
		const va = iteratee(a);
		const vb = iteratee(b);
		if (va < vb) return -1;
		if (va > vb) return 1;
		return 0;
	});
}

export function groupBy<T>(arr: T[], iteratee: (item: T) => string): { [string]: T[] } {
	const result: { [string]: T[] } = {};
	for (const item of arr) {
		const key = iteratee(item);
		if (!result[key]) result[key] = [];
		result[key].push(item);
	}
	return result;
}

export function uniqBy<T>(arr: T[], iteratee: (item: T) => mixed): T[] {
	const seen = new Set();
	return arr.filter(item => {
		const key = iteratee(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function pull<T>(arr: T[], ...values: T[]): T[] {
	const set = new Set(values);
	let i = 0;
	for (let j = 0; j < arr.length; j++) {
		if (!set.has(arr[j])) arr[i++] = arr[j];
	}
	arr.length = i;
	return arr;
}

export function difference<T>(arr: T[], ...others: T[][]): T[] {
	const excluded = new Set(others.flat());
	return arr.filter(v => !excluded.has(v));
}

export function without<T>(arr: T[], ...values: T[]): T[] {
	const set = new Set(values);
	return arr.filter(v => !set.has(v));
}

export function compact<T>(arr: (?T | false | 0 | '' | void)[]): T[] {
	return (arr.filter(Boolean): any);
}

export function isEmpty(value: mixed): boolean {
	if (value == null) return true;
	if (Array.isArray(value) || typeof value === 'string') return value.length === 0;
	if (typeof value === 'object') return Object.keys(value).length === 0;
	return true;
}

export function isEqual(a: mixed, b: mixed): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => isEqual(v, b[i]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const keysA = Object.keys((a: any));
		const keysB = Object.keys((b: any));
		if (keysA.length !== keysB.length) return false;
		return keysA.every(k => isEqual((a: any)[k], (b: any)[k]));
	}
	return false;
}

export function clamp(value: number, lower: number, upper: number): number {
	return Math.min(Math.max(value, lower), upper);
}

export function maxBy<T>(arr: T[], iteratee: (item: T) => number): ?T {
	let best: ?T;
	let bestVal = -Infinity;
	for (const item of arr) {
		const val = iteratee(item);
		if (val > bestVal) { bestVal = val; best = item; }
	}
	return best;
}

export function keyBy<T>(arr: T[], iteratee: (item: T) => string): { [string]: T } {
	const result: { [string]: T } = {};
	for (const item of arr) result[iteratee(item)] = item;
	return result;
}

export function pick(obj: { [string]: mixed }, keys: string[]): { [string]: mixed } {
	const result: { [string]: mixed } = {};
	for (const k of keys) {
		if (k in obj) result[k] = obj[k];
	}
	return result;
}

export function omitBy<V>(obj: { [string]: V }, predicate: (v: V, k: string) => boolean): { [string]: V } {
	const result: { [string]: V } = {};
	for (const [k, v] of Object.entries(obj)) {
		if (!predicate((v: any), k)) result[k] = (v: any);
	}
	return result;
}

export function pickBy<V>(obj: { [string]: V }, predicate: (v: V, k: string) => boolean): { [string]: V } {
	const result: { [string]: V } = {};
	for (const [k, v] of Object.entries(obj)) {
		if (predicate((v: any), k)) result[k] = (v: any);
	}
	return result;
}

export function mapValues<V, R>(obj: { [string]: V }, fn: (v: V, k: string) => R): { [string]: R } {
	const result: { [string]: R } = {};
	for (const [k, v] of Object.entries(obj)) {
		result[k] = fn((v: any), k);
	}
	return result;
}

export function mapKeys<V>(obj: { [string]: V }, fn: (v: V, k: string) => string): { [string]: V } {
	const result: { [string]: V } = {};
	for (const [k, v] of Object.entries(obj)) {
		result[fn((v: any), k)] = (v: any);
	}
	return result;
}

export function partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] {
	const yes: T[] = [];
	const no: T[] = [];
	for (const item of arr) (predicate(item) ? yes : no).push(item);
	return [yes, no];
}

export function fromPairs<V>(pairs: [string, V][]): { [string]: V } {
	return Object.fromEntries(pairs);
}

export function zipWith<A, B, R>(a: A[], b: B[], fn: (a: A, b: B) => R): R[] {
	const len = Math.max(a.length, b.length);
	const result: R[] = [];
	for (let i = 0; i < len; i++) result.push(fn(a[i], b[i]));
	return result;
}

export function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function intersection<T>(a: T[], b: T[]): T[] {
	const set = new Set(b);
	return a.filter(v => set.has(v));
}

export function remove<T>(arr: T[], predicate: (item: T) => boolean): T[] {
	const removed: T[] = [];
	let i = 0;
	for (let j = 0; j < arr.length; j++) {
		if (predicate(arr[j])) {
			removed.push(arr[j]);
		} else {
			arr[i++] = arr[j];
		}
	}
	arr.length = i;
	return removed;
}

export function dropWhile<T>(arr: T[], predicate: (item: T) => boolean): T[] {
	let i = 0;
	while (i < arr.length && predicate(arr[i])) i++;
	return arr.slice(i);
}

export function takeRightWhile<T>(arr: T[], predicate: (item: T) => boolean): T[] {
	let i = arr.length;
	while (i > 0 && predicate(arr[i - 1])) i--;
	return arr.slice(i);
}

export function transform<T, R>(obj: { [string]: T }, fn: (result: R, value: T, key: string) => void, accumulator: R): R {
	for (const [k, v] of Object.entries(obj)) {
		fn(accumulator, (v: any), k);
	}
	return accumulator;
}

export function curryRight(fn: Function): Function {
	return function curried(...rightArgs: any[]) {
		if (rightArgs.length >= fn.length) return fn(...rightArgs);
		return (...leftArgs: any[]) => curried(...leftArgs, ...rightArgs);
	};
}

export function assignIn<T: Object>(target: T, ...sources: Object[]): T {
	for (const source of sources) {
		for (const key in source) {
			(target: any)[key] = source[key];
		}
	}
	return target;
}

export function isObject(value: mixed): boolean {
	const type = typeof value;
	return value != null && (type === 'object' || type === 'function');
}
