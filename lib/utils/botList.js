/* @flow */
// Pure helpers for the botCollapse module. Manages the curated list of bot
// usernames and the matching predicate. Dependency-free so it's testable
// without the extension runtime.

export const DEFAULT_BOTS: $ReadOnlyArray<string> = Object.freeze([
	'AutoModerator',
	'RemindMeBot',
	'WikiTextBot',
	'sneakpeekbot',
	'savevideo',
	'savevideobot',
	'SaveVideo',
	'stabbot',
	'SnapshillBot',
	'image_linker_bot',
	'TweetPoster',
	'RepostCheckerBot',
	'RepostSleuthBot',
	'B0tRank',
	'GoodBot_BadBot',
	'transcribersofreddit',
	'TheStupidNetBot',
	'YouTubeFollower',
	'PriceBot',
	'cheers_robot',
]);

export function normalizeBotName(input: mixed): string {
	if (typeof input !== 'string') return '';
	return input.trim().toLowerCase();
}

// Parses a JSON array string OR a comma-separated string. Both are accepted so
// the option editor can be edited by non-JSON users.
export function parseBotList(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	const trimmed = raw.trim();
	// Try JSON first; if that fails, fall back to a comma-separated list.
	let arr: mixed = null;
	if (trimmed.startsWith('[')) {
		try { arr = JSON.parse(trimmed); } catch (e) { arr = null; }
	}
	if (!Array.isArray(arr)) {
		arr = trimmed.split(/[,\s\n]+/);
	}
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const item of (arr: any[])) {
		const norm = normalizeBotName(item);
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

export function isBot(username: ?string, list: $ReadOnlyArray<string>): boolean {
	if (!username) return false;
	const norm = normalizeBotName(username);
	if (!norm) return false;
	for (const b of list) {
		if (b === norm) return true;
	}
	return false;
}

// AutoMod-sticky detection — comments that are explicitly stickied by mods
// AND authored by AutoModerator. Used to attribute mod automation visibly.
export function isAutoModSticky(authorName: ?string, isStickied: boolean): boolean {
	return isStickied && normalizeBotName(authorName) === 'automoderator';
}
