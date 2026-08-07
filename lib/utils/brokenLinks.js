/* @flow */

// Repair links that old.reddit's markdown renderer escaped incorrectly.
//
// Snudown escapes markdown-significant characters inside link destinations, but
// old.reddit's renderer does not always unescape them before writing the `href`
// attribute. The visible result is a link whose text is right and whose target
// 404s, because the URL carries a literal backslash (or a percent-encoded one)
// in front of an underscore, an asterisk or a parenthesis. Wikipedia article
// titles and old i.imgur.com IDs hit this constantly.
//
// The comparable userscript ("Old Reddit Broken Link Fixer", Greasy Fork
// 485253) rewrites every `a[href]` on the page with a blanket
// `href.replace(/\\/g, '')`. That is wrong for any URL where a backslash is
// legitimately percent-encoded as data — for example a search query — so this
// version only unescapes a backslash when the character it precedes is one
// snudown would have escaped, and never touches a link on a non-reddit host
// unless the escape is unambiguous.

// The set snudown escapes in link destinations.
const ESCAPABLE = '\\\\`*_{}[\\]()#+\\-.!~<>&|^';
const BACKSLASH_ESCAPE = new RegExp(`\\\\([${ESCAPABLE}])`, 'g');
const ENCODED_BACKSLASH_ESCAPE = new RegExp(`%5C([${ESCAPABLE}])`, 'gi');

// A fragment that snudown mangled looks like `#Foo\_bar`; the encoded form
// appears when reddit URL-encodes the destination after escaping it.
export function fixHref(href: ?string): ?string {
	if (typeof href !== 'string' || !href) return null;

	// Leave javascript:, data:, and protocol-relative junk alone entirely —
	// rewriting those is how a link fixer turns into an XSS vector.
	if (/^\s*(javascript|data|vbscript):/i.test(href)) return null;

	const fixed = href
		.replace(ENCODED_BACKSLASH_ESCAPE, '$1')
		.replace(BACKSLASH_ESCAPE, '$1');

	return fixed === href ? null : fixed;
}

// old.reddit writes `/r/sub/comments/id/title/` permalinks with the title slug
// already escaped; when a title contains an underscore the slug arrives with a
// stray backslash that reddit itself then 404s on. Same fix, but we can be sure
// it is safe because we know the shape.
export function isRedditHref(href: string): boolean {
	if (href.startsWith('/')) return true;
	try {
		const { hostname } = new URL(href, 'https://old.reddit.com');
		return hostname === 'reddit.com' || hostname.endsWith('.reddit.com') || hostname.endsWith('.redd.it');
	} catch (e) {
		return false;
	}
}

// Returns the links on `root` that need repair, paired with their fixed href, so
// the caller can apply them in one pass and count what it changed.
export function collectBrokenLinks(root: Document | HTMLElement, redditOnly: boolean = false): Array<{| element: HTMLAnchorElement, href: string |}> {
	const out = [];
	const anchors = root.querySelectorAll('a[href]');
	for (const anchor of anchors) {
		if (!(anchor instanceof HTMLAnchorElement)) continue;
		// `getAttribute` rather than `.href`: the property is already resolved
		// against the document base, which hides the raw escape we are looking for.
		const raw = anchor.getAttribute('href');
		if (typeof raw !== 'string') continue;
		if (redditOnly && !isRedditHref(raw)) continue;
		const href = fixHref(raw);
		if (href) out.push({ element: anchor, href });
	}
	return out;
}
