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
	parseAutoLoadBudget,
	parseCommentResponse,
	sanitizeInstance,
} from '../utils/arcticShift';

export const module: Module<{ [string]: any }> = new Module('arcticShift');

module.moduleName = 'Arctic Shift restoration';
module.category = 'commentsCategory';
module.description = 'Restore [removed] / [deleted] comments inline via the Arctic Shift API. Replacement for the broken Pushshift-based path. Pure helpers + rate-limited. External integration. Defaults off.';
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
		description: 'Fetch every [removed]/[deleted] comment on thread open. Heavier on the archive, so it\'s off by default.',
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

type FetchResult =
	| {| ok: true, body: string, author: string |}
	| {| ok: false, reason: 'not-found' | 'rate-limited' | 'server-error' | 'network' | 'malformed' |};

async function fetchComment(id: string): Promise<FetchResult> {
	const instance = sanitizeInstance(module.options.instance.value);
	const url = buildCommentUrl(instance, id);
	try {
		return await limiter.schedule(async () => {
			let res;
			try {
				res = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
			} catch (netErr) {
				return ({ ok: false, reason: 'network' }: FetchResult);
			}
			if (res.status === 429) return ({ ok: false, reason: 'rate-limited' }: FetchResult);
			if (res.status === 404) return ({ ok: false, reason: 'not-found' }: FetchResult);
			if (!res.ok) return ({ ok: false, reason: 'server-error' }: FetchResult);
			let json;
			try { json = await res.json(); } catch (parseErr) {
				return ({ ok: false, reason: 'malformed' }: FetchResult);
			}
			const parsed = parseCommentResponse(json);
			if (!parsed) return ({ ok: false, reason: 'not-found' }: FetchResult);
			return ({ ok: true, body: parsed.body, author: parsed.author }: FetchResult);
		});
	} catch (err) {
		return ({ ok: false, reason: 'network' }: FetchResult);
	}
}

function failureLabel(reason: string): string {
	switch (reason) {
		case 'rate-limited': return 'rate-limited, try later';
		case 'network': return 'network error';
		case 'server-error': return 'archive server error';
		case 'malformed': return 'bad archive response';
		case 'not-found':
		default: return 'not in archive';
	}
}

function injectRestoreLink(thing: Thing): void {
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement) || !isDeletedBody(md.textContent)) return;
	if (thing.entry.querySelector(`.${LINK_CLASS}`)) return;
	const link = document.createElement('a');
	link.href = '#';
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
	const result = await fetchComment(idMatch[1]);
	if (!result.ok) {
		link.textContent = failureLabel(result.reason);
		link.title = `Arctic Shift: ${result.reason}`;
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
	restored.textContent = result.body;
	md.textContent = '';
	md.append(restored);
	const byline = thing.entry.querySelector('.author');
	if (byline instanceof HTMLElement && result.author && result.author !== 'unknown') {
		byline.textContent = `${result.author} (archive)`;
	}
	if (document.contains(link)) link.remove();
}

let autoLoadBudget = 0;

module.contentStart = () => {
	if (!isPageType('comments')) return;
	autoLoadBudget = parseAutoLoadBudget(module.options.maxAutoLoad.value);
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
