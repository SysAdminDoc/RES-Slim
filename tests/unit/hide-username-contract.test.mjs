import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('hideUsername is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as hideUsername \} from '\.\/hideUsername';/);
	assert.match(index, /^\s*hideUsername,/m);
});

test('hideUsername reads the username from the header userbar', () => {
	const source = read('lib/modules/hideUsername.js');
	assert.match(source, /#header-bottom-right \.user a\[href\^="\/user\/"\]/);
});

test('hideUsername masks .author anchors that match the username case-insensitively', () => {
	const source = read('lib/modules/hideUsername.js');
	assert.match(source, /a\.author/);
	assert.match(source, /text\.toLowerCase\(\) !== me\.toLowerCase\(\)/);
});

test('hideUsername uses a configurable placeholder with a sensible default', () => {
	const source = read('lib/modules/hideUsername.js');
	assert.match(source, /placeholder:\s*\{[\s\S]*?value:\s*'\[me\]'/);
	assert.match(source, /'\[me\]'/);
});

test('hideUsername stays in the privacy category and watches new posts/comments', () => {
	const source = read('lib/modules/hideUsername.js');
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	assert.match(source, /watchForThings\(\['post', 'comment'\]/);
});

test('hideUsername no-ops when the userbar reports no logged-in account', () => {
	const source = read('lib/modules/hideUsername.js');
	assert.match(source, /if \(!findUsername\(\)\) return/);
});
