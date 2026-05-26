/* @flow */
// RES-Slim: click-to-restore [removed] / [deleted] comments via the pullpush.io archive.
// Inspired by spiralx's "Reddit - View deleted content" (MIT). Feature lives or dies with
// the availability of the third-party archive.

import { Module } from '../core/module';
import { Thing, isPageType, string, watchForThings } from '../utils';
import { ajax } from '../environment';
import { createRateLimiter } from '../utils/rateLimiter';

export const module: Module<*> = new Module('viewDeleted');

module.moduleName = 'View deleted comments';
module.category = 'commentsCategory';
module.description = 'Adds a "restore" link under [removed] or [deleted] comments that fetches the archived body from pullpush.io.';
module.descriptionRaw = true;
module.include = ['comments'];
module.options = {
	autoLoad: {
		type: 'boolean',
		value: false,
		title: 'Auto-load on thread open',
		description: 'Automatically fetch all removed comments instead of requiring a click. Heavier on the archive.',
	},
	maxAutoLoad: {
		type: 'text',
		value: '25',
		title: 'Max auto-loads',
		description: 'Hard cap on auto-loaded PullPush restorations per thread.',
	},
};

const limiter = createRateLimiter({ tokens: 3, refillMs: 2000, maxConcurrent: 2 });

function parseAutoLoadBudget(raw: mixed): number {
	const parsed = parseInt(String(raw == null ? '' : raw).trim(), 10);
	if (!Number.isFinite(parsed)) return 25;
	return Math.max(0, parsed);
}

async function fetchArchived(id: string): Promise<?{ body: string, author: string }> {
	try {
		const data: any = await limiter.schedule(() => ajax({
			url: 'https://api.pullpush.io/reddit/search/comment/',
			query: { ids: id },
			type: 'json',
			cacheFor: 60 * 60 * 1000,
		}));
		const item = data && data.data && data.data[0];
		if (!item) return null;
		return { body: item.body || '', author: item.author || 'unknown' };
	} catch {
		return null;
	}
}

function isDeletedText(body: HTMLElement): boolean {
	const txt = (body.textContent || '').trim();
	return txt === '[removed]' || txt === '[deleted]';
}

async function restore(thing: Thing, trigger: ?HTMLElement) {
	const initialMd = thing.entry.querySelector('.usertext-body .md');
	if (!(initialMd instanceof HTMLElement) || !isDeletedText(initialMd)) return;
	const m = /t1_([a-z0-9]+)/.exec(thing.element.id || '');
	if (!m) return;
	if (trigger) trigger.textContent = 'loading\u2026';
	const archived = await fetchArchived(m[1]);
	if (!archived) {
		if (trigger) trigger.textContent = 'not in archive';
		return;
	}
	// Re-query after the ajax — the original `.md` reference may be stale if
	// infinite-scroll or any DOM churn has rerendered the comment. Bail if the
	// comment is no longer in the live document at all.
	if (!document.contains(thing.element)) return;
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement) || !isDeletedText(md)) return;
	const restored = document.createElement('div');
	restored.className = 'res-slim-restored';
	restored.style.borderLeft = '3px solid #e66';
	restored.style.padding = '4px 8px';
	restored.style.margin = '4px 0';
	restored.textContent = archived.body;
	md.textContent = '';
	md.append(restored);
	const byline = thing.entry.querySelector('.author');
	if (byline instanceof HTMLElement && archived.author !== 'unknown') {
		byline.textContent = `${archived.author} (archived)`;
	}
	if (trigger && document.contains(trigger)) trigger.remove();
}

let autoLoadBudget = 0;

function addRestoreLink(thing: Thing) {
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement) || !isDeletedText(md)) return;
	if (thing.entry.querySelector('.res-slim-restore-link')) return;
	const link = string.html`<a href="#" class="res-slim-restore-link" style="margin-left: 6px;">[restore from archive]</a>`;
	link.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		restore(thing, link);
	});
	md.append(link);
	if (module.options.autoLoad.value && autoLoadBudget > 0) {
		autoLoadBudget -= 1;
		restore(thing, link);
	}
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	autoLoadBudget = parseAutoLoadBudget(module.options.maxAutoLoad.value);
	watchForThings(['comment'], (thing: Thing) => addRestoreLink(thing));
};
