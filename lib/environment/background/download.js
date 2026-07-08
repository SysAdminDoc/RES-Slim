/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';
import { isProxyableUrl } from './urlGuard';

const downloadFile = apiToPromise((options, callback) => chrome.downloads.download(options, callback));

addListener('download', ({ url, filename }, { tab: { incognito } }) => {
	if (!isProxyableUrl(url)) {
		console.error('[RES-Slim] refusing to download non-http(s) URL:', url);
		throw new Error('RES-Slim: blocked non-http(s) download request');
	}
	return downloadFile({ url, filename, ...(process.env.BUILD_TARGET !== 'firefox' ? {} : { incognito }) });
});
