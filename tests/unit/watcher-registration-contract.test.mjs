import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// `watchForThings` appends to a list and never replays. The things already on
// the page are walked once, during the contentStart phase, so a watcher
// registered after an `await` inside `module.contentStart` is installed too
// late to see any of them.
//
// userTagger had exactly this shape and rendered nothing on a normal page load
// — no [+] triggers, no tag badges — while still working for things added later
// by ajax, which is why it looked fine in isolation. dragResize had it too.
//
// `beforeLoad` runs before things are registered, so an await there is safe.

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modulesDir = path.join(repoRoot, 'lib/modules');

const PHASES_THAT_RACE = ['contentStart', 'go', 'always'];

function offendersIn(source, file) {
	const found = [];
	for (const phase of PHASES_THAT_RACE) {
		const re = new RegExp(`module\\.${phase}\\s*=\\s*async[\\s\\S]*?\\n\\};`, 'g');
		for (const match of source.matchAll(re)) {
			const body = match[0];
			const watcherAt = Math.min(
				...['watchForThings(', 'watchForElements('].map(needle => {
					const i = body.indexOf(needle);
					return i === -1 ? Infinity : i;
				}),
			);
			if (!Number.isFinite(watcherAt)) continue;
			if (/\bawait\b/.test(body.slice(0, watcherAt))) {
				found.push(`${file}: module.${phase} awaits before registering a watcher`);
			}
		}
	}
	return found;
}

test('no module registers a thing-watcher after awaiting inside a racing phase', () => {
	const offenders = [];
	for (const file of fs.readdirSync(modulesDir).filter(f => f.endsWith('.js'))) {
		const source = fs.readFileSync(path.join(modulesDir, file), 'utf8');
		offenders.push(...offendersIn(source, file));
	}
	assert.deepEqual(offenders, [],
		`watchers registered too late to see the initial page:\n${offenders.join('\n')}`);
});

test('the detector actually fires on the shape it is meant to catch', () => {
	// A check that cannot fail is worse than no check.
	const bait = [
		'module.contentStart = async () => {',
		'\tawait loadInitialCache();',
		"\twatchForThings(['post'], process);",
		'};',
	].join('\n');
	assert.equal(offendersIn(bait, 'bait.js').length, 1);

	const fixed = [
		'module.contentStart = () => {',
		"\twatchForThings(['post'], process);",
		'\tloadInitialCache();',
		'};',
	].join('\n');
	assert.equal(offendersIn(fixed, 'fixed.js').length, 0);
});

test('userTagger and dragResize register synchronously and refresh after loading', () => {
	const tagger = fs.readFileSync(path.join(modulesDir, 'userTagger.js'), 'utf8');
	assert.match(tagger, /module\.contentStart = \(\) => \{[\s\S]{0,700}?watchForThings\(\['post', 'comment'\], processThing\);/);
	assert.match(tagger, /for \(const username of \[\.\.\.authorIndex\.keys\(\)\]\) tagThingForUser\(username\);/,
		'tags that arrive after the first render must be applied to authors already on the page');

	const drag = fs.readFileSync(path.join(modulesDir, 'dragResize.js'), 'utf8');
	assert.match(drag, /module\.contentStart = \(\) => \{[\s\S]{0,500}?watchForThings\(\['post', 'comment'\], process\);/);
	assert.match(drag, /applyStoredSize\(expando\)/,
		'persisted sizes must be re-applied once the cache resolves');
});
