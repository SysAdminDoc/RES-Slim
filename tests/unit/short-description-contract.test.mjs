import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(import.meta.dirname, '.tmp-short-description');
fs.mkdirSync(tmpDir, { recursive: true });

const stripped = read('lib/utils/shortDescription.js')
	.replace(/\/\* @flow \*\//, '')
	.replace(/: \?string/g, '')
	.replace(/: number = DEFAULT_MAX_LENGTH/g, ' = DEFAULT_MAX_LENGTH')
	.replace(/\): string \{/g, ') {');
const helperPath = path.join(tmpDir, 'shortDescription.mjs');
fs.writeFileSync(helperPath, stripped);
const { shortDescription } = await import(pathToFileURL(helperPath).href);

test('a dot inside a domain name is not a sentence end', () => {
	// The exact regressions the old split(/[!?.]/) produced in the sidebar.
	assert.equal(
		shortDescription('Rewrites i.redd.it / preview.redd.it links so they open the direct image.'),
		'Rewrites i.redd.it / preview.redd.it links so they open the direct image.');
	assert.equal(
		shortDescription('Optionally redirect www.reddit.com to old.reddit.com.'),
		'Optionally redirect www.reddit.com to old.reddit.com.');
	assert.equal(
		shortDescription("Strip Reddit's `out.reddit.com` tracking wrapper."),
		"Strip Reddit's `out.reddit.com` tracking wrapper.");
});

test('a real sentence boundary still ends the summary', () => {
	assert.equal(
		shortDescription('Dark skin for old.reddit. Disabled by default.'),
		'Dark skin for old.reddit.');
	assert.equal(
		shortDescription('Collapse bot comments (AutoModerator, RemindMeBot, etc). Reveal per comment.'),
		'Collapse bot comments (AutoModerator, RemindMeBot, etc).');
	assert.equal(shortDescription('Does a thing! Then another.'), 'Does a thing!');
	assert.equal(shortDescription('Really? Yes.'), 'Really?');
});

test('a version number does not end the summary', () => {
	assert.equal(
		shortDescription('Requires v0.1.0 or newer to work.'),
		'Requires v0.1.0 or newer to work.');
});

test('an over-long single sentence is clamped on a word boundary', () => {
	const long = `Adds a download button next to ${'media '.repeat(40)}items.`;
	const out = shortDescription(long);
	assert.ok(out.length <= 121, `expected <=121 chars, got ${out.length}`);
	assert.ok(out.endsWith('…'));
	assert.ok(!out.includes('  '));
	// Clamped at a space, so the last word is whole.
	assert.ok(/\bmedia…$/.test(out), out);
});

test('empty and nullish input degrade to an empty string', () => {
	assert.equal(shortDescription(''), '');
	assert.equal(shortDescription(null), '');
	assert.equal(shortDescription(undefined), '');
	assert.equal(shortDescription('   \n  '), '');
});

test('whitespace is normalised before summarising', () => {
	assert.equal(shortDescription('Two   lines\n  of   text.'), 'Two lines of text.');
});

test('the settings console uses the helper rather than a bare split', () => {
	const console_ = read('lib/options/settingsConsole.js');
	assert.match(console_, /import \{ shortDescription \} from '\.\.\/utils\/shortDescription'/);
	assert.match(console_, /shortDescription: shortDescription\(description\)/);
	assert.doesNotMatch(console_, /description\.split\(\/\[!\?\.\]\//,
		'the naive sentence split truncated any description containing a domain or version number');
});

test('no shipped module description is cut mid-word by the helper', () => {
	const dir = path.join(repoRoot, 'lib/modules');
	const offenders = [];
	for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
		const src = fs.readFileSync(path.join(dir, file), 'utf8');
		const match = src.match(/^module\.description = (['"])([\s\S]*?)\1;/m);
		if (!match) continue;
		const summary = shortDescription(match[2]);
		// Either the summary is the whole first sentence, or it was clamped with
		// an ellipsis. What it must never do is stop on a bare dot mid-token.
		if (/[^\s.!?…]$/.test(summary) && summary.length < match[2].length) {
			offenders.push(`${file}: ${JSON.stringify(summary)}`);
		}
	}
	assert.deepEqual(offenders, [], `descriptions cut mid-sentence:\n${offenders.join('\n')}`);
});
