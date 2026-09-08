/* @flow */

import { addListener } from './messaging';
import { isProxyableUrl } from './urlGuard';

// The same scheme check the fetch and download proxies make, for the same
// reason: this is reachable only from this extension's own content script, and a
// content-script XSS could otherwise use it as a confused deputy. The browser
// refuses `javascript:` and a top-level `data:` here on its own, so what this
// adds is `file:///` -- reading the local disk into a tab -- and the general
// principle that all four background proxies answer the same question about a
// URL before acting on it.
addListener('openNewTabs', ({ urls, focusIndex }, { tab }) => {
	(Array.isArray(urls) ? urls : []).forEach((url, i) => {
		if (!isProxyableUrl(url)) return;
		chrome.tabs.create({
			url,
			active: i === focusIndex,
			index: tab.index + 1 + i,
			openerTabId: tab.id,
			// Firefox needs cookieStoreId to open in correct container
			...(process.env.BUILD_TARGET === 'firefox' ? { cookieStoreId: tab.cookieStoreId } : {}),
		});
	});
});

