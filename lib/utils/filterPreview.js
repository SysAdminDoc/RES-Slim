/* @flow */
// The settings-page half of the filter preview.
//
// The rules are edited in the settings console, which is an iframe served from
// the extension's origin. The posts they would match are in the page behind it.
// So the console asks the page, exactly as it already does for the module
// timings in the support report, and this is the asking half — kept away from
// anything that touches a Thing so the options bundle does not pull the whole
// filter runtime in behind an option callback.

export type FilterPreviewReply = {|
	scanned: number,
	counts: { [ruleId: string]: number },
	errors: string[],
	matched: number,
|};

export const FILTER_PREVIEW_TIMEOUT_MS = 4000;

// Resolves null when there is no page to ask — the standalone options page,
// opened in its own tab, has no Reddit document behind it.
export function requestFilterPreview(
	rulesJson: string,
	reveal: boolean,
	targetOrigin: string,
): Promise<?FilterPreviewReply> {
	if (typeof window === 'undefined' || window.parent === window) return Promise.resolve(null);

	return new Promise(resolve => {
		let done = false;
		const finish = (value: ?FilterPreviewReply) => {
			if (done) return;
			done = true;
			window.removeEventListener('message', onMessage);
			clearTimeout(timer);
			resolve(value);
		};
		function onMessage({ origin, data }: any) {
			if (origin !== targetOrigin) return;
			if (data && data.filterPreview) finish(data.filterPreview);
		}
		window.addEventListener('message', onMessage);
		// A page that never answers must not leave the button spinning: an old
		// content script, or a tab that navigated between the ask and the reply.
		const timer = setTimeout(() => finish(null), FILTER_PREVIEW_TIMEOUT_MS);
		try {
			window.parent.postMessage({ requestFilterPreview: { rulesJson, reveal } }, targetOrigin);
		} catch (error) {
			finish(null);
		}
	});
}

export function describePreview(reply: FilterPreviewReply): string {
	const ids = Object.keys(reply.counts);
	if (!ids.length) return `No rules to try against the ${reply.scanned} posts and comments on the page.`;
	const perRule = ids.map(id => `${id}: ${reply.counts[id]}`).join(', ');
	return `${reply.matched} of ${reply.scanned} on the page would match. ${perRule}.`;
}
