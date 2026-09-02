import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-bot-collapse');
fs.mkdirSync(tmpDir, { recursive: true });
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/botList.js'), 'utf8');
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'botList.mjs');
fs.writeFileSync(modulePath, stripped);
const { DEFAULT_BOTS, normalizeBotName, parseBotList, isBot, isAutoModSticky } = await import(pathToFileURL(modulePath).href);

test('DEFAULT_BOTS includes AutoModerator and is frozen', () => {
	assert.ok(DEFAULT_BOTS.includes('AutoModerator'));
	assert.throws(() => DEFAULT_BOTS.push('x'));
});

test('normalizeBotName lowercases and trims, rejects non-strings', () => {
	assert.equal(normalizeBotName('  AutoModerator  '), 'automoderator');
	assert.equal(normalizeBotName('REMINDMEBOT'), 'remindmebot');
	assert.equal(normalizeBotName(undefined), '');
	assert.equal(normalizeBotName({}), '');
});

test('parseBotList accepts JSON array and comma-separated input', () => {
	assert.deepEqual(parseBotList('["AutoModerator", "Foo"]'), ['automoderator', 'foo']);
	assert.deepEqual(parseBotList('AutoModerator, Foo, Bar'), ['automoderator', 'foo', 'bar']);
	assert.deepEqual(parseBotList('Foo\nBar\nFoo'), ['foo', 'bar']); // dedup
	assert.deepEqual(parseBotList(''), []);
	assert.deepEqual(parseBotList(undefined), []);
});

test('parseBotList survives malformed JSON by falling back to splitter', () => {
	const list = parseBotList('[not json, foo, bar');
	assert.ok(list.includes('foo'));
	assert.ok(list.includes('bar'));
});

test('isBot is case-insensitive and ignores empty names', () => {
	const list = parseBotList('AutoModerator, RemindMeBot');
	assert.equal(isBot('automoderator', list), true);
	assert.equal(isBot('REMINDMEBOT', list), true);
	assert.equal(isBot('alice', list), false);
	assert.equal(isBot('', list), false);
	assert.equal(isBot(null, list), false);
});

test('isAutoModSticky requires both author AND stickied flag', () => {
	assert.equal(isAutoModSticky('AutoModerator', true), true);
	assert.equal(isAutoModSticky('automoderator', true), true);
	assert.equal(isAutoModSticky('AutoModerator', false), false);
	assert.equal(isAutoModSticky('alice', true), false);
	assert.equal(isAutoModSticky(null, true), false);
});

test('botCollapse module is registered and wires the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as botCollapse \} from '\.\/botCollapse';/);
	assert.match(index, /^\s*botCollapse,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/botCollapse.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/botList'/);
	assert.match(mod, /watchForThings\(\['comment'\]/);
	assert.match(mod, /rsm-botCollapse-badge/);
	assert.match(mod, /rsm-botCollapse-reveal/);
	for (const opt of ['botList', 'collapseStickyAutomod', 'collapseOtherBots', 'attributeAutoMod']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('botCollapse SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_botCollapse.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /\.rsm-botCollapse-badge/);
	assert.match(scss, /\.rsm-botCollapse-reveal/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@use 'modules\/botCollapse'/);
});
