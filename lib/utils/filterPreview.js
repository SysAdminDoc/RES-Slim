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

const MAX_RULES = 200;
const MAX_ERRORS = 50;
const MAX_TEXT = 300;

function counted(value: mixed): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor((value: any))) : 0;
}

function line(value: mixed): string {
	if (typeof value !== 'string') return '';
	// Same rule as the action log's: these strings are shown to a reader in a
	// status line, and a line breaker or a bidi override in one makes it read as
	// something it is not.
	// eslint-disable-next-line no-control-regex
	const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2028\u2029\ufeff]/g, ' ');
	return flat.length > MAX_TEXT ? flat.slice(0, MAX_TEXT) : flat;
}

// The payload, not just the sender.
//
// `options.html` is an iframe inside reddit pages, so page-world script on
// reddit.com can post to this window at the origin the check accepts --
// `sanitizeContext` and `sanitizeActionLog` say the same thing for the two other
// channels into this document. Without it a crafted reply makes the preview
// report matches nobody made, or hands `describePreview` a `counts` that is a
// string and gets nonsense printed out of it.
//
// Returns null when the payload is not a preview reply. Never throws.
export function sanitizeFilterPreview(payload: mixed): FilterPreviewReply | null {
	if (!payload || typeof payload !== 'object') return null;
	const reply = (payload: any).filterPreview;
	if (!reply || typeof reply !== 'object') return null;

	const rawCounts = reply.counts && typeof reply.counts === 'object' && !Array.isArray(reply.counts) ? reply.counts : {};
	const counts: { [string]: number } = (Object.create(null): any);
	for (const id of Object.keys(rawCounts).slice(0, MAX_RULES)) counts[line(id)] = counted(rawCounts[id]);

	const rawErrors = Array.isArray(reply.errors) ? reply.errors : [];
	const scanned = counted(reply.scanned);
	return {
		scanned,
		// A count of matches larger than the number of things looked at is not a
		// number this page produced.
		matched: Math.min(counted(reply.matched), scanned),
		counts,
		errors: rawErrors.slice(0, MAX_ERRORS).map(line).filter(Boolean),
	};
}

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
			// A payload that is not a reply leaves the wait running rather than
			// resolving it: several message shapes are posted to this window, and the
			// first one that is not ours must not end the ask.
			const reply = sanitizeFilterPreview(data);
			if (reply) finish(reply);
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
	const ids = Object.keys(reply.counts || {});
	if (!ids.length) return `No rules to try against the ${reply.scanned} posts and comments on the page.`;
	const perRule = ids.map(id => `${id}: ${reply.counts[id]}`).join(', ');
	return `${reply.matched} of ${reply.scanned} on the page would match. ${perRule}.`;
}
