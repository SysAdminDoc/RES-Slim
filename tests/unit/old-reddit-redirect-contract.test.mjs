import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('oldRedditRedirect is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as oldRedditRedirect \} from '\.\/oldRedditRedirect';/);
	assert.match(index, /^\s*oldRedditRedirect,/m);
});

test('oldRedditRedirect defaults autoRedirect off and toggle on', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	assert.match(source, /autoRedirect:\s*\{[\s\S]*?value:\s*false/);
	assert.match(source, /showHostToggle:\s*\{[\s\S]*?value:\s*true/);
});

test('oldRedditRedirect only rewrites from www.reddit.com to old.reddit.com', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	assert.match(source, /location\.host !== 'www\.reddit\.com'/);
	assert.match(source, /next\.host = 'old\.reddit\.com'/);
	assert.match(source, /location\.replace/);
});

test('oldRedditRedirect injects an old/www/sh host toggle with active-state marking', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	for (const host of ['old.reddit.com', 'www.reddit.com', 'sh.reddit.com']) {
		assert.ok(source.includes(`'${host}'`), `expected host ${host}`);
	}
	assert.match(source, /classList\.add\('is-active'\)/);
	const css = read('lib/css/modules/_oldRedditRedirect.scss');
	assert.match(css, /\.rsm-host-toggle/);
	assert.match(css, /border-radius:\s*4px/);
});

test('oldRedditRedirect CSS partial is wired into res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@import 'modules\/oldRedditRedirect';/);
});
