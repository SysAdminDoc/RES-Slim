/* @flow */
// RES-Slim: on listing pages, expose a 'preview top comments' link on each
// post entry that fetches the post's top N comments via the .json endpoint
// and inlines them below the post. Cached per fullname for the session;
// outbound requests are rate-limited.

import { Module } from '../core/module';
import { watchForThings } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import { escapeHTML } from '../utils/html';
import DOMPurify from 'dompurify';

export const module: Module<*> = new Module('topCommentsPreview');

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
		description: 'Fetch when the mouse hovers the preview link. Defaults off — explicit click is friendlier on slow connections.',
	},
};

const limiter = createRateLimiter({ tokens: 4, refillMs: 1000, maxConcurrent: 4 });
const cache: Map<string, string> = new Map();

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
		});
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
		const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!response.ok) throw new Error(`status ${response.status}`);
		const json = await response.json();
		return buildPreviewHtml(json, count);
	});
	cache.set(cacheKey, html);
	return html;
}

function ensureTrigger(thing: Element) {
	if (thing.querySelector(':scope > .entry .rsm-tcp-link')) return;
	const buttons = thing.querySelector(':scope > .entry .buttons.flat-list, :scope > .entry ul.flat-list');
	if (!(buttons instanceof HTMLElement)) return;
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = 'rsm-tcp-link';
	a.textContent = 'preview top';
	a.dataset.permalink = thing.getAttribute('data-permalink') || '';
	li.append(a);
	buttons.append(li);

	const trigger = async (e: Event) => {
		e.preventDefault();
		if (!a.dataset.permalink) return;
		if (thing.querySelector(':scope > .entry .rsm-tcp-host')) return;
		a.textContent = 'loading…';
		try {
			const html = await fetchPreview(a.dataset.permalink, previewCount());
			const host = document.createElement('div');
			host.className = 'rsm-tcp-host';
			host.innerHTML = html;
			thing.querySelector(':scope > .entry')?.append(host);
			a.textContent = 'preview top';
		} catch (err) {
			a.textContent = 'preview failed';
		}
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
