import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-url-guard');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/environment/background/urlGuard.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'urlGuard.mjs');
fs.writeFileSync(modulePath, stripped);
const { isProxyableUrl } = await import(pathToFileURL(modulePath).href);

test('isProxyableUrl allows absolute http(s) only', () => {
	assert.equal(isProxyableUrl('https://api.pullpush.io/x'), true);
	assert.equal(isProxyableUrl('http://127.0.0.1:7860/ytdlp'), true);
	assert.equal(isProxyableUrl('https://i.redd.it/a.jpg'), true);
});

test('isProxyableUrl rejects non-http(s) schemes and junk', () => {
	assert.equal(isProxyableUrl('file:///etc/passwd'), false);
	assert.equal(isProxyableUrl('data:text/html,<script>'), false);
	assert.equal(isProxyableUrl('blob:https://x/abc'), false);
	assert.equal(isProxyableUrl('javascript:alert(1)'), false);
	assert.equal(isProxyableUrl('chrome-extension://abc/x'), false);
	assert.equal(isProxyableUrl('/relative/path'), false);
	assert.equal(isProxyableUrl(''), false);
	assert.equal(isProxyableUrl(null), false);
});

test('both background proxies gate on isProxyableUrl', () => {
	const ajax = read('lib/environment/background/ajax.js');
	const download = read('lib/environment/background/download.js');
	assert.match(ajax, /if \(!isProxyableUrl\(url\)\)/);
	assert.match(download, /if \(!isProxyableUrl\(url\)\)/);
});
