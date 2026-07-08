/* @flow */
// RES-Slim: show the original text of an *edited* comment as a diff against its
// current text, using the Arctic Shift archive (with a PullPush fallback). Where
// arcticShift restores [deleted]/[removed] bodies, this covers the far more
// common "comment was quietly edited" case. Local-only, disabled by default.

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';
import { ajax } from '../environment';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { createRateLimiter } from '../utils/rateLimiter';
import { buildCommentUrl, parseCommentResponse, sanitizeInstance } from '../utils/arcticShift';
import { diffTokens, hasChanges, renderDiffHtml } from '../utils/textDiff';

export const module: Module<*> = new Module('editedCommentDiff');

module.moduleName = 'Edited comment diff';
module.category = 'commentsCategory';
module.description = 'On comments marked "edited", add a link that fetches the archived original from Arctic Shift (PullPush fallback) and shows a word-level diff against the current text. Local-only, external integration — defaults off.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['edited', 'diff', 'original', 'unedit', 'arctic-shift', 'pullpush', 'history'];

module.options = {
	instance: {
		type: 'text',
		value: 'https://arctic-shift.photon-reddit.com',
		title: 'Arctic Shift instance',
		description: 'Base URL. Defaults to the public instance.',
	},
	pullpushFallback: {
		type: 'boolean',
		value: true,
		title: 'PullPush fallback',
		description: 'If Arctic Shift has no record, try the PullPush archive before giving up.',
	},
};

const limiter = createRateLimiter({ tokens: 3, refillMs: 2000, maxConcurrent: 2 });

const LINK_CLASS = 'rsm-editedDiff-link';
const DIFF_CLASS = 'rsm-editedDiff-body';
const PROCESSED = 'data-rsm-edited-diff';

async function fetchFromArcticShift(id: string): Promise<?string> {
	const url = buildCommentUrl(sanitizeInstance(module.options.instance.value), id);
	try {
		return await limiter.schedule(async () => {
			const res = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
			if (!res.ok) return null;
			const parsed = parseCommentResponse(await res.json());
			return parsed ? parsed.body : null;
		});
	} catch (err) {
		return null;
	}
}

async function fetchFromPullPush(id: string): Promise<?string> {
	try {
		const data: any = await limiter.schedule(() => ajax({
			url: 'https://api.pullpush.io/reddit/search/comment/',
			query: { ids: id },
			type: 'json',
			cacheFor: 60 * 60 * 1000,
		}));
		const item = data && data.data && data.data[0];
		return item && typeof item.body === 'string' ? item.body : null;
	} catch (err) {
		return null;
	}
}

function isEdited(thing: Thing): boolean {
	return !!thing.entry.querySelector('.tagline time.edited-timestamp');
}

function currentBodyText(thing: Thing): ?HTMLElement {
	const md = thing.entry.querySelector('.usertext-body .md');
	return md instanceof HTMLElement ? md : null;
}

async function runDiff(thing: Thing, link: HTMLAnchorElement): Promise<void> {
	const idMatch = /t1_([a-z0-9]+)/.exec(thing.element.id || '');
	if (!idMatch) return;
	const md = currentBodyText(thing);
	if (!md) return;

	link.textContent = 'loading…';
	const id = idMatch[1];
	let original = await fetchFromArcticShift(id);
	if (original == null && module.options.pullpushFallback.value === true) {
		original = await fetchFromPullPush(id);
	}

	if (!document.contains(thing.element)) return;
	if (original == null) {
		link.textContent = 'no archived original';
		link.title = 'The archive has no earlier copy of this comment.';
		return;
	}

	const current = (md.textContent || '').trim();
	const segments = diffTokens(original.trim(), current);
	const panel = document.createElement('div');
	panel.className = DIFF_CLASS;
	if (!hasChanges(segments)) {
		panel.textContent = 'Archived copy matches the current text (edit predates the archive snapshot).';
	} else {
		setTrustedHTML(panel, renderDiffHtml(segments));
	}
	md.after(panel);
	link.remove();
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	watchForThings(['comment'], (thing: Thing) => {
		if (thing.entry.hasAttribute(PROCESSED)) return;
		if (!isEdited(thing) || !currentBodyText(thing)) return;
		thing.entry.setAttribute(PROCESSED, '1');

		const link = document.createElement('a');
		link.href = '#';
		link.className = LINK_CLASS;
		link.textContent = '[show original]';
		link.style.marginLeft = '6px';
		link.addEventListener('click', (e: MouseEvent) => {
			e.preventDefault();
			runDiff(thing, link);
		});
		const tagline = thing.entry.querySelector('.tagline');
		if (tagline instanceof HTMLElement) tagline.append(link);
	});
};
