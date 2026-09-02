/* @flow */

import { Storage } from '../environment';
import { createRateLimiter } from './rateLimiter';
import { fetchRedditJson, isJsonObject } from './redditJson';

export type SubRule = {|
	kind: string,
	short_name: string,
	description: string,
	violation_reason: string,
|};

const limiter = createRateLimiter({ tokens: 3, refillMs: 2000, maxConcurrent: 2 });
const CACHE_KEY = 'RESmodules.subRulesInline.cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;

let cache: ?{ [string]: { rules: SubRule[], ts: number } } = null;

// A null-prototype map, because the key is a subreddit name taken from the page
// and `r/constructor` exists. On a plain object `c[subreddit]` would have found
// `Object.prototype.constructor` and treated it as a cache entry, then read
// `.ts` and `.rules` off a function.
async function loadCache(): Promise<{ [string]: { rules: SubRule[], ts: number } }> {
	if (cache) return cache;
	const raw = await Storage.get(CACHE_KEY);
	cache = Object.assign((Object.create(null): any), (raw && typeof raw === 'object') ? raw : {});
	return cache;
}

async function saveCache(): Promise<void> {
	if (cache) await Storage.set(CACHE_KEY, cache);
}

export function parseRulesResponse(json: mixed): SubRule[] {
	if (!json || typeof json !== 'object') return [];
	const data = (json: any);
	const rules = Array.isArray(data.rules) ? data.rules : Array.isArray(data) ? data : [];
	return rules.filter(
		r => r && typeof r.short_name === 'string',
	).map(r => ({
		kind: String(r.kind || 'all'),
		short_name: String(r.short_name || ''),
		description: String(r.description || ''),
		violation_reason: String(r.violation_reason || ''),
	}));
}

export function buildRulesUrl(subreddit: string): string {
	return `/r/${encodeURIComponent(subreddit)}/about/rules.json`;
}

export async function fetchRules(subreddit: string, onStatus?: (status: number) => mixed): Promise<SubRule[]> {
	const c = await loadCache();
	const entry = c[subreddit];
	if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry.rules;

	const rules = await limiter.schedule(async () => {
		const json = await fetchRedditJson(buildRulesUrl(subreddit), {
			onStatus,
			validate: isJsonObject,
		});
		return parseRulesResponse(json);
	});

	c[subreddit] = { rules, ts: Date.now() };
	saveCache().catch(() => {});
	return rules;
}

export function formatRulesHtml(rules: SubRule[], subreddit: string): string {
	if (!rules.length) return `<div class="rsm-subrules-empty">No rules found for r/${subreddit}</div>`;
	const items = rules.map((r, i) => {
		const desc = r.description ? `<div class="rsm-subrules-desc">${escapeForHtml(r.description)}</div>` : '';
		return `<li class="rsm-subrules-item"><strong>${i + 1}. ${escapeForHtml(r.short_name)}</strong>${desc}</li>`;
	}).join('');
	return `<div class="rsm-subrules-title">r/${escapeForHtml(subreddit)} rules</div><ul class="rsm-subrules-list">${items}</ul>`;
}

function escapeForHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
