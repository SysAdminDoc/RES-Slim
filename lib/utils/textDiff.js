/* @flow */
// Pure word-level diff for the editedCommentDiff module. Produces a token diff
// (LCS-based) between an archived comment body and the current one, and renders
// it as escaped <ins>/<del> HTML. Dependency-free for unit testing.

const MAX_TOKENS = 4000;

export type DiffSegment = {| type: 'equal' | 'ins' | 'del', value: string |};

export function tokenize(text: mixed): Array<string> {
	return String(text == null ? '' : text).split(/(\s+)/).filter(t => t !== '');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// LCS word diff. Falls back to a coarse whole-body del+ins past a size cap so a
// huge pair can't drive the O(n*m) table into pathological memory/time.
export function diffTokens(oldText: mixed, newText: mixed): Array<DiffSegment> {
	const a = tokenize(oldText);
	const b = tokenize(newText);
	const segs: Array<DiffSegment> = [];
	const push = (type, value) => {
		const last = segs[segs.length - 1];
		if (last && last.type === type) last.value += value;
		else segs.push({ type, value });
	};

	if (a.length + b.length > MAX_TOKENS) {
		const oldStr = String(oldText == null ? '' : oldText);
		const newStr = String(newText == null ? '' : newText);
		if (oldStr) push('del', oldStr);
		if (newStr) push('ins', newStr);
		return segs;
	}

	const n = a.length;
	const m = b.length;
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push('equal', a[i]); i++; j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push('del', a[i]); i++;
		} else {
			push('ins', b[j]); j++;
		}
	}
	while (i < n) { push('del', a[i]); i++; }
	while (j < m) { push('ins', b[j]); j++; }
	return segs;
}

export function hasChanges(segments: $ReadOnlyArray<DiffSegment>): boolean {
	return segments.some(s => s.type !== 'equal');
}

export function renderDiffHtml(segments: $ReadOnlyArray<DiffSegment>): string {
	return segments.map(seg => {
		const v = escapeHtml(seg.value);
		if (seg.type === 'ins') return `<ins class="rsm-diff-ins">${v}</ins>`;
		if (seg.type === 'del') return `<del class="rsm-diff-del">${v}</del>`;
		return v;
	}).join('');
}
