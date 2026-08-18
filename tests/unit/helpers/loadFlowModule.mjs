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
//
// `deps` names sibling `lib/utils/` helpers the target imports. They are stripped
// into the same directory and the extensionless relative specifiers are rewritten
// to `.mjs`, because Node's ESM resolver requires an extension and `lib/` is
// written for a bundler that does not. Without this, a helper that grows a single
// import to another helper breaks every contract that loads it — which is a poor
// reason to duplicate maths that is already tested elsewhere.
export async function loadFlowModule(relativePath, name, { deps = [] } = {}) {
	const tmpDir = path.join(repoRoot, 'tests', 'unit', `.tmp-${name}`);
	fs.mkdirSync(tmpDir, { recursive: true });

	const names = [relativePath, ...deps].map(p => path.basename(p, '.js'));
	const withExtensions = source => names.reduce(
		(acc, base) => acc.replace(new RegExp(`(from\\s+['"]\\.\\/)${base}(['"])`, 'g'), `$1${base}.mjs$2`),
		source,
	);

	let outPath;
	for (const dep of [relativePath, ...deps]) {
		const stripped = withExtensions(flowRemoveTypes(readRepoFile(dep), { all: true }).toString());
		const depPath = path.join(tmpDir, `${path.basename(dep, '.js')}.mjs`);
		fs.writeFileSync(depPath, stripped);
		if (dep === relativePath) outPath = depPath;
	}

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
