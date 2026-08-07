// User-facing strings must name controls the way the user sees them.
//
// Three descriptions told the user to use a control by its *internal option key*
// — "use the nightModeOn switch below", above a toggle labelled "Night Mode On".
// Inherited upstream copy that was never adapted. It reads as leaked developer
// detail, and on a settings surface someone spends deliberate time in, that is
// the difference between polished and unfinished.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const en = JSON.parse(read('locales/locales/en.json'));

// Every option key declared by any module, read from source rather than hardcoded
// so a new module's keys are covered the day it lands.
function optionKeys() {
	const keys = new Set();
	const dir = path.join(repoRoot, 'lib', 'modules');

	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.js')) continue;
		const block = fs.readFileSync(path.join(dir, name), 'utf8').match(/module\.options = \{[\s\S]*?\n\};/);
		if (!block) continue;
		for (const [, key] of block[0].matchAll(/^\t([a-z][A-Za-z0-9]*):\s*\{/gm)) keys.add(key);
	}

	return keys;
}

test('the option-key set is actually populated', () => {
	// Without this the scan below silently passes on an empty set — the check
	// would be wired to nothing and would authorise every string.
	const keys = optionKeys();
	assert.ok(keys.size > 100, `expected to find the module option keys, found ${keys.size}`);
	assert.ok(keys.has('nightModeOn'), 'sanity: a known option key should be in the set');
});

test('no user-facing string names a control by its internal option key', () => {
	const keys = optionKeys();
	const offenders = [];

	for (const [id, entry] of Object.entries(en)) {
		const message = entry && entry.message;
		if (typeof message !== 'string') continue;

		for (const [, word] of message.matchAll(/\b([a-z]+[A-Z][A-Za-z]*)\b/g)) {
			if (!keys.has(word)) continue;
			offenders.push(`${id}: "${word}"`);
			break;
		}
	}

	assert.deepEqual(
		offenders,
		[],
		'these strings name an option key instead of its visible title — use the title the user can see',
	);
});

// The `history` permission is gone; nothing writes to the browser's history any
// more. A description that still describes that behaviour is not just untidy, it
// is untrue.
test('no string claims RES-Slim writes to the browser history', () => {
	const offenders = [];

	for (const [id, entry] of Object.entries(en)) {
		const message = entry && entry.message;
		if (typeof message !== 'string') continue;
		if (/added to your browser history \*|adding .{0,20}to your browser history by/i.test(message)) {
			offenders.push(id);
		}
	}

	assert.deepEqual(offenders, [], 'RES-Slim no longer touches browser history — see lib/utils/visitedLinks.js');
});
