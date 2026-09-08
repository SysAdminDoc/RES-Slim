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

export type ActionLogReply = {|
	entries: ActionEntry[],
	total: number,
|};

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
			if (data && data.actionLog) finish(data.actionLog);
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

// One row's worth, as text. Kept here rather than in the panel so the support
// report and the table cannot drift into describing the same entry differently.
export function describeActionEntry(entry: ActionEntry): string {
	const when = new Date(entry.timestamp).toISOString().slice(11, 19);
	const why = entry.reason ? ` via ${entry.reason}` : '';
	return `${when}  ${entry.moduleID}: ${entry.outcome} ${entry.target}${why}`;
}
