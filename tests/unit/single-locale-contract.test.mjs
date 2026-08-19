import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
// Absence assertions read the code, not the prose explaining it. `locales/index.js`
// names the retired mappings precisely so the next reader knows what went; a
// scanner that reads its own explanation as the thing it forbids fails on a
// correct file. Line-preserving, per the house rule.
const readCode = relative => read(relative)
	.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
	.replace(/(^|\s)\/\/[^\r\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));

// This fork ships one dictionary, and v0.41.0 removed the locale negotiation that
// pretended otherwise: `redditLocaleToTransifexLocale` mapped `lol` to
// `en_lolcat` and `es-ar` to `es_419`, then merged exact match over region match
// over `en` — and every one of those branches resolved to `en`, because
// `locales/locales/` has held exactly one file since v0.1.0.
//
// The decision is reversible; this is what makes reversing it deliberate. Add a
// second dictionary and these tests fail, naming what has to come back with it.

test('exactly one locale dictionary ships', () => {
	const files = fs.readdirSync(path.join(repoRoot, 'locales', 'locales'));
	const dictionaries = files.filter(name => name.endsWith('.json'));
	assert.deepEqual(dictionaries, ['en.json'],
		'a second dictionary needs the locale negotiation back: reddit locale -> dictionary name, ' +
		'plus region fallback (en_CA -> en), plus a cache key that varies by locale again. ' +
		'See the comment in locales/index.js.');

	const index = read('locales/locales/index.js');
	const imports = [...index.matchAll(/^import\s+\w+\s+from\s+'\.\/([\w-]+)\.json';$/gm)].map(m => m[1]);
	assert.deepEqual(imports, ['en'], 'the barrel exports a dictionary the negotiation could not reach');
});

test('the dictionary lookup takes no locale, because it cannot use one', () => {
	const source = readCode('locales/index.js');
	// A parameter that cannot change the answer is exactly how the dead
	// negotiation stayed plausible for four hundred releases.
	assert.match(source, /export function getLocaleDictionary\(\): \{ \[string\]: string \} \{/);
	assert.doesNotMatch(source, /redditLocaleToTransifexLocale/);
	assert.doesNotMatch(source, /en_lolcat|en_pirate|es_419/);

	const background = read('lib/environment/background/i18n.js');
	assert.match(background, /addListener\('i18n', \(\) => getLocaleDictionary\(\)\);/);
});

test('the dictionary cache is no longer keyed on a locale it does not vary by', () => {
	const foreground = read('lib/environment/foreground/i18n.js');
	// Every reddit language switch used to discard the cached dictionary and
	// re-fetch an identical one.
	assert.match(foreground, /if \(localStorage\.getItem\(CACHED_MESSAGES_TOKEN_KEY\) === buildToken\) \{/);
	assert.match(foreground, /localStorage\.removeItem\(STALE_CACHED_LANG_KEY\)/,
		'the key every previous build wrote has to be cleared from existing profiles');
	assert.doesNotMatch(foreground, /setItem\(STALE_CACHED_LANG_KEY/);
	assert.doesNotMatch(foreground, /sendMessage\('i18n', /);
});

test('reddit locale detection stays, because timestamps still use it', () => {
	// The half of this that was never dead. Retiring detection along with
	// translation would have silently moved every timestamp to the browser locale.
	const foreground = read('lib/environment/foreground/i18n.js');
	assert.match(foreground, /export let locale = navigator\.language \|\| 'en';/);
	assert.match(foreground, /function getRedditLocale\(\)/);
	// leet/lol/pir are real reddit languages and not valid browser locales, so
	// they must not reach `toLocaleString`.
	assert.match(foreground, /SPECIAL_LANGUAGES = new Set\(\['leet', 'lol', 'pir'\]\)/);
	assert.match(foreground, /if \(redditLocale && !SPECIAL_LANGUAGES\.has\(redditLocale\)\) locale = redditLocale;/);

	const localization = read('lib/utils/localization.js');
	assert.match(localization, /import \{ locale \} from '\.\.\/environment';/);
	assert.match(localization, /dayjs\.locale\(/);
});

test('the README describes this fork rather than upstream Transifex', () => {
	const readme = read('locales/locales/README.md');
	// Not the words — the README has to explain what changed, and it cannot do that
	// without naming Transifex or the module it used to cite. What must be gone are
	// the two *instructions*: a link sending a would-be translator to a project
	// this fork does not consume, and a worked example pointing at a file that no
	// longer exists.
	assert.doesNotMatch(readme, /transifex\.com/i);
	// It also opened with "Do not edit the files in this directory, they are
	// automatically generated" — nothing has generated them since the fork.
	assert.doesNotMatch(readme, /automatically generated/i);
	assert.match(readme, /edited by hand/);

	// Every repo-relative path it cites has to exist. That is the check the
	// `userbarHider` example needed and never had: the module was deleted in
	// v0.1.0 and the link outlived it by four hundred releases.
	const cited = [...readme.matchAll(/(?:\]\(|`)(\/?(?:lib|locales|tests|scripts)\/[\w./-]+?)(?:\)|`)/g)]
		.map(match => match[1].replace(/^\//, ''));
	assert.ok(cited.length >= 3, `expected the README to cite repo paths, found ${cited.length}`);
	const missing = cited.filter(relative => !fs.existsSync(path.join(repoRoot, relative)));
	assert.deepEqual([...new Set(missing)], [], `README cites paths that do not exist:\n  ${missing.join('\n  ')}`);
});
