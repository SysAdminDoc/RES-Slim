import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/outboundCleanser.js'), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-outbound');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'cleanser.mjs');
fs.writeFileSync(modulePath, stripped);

const { cleanseUrl, TRACKING_PARAMS, OUTBOUND_HOST } = await import(pathToFileURL(modulePath).href);

test('cleanseUrl unwraps Reddit out.reddit.com tracker wrappers', () => {
	const target = 'https://example.com/article?id=42';
	const wrapped = `https://${OUTBOUND_HOST}/?url=${encodeURIComponent(target)}&token=abc`;
	assert.equal(cleanseUrl(wrapped), 'https://example.com/article?id=42');
});

test('cleanseUrl strips every common UTM and ref parameter', () => {
	const href = 'https://example.com/post?id=7&utm_source=reddit&utm_medium=cpc&ref_source=share&share_id=xyz';
	const out = cleanseUrl(href);
	for (const param of TRACKING_PARAMS) {
		assert.ok(!String(out).includes(`${param}=`), `param ${param} should have been removed`);
	}
	assert.match(String(out), /^https:\/\/example\.com\/post\?id=7$/);
});

test('cleanseUrl returns null when the URL is already clean', () => {
	assert.equal(cleanseUrl('https://example.com/'), null);
	assert.equal(cleanseUrl('https://old.reddit.com/r/all'), null);
});

test('cleanseUrl preserves the document fragment when stripping query params', () => {
	const href = 'https://example.com/doc?utm_source=x#section-2';
	const out = cleanseUrl(href);
	assert.equal(out, 'https://example.com/doc#section-2');
});

test('cleanseUrl unwraps outbound + strips tracking params in one pass', () => {
	const target = 'https://example.com/?utm_source=tracker&id=1';
	const wrapped = `https://${OUTBOUND_HOST}/?url=${encodeURIComponent(target)}`;
	assert.equal(cleanseUrl(wrapped), 'https://example.com/?id=1');
});

test('cleanseUrl rejects malformed input without throwing', () => {
	assert.equal(cleanseUrl(''), null);
	assert.equal(cleanseUrl('::not-a-url::'), null);
});

test('outboundCleanser module wires the pure helpers through to anchor events', () => {
	const moduleSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/outboundCleanser.js'), 'utf8');
	assert.match(moduleSource, /import \{ cleanseUrl \} from '\.\.\/utils\/outboundCleanser'/);
	assert.match(moduleSource, /module\.category\s*=\s*'privacyCategory'/);
	for (const ev of ['mouseover', 'focusin', 'contextmenu', 'copy', 'click']) {
		assert.ok(moduleSource.includes(`'${ev}'`), `module should attach ${ev} handler`);
	}
	assert.match(moduleSource, /removeAttribute\('data-href-url'\)/);
	assert.match(moduleSource, /removeAttribute\('data-event-action'\)/);
});

test('outboundCleanser is registered in the module index', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as outboundCleanser \} from '\.\/outboundCleanser';/);
	assert.match(index, /^\s*outboundCleanser,/m);
});
