import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-cobalt-downloader');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/cobalt.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'cobalt.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	DEFAULT_INSTANCE,
	DEFAULT_HOSTS,
	isCobaltEligible,
	parseHostList,
	buildRequestBody,
	sanitizeInstance,
	looksLikeStreamUrl,
} = await import(pathToFileURL(modulePath).href);

test('DEFAULT_HOSTS includes the canonical video hosts cobalt supports', () => {
	for (const host of ['youtube.com', 'twitter.com', 'tiktok.com', 'v.redd.it', 'soundcloud.com']) {
		assert.ok(DEFAULT_HOSTS.includes(host), `expected ${host}`);
	}
	assert.throws(() => DEFAULT_HOSTS.push('mutated'), 'DEFAULT_HOSTS is frozen');
});

test('isCobaltEligible matches exact and *.suffix domains, case-insensitively', () => {
	const hosts = ['youtube.com', 'tiktok.com'];
	assert.equal(isCobaltEligible('youtube.com', hosts), true);
	assert.equal(isCobaltEligible('YouTube.com', hosts), true);
	assert.equal(isCobaltEligible('m.youtube.com', hosts), true);
	assert.equal(isCobaltEligible('example.com', hosts), false);
	assert.equal(isCobaltEligible(null, hosts), false);
});

test('parseHostList accepts whitespace/comma separators and falls back to default on empty', () => {
	assert.deepEqual(parseHostList('a.com, b.com\nc.com'), ['a.com', 'b.com', 'c.com']);
	assert.deepEqual(parseHostList('https://a.com/path'), ['a.com'], 'strips scheme + path');
	assert.equal(parseHostList('').length, DEFAULT_HOSTS.length);
});

test('buildRequestBody produces the exact shape the cobalt API expects', () => {
	const body = buildRequestBody({
		url: 'https://example.com/v',
		videoQuality: '720',
		audioFormat: 'mp3',
		downloadMode: 'auto',
		filenameStyle: 'pretty',
	});
	assert.deepEqual(body, {
		url: 'https://example.com/v',
		videoQuality: '720',
		audioFormat: 'mp3',
		downloadMode: 'auto',
		filenameStyle: 'pretty',
	});
});

test('sanitizeInstance normalises scheme + trailing slash + falls back', () => {
	assert.equal(DEFAULT_INSTANCE, 'https://api.cobalt.tools');
	assert.equal(sanitizeInstance(''), DEFAULT_INSTANCE);
	assert.equal(sanitizeInstance('api.example.com/'), 'https://api.example.com');
	assert.equal(sanitizeInstance('http://api.example.com//'), 'http://api.example.com');
	assert.equal(sanitizeInstance('https://api.example.com/base/?ignored=1#frag'), 'https://api.example.com/base');
	assert.equal(sanitizeInstance('javascript:alert(1)'), DEFAULT_INSTANCE);
	assert.equal(sanitizeInstance('http://localhost:99999'), DEFAULT_INSTANCE);
});

test('looksLikeStreamUrl accepts http(s) URLs only', () => {
	assert.equal(looksLikeStreamUrl('https://x/y.mp4'), true);
	assert.equal(looksLikeStreamUrl('http://x/y.mp4'), true);
	assert.equal(looksLikeStreamUrl('https://'), false);
	assert.equal(looksLikeStreamUrl('file:///x'), false);
	assert.equal(looksLikeStreamUrl(null), false);
});

test('cobaltDownloader module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as cobaltDownloader \} from '\.\/cobaltDownloader';/);
	assert.match(index, /^\s*cobaltDownloader,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/cobaltDownloader.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/cobalt'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /buildRequestBody\(/);
	assert.match(mod, /item && looksLikeStreamUrl\(item\.url\)/, 'picker entries must be URL-validated before download');
	for (const opt of ['instance', 'videoQuality', 'audioFormat', 'downloadMode', 'customHosts']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
