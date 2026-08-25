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

test('every direct feature IndexedDB owner checks the shared policy before opening', () => {
	const roots = [path.join(repoRoot, 'lib', 'modules'), path.join(repoRoot, 'lib', 'utils')];
	const owners = roots.flatMap(javascriptFiles)
		.filter(file => path.basename(file) !== 'storageDashboard.js')
		.map(file => ({ file, code: codeOnly(fs.readFileSync(file, 'utf8')) }))
		.filter(({ code }) => code.includes('indexedDB.open'));

	assert.deepEqual(
		owners.map(({ file }) => repoRelative(file)).sort(),
		[
			'lib/modules/mediaArchiveManifest.js',
			'lib/modules/voteHistory.js',
			'lib/utils/savedBackup.js',
			'lib/utils/subredditEmoteStore.js',
		],
	);
	for (const { file, code } of owners) {
		const guard = /canPersistFeatureData\(\s*'([^']+)'/.exec(code);
		assert.ok(guard, `${repoRelative(file)} opens IndexedDB without the shared policy guard`);
		assert.ok(Object.hasOwn(PrivateStorage.FEATURE_DATA_STORE_POLICIES, guard[1]));
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

test('private saved-content and emoji operations never open IndexedDB', async () => {
	let opens = 0;
	globalThis.indexedDB = { open() { opens += 1; throw new Error('IndexedDB must stay closed'); } };
	globalThis.chrome.extension.inIncognitoContext = true;

	const Saved = await loadModule('lib/utils/savedBackup.js', 'private-saved-content');
	assert.deepEqual(await Saved.loadSavedRecords('alice'), []);
	const ephemeral = await Saved.mergeSavedRecordsIntoStore('alice', [{
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
	}], 10);
	assert.equal(ephemeral.length, 1);
	assert.equal(await Saved.updateSavedRecordTags('alice', 't3_private', ['private']), null);
	assert.equal(await Saved.purgeSavedRecords('alice'), 0);

	const Emotes = await loadModule('lib/utils/subredditEmoteStore.js', 'private-subreddit-emotes');
	assert.equal(await Emotes.readEmoteCache('test'), null);
	await Emotes.writeEmoteCache({ subreddit: 'test', fetchedAt: 1, emotes: {}, threads: {} }, 1000);
	assert.equal(opens, 0);
	globalThis.chrome.extension.inIncognitoContext = false;
});

test('private vote and media writers stop before IndexedDB is opened', async () => {
	let opens = 0;
	globalThis.indexedDB = { open() { opens += 1; throw new Error('IndexedDB must stay closed'); } };
	globalThis.chrome.extension.inIncognitoContext = true;

	const Vote = await loadModule('lib/modules/voteHistory.js', 'private-vote-history');
	await Vote._internal.putRecord({
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
	});
	const Media = await loadModule('lib/modules/mediaArchiveManifest.js', 'private-media-manifest');
	await Media._internal.putEntry({
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
	});

	assert.equal(opens, 0);
	globalThis.chrome.extension.inIncognitoContext = false;
});
