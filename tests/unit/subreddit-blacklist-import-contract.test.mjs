import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const list = await loadFlowModule('lib/utils/subredditBlacklist.js', 'subreddit-blacklist-import');
const { normalizeSubredditName, parseSubredditList, inspectListImport, mergeSubredditList, commitListImport, ListImportError } = list;

const mod = readRepoFile('lib/modules/subredditBlacklist.js');

test('a subreddit is the same subreddit however it was pasted', () => {
	for (const written of ['pics', 'r/pics', '/r/pics', 'R/Pics', 'https://www.reddit.com/r/pics/', 'https://old.reddit.com/r/pics']) {
		assert.equal(normalizeSubredditName(written), 'pics', `${written} should normalize to pics`);
	}
});

test('a name reddit could not have is refused rather than trimmed into one', () => {
	// An entry that can never match a subreddit is a line that looks like it is
	// working and is not, which is worse than being told it was rejected.
	for (const bad of ['', '   ', 'a', 'has space', 'has-dash', 'way_too_long_for_a_subreddit_name', 'r/', '#pics', null, undefined, 42]) {
		assert.equal(normalizeSubredditName(bad), null, `${String(bad)} is not a subreddit name`);
	}
});

test('the list is read from commas and newlines alike, and de-duplicated', () => {
	// The stored option is comma-separated and a pasted list is one per line.
	const parsed = parseSubredditList('pics\nr/aww, /r/PICS\n\nnot a name\naww');
	assert.deepEqual(parsed.valid, ['pics', 'aww']);
	assert.deepEqual(parsed.invalid, ['not a name']);
});

test('a preview counts what an import would do and writes nothing', () => {
	const preview = inspectListImport('pics\naww\nr/videos\nnot a name', 'pics, gaming');
	assert.deepEqual(preview.counts, { valid: 3, invalid: 1, newEntries: 2, duplicate: 1 });
	assert.deepEqual(preview.incoming, ['pics', 'aww', 'videos']);
	assert.deepEqual(preview.invalid, ['not a name']);
	assert.equal(preview.error, null);
});

test('a payload with nothing usable in it is an error rather than an empty success', () => {
	assert.match(inspectListImport('', 'pics').error, /nothing to import/);
	assert.match(inspectListImport('   ', 'pics').error, /nothing to import/);
	assert.match(inspectListImport('not a name\n#nope', 'pics').error, /No line in that payload is a subreddit name/);
});

test('importing merges and never deletes what was already there', () => {
	// The existing list is what the reader built by hand. An import that could
	// remove an entry is not recoverable from the settings page.
	assert.equal(mergeSubredditList('pics, gaming', ['aww', 'pics']), 'pics, gaming, aww');
	// Order is preserved, so the field does not reshuffle itself under them.
	assert.equal(mergeSubredditList('zebra, alpha', ['beta']), 'zebra, alpha, beta');
	// And an empty starting list is the ordinary case, not a special one.
	assert.equal(mergeSubredditList('', ['pics', 'aww']), 'pics, aww');
	// A merge of nothing changes nothing.
	assert.equal(mergeSubredditList('pics, aww', []), 'pics, aww');
});

test('the existing single-field value survives the change untouched', () => {
	// The whole point of the option staying a comma-separated string: somebody's
	// stored blacklist has to keep meaning what it meant.
	assert.deepEqual(parseSubredditList('pics, aww, gaming').valid, ['pics', 'aww', 'gaming']);
	assert.match(mod, /blacklist: \{[\s\S]*?type: 'text'/, 'the stored option must still be the same text field');
	assert.match(mod, /return parseSubredditList\(module\.options\.blacklist\.value\)\.valid;/,
		'the runtime read has to go through the same parser the import does, or the two disagree');
});

test('the commit is refused unless it is committing what was previewed', () => {
	// A preview describes one payload against one list, and either can change
	// while the reader is looking at the counts.
	assert.match(mod, /if \(!pendingImport\)/, 'committing without a preview must be refused');
	assert.match(mod, /!== pending\.raw \|\| String\(liveOptionValue\('blacklist'\) \|\| ''\) !== pending\.base/);
	assert.match(mod, /changed after the preview/);
});

test('the pre-import list is saved before the list is overwritten', () => {
	const commit = mod.slice(mod.indexOf('async function commitPreviewedListImport'));
	const rollbackAt = commit.indexOf('Options.set(module, \'importRollback\'');
	const writeAt = commit.indexOf('Options.set(module, \'blacklist\'');
	assert.ok(rollbackAt > -1 && writeAt > -1);
	assert.ok(rollbackAt < writeAt, 'saving the rollback after the overwrite saves the overwritten value');
	// And the payload is cleared, so pressing the button twice cannot import twice.
	assert.match(commit, /Options\.set\(module, 'importList', ''\)/);
});

// The import is three writes: save what the list was, write the merged one,
// clear the box. Any of them can fail, and the reader is left with a settings
// page whose fields no longer say what is on disk. A bare throw told them
// nothing about which.

function steps(failAt) {
	const done = [];
	const step = name => () => {
		if (name === failAt) return Promise.reject(new Error('quota exceeded'));
		done.push(name);
		return Promise.resolve();
	};
	return {
		done,
		saveRollback: step('rollback'),
		writeList: step('list'),
		clearPayload: step('payload'),
	};
}

test('a clean import does all three, in the order that makes undo possible', async () => {
	// Rollback first. A merge cannot lose an entry, but the reader is allowed to
	// change their mind, and an undo that depends on remembering what the field
	// said is not an undo.
	const plan = steps(null);
	assert.deepEqual(await commitListImport(plan), ['rollback', 'list', 'payload']);
	assert.deepEqual(plan.done, ['rollback', 'list', 'payload']);
});

test('a failure to save the previous list changes nothing, and says so', async () => {
	const plan = steps('rollback');
	const error = await commitListImport(plan).then(() => null, e => e);
	assert.ok(error instanceof ListImportError);
	assert.deepEqual(plan.done, [], 'the list was written without a way back');
	assert.deepEqual(error.landed, []);
	assert.match(error.message, /Nothing was changed/);
	assert.match(error.message, /quota exceeded/, 'the reason is dropped');
});

test('a failure to write the list names what did land', async () => {
	// This is the case the reader most needs told: the rollback field now holds
	// their old list, the box still holds the payload, and nothing was merged.
	const plan = steps('list');
	const error = await commitListImport(plan).then(() => null, e => e);
	assert.deepEqual(plan.done, ['rollback']);
	assert.deepEqual(error.landed, ['rollback']);
	assert.match(error.message, /Nothing was added/);
	assert.match(error.message, /previous list was saved/);
	assert.match(error.message, /payload is still in the box/);
});

test('a failure to clear the box says the import worked', async () => {
	// The merge is done and the rollback is saved. The only thing wrong is a
	// field that still shows what was pasted, and importing it again is a no-op --
	// which is worth saying, because it looks like the import did not happen.
	const plan = steps('payload');
	const error = await commitListImport(plan).then(() => null, e => e);
	assert.deepEqual(plan.done, ['rollback', 'list']);
	assert.deepEqual(error.landed, ['rollback', 'list']);
	assert.match(error.message, /list was merged/);
	assert.match(error.message, /would change nothing/);
});

test('the module reports the message rather than swallowing it', () => {
	// The status line is the only place any of this reaches the reader.
	const commit = mod.slice(mod.indexOf('async function commitPreviewedListImport'));
	assert.match(commit, /await commitListImport\(\{/, 'the module does its own three writes again');
	assert.match(commit, /setImportStatus\(error instanceof Error \? error\.message/);
	// And it still rethrows, because the console's button handler reports a
	// rejected callback separately.
	assert.match(commit, /throw error instanceof Error \? error : new Error\(String\(error\)\);/);
});
