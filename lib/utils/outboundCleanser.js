/* @flow */
// Pure helpers used by the outboundCleanser module. Kept dependency-free so they
// can be unit-tested without the extension runtime.

export const OUTBOUND_HOST = 'out.reddit.com';

export const TRACKING_PARAMS: $ReadOnlyArray<string> = Object.freeze([
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_content',
	'utm_term',
	'utm_name',
	'ref',
	'ref_source',
	'ref_campaign',
	'ref_medium',
	'$deep_link',
	'$3p',
	'$original_url',
	'correlation_id',
	'share_id',
]);

export function cleanseUrl(rawHref: string, base: string = 'https://old.reddit.com/'): string | null {
	if (!rawHref) return null;
	let parsed;
	try {
		parsed = new URL(rawHref, base);
	} catch (e) {
		return null;
	}

	let changed = false;

	if (parsed.hostname === OUTBOUND_HOST) {
		const target = parsed.searchParams.get('url');
		if (target) {
			try {
				parsed = new URL(target, base);
				changed = true;
			} catch (e) {
				return null;
			}
		}
	}

	for (const param of TRACKING_PARAMS) {
		if (parsed.searchParams.has(param)) {
			parsed.searchParams.delete(param);
			changed = true;
		}
	}

	return changed ? parsed.toString() : null;
}
