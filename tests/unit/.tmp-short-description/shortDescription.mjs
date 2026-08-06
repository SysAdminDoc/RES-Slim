

// First-sentence extraction for the settings console module list.
//
// The console used to do `description.split(/[!?.]/)[0]`, which treats every
// full stop as a sentence end. RES-Slim descriptions are full of dots that are
// not sentence ends — old.reddit, i.redd.it, v.redd.it, utm_*, `out.` — so 17 of
// the 97 modules rendered a mangled summary in the sidebar: fixImageLinks read
// "Rewrites i", pageTheme read "Dark / OLED skin for old", outboundCleanser read
// "Strip Reddit's `out".
//
// A terminator only ends a sentence when the next non-space character starts a
// new one, which is what the lookahead below requires.

const SENTENCE_END = /^([\s\S]*?[.!?])(?=\s+["'“([]?[A-Z0-9])/;

export const DEFAULT_MAX_LENGTH = 120;

export function shortDescription(text, maxLength = DEFAULT_MAX_LENGTH) {
	const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
	if (!clean) return '';

	const match = clean.match(SENTENCE_END);
	let first = match ? match[1] : clean;

	if (first.length > maxLength) {
		const cut = first.slice(0, maxLength);
		const lastSpace = cut.lastIndexOf(' ');
		// Only honour the word boundary if it is not so early that the summary
		// loses its meaning; otherwise hard-cut rather than return two words.
		const trimmed = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
		first = `${trimmed.replace(/[\s,;:.]+$/, '')}…`;
	}

	return first;
}
