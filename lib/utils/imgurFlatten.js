/* @flow */
// Pure helpers for the imgurFlatten module. Recognises imgur album / gallery
// URLs, rewrites them through a configurable rimgo-style mirror, and parses
// the simple "ids" embedded in album HTML so showImages can stitch them
// inline. Dependency-free for unit testing.

const ALBUM_RE = /^https?:\/\/(?:www\.|m\.)?imgur\.com\/(?:a|gallery)\/([a-zA-Z0-9]+)(?:[?#].*)?$/i;
// The previous default (rimgo.totaldarkness.net) went offline (502) and was
// dropped from the official instance list. ri.bcow.xyz is the maintainer's
// reference instance as of 2026-07; see rimgo.codeberg.page for alternates.
const DEFAULT_MIRROR = 'https://ri.bcow.xyz';

export function isImgurAlbumUrl(url: mixed): boolean {
	return typeof url === 'string' && ALBUM_RE.test(url);
}

export function extractAlbumId(url: mixed): string {
	if (typeof url !== 'string') return '';
	const m = ALBUM_RE.exec(url);
	return m ? m[1] : '';
}

export function sanitizeMirror(raw: mixed): string {
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MIRROR;
	let value = raw.trim();
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	return value.replace(/\/+$/, '');
}

export function rewriteAlbumUrl(url: string, mirror: string = DEFAULT_MIRROR): string {
	const id = extractAlbumId(url);
	if (!id) return url;
	const base = sanitizeMirror(mirror);
	return `${base}/a/${id}`;
}

export function rewriteImageUrl(url: string, mirror: string): string {
	if (typeof url !== 'string') return url;
	const base = sanitizeMirror(mirror);
	return url.replace(/^https?:\/\/i\.imgur\.com\//i, `${base}/`);
}
