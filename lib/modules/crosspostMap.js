/* @flow */
// RES-Slim: on a comments page, surface every other subreddit the same post
// landed in via /duplicates/<id>.json. Inline widget under the post entry.
// Cached per article ID; outbound requests share the shared rate limiter.

import { Module } from '../core/module';
import { isPageType } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import {
	buildDuplicatesUrl,
	extractArticleId,
	parseDuplicatesResponse,
	relativeAge,
} from '../utils/crosspostMap';
import type { Duplicate } from '../utils/crosspostMap';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<*> = new Module('crosspostMap');

module.moduleName = 'Crosspost map';
module.category = 'browsingCategory';
module.description = 'On a comments page, list every other subreddit the same post appears in. Loads /duplicates/<id>.json behind a rate limiter; cached per session.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['crosspost', 'duplicates', 'reposts', 'same content'];

module.options = {
	autoLoad: {
		type: 'boolean',
		value: false,
		title: 'Auto-load',
		description: 'Fetch crossposts on every comments-page open. Defaults off — the explicit "Find crossposts" button keeps unneeded requests at zero.',
	},
	maxItems: {
		type: 'text',
		value: '10',
		title: 'Max items',
		description: 'How many duplicates to render. Capped at 50.',
	},
	hideWhenEmpty: {
		type: 'boolean',
		value: true,
		title: 'Hide widget when no duplicates found',
		description: 'Suppress the widget on posts where no other subreddit carries the same content. Disable to always see the box.',
	},
};

const limiter = createRateLimiter({ tokens: 2, refillMs: 1500, maxConcurrent: 2 });
const cache: Map<string, Duplicate[]> = new Map();

const HOST_CLASS = 'rsm-crosspostMap';
const BTN_CLASS = `${HOST_CLASS}-trigger`;
const LIST_CLASS = `${HOST_CLASS}-list`;
const TITLE_ID = `${HOST_CLASS}-title`;
const STATUS_CLASS = `${HOST_CLASS}-status`;

function clampMax(): number {
	const n = Number(module.options.maxItems.value);
	if (!Number.isFinite(n) || n <= 0) return 10;
	return Math.min(50, Math.floor(n));
}

async function fetchDuplicates(articleId: string, selfFullname: string): Promise<Duplicate[]> {
	const cached = cache.get(articleId);
	if (cached) return cached;
	const url = buildDuplicatesUrl(articleId);
	const items = await limiter.schedule(async () => {
		const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!res.ok) { notifyRedditApiBlocked(res.status); throw new Error(`status ${res.status}`); }
		const json = await res.json();
		return parseDuplicatesResponse(json, selfFullname);
	});
	cache.set(articleId, items);
	return items;
}

function findInsertionPoint(): ?HTMLElement {
	// On a comments page, the post lives in #siteTable above .commentarea.
	const siteTable = document.querySelector('#siteTable.sitetable');
	if (siteTable instanceof HTMLElement) return siteTable;
	return null;
}

function findSelfFullname(): string {
	const thing = document.querySelector('#siteTable.sitetable > .thing[data-fullname]');
	if (thing instanceof HTMLElement) return thing.getAttribute('data-fullname') || '';
	return '';
}

function renderList(host: HTMLElement, items: Duplicate[]): void {
	const max = clampMax();
	const visible = items.slice(0, max);
	const list = document.createElement('ul');
	list.className = LIST_CLASS;
	if (!visible.length) {
		list.classList.add(`${LIST_CLASS}--empty`);
		const li = document.createElement('li');
		li.className = `${LIST_CLASS}-empty`;
		li.textContent = 'No crossposts found.';
		list.append(li);
	} else {
		for (const dup of visible) {
			const li = document.createElement('li');
			li.className = `${LIST_CLASS}-item`;

			const sub = document.createElement('a');
			sub.className = `${LIST_CLASS}-sub`;
			sub.href = `/r/${dup.subreddit}`;
			sub.textContent = `r/${dup.subreddit}`;
			sub.title = `Open r/${dup.subreddit}`;

			const link = document.createElement('a');
			link.className = `${LIST_CLASS}-link`;
			link.href = dup.permalink || '#';
			link.textContent = `${dup.numComments} comments`;

			const meta = document.createElement('span');
			meta.className = `${LIST_CLASS}-meta`;
			meta.textContent = `${dup.score} pts · ${relativeAge(dup.createdUtc)} · u/${dup.author}`;

			li.append(sub, ' — ', link, ' ', meta);
			list.append(li);
		}
	}
	const existing = host.querySelector(`:scope > .${LIST_CLASS}`);
	if (existing instanceof HTMLElement) existing.replaceWith(list);
	else host.append(list);
}

function setStatus(host: HTMLElement, message: string, kind: 'idle' | 'loading' | 'success' | 'empty' | 'error'): void {
	host.dataset.state = kind;
	host.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
	const status = host.querySelector(`:scope .${STATUS_CLASS}`);
	if (!(status instanceof HTMLElement)) return;
	status.textContent = message;
	status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function injectWidget(): void {
	const insertion = findInsertionPoint();
	if (!insertion) return;
	if (document.querySelector(`.${HOST_CLASS}`)) return;

	const host = document.createElement('div');
	host.className = HOST_CLASS;
	host.setAttribute('role', 'region');
	host.setAttribute('aria-labelledby', TITLE_ID);
	host.setAttribute('aria-busy', 'false');

	const header = document.createElement('div');
	header.className = `${HOST_CLASS}-header`;
	const title = document.createElement('h2');
	title.id = TITLE_ID;
	title.className = `${HOST_CLASS}-title`;
	title.textContent = 'Crossposts';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = BTN_CLASS;
	btn.textContent = 'Find crossposts';
	btn.setAttribute('aria-describedby', `${HOST_CLASS}-status`);
	header.append(title, btn);
	const status = document.createElement('p');
	status.id = `${HOST_CLASS}-status`;
	status.className = STATUS_CLASS;
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.textContent = 'Check where else this post appears.';
	host.append(header, status);
	insertion.after(host);

	const articleId = extractArticleId(location.pathname);
	const selfFullname = findSelfFullname();
	let loaded = false;

	const trigger = async () => {
		if (loaded) return;
		if (!articleId) {
			btn.textContent = 'No article id';
			btn.disabled = true;
			setStatus(host, 'This page does not expose a post id.', 'error');
			return;
		}
		btn.textContent = 'Checking...';
		btn.disabled = true;
		setStatus(host, 'Checking duplicate discussions...', 'loading');
		try {
			const items = await fetchDuplicates(articleId, selfFullname);
			loaded = true;
			if (!items.length && module.options.hideWhenEmpty.value !== false) {
				host.remove();
				return;
			}
			renderList(host, items);
			if (items.length) {
				btn.textContent = `${items.length} found`;
				setStatus(host, `${items.length} crosspost${items.length === 1 ? '' : 's'} found.`, 'success');
			} else {
				btn.textContent = 'None found';
				setStatus(host, 'No crossposts found.', 'empty');
			}
		} catch (err) {
			btn.textContent = 'Retry';
			btn.disabled = false;
			setStatus(host, 'Could not load crossposts. Try again.', 'error');
		}
	};

	btn.addEventListener('click', trigger);
	if (module.options.autoLoad.value === true) {
		trigger();
	}
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	injectWidget();
};
