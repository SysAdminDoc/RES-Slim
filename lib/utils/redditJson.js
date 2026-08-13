/* @flow */
// One policy for authenticated, read-only Reddit JSON requests. Callers keep
// their feature-specific rate limiters and parsers; this layer owns credentials,
// response validation, bounded 429 retries, and cancellation when the page goes
// away. Error messages never include response bodies, which may contain private
// account data.

export const DEFAULT_RETRY_LIMIT = 2;
export const DEFAULT_BACKOFF_MS = 750;
export const MAX_BACKOFF_MS = 10000;

// Flow 0.84 predates the DOM AbortController declaration. The browser floor
// provides it at runtime; keep the local declaration narrow rather than adding
// an application-wide untyped libdef.
declare class AbortController {
	signal: any;
	abort(): void;
}

export type RedditJsonErrorCode = 'http' | 'content-type' | 'malformed-json' | 'shape';

export class RedditJsonError extends Error {
	status: number;
	code: RedditJsonErrorCode;

	constructor(code: RedditJsonErrorCode, message: string, status: number = 0) {
		super(message);
		this.name = 'RedditJsonError';
		this.code = code;
		this.status = status;
	}
}

type Fetcher = (url: string, options: { [string]: any }) => Promise<any>;
type Sleeper = (delayMs: number, signal: ?any) => Promise<void>;

type RedditJsonOptions = {
	signal?: any,
	maxRetries?: number,
	backoffMs?: number,
	maxBackoffMs?: number,
	validate?: (value: mixed) => boolean,
	onStatus?: (status: number) => mixed,
	fetcher?: Fetcher,
	sleep?: Sleeper,
};

let pageAbortController: any = null;

function abortError(): Error {
	const error = new Error('Reddit JSON request aborted');
	error.name = 'AbortError';
	return error;
}

export function createRedditRequestScope(): {| signal: any, abort: () => void |} {
	const controller = new AbortController();
	return {
		signal: controller.signal,
		abort: () => { controller.abort(); },
	};
}

export function getRedditPageAbortSignal(): ?any {
	if (pageAbortController) return pageAbortController.signal;
	if (typeof AbortController === 'undefined' || typeof window === 'undefined' || typeof document === 'undefined') return null;

	const controller = new AbortController();
	pageAbortController = controller;
	const abort = () => {
		window.removeEventListener('pagehide', abort);
		document.removeEventListener('reddit.urlChanged', abort);
		controller.abort();
		if (pageAbortController === controller) pageAbortController = null;
	};
	window.addEventListener('pagehide', abort, { once: true });
	document.addEventListener('reddit.urlChanged', abort, { once: true });
	return controller.signal;
}

export function isJsonObject(value: mixed): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRedditListing(value: mixed): boolean {
	if (!isJsonObject(value)) return false;
	const data = (value: any).data;
	return isJsonObject(data) && Array.isArray(data.children);
}

export function isRedditListingPair(value: mixed): boolean {
	return Array.isArray(value) && value.length >= 2 && value.every(isRedditListing);
}

export function isJsonContentType(value: mixed): boolean {
	if (typeof value !== 'string') return false;
	const mime = value.split(';', 1)[0].trim().toLowerCase();
	return mime === 'application/json' || mime.endsWith('+json');
}

export function retryDelayMs(
	attempt: number,
	retryAfter: mixed,
	backoffMs: number = DEFAULT_BACKOFF_MS,
	maxBackoffMs: number = MAX_BACKOFF_MS,
	now: number = Date.now(),
): number {
	const parsedBase = Number(backoffMs);
	const parsedMax = Number(maxBackoffMs);
	const safeBase = Math.max(0, Math.min(MAX_BACKOFF_MS, Number.isFinite(parsedBase) ? parsedBase : DEFAULT_BACKOFF_MS));
	const safeMax = Math.max(safeBase, Math.min(MAX_BACKOFF_MS, Number.isFinite(parsedMax) ? parsedMax : MAX_BACKOFF_MS));
	let headerDelay = 0;
	if (typeof retryAfter === 'string' && retryAfter.trim()) {
		const value = retryAfter.trim();
		if (/^\d+$/.test(value)) headerDelay = Number(value) * 1000;
		else {
			const date = Date.parse(value);
			if (Number.isFinite(date)) headerDelay = Math.max(0, date - now);
		}
	}
	const exponential = safeBase * (2 ** Math.max(0, attempt));
	return Math.min(safeMax, Math.max(exponential, headerDelay));
}

export function sleepWithAbort(delayMs: number, signal: ?any): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal && signal.aborted) {
			reject(abortError());
			return;
		}
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			settled = true;
			if (signal) signal.removeEventListener('abort', onAbort);
			resolve();
		}, delayMs);
		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
			// Close the gap between the initial check and listener registration.
			if (signal.aborted) onAbort();
		}
	});
}

function responseHeader(response: any, name: string): string {
	if (!response || !response.headers || typeof response.headers.get !== 'function') return '';
	return response.headers.get(name) || '';
}

function blockStatus(status: number): boolean {
	return status === 401 || status === 403 || status === 429;
}

export function fetchRedditJson<T>(url: string, options: RedditJsonOptions = {}): Promise<T> {
	const fetcher: Fetcher = options.fetcher || (fetch: any);
	const sleeper: Sleeper = options.sleep || sleepWithAbort;
	const signal = options.signal || getRedditPageAbortSignal();
	const requestedRetries = options.maxRetries === undefined ? DEFAULT_RETRY_LIMIT : Number(options.maxRetries);
	const maxRetries = Math.max(0, Math.min(4, Math.floor(Number.isFinite(requestedRetries) ? requestedRetries : DEFAULT_RETRY_LIMIT)));
	const validate = options.validate || (value => isJsonObject(value) || Array.isArray(value));

	const request = async (attempt: number): Promise<T> => {
		const requestOptions: { [string]: any } = {
			credentials: 'include',
			headers: { Accept: 'application/json' },
		};
		if (signal) requestOptions.signal = signal;
		const response = await fetcher(url, requestOptions);
		const status = Number(response && response.status) || 0;

		if (!response || response.ok !== true) {
			if (blockStatus(status) && options.onStatus) options.onStatus(status);
			if (status === 429 && attempt < maxRetries) {
				await sleeper(retryDelayMs(
					attempt,
					responseHeader(response, 'retry-after'),
					options.backoffMs,
					options.maxBackoffMs,
				), signal);
				return request(attempt + 1);
			}
			throw new RedditJsonError('http', `Reddit JSON request failed with status ${status || 'unknown'}`, status);
		}

		if (!isJsonContentType(responseHeader(response, 'content-type'))) {
			throw new RedditJsonError('content-type', 'Reddit JSON request returned a non-JSON content type', status);
		}

		let value;
		try {
			value = await response.json();
		} catch (error) {
			if (error && typeof error === 'object' && (error: any).name === 'AbortError') throw error;
			throw new RedditJsonError('malformed-json', 'Reddit JSON response could not be parsed', status);
		}

		let valid = false;
		try {
			valid = validate(value);
		} catch (error) { /* a throwing shape guard is a failed guard */ }
		if (!valid) throw new RedditJsonError('shape', 'Reddit JSON response had an unexpected shape', status);
		return (value: any);
	};

	return request(0);
}
