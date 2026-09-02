import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadFlowModule, readRepoFile, codeOnly, repoRoot } from './helpers/loadFlowModule.mjs';
import { loadModule } from './helpers/loadModule.mjs';

const PrivateStorage = await loadFlowModule(
	'lib/environment/foreground/privateBrowsing.js',
	'private-feature-storage-policy',
);

const REQUIRED_PRIVATE_BLOCKS = [
	'mediaArchiveManifest',
	'savedBackup',
	'subredditEmotes',
	'userTagger',
	'visitedPosts',
	'voteHistory',
];

function javascriptFiles(root) {
	const files = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...javascriptFiles(full));
		else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
	}
	return files;
}

function repoRelative(file) {
	return path.relative(repoRoot, file).split(path.sep).join('/');
}

test('the sensitive feature stores default to blocking private persistence', () => {
	assert.equal(typeof PrivateStorage.canPersistFeatureData, 'function');
	for (const id of REQUIRED_PRIVATE_BLOCKS) {
		assert.equal(
			PrivateStorage.FEATURE_DATA_STORE_POLICIES[id],
			'block',
			`${id} must not persist private-window activity`,
		);
	}

	const previousChrome = globalThis.chrome;
	globalThis.chrome = { extension: { inIncognitoContext: false } };
	try {
		assert.equal(PrivateStorage.canPersistFeatureData('visitedPosts'), true);
		globalThis.chrome.extension.inIncognitoContext = true;
		assert.equal(PrivateStorage.canPersistFeatureData('visitedPosts'), false);
		assert.equal(PrivateStorage.canPersistFeatureData('versionLifecycle'), true);
		assert.throws(
			() => PrivateStorage.canPersistFeatureData('notRegistered'),
			/does not declare a private-context policy/,
		);
		assert.throws(
			() => PrivateStorage.canPersistFeatureData('__proto__'),
			/does not declare a private-context policy/,
		);
	} finally {
		globalThis.chrome = previousChrome;
	}
});

test('every module-owned storage wrapper declares a registered feature policy', () => {
	const sources = [
		...javascriptFiles(path.join(repoRoot, 'lib', 'modules')),
		...javascriptFiles(path.join(repoRoot, 'lib', 'utils')),
	]
		.map(file => ({ file, code: codeOnly(fs.readFileSync(file, 'utf8')) }));
	const undeclared = [];
	const ids = new Set();

	for (const { file, code } of sources) {
		for (const match of code.matchAll(/Storage\.(wrap|wrapBlob|wrapPrefix|wrapPrefix2)\s*\(/g)) {
			undeclared.push(`${repoRelative(file)}:${code.slice(0, match.index).split('\n').length}`);
		}
		for (const match of code.matchAll(/Storage\.wrapFeature(?:Blob|Prefix2|Prefix)?\s*\(\s*'([^']+)'/g)) {
			ids.add(match[1]);
		}
	}

	assert.deepEqual(undeclared, [], `generic feature storage wrappers need a policy:\n${undeclared.join('\n')}`);
	assert.ok(ids.size > REQUIRED_PRIVATE_BLOCKS.length, 'the registry must cover all module-owned feature storage, not only the six blocked stores');
	for (const id of ids) {
		assert.ok(
			Object.hasOwn(PrivateStorage.FEATURE_DATA_STORE_POLICIES, id),
			`${id} is used without a registered private-context policy`,
		);
	}

	const history = codeOnly(readRepoFile('lib/environment/foreground/history.js'));
	const maintenance = codeOnly(readRepoFile('lib/utils/storage.js'));
	assert.match(history, /wrapFeatureBlob\(\s*'visitedLinks'/);
	assert.match(maintenance, /Storage\.wrapFeature\(\s*'storageMaintenance'/);
});

test('no feature owner opens IndexedDB itself, and the one that does guards every store', () => {
	// The data sets moved out of reddit.com's storage and into the extension's,
	// so the only context that may open a database is the background page. A
	// module or helper that opens one again is opening the wrong origin's, and
	// the settings page loses sight of whatever it writes there.
	const roots = [path.join(repoRoot, 'lib', 'modules'), path.join(repoRoot, 'lib', 'utils')];
	const owners = roots.flatMap(javascriptFiles)
		.map(file => ({ file, code: codeOnly(fs.readFileSync(file, 'utf8')) }))
		.filter(({ code }) => code.includes('indexedDB.open'));
	assert.deepEqual(owners.map(({ file }) => repoRelative(file)).sort(), []);

	// The comment stripper has to have run for that to mean anything: several of
	// these files describe IndexedDB in their headers.
	assert.ok(readRepoFile('lib/utils/featureStores.js').includes('`indexedDB`'));
	assert.ok(!codeOnly(readRepoFile('lib/utils/featureStores.js')).includes('`indexedDB`'));

	// Every caller of the bridge still consults the private-context policy. The
	// bridge itself deliberately does not: the saved-content manager has an
	// in-tab fallback that a blanket guard would pre-empt.
	const callers = roots.flatMap(javascriptFiles)
		.map(file => ({ file, code: codeOnly(fs.readFileSync(file, 'utf8')) }))
		.filter(({ code }) => /from '[^']*foreground\/featureDb'/.test(code));
	assert.ok(callers.length >= 4, 'the local data sets all read through the bridge');
	for (const { file, code } of callers) {
		assert.ok(
			code.includes('canPersistFeatureData('),
			`${repoRelative(file)} uses the feature database without the shared policy guard`,
		);
		// Where the store is named literally, it has to be a registered one. The
		// dashboard reads the id off the descriptor instead, because it covers
		// every set rather than one.
		for (const [, id] of code.matchAll(/canPersistFeatureData\(\s*'([^']+)'/g)) {
			assert.ok(Object.hasOwn(PrivateStorage.FEATURE_DATA_STORE_POLICIES, id), `${id} has no registered policy`);
		}
	}
});

test('policy-aware chrome storage wrappers suppress every private mutation', async () => {
	const Storage = await loadModule(
		'lib/environment/foreground/storage.js',
		'private-feature-storage-wrapper',
	);
	const key = 'RESmodules.privatePolicy.contract';
	const store = Storage.wrapFeatureBlob('visitedPosts', key, () => 0);

	globalThis.chrome.extension.inIncognitoContext = false;
	await store.set('t3_normal', 1);
	assert.deepEqual(await store.getAll(), { t3_normal: 1 });

	globalThis.chrome.extension.inIncognitoContext = true;
	await store.set('t3_private', 2);
	await store.patch('t3_normal', 3);
	await store.delete('t3_normal');
	await store.clear();
	assert.deepEqual(await store.getAll(), { t3_normal: 1 });

	globalThis.chrome.extension.inIncognitoContext = false;
	await store.clear();
});

// Counting bridge messages, not IndexedDB opens. Once the databases moved into
// the extension's origin nothing in a content script opened one at all, so
// asserting on `indexedDB.open` passed no matter what these functions did — the
// exact shape of a test that has quietly stopped testing. Each half below
// therefore carries a positive control: the same call outside a private window
// must reach the store.
function recordBridgeMessages() {
	const sent = [];
	globalThis.__runtimeMessageResponder = message => {
		if (!String(message.type).startsWith('featureDb-')) return undefined;
		sent.push(message.type);
		return message.type === 'featureDb-count' || message.type === 'featureDb-clear' ? 0 : [];
	};
	return sent;
}

const SAVED_ITEM = {
	fullname: 't3_private',
	kind: 't3',
	id: 'private',
	subreddit: 'test',
	author: 'alice',
	permalink: '/r/test/comments/private',
	createdUtc: 1,
	body: '',
	title: 'Private',
	url: '',
	score: 1,
};

test('private saved-content and emoji operations never reach the store', async () => {
	const sent = recordBridgeMessages();
	globalThis.chrome.extension.inIncognitoContext = true;

	const Saved = await loadModule('lib/utils/savedBackup.js', 'private-saved-content');
	assert.deepEqual(await Saved.loadSavedRecords('alice'), []);
	const ephemeral = await Saved.mergeSavedRecordsIntoStore('alice', [SAVED_ITEM], 10);
	assert.equal(ephemeral.length, 1);
	assert.equal(await Saved.updateSavedRecordTags('alice', 't3_private', ['private']), null);
	assert.equal(await Saved.purgeSavedRecords('alice'), 0);

	const Emotes = await loadModule('lib/utils/subredditEmoteStore.js', 'private-subreddit-emotes');
	assert.equal(await Emotes.readEmoteCache('test'), null);
	await Emotes.writeEmoteCache({ subreddit: 'test', fetchedAt: 1, emotes: {}, threads: {} }, 1000);
	assert.deepEqual(sent, []);

	// Positive control: the same calls outside a private window do reach it.
	globalThis.chrome.extension.inIncognitoContext = false;
	await Saved.loadSavedRecords('alice');
	await Emotes.readEmoteCache('test');
	assert.deepEqual(sent, ['featureDb-read', 'featureDb-get']);
	globalThis.__runtimeMessageResponder = undefined;
});

test('private vote and media writers stop before the store', async () => {
	const sent = recordBridgeMessages();
	globalThis.chrome.extension.inIncognitoContext = true;

	const Vote = await loadModule('lib/modules/voteHistory.js', 'private-vote-history');
	const voteRecord = {
		id: '1',
		fullname: 't3_private',
		kind: 't3',
		direction: 'up',
		subreddit: 'test',
		author: 'alice',
		permalink: '/r/test/comments/private',
		snippet: '',
		scoreAtTime: 1,
		timestamp: 1,
	};
	await Vote._internal.putRecord(voteRecord);
	const Media = await loadModule('lib/modules/mediaArchiveManifest.js', 'private-media-manifest');
	const mediaEntry = {
		id: '1',
		url: 'https://example.com/private.jpg',
		filename: 'private.jpg',
		postPermalink: '',
		postFullname: 't3_private',
		subreddit: 'test',
		source: 'manual',
		mime: '',
		bytes: 0,
		timestamp: 1,
	};
	await Media._internal.putEntry(mediaEntry);
	assert.deepEqual(sent, []);

	globalThis.chrome.extension.inIncognitoContext = false;
	await Vote._internal.putRecord(voteRecord);
	await Media._internal.putEntry(mediaEntry);
	assert.deepEqual(sent, ['featureDb-write', 'featureDb-write']);
	globalThis.__runtimeMessageResponder = undefined;
});
