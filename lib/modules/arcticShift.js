/* @flow */
// RES-Slim: restore [removed] / [deleted] content via the Arctic Shift API.
// Pushshift was locked to moderators in 2023; Arctic Shift is the durable
// replacement. Pairs with viewDeleted (pullpush fallback) — both modules
// can be enabled at once and Arctic Shift will run first.

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import {
	buildCommentUrl,
	isDeletedBody,
	parseCommentResponse,
	sanitizeInstance,
} from '../utils/arcticShift';

export const module: Module<*> = new Module('arcticShift');

module.moduleName = 'Arctic Shift restoration';
module.category = 'commentsCategory';
module.description = 'Restore [removed] / [deleted] comments inline via the Arctic Shift API. Replacement for the broken Pushshift-based path. Pure helpers + rate-limited. External integration — defaults off.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['arctic-shift', 'deleted', 'removed', 'restore', 'pushshift'];

module.options = {
	instance: {
		type: 'text',
		value: 'https://arctic-shift.photon-reddit.com',
		title: 'Arctic Shift instance',
		description: 'Base URL. Defaults to the public instance.',
	},
	autoLoad: {
		type: 'boolean',
		value: false,
		title: 'Auto-load',
		description: 'Fetch every [removed]/[deleted] comment on thread open. Heavier on the archive — defaults off.',
	},
	maxAutoLoad: {
		type: 'text',
		value: '25',
		title: 'Max auto-loads',
		description: 'Hard cap on auto-loaded restorations per thread to avoid hammering the archive.',
	},
};

const limiter = createRateLimiter({ tokens: 3, refillMs: 2000, maxConcurrent: 2 });

const LINK_CLASS = 'rsm-arcticShift-link';
const RESTORED_CLASS = 'rsm-arcticShift-restored';

async function fetchComment(id: string): Promise<?{ body: string, author: string }> {
	const instance = sanitizeInstance(module.options.instance.value);
	const url = buildCommentUrl(instance, id);
	try {
		return await limiter.schedule(async () => {
			const res = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(`status ${res.status}`);
			const json = await res.json();
			const parsed = parseCommentResponse(json);
			return parsed ? { body: parsed.body, author: parsed.author } : null;
		});
	} catch (err) {
		return null;
	}
}

function injectRestoreLink(thing: Thing): void {
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement) || !isDeletedBody(md.textContent)) return;
	if (thing.entry.querySelector(`.${LINK_CLASS}`)) return;
	const link = document.createElement('a');
	link.href = 'javascript:void 0';
	link.className = LINK_CLASS;
	link.textContent = '[restore via Arctic Shift]';
	link.style.marginLeft = '6px';
	link.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		runRestore(thing, link);
	});
	md.append(link);
}

async function runRestore(thing: Thing, link: HTMLAnchorElement): Promise<void> {
	const idMatch = /t1_([a-z0-9]+)/.exec(thing.element.id || '');
	if (!idMatch) return;
	const original = link.textContent || '[restore via Arctic Shift]';
	link.textContent = 'loading…';
	const archived = await fetchComment(idMatch[1]);
	if (!archived) {
		link.textContent = 'not in archive';
		return;
	}
	if (!document.contains(thing.element)) return;
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement) || !isDeletedBody(md.textContent)) {
		link.textContent = original;
		return;
	}
	const restored = document.createElement('div');
	restored.className = RESTORED_CLASS;
	restored.textContent = archived.body;
	md.textContent = '';
	md.append(restored);
	const byline = thing.entry.querySelector('.author');
	if (byline instanceof HTMLElement && archived.author && archived.author !== 'unknown') {
		byline.textContent = `${archived.author} (archive)`;
	}
	if (document.contains(link)) link.remove();
}

let autoLoadBudget = 0;

module.contentStart = () => {
	if (!isPageType('comments')) return;
	autoLoadBudget = Math.max(0, parseInt(String(module.options.maxAutoLoad.value || '25'), 10) || 25);
	watchForThings(['comment'], (thing: Thing) => {
		injectRestoreLink(thing);
		if (module.options.autoLoad.value === true && autoLoadBudget > 0) {
			const md = thing.entry.querySelector('.usertext-body .md');
			if (md instanceof HTMLElement && isDeletedBody(md.textContent)) {
				autoLoadBudget -= 1;
				const link = thing.entry.querySelector(`.${LINK_CLASS}`);
				if (link instanceof HTMLAnchorElement) runRestore(thing, link);
			}
		}
	});
};
