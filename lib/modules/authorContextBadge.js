/* @flow */
// RES-Slim: inline author-context badge. After every .author anchor, render
// a small `[2y · 12k]` chip showing account age and total karma. Uses
// /user/<u>/about.json behind a dedicated 1/s rate limiter; cached per
// username via Storage.wrapBlob with a configurable TTL.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { Storage } from '../environment';
import { createRateLimiter } from '../utils/rateLimiter';
import { notifyRedditApiBlocked } from './notifications';
import {
	ageRiskClass,
	formatBadge,
	isFresh,
	parseAuthorAbout,
} from '../utils/authorContext';
import type { AuthorAbout } from '../utils/authorContext';

export const module: Module<*> = new Module('authorContextBadge');

module.moduleName = 'Author context badge';
module.category = 'usersCategory';
module.description = 'Inline `[age · karma]` chip after every .author link. Fetches /user/<u>/about.json behind a rate limiter; cached locally with a configurable TTL (default 24h).';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['author', 'age', 'karma', 'badge', 'context', 'rager'];

module.options = {
	showAge: {
		type: 'boolean',
		value: true,
		title: 'Show account age',
		description: 'Render the account age in the badge (e.g. "2y3mo").',
	},
	showKarma: {
		type: 'boolean',
		value: true,
		title: 'Show karma',
		description: 'Render total karma in the badge (e.g. "12.4k").',
	},
	colorByAge: {
		type: 'boolean',
		value: false,
		title: 'Colour by age risk',
		description: 'Tint badges red for accounts younger than 30 days, amber under 180 days.',
	},
	cacheHours: {
		type: 'text',
		value: '24',
		title: 'Cache TTL (hours)',
		description: 'How long to trust a cached /user/<u>/about.json response before re-fetching. Default 24.',
	},
	skipDeleted: {
		type: 'boolean',
		value: true,
		title: 'Skip [deleted]/[removed]',
		description: 'Suppress badge rendering on deleted/removed authors.',
	},
};

const BADGE_CLASS = 'rsm-authorBadge';

const limiter = createRateLimiter({ tokens: 5, refillMs: 1000, maxConcurrent: 2 });
const store = Storage.wrapBlob('RESmodules.authorContextBadge.cache', (): AuthorAbout | null => null);

// In-memory cache so repeat authors in a single page don't all wait on Storage.
const memCache: Map<string, AuthorAbout> = new Map();
// Username -> Set of badge host elements awaiting a value.
const pendingHosts: Map<string, Set<HTMLElement>> = new Map();
// Usernames currently being fetched (avoid duplicate inflight requests).
const inflight: Set<string> = new Set();

function cacheTtlMs(): number {
	const hours = Number(module.options.cacheHours.value);
	if (!Number.isFinite(hours) || hours <= 0) return 24 * 3600_000;
	return hours * 3600_000;
}

function isDeletedAuthor(name: string): boolean {
	const n = name.toLowerCase();
	return n === '[deleted]' || n === '[removed]';
}

function trackHost(username: string, host: HTMLElement): void {
	let set = pendingHosts.get(username);
	if (!set) {
		set = new Set();
		pendingHosts.set(username, set);
	}
	set.add(host);
}

function applyBadge(host: HTMLElement, about: ?AuthorAbout): void {
	const showAge = module.options.showAge.value !== false;
	const showKarma = module.options.showKarma.value !== false;
	const colorByAge = module.options.colorByAge.value === true;
	if (!about) {
		host.textContent = '?';
		host.removeAttribute('data-rsm-risk');
		host.title = 'Author lookup failed';
		return;
	}
	host.textContent = formatBadge(about, { showAge, showKarma });
	host.title = `u/${about.username} · ${about.linkKarma} link · ${about.commentKarma} comment`;
	if (colorByAge) host.setAttribute('data-rsm-risk', ageRiskClass(about.createdUtc));
	else host.removeAttribute('data-rsm-risk');
}

async function resolveAuthor(username: string): Promise<?AuthorAbout> {
	const cached = memCache.get(username);
	if (cached && isFresh(cached, cacheTtlMs())) return cached;
	try {
		const stored = await store.getNullable(username);
		if (stored && isFresh(stored, cacheTtlMs())) {
			memCache.set(username, stored);
			return stored;
		}
	} catch (e) { /* storage unavailable in tests */ }

	if (inflight.has(username)) {
		// Another caller is already fetching. The resolution will broadcast.
		return null;
	}
	inflight.add(username);

	try {
		const about = await limiter.schedule(async () => {
			const url = `https://old.reddit.com/user/${encodeURIComponent(username)}/about.json?raw_json=1`;
			const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
			if (!res.ok) { notifyRedditApiBlocked(res.status); throw new Error(`status ${res.status}`); }
			const json = await res.json();
			return parseAuthorAbout(json);
		});
		if (about) {
			memCache.set(username, about);
			try { await store.set(username, about); } catch (e) { /* storage unavailable */ }
		}
		return about;
	} catch (e) {
		return null;
	} finally {
		inflight.delete(username);
	}
}

async function flushHosts(username: string, about: ?AuthorAbout): Promise<void> {
	const set = pendingHosts.get(username);
	if (!set) return;
	pendingHosts.delete(username);
	for (const host of set) {
		if (!host.isConnected) continue;
		applyBadge(host, about);
	}
}

function ensureBadge(authorEl: HTMLAnchorElement, username: string): void {
	const parent = authorEl.parentNode;
	if (!(parent instanceof HTMLElement)) return;
	let badge = parent.querySelector(`:scope > .${BADGE_CLASS}[data-user="${cssEscape(username)}"]`);
	if (!(badge instanceof HTMLElement)) {
		badge = document.createElement('span');
		badge.className = BADGE_CLASS;
		badge.setAttribute('data-user', username);
		badge.textContent = '…';
		authorEl.after(badge);
	}
	const host: HTMLElement = (badge: any);
	const cached = memCache.get(username);
	if (cached && isFresh(cached, cacheTtlMs())) {
		applyBadge(host, cached);
		return;
	}
	trackHost(username, host);
	resolveAuthor(username).then(about => { flushHosts(username, about); });
}

function cssEscape(value: string): string {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
	return value.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);
}

function processThing(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const anchors = el.querySelectorAll('a.author');
	const skipDeleted = module.options.skipDeleted.value !== false;
	for (let i = 0; i < anchors.length; i++) {
		const a = anchors[i];
		if (!(a instanceof HTMLAnchorElement)) continue;
		const name = (a.textContent || '').trim();
		if (!name) continue;
		if (skipDeleted && isDeletedAuthor(name)) continue;
		ensureBadge(a, name);
	}
}

module.contentStart = () => {
	watchForThings(['post', 'comment'], processThing);
};
