import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('download requests propagate extension API failures to callers', () => {
	const foregroundDownload = read('lib/environment/foreground/download.js');
	const backgroundDownload = read('lib/environment/background/download.js');
	const showImagesMediaTypes = read('lib/modules/showImages/mediaTypes.js');

	assert.match(foregroundDownload, /export function download\(url: string, filename\?: string\): Promise<\*>/);
	assert.match(foregroundDownload, /return sendMessage\('download'/);
	assert.match(backgroundDownload, /const downloadFile = apiToPromise/);
	assert.match(backgroundDownload, /return downloadFile\(\{ url, filename/s);
	assert.match(showImagesMediaTypes, /return download\(downloadUrl, filename\)/);
	assert.match(showImagesMediaTypes, /return download\(downloadUrl\)/);
	assert.match(showImagesMediaTypes, /notificationID: 'downloadFailed'/);
});
