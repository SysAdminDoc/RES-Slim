/* @flow */
// Pure helpers for the commentTreeExport module. Walks the reddit comments
// JSON listing and renders it as JSON / Markdown / HTML. Dependency-free for
// unit testing.

export type ExportComment = {|
	id: string,
	fullname: string,
	parentId: ?string,
	author: string,
	body: string,
	score: number,
	createdUtc: number,
	depth: number,
	permalink: string,
	distinguished: ?string,
	stickied: boolean,
	edited: boolean | number,
|};

export type ExportPost = {|
	id: string,
	fullname: string,
	subreddit: string,
	author: string,
	title: string,
	selftext: string,
	url: string,
	score: number,
	createdUtc: number,
	permalink: string,
|};

export type ExportTree = {|
	post: ?ExportPost,
	comments: ExportComment[],
	exportedAt: number,
	schemaVersion: number,
|};

function str(v: mixed): string { return typeof v === 'string' ? v : ''; }
function num(v: mixed): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function parsePostFromListing(raw: mixed): ?ExportPost {
	if (!Array.isArray(raw) || !raw.length) return null;
	const data = (raw[0] && (raw[0]: any).data && (raw[0]: any).data.children) || [];
	if (!Array.isArray(data) || !data.length) return null;
	const k = data[0] && (data[0]: any).data;
	if (!k) return null;
	return {
		id: str(k.id),
		fullname: str(k.name),
		subreddit: str(k.subreddit),
		author: str(k.author),
		title: str(k.title),
		selftext: str(k.selftext),
		url: str(k.url),
		score: num(k.score),
		createdUtc: num(k.created_utc),
		permalink: str(k.permalink),
	};
}

export function parseCommentsFromListing(raw: mixed): ExportComment[] {
	if (!Array.isArray(raw) || raw.length < 2) return [];
	const out: ExportComment[] = [];
	const root = (raw[1] && (raw[1]: any).data && (raw[1]: any).data.children) || [];
	walk(root, 0, null, out);
	return out;
}

function walk(children: mixed, depth: number, parentId: ?string, out: ExportComment[]): void {
	if (!Array.isArray(children)) return;
	for (const child of children) {
		if (!child || typeof child !== 'object') continue;
		const kind = (child: any).kind;
		const data = (child: any).data;
		if (kind !== 't1' || !data) continue;
		const entry: ExportComment = {
			id: str(data.id),
			fullname: str(data.name),
			parentId,
			author: str(data.author),
			body: str(data.body),
			score: num(data.score),
			createdUtc: num(data.created_utc),
			depth,
			permalink: str(data.permalink),
			distinguished: typeof data.distinguished === 'string' ? data.distinguished : null,
			stickied: data.stickied === true,
			edited: typeof data.edited === 'boolean' ? data.edited : num(data.edited),
		};
		out.push(entry);
		const replies = data.replies;
		if (replies && typeof replies === 'object') {
			const repChildren = (replies: any).data && (replies: any).data.children;
			walk(repChildren, depth + 1, entry.fullname, out);
		}
	}
}

export function buildTree(rawJson: mixed): ExportTree {
	return {
		post: parsePostFromListing(rawJson),
		comments: parseCommentsFromListing(rawJson),
		exportedAt: Date.now(),
		schemaVersion: 1,
	};
}

export function toJson(tree: ExportTree): string {
	return JSON.stringify(tree, null, 2);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function toMarkdown(tree: ExportTree): string {
	const lines: string[] = [];
	const post = tree.post;
	if (post) {
		lines.push(`# ${post.title}`);
		lines.push('');
		lines.push(`*Posted by u/${post.author} in r/${post.subreddit} · score ${post.score} · ${new Date(post.createdUtc * 1000).toISOString()}*`);
		lines.push('');
		if (post.url && post.url !== `https://www.reddit.com${post.permalink}`) {
			lines.push(`Link: ${post.url}`);
			lines.push('');
		}
		if (post.selftext) {
			lines.push(post.selftext);
			lines.push('');
		}
		lines.push('---');
		lines.push('');
	}
	for (const c of tree.comments) {
		const indent = '> '.repeat(c.depth + 1);
		const header = `**u/${c.author}** · ${c.score} pts · ${new Date(c.createdUtc * 1000).toISOString()}${c.distinguished ? ` · _${c.distinguished}_` : ''}${c.stickied ? ' · _stickied_' : ''}`;
		lines.push(`${indent}${header}`);
		const body = (c.body || '').split('\n').map(line => `${indent}${line}`).join('\n');
		lines.push(body);
		lines.push('');
	}
	return lines.join('\n');
}

export function toHtml(tree: ExportTree): string {
	const parts: string[] = [];
	parts.push('<!DOCTYPE html>');
	parts.push('<html lang="en"><head><meta charset="utf-8">');
	const title = tree.post ? escapeHtml(tree.post.title) : 'reddit thread';
	parts.push(`<title>${title}</title>`);
	parts.push('<style>body{font:14px/1.5 -apple-system,Helvetica Neue,Arial,sans-serif;background:#111418;color:#e5e7eb;max-width:860px;margin:24px auto;padding:0 16px;}h1{font-size:22px;margin:0 0 8px;}h1 a{color:#fff;text-decoration:none;}.meta{color:#9ca3af;font-size:12px;margin-bottom:18px;}.c{border-left:2px solid rgb(255 255 255 / 8%);padding:6px 0 6px 10px;margin:4px 0 4px var(--d, 0);} .c .h{color:#93c5fd;font-size:12px;margin-bottom:2px;} .body{white-space:pre-wrap;}</style>');
	parts.push('</head><body>');
	const post = tree.post;
	if (post) {
		parts.push(`<h1><a href="https://old.reddit.com${escapeHtml(post.permalink)}">${escapeHtml(post.title)}</a></h1>`);
		parts.push(`<div class="meta">u/${escapeHtml(post.author)} · r/${escapeHtml(post.subreddit)} · score ${post.score} · ${new Date(post.createdUtc * 1000).toISOString()}</div>`);
		if (post.selftext) parts.push(`<div class="body">${escapeHtml(post.selftext)}</div>`);
	}
	for (const c of tree.comments) {
		parts.push(`<div class="c" style="--d:${c.depth * 12}px"><div class="h">u/${escapeHtml(c.author)} · ${c.score} pts · ${new Date(c.createdUtc * 1000).toISOString()}${c.distinguished ? ` · <em>${escapeHtml(c.distinguished)}</em>` : ''}${c.stickied ? ' · <em>stickied</em>' : ''}</div><div class="body">${escapeHtml(c.body)}</div></div>`);
	}
	parts.push(`<footer class="meta">Exported ${new Date(tree.exportedAt).toISOString()} · schema v${tree.schemaVersion}</footer>`);
	parts.push('</body></html>');
	return parts.join('\n');
}
