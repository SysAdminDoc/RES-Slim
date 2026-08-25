/* @flow */
// RES-Slim: on listing pages, expose a 'preview top comments' link on each
// post entry that fetches the post's top N comments via the .json endpoint
// and inlines them below the post. Cached per fullname for the session;
// outbound requests are rate-limited.

import DOMPurify from 'dompurify';
import { Module } from '../core/module';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { watchForThings } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import { fetchRedditJson, isRedditListingPair } from '../utils/redditJson';
import { escapeHTML } from '../utils/html';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<{ [string]: any }> = new Module('topCommentsPreview');

module.moduleName = 'Top-comments preview';
module.category = 'commentsCategory';
module.description = 'Add a "preview top comments" link to each post in listings. Fetches the top N comments inline. Cached + rate-limited.';
module.descriptionRaw = true;
module.include = ['linklist', 'profile'];
module.keywords = ['comment', 'preview', 'top', 'inline', 'listing'];

module.options = {
	count: {
		type: 'text',
		value: '3',
		title: 'How many top comments',
		description: 'Number of top-sorted comments to fetch per post. Capped at 10.',
	},
	autoOnHover: {
		type: 'boolean',
		value: false,
		title: 'Auto-load on hover',
		description: 'Fetch when the mouse hovers the preview link. Defaults off. An explicit click is friendlier on slow connections.',
	},
};

const limiter = createRateLimiter({ tokens: 4, refillMs: 1000, maxConcurrent: 4 });
const cache: Map<string, string> = new Map();
const LINK_CLASS = 'rsm-tcp-link';
const HOST_CLASS = 'rsm-tcp-host';
const CONTENT_CLASS = 'rsm-tcp-content';
let hostSeq = 0;

function previewCount(): number {
	const raw = Number(module.options.count.value);
	if (!Number.isFinite(raw) || raw <= 0) return 3;
	return Math.min(10, Math.floor(raw));
}

function safeCommentBodyHtml(comment: { body?: string, body_html?: string }): string {
	const html = typeof comment.body_html === 'string' && comment.body_html ?
		comment.body_html :
		`<div class="md"><p>${escapeHTML(comment.body || '')}</p></div>`;
	return DOMPurify.sanitize(html);
}

function buildPreviewHtml(json: any, count: number): string {
	try {
		const listing = json[1] && json[1].data && json[1].data.children;
		if (!Array.isArray(listing)) return '';
		const items = listing.slice(0, count).map(child => {
			const c = child && child.data;
			if (!c) return '';
			const author = escapeHTML(c.author || '[deleted]');
			const body = safeCommentBodyHtml(c);
			const score = typeof c.score === 'number' ? c.score : '?';
			return `<li class="rsm-tcp-comment"><span class="rsm-tcp-meta">${author} · ${score} pts</span><div class="rsm-tcp-body">${body}</div></li>`;
		}).filter(Boolean);
		if (!items.length) return '';
		return `<ul class="rsm-tcp-list">${items.join('')}</ul>`;
	} catch (e) {
		return '';
	}
}

async function fetchPreview(permalink: string, count: number): Promise<string> {
	const cacheKey = `${permalink}::${count}`;
	const cached = cache.get(cacheKey);
	if (cached !== undefined) return cached;
	const url = `${permalink.replace(/\/$/, '')}.json?raw_json=1&sort=top&depth=1&limit=${count}`;
	const html = await limiter.schedule(async () => {
		const json = await fetchRedditJson(url, {
			onStatus: notifyRedditApiBlocked,
			validate: isRedditListingPair,
		});
		return buildPreviewHtml(json, count);
	});
	cache.set(cacheKey, html);
	return html;
}

function makeHostId(thing: Element): string {
	const raw = thing.getAttribute('data-fullname') || String(++hostSeq);
	return `rsm-tcp-${raw.replace(/[^a-z0-9_-]/gi, '-')}`;
}

function createPreviewHost(id: string): HTMLElement {
	const host = document.createElement('section');
	host.id = id;
	host.className = HOST_CLASS;
	host.setAttribute('role', 'region');
	host.setAttribute('aria-label', 'Top comments preview');

	const header = document.createElement('div');
	header.className = 'rsm-tcp-header';
	const title = document.createElement('span');
	title.className = 'rsm-tcp-title';
	title.textContent = 'Top comments';
	header.append(title);

	const content = document.createElement('div');
	content.className = CONTENT_CLASS;
	host.append(header, content);
	return host;
}

function setHostState(host: HTMLElement, state: 'loading' | 'ready' | 'empty' | 'error', html?: string): void {
	host.dataset.state = state;
	host.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
	const content = host.querySelector(`:scope > .${CONTENT_CLASS}`);
	if (!(content instanceof HTMLElement)) return;
	content.className = `${CONTENT_CLASS} ${CONTENT_CLASS}--${state}`;
	if (state === 'loading') {
		content.setAttribute('role', 'status');
		content.textContent = 'Loading top comments…';
		return;
	}
	if (state === 'error') {
		content.setAttribute('role', 'alert');
		content.textContent = 'Could not load top comments. Try again.';
		return;
	}
	if (state === 'empty') {
		content.setAttribute('role', 'status');
		content.textContent = 'No top comments are available yet.';
		return;
	}
	content.removeAttribute('role');
	setTrustedHTML(content, html || '');
}

function ensureTrigger(thing: Element) {
	if (thing.querySelector(`:scope > .entry .${LINK_CLASS}`)) return;
	const buttons = thing.querySelector(':scope > .entry .buttons.flat-list, :scope > .entry ul.flat-list');
	if (!(buttons instanceof HTMLElement)) return;
	const hostId = makeHostId(thing);
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = LINK_CLASS;
	a.textContent = 'Top comments';
	a.dataset.permalink = thing.getAttribute('data-permalink') || '';
	a.setAttribute('role', 'button');
	a.setAttribute('aria-expanded', 'false');
	a.setAttribute('aria-controls', hostId);
	a.setAttribute('aria-busy', 'false');
	li.append(a);
	buttons.append(li);

	const trigger = async (e: Event) => {
		e.preventDefault();
		if (!a.dataset.permalink) return;
		const existing = thing.querySelector(`:scope > .entry .${HOST_CLASS}`);
		if (existing instanceof HTMLElement) {
			const expand = existing.hidden;
			existing.hidden = !expand;
			a.setAttribute('aria-expanded', expand ? 'true' : 'false');
			return;
		}
		if (a.getAttribute('aria-busy') === 'true') return;
		a.setAttribute('aria-busy', 'true');
		a.setAttribute('aria-expanded', 'true');
		const host = createPreviewHost(hostId);
		setHostState(host, 'loading');
		thing.querySelector(':scope > .entry')?.append(host);
		try {
			const html = await fetchPreview(a.dataset.permalink, previewCount());
			setHostState(host, html ? 'ready' : 'empty', html);
		} catch (err) {
			setHostState(host, 'error');
		}
		a.setAttribute('aria-busy', 'false');
	};

	a.addEventListener('click', trigger, false);
	if (module.options.autoOnHover.value) {
		a.addEventListener('mouseover', trigger, { once: true });
	}
}

module.contentStart = () => {
	watchForThings(['post'], thing => {
		const el = thing.element;
		if (el instanceof Element) ensureTrigger(el);
	});
};
