import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const mockupDir = path.join(repoRoot, 'design', 'mockups');
const expected = [
	'about.png',
	'appearance.png',
	'browsing.png',
	'comments.png',
	'console.png',
	'core.png',
	'my-account.png',
	'privacy.png',
	'productivity.png',
	'search.png',
	'submissions.png',
	'subreddits.png',
	'users.png',
];

test('every settings destination has a full-size design reference', () => {
	assert.deepEqual(fs.readdirSync(mockupDir).sort(), expected);

	for (const file of expected) {
		const png = fs.readFileSync(path.join(mockupDir, file));
		assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${file} must be a PNG`);
		assert.equal(png.readUInt32BE(16), 1440, `${file} must use the desktop reference width`);
		assert.equal(png.readUInt32BE(20), 900, `${file} must use the desktop reference height`);
	}
});
