/* @flow */

import { addListener } from './messaging';
import { isOpenableTabUrl } from './urlGuard';

// The same idea as the fetch and download proxies, for the same reason: this is
// reachable only from this extension's own content script, and a content-script
// XSS could otherwise use it as a confused deputy. The browser refuses
// `javascript:` and a top-level `data:` here on its own, so what this adds is
// `file:///` -- reading the local disk into a tab.
//
// Not the same *check*, though. The settings console opens its own options page
// in a tab when the embedded frame fails to load, and that is an extension URL:
// refusing it took away the recovery path from a reader whose console was
// already broken.
addListener('openNewTabs', ({ urls, focusIndex }, { tab }) => {
	(Array.isArray(urls) ? urls : []).forEach((url, i) => {
		if (!isOpenableTabUrl(url)) return;
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

