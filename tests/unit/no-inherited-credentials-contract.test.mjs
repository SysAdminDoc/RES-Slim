import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { stripComments } from './helpers/readCode.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

// Four third-party API keys shipped in this public GPL-3.0 repo until v0.40.0,
// two of them Google `AIza` keys. They were inherited from upstream and
// snapshot-tracked, so they were known rather than accidental — which is exactly
// what made them durable. They were live quota credentials this project neither
// owns nor can restrict, in the worst possible place to keep one.
//
// The decision, per key, is recorded in CLAUDE.md. This holds the outcome.

function collectJs(dir, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectJs(full, found);
		else if (entry.name.endsWith('.js')) found.push(full);
	}
	return found;
}

// Deliberately narrow, and each one is a shape a real credential takes rather
// than a guess at entropy: a token that only ever appears as a literal in source
// has no legitimate form here, because this project owns no third-party account.
//
// 2026-08-19: a fifth key was found sitting in `hosts/imgur.js` through all of
// this — `const apiId = '1d8d9b36339e0e2'`, sent as a `Client-ID` header. It was
// missed because the four shapes above were derived from the four keys already
// known, so this file proved "those four are gone", which is a different claim
// from the one its name makes. The shapes below are derived from how a
// credential is *written* instead: the assignment spellings a key can take, and
// the auth headers it can be sent in.
const CREDENTIAL_SHAPES = [
	{ name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
	{ name: 'hardcoded api_key value', pattern: /api_?[kK]ey\s*:\s*'[A-Za-z0-9_-]{12,}'/ },
	{ name: 'hardcoded key query parameter', pattern: /[?&]key=[A-Za-z0-9_-]{20,}/ },
	{ name: 'bearer token literal', pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/ },
	// Any `const <something id-ish> = '<opaque token>'`. The name test is what
	// keeps this off ordinary constants; a 12-character lower-bound keeps it off
	// short enum values and CSS-ish literals.
	{
		name: 'credential assigned to an id-like constant',
		pattern: /\b(?:const|let|var)\s+\w*(?:api(?:Id|Key)|clientId|client_id|appId|app_key|accessToken|secret)\w*\s*=\s*'[A-Za-z0-9_-]{12,}'/i,
	},
	// And the same value arriving at a request as a literal rather than through
	// an option, which is the form that actually reaches a third party.
	{ name: 'Client-ID header literal', pattern: /Client-ID\s+(?!\$\{)[A-Za-z0-9_-]{12,}/ },
	// 2026-08-25: a sixth key was found in `hosts/tenor.js` - `key: 'JJHDC7UK73EH'`
	// inside an ajax `query` object. Every shape above walked past it. `api_key`
	// requires that exact property name, `[?&]key=` requires the parameter to be
	// spelled inside a URL string, and the 20-character floor is above a 12
	// character key anyway. So the same twice-learnt lesson, generalised: a
	// credential-ish *property* holding an opaque literal, whatever it is called
	// and wherever the request assembles it.
	{
		name: 'credential-ish property with a literal value',
		pattern: /\b(?:api_?key|client_?id|app_?id|access_?token|consumer_?key|secret)\s*:\s*'[A-Za-z0-9_-]{10,}'/i,
	},
	// `key` and `token` on their own are ordinary words in this codebase - option
	// keys, storage keys, a search-engine id - so the property name cannot carry
	// the whole judgement. What separates a credential from those is the *value*:
	// an opaque token mixes digits with capitals, or is a long hex run. A
	// dictionary word like 'subreddits' or 'hideSidebar' has neither. A shape that
	// fires on ordinary code gets deleted the first time it cries wolf, which is
	// how a check stops being one.
	{
		name: 'opaque token in a key or token property',
		pattern: /\b(?:key|token)\s*:\s*'(?:(?=[^']*[0-9])(?=[^']*[A-Z])[A-Za-z0-9_-]{10,}|[0-9a-f]{15,})'/,
	},
];

test('the credential shapes match a real key and not ordinary code', () => {
	// Bait, in both directions. A pattern that matches nothing is a pattern that
	// passes forever, and one that matches ordinary code gets deleted the first
	// time it cries wolf.
	const shape = name => CREDENTIAL_SHAPES.find(s => s.name === name).pattern;
	assert.match("key: 'AIzaSyB8ufxFN0GapU1hSzIbuOLfnFC0XzJousw',", shape('Google API key'));
	assert.match("query: { api_key: 'dc6zaTOxFJmzC' },", shape('hardcoded api_key value'));
	assert.match('view?center=x&key=AIzaSyCtnLZP1XwkgIK53Asx_5qtZa2k9eZcdDc', shape('hardcoded key query parameter'));

	assert.doesNotMatch("api_key: String(this.options.apiKey.value)", shape('hardcoded api_key value'));
	assert.doesNotMatch("query: { api_key: '' },", shape('hardcoded api_key value'));
	assert.doesNotMatch('sortKey: this.key', shape('hardcoded key query parameter'));

	// The sixth key, in the spelling that walked past all six shapes above it.
	const opaque = shape('opaque token in a key or token property');
	assert.match('query: { key: \'JJHDC7UK73EH\', ids: id },', opaque);
	assert.match('headers: { token: \'abcdef0123456789\' },', opaque);
	// ...and the option keys and storage keys it must not fire on, each one a real
	// line from this repo.
	assert.doesNotMatch('query: { key: String(this.options.apiKey.value), ids: id },', opaque);
	assert.doesNotMatch('query: { key: \'\' },', opaque);
	assert.doesNotMatch('{ key: \'subreddits\' }', opaque);
	assert.doesNotMatch('{ key: \'hideSidebar\' }', opaque);
	assert.doesNotMatch('{ key: \'google-site\' }', opaque);
	assert.doesNotMatch('sortBy: \'confidence\'', opaque);

	// The fifth key, in the exact spelling that walked past the four shapes above.
	assert.match("\t\tconst apiId = '1d8d9b36339e0e2';", shape('credential assigned to an id-like constant'));
	assert.match('Authorization: `Client-ID 1d8d9b36339e0e2`,', shape('Client-ID header literal'));

	// ...and the shapes it must not fire on: the option-driven forms that replaced
	// it, and ordinary constants whose names happen to be nearby.
	assert.doesNotMatch(
		"const apiKey = String(this.options && this.options.apiKey ? this.options.apiKey.value : '');",
		shape('credential assigned to an id-like constant'),
	);
	assert.doesNotMatch('Authorization: `Client-ID ${apiKey}`,', shape('Client-ID header literal'));
	assert.doesNotMatch("const apiPrefix = 'https://api.imgur.com/3/';", shape('credential assigned to an id-like constant'));
	assert.doesNotMatch("const cdnUrl = 'https://i.imgur.com/';", shape('credential assigned to an id-like constant'));
});

test('no third-party credential is hardcoded anywhere in lib/', () => {
	const findings = [];
	for (const file of collectJs(path.join(repoRoot, 'lib'))) {
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		// Comments in these files quote the keys they removed, which is the record
		// of why they are gone; reading that record as the offence would fail on
		// the very files that fixed it.
		const code = stripComments(fs.readFileSync(file, 'utf8'));
		for (const { name, pattern } of CREDENTIAL_SHAPES) {
			const match = pattern.exec(code);
			if (match) findings.push(`${relative} — ${name}: ${match[0].slice(0, 24)}…`);
		}
	}
	assert.deepEqual(findings, [], `hardcoded credentials:\n  ${findings.join('\n  ')}`);
});

test('each of the four inherited keys has its recorded resolution in the code', () => {
	const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

	// youtube: deleted with the caller-less function that carried it. Host no
	// longer declares getVideoData at all, so the field cannot come back by
	// accident either.
	assert.doesNotMatch(read('lib/modules/hosts/youtube.js'), /googleapis\.com/);
	assert.doesNotMatch(read('lib/core/host.js'), /getVideoData/);

	// giphy: key-less, because the media paths the id determines are what the API
	// was returning anyway.
	const giphy = read('lib/modules/hosts/giphy.js');
	assert.doesNotMatch(giphy, /api\.giphy\.com/);
	assert.match(giphy, /media\.giphy\.com\/media\/\$\{id\}\/giphy\.mp4/);

	// googlemaps: key-less via OpenStreetMap, since Google's Embed API requires
	// one and no key-less Google path exists.
	const maps = read('lib/modules/hosts/googlemaps.js');
	assert.doesNotMatch(maps, /maps\/embed\/v1/);
	assert.match(maps, /openstreetmap\.org\/export\/embed\.html/);

	// tumblr: the one host with no key-less path — its oEmbed endpoint stopped
	// returning JSON — so the key became the user's, and detection is off until
	// one is set rather than offering an expando that can only fail.
	const tumblr = read('lib/modules/hosts/tumblr.js');
	assert.match(tumblr, /apiKey: \{/);
	assert.match(tumblr, /if \(!this\.options \|\| !this\.options\.apiKey\.value\) return null;/);
	assert.match(tumblr, /api_key: String\(this\.options \? this\.options\.apiKey\.value : ''\)/);
});

test('the sixth key is user-supplied, and the tenor CDN still works without one', () => {
	const tenor = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/tenor.js'), 'utf8');

	assert.doesNotMatch(stripComments(tenor), /JJHDC7UK73EH/);
	assert.match(tenor, /apiKey: \{/);
	assert.match(tenor, /key: String\(this\.options \? this\.options\.apiKey\.value : ''\)/);
	// The CDN branch answers before the key is consulted, so a direct file still
	// expands with no key - the same key-less path imgur keeps.
	assert.match(tenor, /if \(hostname === 'media\.tenor\.com'[\s\S]*?return \{ id: null \};/);
	// And the request the key rides on is declared, which it never was.
	assert.match(tenor, /permissions: \['https:\/\/api\.tenor\.co\/v1\/gifs\*'\]/);
});

test('the fifth key is user-supplied, and imgur still works without one', () => {
	const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
	const imgur = read('lib/modules/hosts/imgur.js');

	// The literal is gone and the header is built from the option.
	assert.doesNotMatch(stripComments(imgur), /1d8d9b36339e0e2/);
	assert.match(imgur, /apiKey: \{/);
	assert.match(imgur, /Authorization: `Client-ID \$\{apiKey\}`/);

	// Unlike tumblr, imgur keeps a key-less path — that is the whole reason it is
	// gated per-branch rather than at `detect`'s entry. `imgur-url-shapes-contract`
	// drives both halves; this asserts the shape so the gate cannot be widened into
	// "no key, no imgur" by a later edit.
	assert.match(imgur, /if \(!apiKey\) return null;/);
	assert.match(imgur, /\} else if \(!apiKey\) \{\n\s*\/\//, 'the bare-hash branch must degrade, not decline');
});
