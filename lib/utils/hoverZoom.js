/* @flow */
// Pure helpers for the hoverZoom module. Decides whether a given URL can be
// previewed inline (i.e. the URL itself is the image / video file). RedGifs
// and other host-side embed endpoints are deferred to the existing showImages
// pipeline; hoverZoom limits itself to direct-resource URLs to keep behaviour
// predictable and rate-friendly.

export type PreviewKind = 'image' | 'video' | 'none';

const IMAGE_RE = /\.(?:jpg|jpeg|png|gif|webp|bmp|svg|avif)(?:$|[?#])/i;
const VIDEO_RE = /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i;

export function classifyUrl(url: mixed): PreviewKind {
	if (typeof url !== 'string' || !url) return 'none';
	if (IMAGE_RE.test(url)) return 'image';
	if (VIDEO_RE.test(url)) return 'video';
	if (/imgur\.com\/[^/?#]+\.gifv/i.test(url)) return 'video';
	return 'none';
}

export function normalizePreviewUrl(url: string): string {
	if (typeof url !== 'string') return url;
	// imgur .gifv -> .mp4 so the <video> tag can load directly.
	return url.replace(/(imgur\.com\/[^/?#]+)\.gifv(\b|$)/i, '$1.mp4$2');
}

export function inferUrlFromAnchor(href: string, dataUrl: string): string {
	const candidates = [href, dataUrl];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && classifyUrl(candidate) !== 'none') {
			return normalizePreviewUrl(candidate);
		}
	}
	return '';
}

export type PopoverPosition = {| x: number, y: number, attach: 'left' | 'right' |};

export function placePopover(
	cursorX: number,
	cursorY: number,
	viewportWidth: number,
	viewportHeight: number,
	popoverWidth: number,
	popoverHeight: number,
	margin: number = 12,
): PopoverPosition {
	// Prefer right-of-cursor; flip to left if it would overflow the viewport.
	let x = cursorX + margin;
	let attach: 'left' | 'right' = 'right';
	if (x + popoverWidth + margin > viewportWidth) {
		x = cursorX - popoverWidth - margin;
		attach = 'left';
	}
	if (x < margin) x = margin;
	let y = cursorY - popoverHeight / 2;
	if (y < margin) y = margin;
	if (y + popoverHeight + margin > viewportHeight) {
		y = viewportHeight - popoverHeight - margin;
	}
	return { x, y, attach };
}
