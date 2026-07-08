/* @flow */
// RES-Slim: visually highlight comments that appeared after your last visit to a thread.
// Complements the existing newCommentCount module (which only shows numeric deltas).
// Inspired by aesy/reddit-comment-highlights (MIT).

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';
import { Storage } from '../environment';
import { isNewComment, isRevisit } from '../utils/commentHighlights';

export const module: Module<*> = new Module('commentHighlights');

module.moduleName = 'Highlight unread comments';
module.category = 'commentsCategory';
module.description = 'Remembers when you last visited a thread and visually highlights comments posted since then.';
module.descriptionRaw = true;
module.include = ['comments'];
module.options = {
	color: {
		type: 'color',
		value: '#ffe066',
		title: 'Highlight color',
		description: 'Background color for new comments.',
	},
	borderOnly: {
		type: 'boolean',
		value: false,
		title: 'Border only',
		description: 'Only highlight a left border instead of the whole background.',
	},
	expireDays: {
		type: 'text',
		value: '30',
		title: 'Expire after (days)',
		description: 'Thread visit history older than this is pruned.',
	},
};

const store = Storage.wrapBlob('RESmodules.commentHighlights.lastVisit', (): number => 0);

function threadKey(): ?string {
	const m = /\/comments\/([a-z0-9]+)/.exec(location.pathname);
	return m ? m[1] : null;
}

function highlightFrom(lastVisit: number) {
	const { color, borderOnly } = module.options;
	const style = borderOnly.value ?
		`border-left: 3px solid ${(color.value: any)} !important; padding-left: 4px;` :
		`background: ${(color.value: any)}33 !important;`;

	watchForThings(['comment'], (thing: Thing) => {
		const ts = thing.getTimestamp();
		if (!ts) return;
		if (isNewComment(ts.getTime(), lastVisit)) {
			const ele = thing.entry;
			if (ele) ele.setAttribute('style', `${ele.getAttribute('style') || ''};${style}`);
		}
	});
}

module.contentStart = async () => {
	if (!isPageType('comments')) return;
	const key = threadKey();
	if (!key) return;

	const last = await store.getNullable(key);
	// Only highlight on a genuine revisit. On the first visit there is no stored
	// timestamp, so highlighting everything newer than epoch 0 would mark every
	// comment as "new" — the bug this guard fixes.
	if (isRevisit(last)) highlightFrom(Number(last));

	// Record this visit (including the first) after a small delay, so the next
	// visit can highlight comments posted since now.
	setTimeout(() => { store.set(key, Date.now()); }, 5000);

	// Prune old entries occasionally.
	const expireMs = parseFloat(module.options.expireDays.value) * 24 * 60 * 60 * 1000;
	if (Number.isFinite(expireMs) && Math.random() < 0.1) {
		const all = await store.getAll();
		const cutoff = Date.now() - expireMs;
		for (const [k, v] of Object.entries(all)) {
			if (typeof v === 'number' && v < cutoff) store.delete(k);
		}
	}
};
