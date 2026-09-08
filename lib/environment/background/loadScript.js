/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';
import { isInjectableScript } from './urlGuard';

// An allowlist, not a scheme check. `files` only resolves inside the package, so
// this cannot reach the web -- what it can do, handed a name from a
// content-script XSS, is inject any of this extension's own bundles into the
// frame that asked. Three callers name three files.
addListener('loadScript', async ({ url }, { tab: { id: tabId }, frameId }) => {
	if (!isInjectableScript(url)) throw new Error(`Refusing to inject "${String(url)}"`);
	await apiToPromise(chrome.scripting.executeScript)({
		target: { tabId, frameIds: [frameId] },
		files: [url],
	});
});
