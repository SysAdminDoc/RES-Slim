import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('eventTrackingSabotage module is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as eventTrackingSabotage \} from '\.\/eventTrackingSabotage';/);
	assert.match(index, /^\s*eventTrackingSabotage,/m);
});

test('eventTrackingSabotage covers the canonical Reddit beacon hosts and analytics paths', () => {
	const source = read('lib/modules/eventTrackingSabotage.js');
	for (const host of [
		'events.reddit.com',
		'events.redditmedia.com',
		'pixel.redditmedia.com',
		'e.reddit.com',
		'alb.reddit.com',
		'w3-reporting.reddit.com',
	]) {
		assert.ok(source.includes(`'${host}'`), `expected host ${host}`);
	}
	for (const path of ['/api/event', '/api/v1/page_view', '/api/v1/clk']) {
		assert.ok(source.includes(`'${path}'`), `expected path ${path}`);
	}
});

test('eventTrackingSabotage injects a page-world script that wraps sendBeacon, fetch, and XHR', () => {
	const source = read('lib/modules/eventTrackingSabotage.js');
	assert.match(source, /navigator\.sendBeacon = function/);
	assert.match(source, /window\.fetch = function/);
	assert.match(source, /XMLHttpRequest\.prototype\.open/);
	assert.match(source, /XMLHttpRequest\.prototype\.send/);
	assert.match(source, /document\.createElement\('script'\)/);
	assert.match(source, /script\.remove\(\)/);
});

test('eventTrackingSabotage stays in the privacy category and gates with the schema include', () => {
	const source = read('lib/modules/eventTrackingSabotage.js');
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	assert.match(source, /module\.include\s*=\s*\['r2'\]/);
});
