/* @flow */

// Build the `dest` value reddit redirects to after a successful login.
//
// `dest` is an open redirect if it is allowed to name a host: reddit will send
// the browser wherever it points once the credentials are in. So this never
// accepts a full URL, only a same-site path, and it rejects the shapes that look
// same-site to a naive check — a protocol-relative //host, a backslash-prefixed
// path that several browsers normalise to the same thing, and anything carrying
// a control character.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

// Written as a code point so the literal cannot be mangled by an editor or a
// shell heredoc, which is how the first version of this file shipped broken.
const BACKSLASH = 92;

export function safeDest(pathname: ?string, search: ?string, includeQuery: boolean): string {
	const raw = typeof pathname === 'string' ? pathname : '';
	if (!raw.startsWith('/')) return '/';
	if (raw.startsWith('//')) return '/';
	if (raw.charCodeAt(1) === BACKSLASH) return '/';
	if (CONTROL_CHARACTERS.test(raw)) return '/';

	if (!includeQuery) return raw;
	const query = typeof search === 'string' ? search : '';
	if (!query) return raw;
	if (CONTROL_CHARACTERS.test(query)) return raw;
	return `${raw}${query.startsWith('?') ? query : `?${query}`}`;
}
