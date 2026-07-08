import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const source = read('lib/options/settingsConsole.js');

test('options console message handler validates the sender origin', () => {
	// The privileged options page is embedded as an iframe on the Reddit page.
	// Its `message` listener must reject cross-origin senders before acting on
	// `load`/`close`, otherwise any frame on the page can drive it.
	assert.match(source, /window\.addEventListener\('message', \(\{ origin, data \}\) => \{/);
	assert.match(source, /if \(!isTrustedConsoleOrigin\(origin\)\) return;/);
});

test('isTrustedConsoleOrigin accepts only the extension origin or reddit.com', () => {
	assert.match(source, /function isTrustedConsoleOrigin\(origin/);
	assert.match(source, /origin === getOptionsURL\(\)\.origin/);
	assert.match(source, /hostname === 'reddit\.com' \|\| hostname\.endsWith\('\.reddit\.com'\)/);
});
