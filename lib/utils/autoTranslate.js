/* @flow */

// Strip reddit's machine-translation parameter.
//
// Reddit began appending `?tl=<lang>` to links served to users whose browser
// locale is not English, which replaces the post and comment text with a machine
// translation and gives no in-page way back. The parameter survives navigation
// because every link on a translated page is rendered carrying it, so removing
// it once is not enough — the links have to be cleaned too.

export const TRANSLATION_PARAMS: string[] = ['tl'];

export function hasTranslationParam(url: string): boolean {
	try {
		const parsed = new URL(url, 'https://old.reddit.com');
		return TRANSLATION_PARAMS.some(p => parsed.searchParams.has(p));
	} catch (e) {
		return false;
	}
}

// Returns the cleaned URL, or null when there was nothing to clean. Null rather
// than the unchanged string so callers can skip the DOM write entirely.
export function stripTranslationParams(url: ?string): ?string {
	if (typeof url !== 'string' || !url) return null;

	let parsed;
	try {
		parsed = new URL(url, 'https://old.reddit.com');
	} catch (e) {
		return null;
	}

	let changed = false;
	for (const param of TRANSLATION_PARAMS) {
		if (parsed.searchParams.has(param)) {
			parsed.searchParams.delete(param);
			changed = true;
		}
	}
	if (!changed) return null;

	const search = parsed.searchParams.toString();
	if (/^https?:/i.test(url)) {
		parsed.search = search;
		return parsed.toString();
	}
	return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`;
}
