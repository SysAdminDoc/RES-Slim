// Load a Flow-annotated `lib/` helper as a real ES module so a test can execute
// it rather than pattern-match its source.
//
// The suite grew 51 files that only regex the source, which is exactly how the
// eventTrackingSabotage fetch bug shipped green — a source assertion cannot tell
// you whether the code runs. Every contract added from here on uses this.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export function readRepoFile(relativePath) {
	return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// `name` scopes the temp directory so two suites running in parallel do not
// write over each other's stripped copy.
export async function loadFlowModule(relativePath, name) {
	const tmpDir = path.join(repoRoot, 'tests', 'unit', `.tmp-${name}`);
	fs.mkdirSync(tmpDir, { recursive: true });

	const stripped = flowRemoveTypes(readRepoFile(relativePath), { all: true }).toString();
	const outPath = path.join(tmpDir, `${path.basename(relativePath, '.js')}.mjs`);
	fs.writeFileSync(outPath, stripped);

	return import(pathToFileURL(outPath).href);
}

// Source with comments removed.
//
// Contracts of the form "this module never calls X" must run against code, not
// prose: every module header here names the userscript or endpoint it replaced,
// so the unstripped source contains the very strings the assertion forbids.
//
// Two traps this exists to stop repeating. The naive strip —
// `line.replace(/(^|\s)\/\/.*$/, '$1')` after splitting on a bare LF — is a
// silent no-op on a CRLF checkout, because `.` does not match the trailing CR so
// `$` never matches. And a caller who forgets to strip at all gets a green test
// that proves nothing. Pair every use with an assertion that the *unstripped*
// source still contains the string, so the stripper is proven to have run.
export function codeOnly(source) {
	return String(source)
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/)
		.map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1'))
		.join('\n');
}
