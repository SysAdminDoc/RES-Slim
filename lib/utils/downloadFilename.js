/* @flow */

// Filenames for media the user asks to download.
//
// The expando's download control used to build one inline, and got four things
// wrong that an ordinary post title triggers:
//
//   * the extension came from a regex over the *whole* URL, so a link with no
//     file extension matched the empty alternative and yielded `undefined`,
//     which then threw on `.includes('?')` and turned the download into a
//     "download failed" toast instead of an unnamed-but-working save;
//   * a query string with a dot in it (`?v=1.2`) was read as the extension;
//   * emoji and reserved characters were stripped *after* the title was tested
//     for truthiness, so an emoji-only title reduced to the empty string and
//     produced a dotfile named `.jpg`, and a 300-character title produced a name
//     no filesystem accepts;
//   * the inherited strip range ran from U+2000 to U+3300, which deletes CJK
//     punctuation and half of Japanese typography along with the emoji it was
//     aiming at. A Japanese title came out shredded.
//
// Kept here, and exported, so each rule is executable rather than inferred from
// the source of a click handler.

const RESERVED_CHARS = `<>:"|?*/${String.fromCharCode(92)}`;

// Only what actually breaks a filename or makes it unusable from a shell.
// Letters in any script are left alone.
function isDisallowed(codePoint: number): boolean {
	if (codePoint < 0x20 || codePoint === 0x7f) return true; // control characters
	if (codePoint === 0xa9 || codePoint === 0xae) return true; // (c) (r)
	if (codePoint === 0x200d || codePoint === 0xfe0f) return true; // ZWJ, emoji variation selector
	if (codePoint >= 0x2190 && codePoint <= 0x27bf) return true; // arrows, misc symbols, dingbats
	if (codePoint >= 0x2b00 && codePoint <= 0x2bff) return true; // misc symbols and arrows
	if (codePoint >= 0x1f000 && codePoint <= 0x1faff) return true; // emoji and pictographs
	return RESERVED_CHARS.includes(String.fromCodePoint(codePoint));
}

// 255 bytes is the common filesystem ceiling. Leave room for an extension and
// for the " (1)" a browser appends when the name is already taken.
const MAX_STEM = 180;

export const DEFAULT_STEM = 'reddit-download';

// The extension belongs to the path, never to the query. `preview.redd.it`
// signs its URLs, so `.jpg?auto=webp&s=...` is the normal case and reading the
// whole URL gets it wrong.
export function extensionFor(url: ?string): ?string {
	if (typeof url !== 'string' || !url) return null;
	let pathname;
	try {
		pathname = new URL(url, 'https://reddit.com').pathname;
	} catch (e) {
		return null;
	}
	const base = pathname.split('/').pop() || '';
	const match = (/\.([A-Za-z0-9]{1,8})$/).exec(base);
	return match ? match[1] : null;
}

// The last path segment, cleaned up enough to be a filename.
export function basenameFor(url: ?string): string {
	if (typeof url !== 'string' || !url) return DEFAULT_STEM;
	let pathname;
	try {
		pathname = new URL(url, 'https://reddit.com').pathname;
	} catch (e) {
		return DEFAULT_STEM;
	}
	// `new URL()` percent-encodes the path, so a segment that reads `file name.jpg`
	// on the page arrives as `file%20name.jpg`. Sanitizing that directly turns the
	// `%` into an underscore and leaves `file_20name.jpg` in the downloads list.
	let segment = pathname.split('/').filter(Boolean).pop() || '';
	try {
		segment = decodeURIComponent(segment);
	} catch (e) {
		// A malformed escape sequence is not worth failing a download over.
	}
	const base = segment.replace(/[^\w.-]/g, '_');
	// A name that is nothing but dots (`.`, `..`) is a directory reference, not a
	// file, and an empty one is no name at all.
	return (/[^.]/).test(base) ? base : DEFAULT_STEM;
}

// Turn a post title into a filename stem, or return null when nothing usable
// survives. Callers fall back to the URL rather than writing a dotfile.
export function stemFromTitle(title: ?string): ?string {
	if (typeof title !== 'string') return null;

	let cleaned = '';
	for (const character of title) {
		const codePoint = character.codePointAt(0);
		if (typeof codePoint === 'number' && isDisallowed(codePoint)) continue;
		cleaned += character;
	}

	cleaned = cleaned
		// Windows silently drops a trailing dot, which turns `report..jpg` into
		// something the user did not ask for.
		.replace(/\.+/g, '.')
		.replace(/\s+/g, ' ')
		.replace(/^[.\s]+/, '')
		.slice(0, MAX_STEM)
		.replace(/[.\s]+$/, '');

	return cleaned ? cleaned : null;
}

// The whole rule in one call: prefer the post title, fall back to the URL's own
// basename, and only append an extension when the URL actually has one.
export function downloadFilename(title: ?string, url: ?string): string {
	const extension = extensionFor(url);
	const stem = stemFromTitle(title);
	if (!stem) return basenameFor(url);
	return extension ? `${stem}.${extension}` : stem;
}
