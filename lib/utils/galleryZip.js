/* @flow */
// Pure helpers for the galleryZip module. Extracts gallery image URLs from a
// reddit comments JSON payload, formats a captions.txt sidecar, and produces
// a safe filename. Dependency-free for unit testing.

export type GalleryItem = {|
	url: string,
	caption: string,
	mediaId: string,
	ext: string,
|};

function decodeAmpEntities(value: string): string {
	if (typeof value !== 'string') return '';
	return value.replace(/&amp;/g, '&');
}

function extFromMime(mime: string): string {
	if (typeof mime !== 'string') return 'jpg';
	const m = /image\/(\w+)/.exec(mime);
	if (!m) return 'jpg';
	const ext = m[1].toLowerCase();
	if (ext === 'jpeg') return 'jpg';
	return ext;
}

function extFromUrl(url: string): string {
	const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
	return m ? m[1].toLowerCase() : '';
}

export function parseGalleryFromJson(rawJson: mixed): GalleryItem[] {
	if (!Array.isArray(rawJson) || rawJson.length === 0) return [];
	const listing = rawJson[0];
	if (!listing || typeof listing !== 'object') return [];
	const data = (listing: any).data;
	if (!data || !Array.isArray(data.children) || data.children.length === 0) return [];
	const post = data.children[0];
	if (!post || typeof post !== 'object') return [];
	const k: any = (post: any).data;
	if (!k) return [];
	if (k.is_gallery !== true) return [];
	const meta = k.media_metadata || {};
	const galleryData = k.gallery_data;
	if (!galleryData || !Array.isArray(galleryData.items)) return [];
	const captions: GalleryItem[] = [];
	for (const item of galleryData.items) {
		if (!item || typeof item !== 'object') continue;
		const mediaId = typeof item.media_id === 'string' ? item.media_id : '';
		if (!mediaId) continue;
		const entry = meta[mediaId];
		if (!entry || typeof entry !== 'object') continue;
		const sUrl = entry.s && typeof entry.s.u === 'string' ? decodeAmpEntities(entry.s.u) : '';
		if (!sUrl) continue;
		const caption = typeof item.caption === 'string' ? item.caption : '';
		const mime = typeof entry.m === 'string' ? entry.m : '';
		const ext = extFromMime(mime) || extFromUrl(sUrl) || 'jpg';
		captions.push({ url: sUrl, caption, mediaId, ext });
	}
	return captions;
}

export function safeFilename(title: mixed, fallback: string = 'gallery'): string {
	const raw = typeof title === 'string' && title.trim() ? title : fallback;
	const trimmed = raw
		.replace(/[\x00-\x1f\x7f]/g, '')
		.replace(/[<>:"/\\|?*]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return trimmed || fallback;
}

export function paddedIndex(i: number, total: number): string {
	const digits = String(Math.max(total, 1)).length;
	return String(i + 1).padStart(digits, '0');
}

export function formatCaptionsText(items: $ReadOnlyArray<GalleryItem>): string {
	const lines: string[] = [];
	items.forEach((item, i) => {
		const idx = paddedIndex(i, items.length);
		lines.push(`${idx}.${item.ext}`);
		lines.push(`  URL:     ${item.url}`);
		lines.push(`  media:   ${item.mediaId}`);
		lines.push(`  caption: ${item.caption || '(none)'}`);
		lines.push('');
	});
	return lines.join('\n');
}
