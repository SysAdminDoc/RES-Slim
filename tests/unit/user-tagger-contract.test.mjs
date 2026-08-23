import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/userTags.js'), 'utf8');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-user-tagger');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'userTags.mjs');
fs.writeFileSync(modulePath, stripped);

const {
	normalizeUsername,
	sanitizeTagText,
	sanitizeColor,
	normalizeTag,
	parseTagsJson,
	stringifyTags,
	mergeTags,
	inspectTagImport,
	buildTagImportMap,
	commitTagImport,
	tagBadgeText,
} = await import(pathToFileURL(modulePath).href);

test('normalizeUsername lowercases and trims', () => {
	assert.equal(normalizeUsername('  Alice  '), 'alice');
	assert.equal(normalizeUsername('SPEZ'), 'spez');
	assert.equal(normalizeUsername(undefined), '');
	assert.equal(normalizeUsername(42), '');
});

test('sanitizeTagText strips control chars, collapses whitespace, caps length', () => {
	assert.equal(sanitizeTagText('  hello\tworld  '), 'hello world');
	assert.equal(sanitizeTagText('foo\u0000bar'), 'foobar');
	assert.equal(sanitizeTagText('x'.repeat(200)).length, 120);
	assert.equal(sanitizeTagText(123), '');
});

test('sanitizeColor accepts six-digit hex only', () => {
	assert.equal(sanitizeColor('#5B8DEF'), '#5b8def');
	assert.equal(sanitizeColor('#abc'), '');
	assert.equal(sanitizeColor('red'), '');
	assert.equal(sanitizeColor('  #112233  '), '#112233');
	assert.equal(sanitizeColor(''), '');
});

test('normalizeTag requires at least one signal', () => {
	assert.equal(normalizeTag({ tag: '', color: '', ignore: false }), null);
	assert.equal(normalizeTag(null), null);
	const onlyIgnore = normalizeTag({ tag: '', color: '', ignore: true });
	assert.equal(onlyIgnore?.ignore, true);
	const onlyTag = normalizeTag({ tag: 'spammer' });
	assert.equal(onlyTag?.tag, 'spammer');
	const full = normalizeTag({ tag: 'spammer', color: '#FF0000', ignore: true, ts: 12345 });
	assert.equal(full?.color, '#ff0000');
	assert.equal(full?.ts, 12345);
});

test('normalizeTag stamps a timestamp when missing or invalid', () => {
	const before = Date.now();
	const t = normalizeTag({ tag: 'foo' });
	assert.ok(t.ts >= before);
	const t2 = normalizeTag({ tag: 'foo', ts: 'nope' });
	assert.ok(t2.ts >= before);
});

test('parseTagsJson rejects malformed input', () => {
	assert.deepEqual(parseTagsJson(''), {});
	assert.deepEqual(parseTagsJson('not-json'), {});
	assert.deepEqual(parseTagsJson('[]'), {});
	assert.deepEqual(parseTagsJson('"string"'), {});
	assert.deepEqual(parseTagsJson(undefined), {});
});

test('parseTagsJson normalises usernames and drops empty tags', () => {
	const parsed = parseTagsJson(JSON.stringify({
		'  Alice ': { tag: 'spammer', color: '#FF0000', ignore: false, ts: 100 },
		'Bob': { tag: '', color: '', ignore: false }, // dropped — no signal
		'Carol': { ignore: true },
		'': { tag: 'noop' }, // empty username dropped
	}));
	assert.deepEqual(Object.keys(parsed).sort(), ['alice', 'carol']);
	assert.equal(parsed.alice.color, '#ff0000');
	assert.equal(parsed.carol.ignore, true);
});

test('stringifyTags emits stable key order', () => {
	const a = stringifyTags({ zoe: { tag: 'z', color: '', ignore: false, ts: 1 }, alice: { tag: 'a', color: '', ignore: false, ts: 1 } });
	const b = stringifyTags({ alice: { tag: 'a', color: '', ignore: false, ts: 1 }, zoe: { tag: 'z', color: '', ignore: false, ts: 1 } });
	assert.equal(a, b);
	assert.ok(a.indexOf('alice') < a.indexOf('zoe'));
});

test('mergeTags right-wins on collisions and ignores empty entries', () => {
	const base = { alice: { tag: 'old', color: '', ignore: false, ts: 1 } };
	const incoming = { alice: { tag: 'new', color: '#000000', ignore: true, ts: 2 }, bob: { tag: 'b', color: '', ignore: false, ts: 3 } };
	const merged = mergeTags(base, incoming);
	assert.equal(merged.alice.tag, 'new');
	assert.equal(merged.alice.ignore, true);
	assert.equal(merged.bob.tag, 'b');
});

test('tag import preview counts valid, invalid, new, and conflicting records', () => {
	const current = {
		alice: { tag: 'kept', color: '', ignore: false, ts: 1 },
	};
	const preview = inspectTagImport(JSON.stringify({
		Alice: { tag: 'replacement', color: '#FF0000', ignore: false, ts: 2 },
		Bob: { ignore: true },
		'  bob  ': { tag: 'duplicate' },
		Carol: { tag: '', color: '', ignore: false },
	}), current);

	assert.deepEqual(preview.counts, {
		valid: 2,
		invalid: 2,
		newRecords: 1,
		conflicting: 1,
	});
	assert.equal(preview.error, null);
	assert.deepEqual(Object.keys(preview.incoming).sort(), ['alice', 'bob']);
});

test('tag import preview reports malformed payloads without inventing records', () => {
	const preview = inspectTagImport('{not json', {});
	assert.deepEqual(preview.incoming, {});
	assert.deepEqual(preview.counts, {
		valid: 0,
		invalid: 1,
		newRecords: 0,
		conflicting: 0,
	});
	assert.match(preview.error, /valid JSON/i);
});

test('existing tags win by default unless replacement is explicit', () => {
	const current = {
		alice: { tag: 'old', color: '', ignore: false, ts: 1 },
	};
	const incoming = {
		alice: { tag: 'new', color: '#000000', ignore: true, ts: 2 },
		bob: { tag: 'added', color: '', ignore: false, ts: 3 },
	};

	const kept = buildTagImportMap(current, incoming);
	assert.equal(kept.alice.tag, 'old');
	assert.equal(kept.bob.tag, 'added');

	const replaced = buildTagImportMap(current, incoming, 'replace');
	assert.equal(replaced.alice.tag, 'new');
	assert.equal(replaced.alice.ignore, true);
});

test('a tag import snapshots, commits once, verifies, then clears its payload', async () => {
	const original = { alice: { tag: 'old', color: '', ignore: false, ts: 1 } };
	const next = { alice: original.alice, bob: { tag: 'new', color: '', ignore: false, ts: 2 } };
	let stored = original;
	let snapshot;
	let clears = 0;
	const writes = [];

	const committed = await commitTagImport({
		original,
		next,
		saveRollback: value => { snapshot = value; return Promise.resolve(); },
		writeMap: value => { writes.push(value); stored = value; return Promise.resolve(); },
		readMap: () => Promise.resolve(stored),
		clearPayload: () => { clears += 1; return Promise.resolve(); },
	});

	assert.deepEqual(snapshot, original);
	assert.deepEqual(committed, next);
	assert.deepEqual(writes, [next], 'the committed map is written in one operation');
	assert.equal(clears, 1);
});

test('a failed tag import restores the original map and leaves its payload', async () => {
	const original = { alice: { tag: 'old', color: '', ignore: false, ts: 1 } };
	const next = { bob: { tag: 'new', color: '', ignore: false, ts: 2 } };
	let stored = original;
	let attempts = 0;
	let clears = 0;
	const writes = [];

	await assert.rejects(commitTagImport({
		original,
		next,
		saveRollback: () => Promise.resolve(),
		writeMap: value => {
			writes.push(value);
			attempts += 1;
			if (attempts === 1) {
				stored = next;
				return Promise.reject(new Error('quota exceeded'));
			}
			stored = value;
			return Promise.resolve();
		},
		readMap: () => Promise.resolve(stored),
		clearPayload: () => { clears += 1; return Promise.resolve(); },
	}), /quota exceeded/);

	assert.deepEqual(stored, original);
	assert.deepEqual(writes, [next, original]);
	assert.equal(clears, 0);
});

test('tagBadgeText prefers tag text, falls back to ignored, then empty', () => {
	assert.equal(tagBadgeText({ tag: 'spammer', color: '', ignore: false, ts: 0 }), 'spammer');
	assert.equal(tagBadgeText({ tag: '', color: '', ignore: true, ts: 0 }), 'ignored');
	assert.equal(tagBadgeText({ tag: '', color: '#111111', ignore: false, ts: 0 }), '');
});

test('userTagger module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as userTagger \} from '\.\/userTagger';/);
	assert.match(index, /^\s*userTagger,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/userTagger.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/userTags'/);
	assert.match(mod, /watchForThings\(\['post', 'comment'\]/);
	assert.match(mod, /rsm-userTagger-btn/);
	assert.match(mod, /rsm-userTagger-popover/);
	assert.match(mod, /rsm-userTagger-badge/);
	for (const opt of ['showTagBadges', 'colorizeUsername', 'hideIgnored', 'defaultBadgeColor', 'importJson', 'importConflicts', 'importActions']) {
		assert.ok(mod.includes(opt), `expected option ${opt} to be declared`);
	}
	assert.doesNotMatch(mod, /applyImportJson/);
	assert.match(mod, /RESmodules\.userTagger\.tags\.rollback/);
	assert.match(mod, /commitTagImport/);
	assert.match(mod, /tagMapStore\.set/);
	assert.match(mod, /URL\.createObjectURL/);
});

test('userTagger popover exposes dialog semantics, status feedback, and trigger state', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/userTagger.js'), 'utf8');
	assert.match(mod, /setAttribute\('role', 'dialog'\)/);
	assert.match(mod, /setAttribute\('aria-labelledby', titleId\)/);
	assert.match(mod, /setAttribute\('aria-describedby', statusId\)/);
	assert.match(mod, /setAttribute\('aria-haspopup', 'dialog'\)/);
	assert.match(mod, /setAttribute\('aria-expanded', 'false'\)/);
	assert.match(mod, /setAttribute\('aria-controls', dialogId\)/);
	assert.match(mod, /setPopoverBusy\(pop, true, 'Saving tag…'\)/);
	// Failures report an outcome state as well as a message, so the status line
	// is coloured rather than relying on wording alone.
	assert.match(mod, /setPopoverBusy\(pop, false, 'Couldn’t save[^']*', 'error'\)/);
	// The failure message says what state the data is actually in, not just that
	// something went wrong.
	assert.match(mod, /the tag is still only in this box/);
});

test('userTagger positions the popover against viewport edges', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/userTagger.js'), 'utf8');
	assert.match(mod, /function placePopover/);
	assert.match(mod, /classList\.add\('is-flipped'\)/);
	assert.match(mod, /classList\.add\('is-above'\)/);
	assert.match(mod, /window\.addEventListener\('resize', onResize, true\)/);
	// Fixed positioning means scroll moves the page out from under the popover, so
	// it has to be re-anchored. Match the registration, not its third argument's
	// spelling — the listener became `{ capture: true, passive: true }` so that
	// re-anchoring cannot hold up the scroll that triggered it, and pinning the
	// bare `true` made that improvement look like a regression.
	assert.match(mod, /window\.addEventListener\('scroll', onResize,/);
	assert.match(mod, /window\.addEventListener\('scroll', onResize, \{[^}]*passive: true/);
	// Capture must survive, because removeEventListener matches on it.
	assert.match(mod, /window\.addEventListener\('scroll', onResize, \{[^}]*capture: true/);
	assert.match(mod, /window\.removeEventListener\('scroll', onResize, true\)/);
});

test('user tagger styles ship in the SCSS bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_userTagger.scss');
	assert.ok(fs.existsSync(scssPath), 'expected _userTagger.scss to exist');
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /\.rsm-userTagger-btn/);
	assert.match(scss, /\.rsm-userTagger-badge/);
	assert.match(scss, /\.rsm-userTagger-popover/);
	assert.match(scss, /&\.is-flipped/);
	assert.match(scss, /&\.is-above/);
	assert.match(scss, /&-status/);
	assert.match(scss, /\[aria-busy='true'\]/);

	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/userTagger'/);
});
