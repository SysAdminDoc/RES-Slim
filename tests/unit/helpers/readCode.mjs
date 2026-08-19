import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// Source with its comments blanked, for contracts that assert a construct is
// *absent*.
//
// Every one of those has to read the code and not the prose about it, because the
// file explaining why something was removed necessarily names the thing it
// removed. That has produced a false failure on a correct file five times now —
// `aria-modal` in overlayViewer, the retired Transifex mappings, the removed
// `AIza` keys, `skipAutoCreate`, and a comment saying `sameColor` replaced
// tinycolor2 — so it lives here once rather than being rewritten each time.
//
// Blanked rather than deleted: a scanner that reports or keys on `file:line`
// cannot survive a stripper that removes the lines a block comment occupied.
export function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
		.replace(/(^|\s)\/\/[^\r\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

export function readCode(relativePath) {
	return stripComments(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

export function readSource(relativePath) {
	return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
