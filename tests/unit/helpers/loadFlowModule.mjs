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
