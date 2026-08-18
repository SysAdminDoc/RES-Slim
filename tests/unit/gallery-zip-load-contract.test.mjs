// `galleryZip` builds a real archive, and pays for JSZip only when asked to.
//
// The module used to write `await import('jszip')`, which reads as a lazy load
// and is not one: the build is `format: 'iife'` with no code splitting, so
// esbuild inlined all 153KB into the foreground content script — parsed on every
// Reddit page, for a module that is disabled by default. The build now refuses to
// bundle a vendored library (`verify-vendored-not-bundled` in build.js); these
// contracts cover the other half, that the on-demand path actually loads the
// library and still produces the same archive.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadModule } from './helpers/loadModule.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('no shipped source imports jszip — it is injected, not bundled', () => {
	// Asserted over the whole of `lib/` rather than over `galleryZip.js` alone:
	// the defect was not "this module imports it wrongly", it was "importing it at
	// all puts it in the content script", and that is true from anywhere in the
	// foreground graph.
	const offenders = [];
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.js')) {
				// Comments stripped first: this file's own explanation of the defect
				// quotes the offending call, and a scanner that trips over the note
				// describing the fix is the same class of bug it exists to catch.
				const source = fs.readFileSync(full, 'utf8')
					.replace(/\/\*[\s\S]*?\*\//g, '')
					.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');
				if (/(?:from|import\s*\()\s*['"]jszip['"]/.test(source)) {
					offenders.push(path.relative(repoRoot, full).split(path.sep).join('/'));
				}
			}
		}
	};
	walk(path.join(repoRoot, 'lib'));
	assert.deepEqual(offenders, [], 'jszip must reach the page through loadScript, never through an import');
});

test('the vendored file galleryZip asks for is one the build actually ships', () => {
	const mod = read('lib/modules/galleryZip.js');
	const requested = mod.match(/loadScript\('\/([\w.-]+)'\)/);
	assert.ok(requested, 'galleryZip must load its zip library with loadScript');

	// A typo here is invisible until a user clicks the button, because
	// `chrome.scripting.executeScript` rejects asynchronously inside a click
	// handler that already reports its own failure. Tie the string to the copy
	// list instead.
	const build = read('build.js');
	assert.ok(
		new RegExp(`file: '${requested[1].replace(/\./g, '\\.')}'`).test(build),
		`build.js does not ship ${requested[1]} as a vendored asset`,
	);
	assert.ok(
		fs.existsSync(path.join(repoRoot, 'node_modules/jszip/dist', requested[1])),
		'the vendored source file is missing from node_modules',
	);
});

test('every vendored asset carries a digest that matches the package on disk', async () => {
	const crypto = await import('node:crypto');
	const build = read('build.js');
	const block = build.slice(build.indexOf('const VENDORED_ASSETS'), build.indexOf('// The supported floor'));
	const entries = [...block.matchAll(/from: '([^']+)',\s*\n\s*sha256: '([0-9a-f]{64})'/g)];
	assert.ok(entries.length >= 2, 'expected dashjs and jszip to be declared as vendored assets');

	for (const [, from, sha256] of entries) {
		const content = fs.readFileSync(path.join(repoRoot, from.replace(/^\.\//, '')));
		const actual = crypto.createHash('sha256').update(content).digest('hex');
		assert.equal(actual, sha256, `${from} does not match its pinned digest`);
	}
});

// --- executing contract ------------------------------------------------------

// `Thing.thingElements` defaults to `.content[role="main"]` and does not
// null-check it, so a bare `.thing` with no page chrome throws inside the
// watcher rather than failing an assertion.
const GALLERY_POST = `<!doctype html><html><body class="listing-page">
	<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
	<div class="content" role="main"><div id="siteTable">
		<div class="thing link" id="thing_t3_abc" data-is-gallery="true" data-permalink="/r/test/comments/abc/x/" data-fullname="t3_abc">
			<div class="entry">
				<p class="title"><a class="title" href="#">A gallery: with/slashes</a></p>
				<ul class="flat-list buttons"><li><a href="#">permalink</a></li></ul>
			</div>
		</div>
	</div></div>
</body></html>`;

const GalleryZip = await loadModule('lib/modules/galleryZip.js', 'gallery-zip-run', {
	dom: { url: 'https://old.reddit.com/r/test/', html: GALLERY_POST },
	alsoExport: { watchers: 'lib/utils/watchers.js', thing: 'lib/utils/thing.js' },
});

const IMAGE_BYTES = {
	'https://preview.redd.it/mid1.jpg': new Uint8Array([1, 2, 3, 4]),
	'https://preview.redd.it/mid2.png': new Uint8Array([9, 9]),
};

function galleryJson() {
	return [{
		data: {
			children: [{
				data: {
					id: 'abc',
					is_gallery: true,
					gallery_data: { items: [{ media_id: 'mid1', caption: 'first' }, { media_id: 'mid2' }] },
					media_metadata: {
						mid1: { m: 'image/jpeg', s: { u: 'https://preview.redd.it/mid1.jpg' } },
						mid2: { m: 'image/png', s: { u: 'https://preview.redd.it/mid2.png' } },
					},
				},
			}],
		},
	}, {
		// The comments listing. `isRedditListingPair` requires *both* halves to be
		// real listings, so `{}` here fails validation before the gallery is ever
		// parsed — and the module reports "zip failed" with no clue why.
		data: { children: [] },
	}];
}

let downloaded = null;

// `watchForThings` without `{ immediate: true }` parks its callback in
// `thing.tasks.visible`, which the product drains from an IntersectionObserver
// on first paint. jsdom has neither, so the page has to be told it is visible —
// otherwise the module is loaded, the watcher is registered, and nothing at all
// happens, which reads exactly like a broken module.
function runQueuedThingTasks(bundle) {
	for (const element of document.querySelectorAll(bundle.thing.Thing.thingSelector)) {
		const thing = bundle.thing.Thing.from(element);
		if (thing) thing.runTasks();
	}
}

// `__fetchHook`, not `globalThis.fetch`: the harness reinstalls its network guard
// on every `installDom`, so a directly-assigned fetch is silently replaced the
// next time a module is loaded.
function installFetch({ failImage = null } = {}) {
	globalThis.__fetchHook = async url => {
		const href = String(url);
		if (href.includes('.json')) {
			return {
				ok: true,
				status: 200,
				headers: { get: name => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
				json: async () => galleryJson(),
			};
		}
		const key = href.split('?')[0];
		if (failImage && key === failImage) return { ok: false, status: 404, headers: { get: () => null } };
		const bytes = IMAGE_BYTES[key];
		assert.ok(bytes, `unexpected fetch for ${href}`);
		return { ok: true, status: 200, headers: { get: () => null }, blob: async () => new Blob([bytes]) };
	};
}

// Answers the `loadScript` message the way the background does: by executing the
// file in the page. The test loads the exact file build.js copies out of
// node_modules rather than the package's CommonJS entry point — that file is
// what a user's browser runs, and a UMD build that failed to define its global
// would be invisible to a test that imported the package instead.
//
// Answering at the chrome boundary means the *product's* loadScript runs,
// memoization included, rather than a stub standing in for it.
let injected = [];
function installLoadScript({ provide = true } = {}) {
	injected = [];
	globalThis.__runtimeMessageResponder = msg => {
		if (msg.type !== 'loadScript') return undefined;
		injected.push(msg.data.url);
		if (!provide) return undefined;
		if (!globalThis.window.JSZip) globalThis.window.JSZip = require('jszip/dist/jszip.min.js');
		return undefined;
	};
}

// jsdom implements neither, and `loadModule` installs a *new* jsdom (and so a new
// URL) on every call — so the stubs have to be reapplied against whichever URL is
// current, or a revoke timer armed by an earlier test lands on a later one's URL
// and surfaces as asynchronous activity after that test has ended.
function stubObjectUrls(onCreate) {
	globalThis.URL.createObjectURL = onCreate;
	globalThis.URL.revokeObjectURL = () => {};
}

async function clickZipButton() {
	downloaded = null;
	stubObjectUrls(blob => { downloaded = blob; return 'blob:res-slim-test'; });

	document.body.innerHTML = GALLERY_POST.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
	GalleryZip.module.contentStart();
	GalleryZip.watchers.registerPage(document.body);
	runQueuedThingTasks(GalleryZip);
	await new Promise(resolve => setTimeout(resolve, 0));

	const button = document.querySelector('.rsm-galleryZip-btn');
	assert.ok(button, 'the ZIP gallery button must be injected on a gallery post');
	button.click();

	for (let i = 0; i < 200 && !downloaded && !/failed/.test(button.textContent); i++) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	return button;
}

async function entriesOf(blob) {
	const JSZip = require('jszip');
	const archive = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
	const out = {};
	for (const [name, entry] of Object.entries(archive.files)) {
		if (entry.dir) continue;
		out[name] = Buffer.from(await entry.async('uint8array'));
	}
	return out;
}

test('clicking the button injects jszip once and produces the archive', async () => {
	installFetch();
	installLoadScript();

	const button = await clickZipButton();
	assert.ok(downloaded, `expected a download; button says "${button.textContent}"`);
	assert.deepEqual(injected, ['/jszip.min.js'], 'the library must be injected on use, not on page load');

	const entries = await entriesOf(downloaded);
	const names = Object.keys(entries).sort();
	assert.deepEqual(names, [
		'A gallery_ with_slashes/1.jpg',
		'A gallery_ with_slashes/2.png',
		'A gallery_ with_slashes/captions.txt',
	], 'the archive layout must not have changed with the load path');

	assert.deepEqual(entries['A gallery_ with_slashes/1.jpg'], Buffer.from([1, 2, 3, 4]), 'image bytes must survive verbatim');
	assert.deepEqual(entries['A gallery_ with_slashes/2.png'], Buffer.from([9, 9]));
	assert.match(entries['A gallery_ with_slashes/captions.txt'].toString('utf8'), /caption: first/);
});

test('a second click reuses the injected library instead of asking again', async () => {
	installFetch();
	injected = [];

	await clickZipButton();
	assert.ok(downloaded, 'the second archive must still be produced');
	assert.deepEqual(injected, [], 'loadScript is memoized per URL — a second click must not re-inject');
});

test('a failed image is recorded in the archive rather than losing the whole run', async () => {
	installFetch({ failImage: 'https://preview.redd.it/mid2.png' });

	await clickZipButton();
	assert.ok(downloaded, 'one dead image must not cost the user the other one');

	const entries = await entriesOf(downloaded);
	assert.ok(entries['A gallery_ with_slashes/1.jpg'], 'the image that worked is still there');
	const failure = entries['A gallery_ with_slashes/2.png.failed.txt'];
	assert.ok(failure, 'the image that did not must say so inside the archive');
	assert.match(failure.toString('utf8'), /preview\.redd\.it\/mid2\.png/);
});

test('the button reports failure when the library cannot be injected', async () => {
	// A fresh module instance: `loadScript` memoizes success, so a failure has to
	// be observed through a bundle that has not already loaded it.
	const Fresh = await loadModule('lib/modules/galleryZip.js', 'gallery-zip-noscript', {
		dom: { url: 'https://old.reddit.com/r/test/', html: GALLERY_POST },
		alsoExport: { watchers: 'lib/utils/watchers.js', thing: 'lib/utils/thing.js' },
	});
	installFetch();
	installLoadScript({ provide: false });
	delete globalThis.window.JSZip;
	stubObjectUrls(() => { throw new Error('nothing should be downloaded'); });

	document.body.innerHTML = GALLERY_POST.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
	Fresh.module.contentStart();
	Fresh.watchers.registerPage(document.body);
	runQueuedThingTasks(Fresh);
	await new Promise(resolve => setTimeout(resolve, 0));

	const button = document.querySelector('.rsm-galleryZip-btn');
	button.click();
	for (let i = 0; i < 200 && !/failed/.test(button.textContent); i++) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.match(button.textContent, /zip failed/, 'a missing library must surface, not hang on "zipping…"');
});
