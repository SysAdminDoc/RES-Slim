/* @flow */

import { fromPairs } from '../../utils/functional';
import { context } from '../../environment';
import { sendMessage } from './messaging';
import * as XhrCache from './xhrCache';

type ResponseType = 'text' | 'json' | 'raw';
type MethodType = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type AjaxOptions<Ty: ResponseType | void> = {|
	method?: MethodType,
	url: string,
	query?: { [string]: string | number | boolean },
	headers?: { [string]: string },
	data?: string | { [string]: string },
	type?: Ty,
	cacheFor?: number,
	credentials?: 'include' | 'omit',
|};

class FetchError extends Error {
	status: number;

	constructor(url, status) {
		super(`${url} failed with status ${status}`);
		this.status = status;
	}
}

/* eslint-disable no-redeclare */
declare function ajax(opt: AjaxOptions<void>): Promise<string>;
declare function ajax(opt: AjaxOptions<'text'>): Promise<string>;
declare function ajax(opt: AjaxOptions<'json'>): Promise<{ [string | number]: any }>;
declare function ajax(opt: AjaxOptions<'raw'>): Promise<{
	ok: boolean,
	status: number,
	headers: { [string]: string },
	text: string,
}>;

/**
 * Send a fetch request.
 *
 * `method`, `url`, and `headers` behave in the obvious way.
 * `query` adds query params to `url`.
 * `data` objects will be sent as application/x-www-form-urlencoded.
 * `data` strings will be sent as-is.
 * `type` affects the return type, either 'text' or 'json'.
 * `cacheFor` is a TTL, in milliseconds.
 */
// What a cached response is a response *to*. The URL alone conflated a
// credentialed GET with an uncredentialed one, and a GET with a POST, so one
// could be served in place of the other. The browsing context is added on the
// background side, which is the only side that knows which tab asked.
function cacheKey({ method, credentials, url }): string {
	return `${method}|${credentials}|${url}`;
}

export async function ajax(options: AjaxOptions<*>) {
	const params = buildRequestParams(options);
	const { method, url, headers, data, type, cacheFor, sameOrigin, credentials } = params;

	if (cacheFor) {
		const cached = await XhrCache.check(cacheKey(params), cacheFor);
		if (cached) {
			return processResponse(cached, type);
		}
	}

	const response = await (sameOrigin ?
		fetch(url, {
			method,
			headers,
			credentials,
			body: data,
		}).then(async r => ({
			ok: r.ok,
			status: r.status,
			headers: fromPairs(Array.from(r.headers.entries())),
			text: await r.text(),
		})) :
		sendMessage('ajax', { method, url, headers, data, credentials })
	);

	if (!response.ok) {
		throw new FetchError(url, response.status);
	}

	if (cacheFor) {
		XhrCache.set(cacheKey(params), response);
	}

	return processResponse(response, type);
}
/* eslint-enable no-redeclare */

ajax.invalidate = (options: AjaxOptions<*>) =>
	XhrCache.delete(cacheKey(buildRequestParams(options)));

function buildRequestParams({ method = 'GET', url, query = {}, headers = {}, data, type = 'text', credentials, cacheFor = 0 }): {|
	method: MethodType,
	url: string,
	headers: { [string]: string },
	data: string | void,
	type: ResponseType,
	cacheFor: number,
	sameOrigin: boolean,
	credentials: 'omit' | 'include',
|} {
	const siteOrigin = new URL(context.origin);

	// Expand relative URLs
	const requestURL = new URL(url, siteOrigin);

	// Append query string to URL
	for (const [key, val] of Object.entries(query)) {
		requestURL.searchParams.set(key, String(val));
	}

	const sameSite = requestURL.hostname.split('.').slice(-2).join('.') === siteOrigin.hostname.split('.').slice(-2).join('.');
	if (sameSite) {
		// Add `app=res` to same-origin request URLs
		requestURL.searchParams.set('app', 'res');

		// include cookies for same-origin requests (to load correct posts, etc.)
		if (!credentials) credentials = 'include';

		if (method !== 'GET' && method !== 'HEAD') {
			// Send modhash for same-origin non-GET requests
			if (context.userHash) headers['X-Modhash'] = context.userHash;
		}

		// new.reddit.com specifically selects the reddit desktop web frontend service.
		// AJAX requests should be sent to www.reddit.com, which will select the correct
		// service based on the path.
		requestURL.hostname = requestURL.hostname.replace(/new\./, 'www.');
	}

	const sameOrigin = siteOrigin.origin === requestURL.origin;

	// Convert plain data objects to application/x-www-form-urlencoded
	if (typeof data === 'object') {
		headers['Content-Type'] = 'application/x-www-form-urlencoded';
		// this needs to be a string because Edge doesn't support sending URlSearchParams
		// (the fetch polyfill passes it through to XHR, which is correct behaviour)
		data = new URLSearchParams(data).toString();
	}

	return {
		method,
		url: requestURL.href,
		headers,
		data,
		type,
		cacheFor,
		credentials: credentials || 'omit',
		sameOrigin,
	};
}

function processResponse(response, type: ResponseType) {
	switch (type) {
		case 'text':
			return response.text;
		case 'json':
			return JSON.parse(response.text);
		case 'raw':
			return response;
		default:
			throw new Error(`Invalid type: ${type}`);
	}
}
