/* @flow */

import { fromPairs } from '../../utils/functional';
import { addListener } from './messaging';
import { isProxyableUrl } from './urlGuard';

addListener('ajax', async ({ method, url, headers, data, credentials }) => {
	if (!isProxyableUrl(url)) {
		console.error('[RES-Slim] refusing to proxy non-http(s) ajax URL:', url);
		throw new Error('RES-Slim: blocked non-http(s) proxy request');
	}
	const rawResponse = await fetch(url, {
		method,
		headers,
		credentials,
		body: data,
	});

	return {
		ok: rawResponse.ok,
		status: rawResponse.status,
		headers: fromPairs(Array.from(rawResponse.headers.entries())),
		text: await rawResponse.text(),
	};
});
