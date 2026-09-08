/* @flow */

import { fromPairs } from '../../utils/functional';
import { addListener } from './messaging';
import { isProxyableUrl } from './urlGuard';

addListener('ajax', async ({ method, url, headers, data, credentials, timeoutMs }) => {
	if (!isProxyableUrl(url)) {
		console.error('[RES-Slim] refusing to proxy non-http(s) ajax URL:', url);
		throw new Error('RES-Slim: blocked non-http(s) proxy request');
	}
	const rawResponse = await fetch(url, {
		method,
		headers,
		credentials,
		body: data,
		// An `AbortSignal` cannot be serialised across the message boundary, so
		// the foreground sends the number and the signal is built here. Without
		// this the proxied half of every request — which is every cross-origin
		// media host — had no ceiling at all.
		...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
	});

	return {
		ok: rawResponse.ok,
		status: rawResponse.status,
		headers: fromPairs(Array.from(rawResponse.headers.entries())),
		text: await rawResponse.text(),
	};
});
