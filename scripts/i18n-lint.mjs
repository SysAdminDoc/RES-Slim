// Fails when source asks for a locale key that `en.json` does not have.
//
// `i18n()` echoes an unknown key rather than throwing, so a missing string does
// not crash — it renders as its own name. That is how `privacyCategory` shipped
// visible as a heading in the settings sidebar (v0.19.0). The check that would
// have caught it existed in `build/i18nLint.js` and was wired to nothing, and it
// checked the *opposite* direction anyway: which keys are unused.
//
// Unused keys are untidy. Missing keys are a visible defect. This checks the
// second and reports the first as a count.
//
// Two ways a key reaches `i18n()`:
//   1. `i18n('someKey')` — explicit.
//   2. A module field the console resolves later: `module.moduleName`,
//      `module.description`, `module.category`, and each option's `title` /
//      `description`. The fork has been replacing these with literal English as it
//      goes, so most are now prose — but a value that still *looks* like a key
//      (camelCase, no spaces, ending Name/Desc/Title/Category) is one, and if it
//      is absent from en.json it renders raw.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localePath = path.join(repoRoot, 'locales', 'locales', 'en.json');
const libRoot = path.join(repoRoot, 'lib');

const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));
const known = new Set(Object.keys(locale));

function listSources(dir = libRoot) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listSources(full);
		return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
	});
}

// Deliberately narrow: a value with a space, punctuation, or HTML in it is prose,
// not a key. The false-negative direction is the safe one here — a prose string
// that happens to look like a key would be reported, and that is noisy, not wrong.
const KEY_SHAPED = /^[a-z][A-Za-z0-9]*(Name|Desc|Description|Title|Category)$/;

const missing = [];
const used = new Set();

for (const file of listSources()) {
	const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
	const source = fs.readFileSync(file, 'utf8');
	const lines = source.split(/\r?\n/);

	lines.forEach((line, index) => {
		for (const match of line.matchAll(/\bi18n\(\s*'([^']+)'/g)) {
			used.add(match[1]);
			if (!known.has(match[1])) missing.push(`${relative}:${index + 1} i18n('${match[1]}')`);
		}

		for (const match of line.matchAll(/(?:moduleName|description|category|title)\s*:?\s*=?\s*'([^']+)'/g)) {
			const value = match[1];
			if (!KEY_SHAPED.test(value)) continue;
			used.add(value);
			if (!known.has(value)) missing.push(`${relative}:${index + 1} ${value}`);
		}
	});
}

if (missing.length) {
	console.error(`${missing.length} locale key${missing.length === 1 ? '' : 's'} referenced in source but absent from locales/locales/en.json.`);
	console.error('`i18n()` echoes an unknown key, so each of these renders as its own name in the UI:\n');
	for (const entry of missing) console.error(`  ${entry}`);
	console.error('\nAdd the string to en.json, or replace the reference with literal English.');
	process.exit(1);
}

// The unused count needs the OPPOSITE definition to the missing check above.
// 63 of the `i18n()` calls take a variable — `i18n(mod.moduleName)`,
// `i18n(option.title)` — whose value is a literal elsewhere in the tree, and the
// narrow scan cannot see those. Using it to decide deletions would have removed
// 435 live keys. So: a key counts as used if it appears anywhere at all.
//
// Excluding `tests/unit/.tmp-*`, which is the bundler's scratch output. It inlines
// the whole locale file, so a scan that reads it reports every key as used — which
// is exactly what the first attempt at this reported, all 1,631 of them.
function readAll(dir) {
	if (!fs.existsSync(dir)) return '';
	return fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
		if (entry.name.startsWith('.tmp-') || entry.name === 'node_modules') return '';
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return readAll(full);
		return /\.(js|mjs|json|scss|html)$/.test(entry.name) ? fs.readFileSync(full, 'utf8') : '';
	}).join('\n');
}

const haystack = [readAll(libRoot), readAll(path.join(repoRoot, 'tests'))].join('\n');
const escapeForRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-bounded so `hoverName` does not keep `hover` alive.
const unused = [...known].filter(key => !new RegExp(`\\b${escapeForRegExp(key)}\\b`).test(haystack));
console.log(`i18n: ${known.size} keys, 0 missing, ${unused.length} unused.`);

if (process.argv.includes('--list-unused')) {
	for (const key of unused) console.log(key);
}
