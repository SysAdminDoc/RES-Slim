/* @flow */
// The settings-page half of the page action log.
//
// The log is written in the reddit page; the console that shows it is an iframe
// served from the extension's origin. So the console asks the page, exactly the
// way it already does for the filter preview and the module timings. This is the
// asking half, kept away from anything that touches the log itself so the
// options bundle does not pull the page's writers in behind a panel.

import type { ActionEntry } from './actionLog';

export const ACTION_LOG_TIMEOUT_MS = 4000;

// A reply is never longer than the ring it comes from, and a row's strings are
// never longer than the writer's own cap.
const MAX_ENTRIES = 500;
const MAX_FIELD_LENGTH = 200;
// Outside this, `new Date(t).toISOString()` throws a RangeError -- in the panel
// an unhandled rejection with the status stuck on its spinner, in the report a
// build that dies outright.
const MAX_TIMESTAMP = 8.64e15;

export type ActionLogReply = {|
	entries: ActionEntry[],
	total: number,
|};

// Anything that could make one value look like another goes.
//
// These strings are printed into the plaintext support report, which is joined
// on newlines and pasted into a bug tracker by a person, and into the settings
// panel's rows. A `moduleID` carrying `\n` writes whole sections of that report
// -- a convincing "Stored options" block naming a password, say -- from a single
// `postMessage` by page-world script on reddit.com, which is exactly the sender
// this function exists to distrust.
//
// The line breakers are the ones that forge structure, so they matter most. The
// bidi overrides and isolates are here for the same reason one step down: a
// right-to-left override in a module name reverses the visual order of the rest
// of its line, so what the reader sees is not what the row says. Zero-width and
// invisible spaces go with them, because two rows that read identically and are
// not identical is the same problem wearing a smaller hat.
function field(value: mixed): string {
	if (typeof value !== 'string') return '';
	// The control characters are the point: this is what stops a value writing
	// its own line in the report.
	// eslint-disable-next-line no-control-regex
	const flat = value.replace(/[\u0000-\u001f\u00ad\u007f-\u009f\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u2028\u2029\u3164\ufeff\uffa0]/g, ' ');
	return flat.length > MAX_FIELD_LENGTH ? flat.slice(0, MAX_FIELD_LENGTH) : flat;
}

// The payload, not just the sender.
//
// `options.html` is embedded as an iframe inside reddit pages, so page-world
// script on reddit.com -- reddit's own, another extension's, a userscript's --
// can post to this window at the origin the check accepts. `sanitizeContext`
// and `sanitizePageDiagnostics` already say this for the two channels that came
// before; without the same treatment here a crafted reply could stall the panel
// on a throw, kill a report build outright, or plant rows in a report the reader
// then pastes into a bug tracker. It cannot make those rows true, but it can
// make them look it, so the shape is enforced rather than trusted.
//
// Returns null when the payload is not an action-log reply. Never throws.
export function sanitizeActionLog(payload: mixed): ActionLogReply | null {
	if (!payload || typeof payload !== 'object') return null;
	const reply = (payload: any).actionLog;
	if (!reply || typeof reply !== 'object') return null;

	const rows = Array.isArray(reply.entries) ? reply.entries.slice(0, MAX_ENTRIES) : [];
	const entries = rows
		.filter(row => row && typeof row === 'object')
		.map(row => ({
			timestamp: Number.isFinite(row.timestamp) && Math.abs(row.timestamp) <= MAX_TIMESTAMP ? row.timestamp : 0,
			moduleID: field(row.moduleID) || 'unknown-module',
			outcome: ((field(row.outcome) || 'built'): any),
			target: field(row.target),
			reason: field(row.reason),
			detail: field(row.detail),
		}));

	// Capped as well as floored. A finite `1e21` survives `Math.floor` and renders
	// as `1e+21` in the report heading and the panel status, which is a count no
	// page ever recorded and reads as a bug in the extension rather than a lie
	// from the page.
	const claimed = Number.isFinite(reply.total) ? Math.floor(reply.total) : entries.length;
	const total = Math.min(Math.max(entries.length, claimed), MAX_ENTRIES);
	return { entries, total };
}

// Resolves null when there is no page to ask -- the standalone options page,
// opened in its own tab, has no reddit document behind it, and saying so is
// better than an empty table that reads as "nothing happened".
export function requestActionLog(targetOrigin: string, limit: number = 200): Promise<?ActionLogReply> {
	if (typeof window === 'undefined' || window.parent === window) return Promise.resolve(null);

	return new Promise(resolve => {
		let done = false;
		const finish = (value: ?ActionLogReply) => {
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
			const reply = sanitizeActionLog(data);
			if (reply) finish(reply);
		}
		window.addEventListener('message', onMessage);
		// A page that never answers must not leave the panel spinning: an old
		// content script, or a tab that navigated between the ask and the reply.
		const timer = setTimeout(() => finish(null), ACTION_LOG_TIMEOUT_MS);
		try {
			window.parent.postMessage({ requestActionLog: { limit } }, targetOrigin);
		} catch (error) {
			finish(null);
		}
	});
}
