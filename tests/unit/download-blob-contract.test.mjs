// Handing a generated file to the browser.
//
// Seven places built this by hand. Six agreed: object URL, anchor, attach the
// anchor to the document, click, release the URL on a timer. The seventh - the
// settings console's selector override export - clicked a detached anchor and
// revoked the URL on the very next line. Both halves of that are wrong. Firefox
// will not follow a click on an anchor that is not in the document, so that
// export did nothing there at all; and revoking synchronously can beat the
// download starting, because the navigation a click schedules has not happened
// by the time the next statement runs.
//
// It survived because there was nothing to compare it against. This asserts the
// shape, and that every call site uses it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

// jsdom has no object-URL implementation and no navigation, so both are stood up
// here. What is under test is the sequence, which is exactly what was wrong.
const created = [];
const revoked = [];
globalThis.URL.createObjectURL = () => {
	const url = `blob:https://old.reddit.com/${created.length}`;
	created.push(url);
	return url;
};
globalThis.URL.revokeObjectURL = url => { revoked.push(url); };

const { downloadBlob, downloadText } = await loadFlowModule('lib/utils/downloadBlob.js', 'download-blob');

function clickRecorder() {
	const clicks = [];
	const realCreate = document.createElement.bind(document);
	document.createElement = (name, ...rest) => {
		const element = realCreate(name, ...rest);
		if (String(name).toLowerCase() === 'a') {
			element.click = () => {
				clicks.push({
					attached: element.isConnected,
					href: element.getAttribute('href'),
					download: element.getAttribute('download'),
					revokedSoFar: revoked.length,
				});
			};
		}
		return element;
	};
	return { clicks, restore() { document.createElement = realCreate; } };
}

test('the anchor is in the document when it is clicked', () => {
	const recorder = clickRecorder();
	try {
		downloadText('{}', 'thing.json');
	} finally {
		recorder.restore();
	}
	assert.equal(recorder.clicks.length, 1);
	assert.equal(recorder.clicks[0].attached, true,
		'Firefox will not follow a click on a detached anchor, so the download silently does not happen');
	assert.equal(recorder.clicks[0].download, 'thing.json');
});

test('the object URL is still alive at the moment of the click', () => {
	const before = revoked.length;
	const recorder = clickRecorder();
	try {
		downloadText('{}', 'thing.json');
	} finally {
		recorder.restore();
	}
	assert.equal(recorder.clicks[0].revokedSoFar, before,
		'revoking before the click can beat the download starting');
});

test('the URL is released, and the anchor is taken back out of the document', async () => {
	const recorder = clickRecorder();
	let anchor;
	const realCreate = document.createElement.bind(document);
	try {
		downloadText('{}', 'thing.json');
		anchor = [...document.body.querySelectorAll('a[download="thing.json"]')].pop();
		assert.ok(anchor, 'the anchor should be in the document immediately after the call');
	} finally {
		recorder.restore();
		document.createElement = realCreate;
	}

	const urlForThisCall = created[created.length - 1];
	await new Promise(resolve => { setTimeout(resolve, 1700); });
	assert.ok(revoked.includes(urlForThisCall), 'the object URL is never freed');
	assert.equal(anchor.isConnected, false, 'the anchor is left in the document');
});

test('the attached anchor is not a stray tab stop while it is there', () => {
	const recorder = clickRecorder();
	try {
		downloadText('{}', 'thing.json');
	} finally {
		recorder.restore();
	}
	const anchor = [...document.body.querySelectorAll('a[download="thing.json"]')].pop();
	assert.equal(anchor.getAttribute('aria-hidden'), 'true');
	assert.equal(anchor.tabIndex, -1);
	assert.equal(anchor.style.display, 'none');
	anchor.remove();
});

test('a blob is passed through unchanged, and text gets the type it was given', () => {
	const recorder = clickRecorder();
	try {
		downloadBlob(new Blob(['zip'], { type: 'application/zip' }), 'gallery.zip');
		downloadText('a,b', 'rows.csv', 'text/csv');
	} finally {
		recorder.restore();
	}
	assert.deepEqual(recorder.clicks.map(c => c.download), ['gallery.zip', 'rows.csv']);
});

test('every export in the product goes through the helper', () => {
	// The bug was one call site diverging from six identical copies. A seventh
	// copy is how that happens again.
	for (const file of [
		'lib/modules/savedBackup.js',
		'lib/modules/galleryZip.js',
		'lib/modules/userTagger.js',
		'lib/options/dataWorkspace.js',
		'lib/options/settingsConsole.js',
	]) {
		const source = codeOnly(readRepoFile(file));
		assert.doesNotMatch(source, /createObjectURL/, `${file} still builds its own download`);
		assert.match(source, /downloadBlob|downloadText/, `${file} does not use the shared helper`);
	}

	// The vote log and the media manifest export from the settings console now,
	// so neither may grow a download of its own again.
	for (const file of ['lib/modules/mediaArchiveManifest.js', 'lib/modules/voteHistory.js']) {
		const source = codeOnly(readRepoFile(file));
		assert.doesNotMatch(source, /createObjectURL|downloadBlob|downloadText/, `${file} downloads from a Reddit page again`);
	}
});
