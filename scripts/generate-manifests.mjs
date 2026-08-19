// Writes `chrome/manifest.json` and `firefox/manifest.json` from
// `manifest.config.js`.
//
// The two files stay committed rather than becoming pure build output, because
// nine unit contracts read them from the repo root and because a manifest change
// is exactly the kind of thing that should show up in a diff. What the generator
// buys is that a difference between the two targets is now a declared transform
// with a reason, instead of something you find by opening both files side by
// side.
//
// `--check` compares instead of writing, which is what the contract and any
// pre-release sweep use.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARGETS, serializeManifest } from '../manifest.config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const drifted = [];

for (const target of TARGETS) {
	const file = path.join(repoRoot, target, 'manifest.json');
	const generated = serializeManifest(target);
	const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

	if (current === generated) {
		if (!check) console.log(`  unchanged  ${target}/manifest.json`);
		continue;
	}

	if (check) {
		drifted.push(`${target}/manifest.json`);
		continue;
	}

	fs.mkdirSync(path.dirname(file), { recursive: true });
	// Bytes, not a text handle: a text write translates the newline on Windows
	// and lands CRLF in a file `.gitattributes` then normalizes, which shows up
	// as a whole-file diff for a one-key change.
	fs.writeFileSync(file, Buffer.from(generated, 'utf8'));
	console.log(`  written    ${target}/manifest.json`);
}

if (check && drifted.length) {
	console.error(`These manifests no longer match manifest.config.js:\n${drifted.map(f => `  ${f}`).join('\n')}\n\nRegenerate them:\n  yarn manifest`);
	process.exit(1);
}

if (check) console.log(`manifests: both match manifest.config.js (${TARGETS.join(', ')}).`);
