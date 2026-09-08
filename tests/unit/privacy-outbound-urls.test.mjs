import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { codeOnly } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libRoot = path.join(repoRoot, 'lib');
const snapshotPath = path.join(repoRoot, 'tests', 'fixtures', 'privacy', 'outbound-url-snapshot.json');
const urlPattern = /https?:\/\/[^\s'"`<>)\\]+/gu;

const blockedOutboundPatterns = [
	/google-analytics\.com/i,
	/googletagmanager\.com/i,
	/hotjar\.com/i,
	/mixpanel\.com/i,
	/segment\.com/i,
	/sentry\.io/i,
	/telemetry/i,
];

function listJavaScriptFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
		return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
	});
}

// Comments are not outbound references.
//
// This scanned raw source, so a URL named in a header -- the endpoint a module
// replaced, the shape of an attack a guard exists to stop -- landed in a
// snapshot that is supposed to be the reviewed list of what this extension can
// talk to. That is noise in a list whose whole value is that a reviewer reads
// every line of it, and noise is where a real entry hides. `codeOnly` requires
// whitespace before a `//` to treat it as a comment, so a URL inside a string
// survives it.
function outboundUrlEntries() {
	return listJavaScriptFiles(libRoot).flatMap(file => {
		const relativePath = path.relative(repoRoot, file).replace(/\\/g, '/');
		const source = codeOnly(fs.readFileSync(file, 'utf8'));
		return [...source.matchAll(urlPattern)].map(match => ({
			file: relativePath,
			url: match[0],
		}));
	}).sort((a, b) => a.file.localeCompare(b.file) || a.url.localeCompare(b.url));
}

function loadSnapshot() {
	const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
	assert.equal(typeof parsed.note, 'string');
	assert.ok(Array.isArray(parsed.entries));
	return parsed.entries;
}

test('hardcoded outbound URL references match the reviewed privacy snapshot', () => {
	assert.deepEqual(outboundUrlEntries(), loadSnapshot());
});

test('reviewed outbound URLs do not include known telemetry endpoints', () => {
	for (const { file, url } of outboundUrlEntries()) {
		for (const pattern of blockedOutboundPatterns) {
			assert.doesNotMatch(url, pattern, `${file} contains blocked outbound endpoint ${url}`);
		}
	}
});
