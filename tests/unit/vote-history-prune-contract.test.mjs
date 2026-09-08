// What a vote costs when there is nothing to clean up.
//
// `pruneIfNeeded` runs after every vote. It used to read the whole store, sort
// it in the content script and send the overflow ids back for deletion -- so at
// the vote log's default cap of fifty thousand records with 240-character
// snippets, one vote click marshalled tens of megabytes through
// `chrome.runtime.sendMessage` and threw all of it away, every time, to find out
// there was nothing to do.
//
// A count answers the only question the common case has, and the trim walks the
// timestamp index in the background where the records already are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const Vote = await loadModule('lib/modules/voteHistory.js', 'vote-history-prune', {
	stubEnvironment: true,
	dom: { url: 'https://old.reddit.com/r/example/', html: '<!doctype html><html><body></body></html>' },
	alsoExport: { db: 'lib/environment/foreground/featureDb.js' },
});

// Every message the module sends, in order, with what it carried.
function watchBridge(replies = {}) {
	const sent = [];
	globalThis.__runtimeMessageResponder = message => {
		sent.push(message);
		const reply = replies[message.type];
		return typeof reply === 'function' ? reply(message) : reply;
	};
	return sent;
}

function settle() {
	return new Promise(resolve => { setTimeout(resolve, 20); });
}

test('a vote below the cap asks how many there are, and reads nothing', async () => {
	const sent = watchBridge({ 'featureDb-count': 12 });
	try {
		Vote.module.options.maxRecords.value = '50000';
		await Vote._pruneIfNeeded();
		await settle();
	} finally {
		delete globalThis.__runtimeMessageResponder;
	}

	const types = sent.map(message => message.type);
	assert.deepEqual(types, ['featureDb-count'], `a prune under the cap sent ${JSON.stringify(types)}`);
	assert.equal(sent[0].data.store, 'voteHistory');
});

test('over the cap, the overflow is deleted where it lives', async () => {
	const sent = watchBridge({ 'featureDb-count': 60_100, 'featureDb-trim': 100 });
	try {
		Vote.module.options.maxRecords.value = '60000';
		await Vote._pruneIfNeeded();
		await settle();
	} finally {
		delete globalThis.__runtimeMessageResponder;
	}

	assert.deepEqual(sent.map(message => message.type), ['featureDb-count', 'featureDb-trim']);
	const trim = sent[1].data;
	assert.equal(trim.store, 'voteHistory');
	assert.equal(trim.keep, 60_000);
	// The index is what makes "oldest" mean anything: a store keyed on a
	// generated id has no useful key order.
	assert.equal(trim.index, 'timestamp');

	// And nothing was read. This is the whole point.
	assert.ok(!sent.some(message => message.type === 'featureDb-read'), 'the prune still reads the store');
});

test('the cap has a floor, whatever is typed into the box', async () => {
	// It is a free-text option, so it takes whatever the reader puts in it.
	for (const [typed, expected] of [['0', 100], ['-5', 100], ['nonsense', 50_000], ['', 50_000], ['250', 250]]) {
		const sent = watchBridge({ 'featureDb-count': 1e9, 'featureDb-trim': 0 });
		try {
			Vote.module.options.maxRecords.value = typed;
			// eslint-disable-next-line no-await-in-loop
			await Vote._pruneIfNeeded();
			// eslint-disable-next-line no-await-in-loop
			await settle();
		} finally {
			delete globalThis.__runtimeMessageResponder;
		}
		const trim = sent.find(message => message.type === 'featureDb-trim');
		assert.ok(trim, `"${typed}" never got as far as a trim`);
		assert.equal(trim.data.keep, expected, `"${typed}" kept ${trim.data.keep}`);
	}
});
