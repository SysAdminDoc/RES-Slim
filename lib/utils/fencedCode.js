/* @flow */
// Pure helpers for the fencedCodeBlocks module. old.reddit's markdown (snudown)
// has no triple-backtick fenced-code support, so ```lang … ``` blocks render as
// literal text. These helpers detect a comment/selftext block that is entirely a
// single fenced block and rebuild it as a real <pre><code>, with an optional,
// dependency-free syntax tokenizer. Dependency-free for unit testing.

const MAX_HIGHLIGHT_CHARS = 20000;

const KEYWORDS = new Set([
	'const', 'let', 'var', 'function', 'return', 'if', 'else', 'elif', 'for', 'while',
	'import', 'from', 'export', 'default', 'class', 'def', 'end', 'null', 'none', 'true',
	'false', 'new', 'await', 'async', 'try', 'catch', 'except', 'finally', 'throw', 'raise',
	'in', 'of', 'not', 'and', 'or', 'with', 'as', 'lambda', 'yield', 'public', 'private',
	'static', 'void', 'int', 'string', 'bool', 'float', 'switch', 'case', 'break', 'continue',
]);

export function escapeHtml(value: mixed): string {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// A block is "single-fenced" when, after trimming, it opens with ``` (optionally
// followed by a language token) and closes with ``` on its own, with nothing
// meaningful outside the fence. Returns { lang, code } or null.
export function parseSingleFence(text: mixed): ?{| lang: string, code: string |} {
	if (typeof text !== 'string') return null;
	const trimmed = text.replace(/\r\n/g, '\n').trim();
	const match = /^```([^\n`]*)\n([\s\S]*?)\n?```$/.exec(trimmed);
	if (!match) return null;
	const lang = match[1].trim().toLowerCase().replace(/[^\w+#.-]/g, '');
	return { lang, code: match[2] };
}

export function hasFencePair(text: mixed): boolean {
	return typeof text === 'string' && /```[^\n`]*\n[\s\S]*?```/.test(text.replace(/\r\n/g, '\n'));
}

// Language-agnostic mini tokenizer. Wraps comments, strings, numbers, and a small
// keyword set in classed spans; escapes everything (matched or gap) so the output
// is always safe to insert. Falls back to a plain escape past a size cap.
export function tokenizeToHtml(code: mixed): string {
	const src = String(code == null ? '' : code);
	if (src.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(src);

	const pattern = /(\/\/[^\n]*|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
	let out = '';
	let last = 0;
	let m;
	while ((m = pattern.exec(src))) {
		if (m.index > last) out += escapeHtml(src.slice(last, m.index));
		const [whole, comment, str, num, word] = m;
		if (comment != null) out += `<span class="rsm-tok-comment">${escapeHtml(comment)}</span>`;
		else if (str != null) out += `<span class="rsm-tok-string">${escapeHtml(str)}</span>`;
		else if (num != null) out += `<span class="rsm-tok-number">${escapeHtml(num)}</span>`;
		else if (word != null && KEYWORDS.has(word.toLowerCase())) out += `<span class="rsm-tok-keyword">${escapeHtml(word)}</span>`;
		else out += escapeHtml(whole);
		last = m.index + whole.length;
	}
	if (last < src.length) out += escapeHtml(src.slice(last));
	return out;
}

export function buildCodeBlockHtml(lang: string, code: string, highlight: boolean): string {
	const body = highlight ? tokenizeToHtml(code) : escapeHtml(code);
	const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
	const langLabel = lang ? `<span class="rsm-fenced-lang">${escapeHtml(lang)}</span>` : '';
	const codeClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
	return `<pre class="rsm-fenced"${langAttr}>${langLabel}<code${codeClass}>${body}</code></pre>`;
}

// Split markdown into alternating prose and fenced-code segments, in order.
//
// `snudown-js` is built without `MKDEXT_FENCED_CODE`, so it renders a
// triple-backtick block as `<p><code>` rather than `<pre><code>` — meaning the
// comment preview and the posted page disagreed about the one construct
// `fencedCodeBlocks` exists for. Upstream reddit/snudown turned that flag on in
// 2025; until `snudown-js` picks it up, the fences are pulled out here, rendered
// by the same builder the page uses, and the prose around them is left to
// snudown untouched.
//
// Unterminated fences are deliberately returned as prose: a half-typed block in
// a live preview must not swallow the rest of the comment.
export type MarkdownSegment = {| type: 'text' | 'fence', lang: string, content: string |};

export function splitFences(text: mixed): MarkdownSegment[] {
	if (typeof text !== 'string' || !text) return [];
	const source = text.replace(/\r\n/g, '\n');
	const pattern = /(^|\n)```([^\n`]*)\n([\s\S]*?)\n?```(?=\n|$)/g;
	const segments = [];
	let last = 0;
	let match = pattern.exec(source);
	while (match) {
		const start = match.index + match[1].length;
		if (start > last) segments.push({ type: 'text', lang: '', content: source.slice(last, start) });
		segments.push({
			type: 'fence',
			lang: match[2].trim().toLowerCase().replace(/[^\w+#.-]/g, ''),
			content: match[3],
		});
		last = match.index + match[0].length;
		match = pattern.exec(source);
	}
	if (last < source.length) segments.push({ type: 'text', lang: '', content: source.slice(last) });
	return segments;
}
