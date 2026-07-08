import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('gallery slideshow position shows current / total', () => {
	const src = read('lib/modules/showImages/mediaTypes.js');
	assert.match(src, /this\.msgPosition\.innerText = `\$\{newIndex \+ 1\} \/ \$\{this\.pieces\.length\}`;/);
});

test('restoreSubCounts surfaces a Reddit block instead of failing silently', () => {
	const src = read('lib/modules/restoreSubCounts.js');
	assert.match(src, /import \{ getStatusFromError \} from '\.\.\/utils\/redditApiStatus';/);
	assert.match(src, /notifyRedditApiBlocked\(getStatusFromError\(err\)\)/);
	assert.doesNotMatch(src, /\/\* ignore network errors \*\//);
});

test('absoluteTimestamps decorates every time element (posts, comments, edits)', () => {
	const src = read('lib/modules/absoluteTimestamps.js');
	// Global coverage: an initial sweep of all <time> plus a watcher for new ones.
	assert.match(src, /document\.querySelectorAll\('time'\)/);
	assert.match(src, /watchForElements\(\['page'\], 'time'/);
});
