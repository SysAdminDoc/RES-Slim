import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-local-companion');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/localCompanion.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'localCompanion.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	isLocalhostUrl,
	sanitizeCompanionUrl,
	buildHealthUrl,
	buildYtdlpUrl,
	buildOllamaUrl,
	looksLikeDownloadUrl,
	parseHealth,
	buildYtdlpBody,
} = await import(pathToFileURL(modulePath).href);

test('isLocalhostUrl accepts 127.0.0.1 / localhost / [::1] with optional port + path', () => {
	assert.equal(isLocalhostUrl('http://127.0.0.1'), true);
	assert.equal(isLocalhostUrl('http://127.0.0.1:7860'), true);
	assert.equal(isLocalhostUrl('http://localhost:7860/api'), true);
	assert.equal(isLocalhostUrl('http://[::1]:7860'), true);
	assert.equal(isLocalhostUrl('https://localhost'), true);
});

test('isLocalhostUrl rejects everything else', () => {
	assert.equal(isLocalhostUrl('http://example.com'), false);
	assert.equal(isLocalhostUrl('http://127.0.0.2'), false);
	assert.equal(isLocalhostUrl('http://my.localhost.com'), false);
	assert.equal(isLocalhostUrl('http://localhost:99999'), false);
	assert.equal(isLocalhostUrl('http://user:pass@localhost:7860'), false);
	assert.equal(isLocalhostUrl(null), false);
	assert.equal(isLocalhostUrl('localhost'), false, 'scheme required');
});

test('sanitizeCompanionUrl falls back when non-localhost', () => {
	assert.equal(sanitizeCompanionUrl(''), 'http://127.0.0.1:7860');
	assert.equal(sanitizeCompanionUrl('http://localhost:8080/'), 'http://localhost:8080');
	assert.equal(sanitizeCompanionUrl('localhost:8080'), 'http://localhost:8080');
	assert.equal(sanitizeCompanionUrl('http://localhost:8080/api?ignored=1#frag'), 'http://localhost:8080/api');
	assert.equal(sanitizeCompanionUrl('http://localhost:99999'), 'http://127.0.0.1:7860');
	assert.equal(sanitizeCompanionUrl('http://example.com'), 'http://127.0.0.1:7860', 'non-localhost reverts to default');
});

test('build*Url append the documented paths to the sanitized base', () => {
	const base = 'http://127.0.0.1:8080';
	assert.equal(buildHealthUrl(base), 'http://127.0.0.1:8080/health');
	assert.equal(buildYtdlpUrl(base), 'http://127.0.0.1:8080/ytdlp');
	assert.equal(buildOllamaUrl(base), 'http://127.0.0.1:8080/ollama');
});

test('looksLikeDownloadUrl accepts valid http(s) URLs only', () => {
	assert.equal(looksLikeDownloadUrl('https://example.com/file.mp4'), true);
	assert.equal(looksLikeDownloadUrl('http://127.0.0.1:7860/file'), true);
	assert.equal(looksLikeDownloadUrl('javascript:alert(1)'), false);
	assert.equal(looksLikeDownloadUrl('file:///tmp/file'), false);
	assert.equal(looksLikeDownloadUrl('https://'), false);
	assert.equal(looksLikeDownloadUrl(null), false);
});

test('parseHealth supports flat and nested `tools` shape', () => {
	const flat = parseHealth({ ok: true, version: '1.0', ytdlp: true, ffmpeg: false, ollama: true });
	assert.equal(flat.ok, true);
	assert.equal(flat.ytdlp, true);
	assert.equal(flat.ffmpeg, false);
	const nested = parseHealth({ status: 'ok', tools: { ytdlp: true, ffmpeg: true } });
	assert.equal(nested.ok, true);
	assert.equal(nested.ffmpeg, true);
	const bad = parseHealth(null);
	assert.equal(bad.ok, false);
});

test('buildYtdlpBody mirrors the documented request shape', () => {
	const body = buildYtdlpBody('https://x.com/v', { format: 'best', audioOnly: false });
	assert.deepEqual(body, { url: 'https://x.com/v', format: 'best', audioOnly: false });
});

test('localCompanion module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as localCompanion \} from '\.\/localCompanion';/);
	assert.match(index, /^\s*localCompanion,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/localCompanion.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/localCompanion'/);
	assert.match(mod, /isLocalhostUrl\(/);
	assert.match(mod, /looksLikeDownloadUrl\(/);
	assert.match(mod, /buildHealthUrl\(/);
	assert.match(mod, /buildYtdlpUrl\(/);
	for (const opt of ['companionUrl', 'ytdlpFormat', 'audioOnly', 'showHealth']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
