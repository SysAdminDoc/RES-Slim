/* @flow */

// What to call a permission when telling a reader one was refused.
//
// A host permission is a match pattern -- `https://web.archive.org/*`,
// `http://127.0.0.1/*` -- and echoing that at someone who has just clicked a
// switch tells them nothing they can act on. The host is the part that means
// something. A named permission is already an English word and is what the
// browser's own dialog showed them, so it is left alone.

function describeOne(permission: string): string {
	if (!permission.includes('://') && permission !== '<all_urls>') return permission;
	if (permission === '<all_urls>') return 'every site';
	// Match patterns are not valid URLs, because of the wildcard, so the host is
	// read out directly and an unusual pattern is left as it was written rather
	// than reported as something it is not.
	const match = /^[a-z*-]+:\/\/([^/]+)/i.exec(permission);
	if (!match) return permission;
	const host = match[1].replace(/^\*\./, '');
	return host === '*' ? 'every site' : host;
}

export function describeRequestedAccess(permissions: $ReadOnlyArray<string>): string {
	const described = [];
	for (const permission of permissions) {
		if (typeof permission !== 'string' || !permission) continue;
		const label = describeOne(permission);
		// `https://a.example/*` and `https://a.example/api/*` are one thing to a
		// reader, and reading the same host twice looks like a mistake.
		if (!described.includes(label)) described.push(label);
	}
	return described.join(', ');
}
