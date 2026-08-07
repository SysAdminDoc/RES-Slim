// Bundle a `lib/modules/<id>.js` and execute it, with the browser environment
// stubbed, so a contract can call the module's real functions.
//
// Why this exists: 51 of the suite's files only regex module source. A source
// assertion cannot tell you whether the code runs — `eventTrackingSabotage`'s
// fetch blocker was green for its entire life while blocking nothing. The pure
// helpers in `lib/utils/` are already executed via `loadFlowModule`, but modules
// themselves could not be, because `lib/modules/*.js` reach `../environment`
// (chrome APIs), `../core/module` and the DOM at import time.
//
// esbuild is already a dependency and already knows how to strip this repo's Flow
// types, so it does the bundling; the browser surface is supplied as stub modules
// resolved by path alias. The point is that everything *inside* `lib/` is real —
// only the outermost browser boundary is replaced.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import flowRemoveTypes from 'flow-remove-types';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// Minimal chrome surface. Anything a module actually depends on should be added
// here deliberately rather than auto-mocked, so a test can never pass because a
// call silently returned undefined.
// Wrapped in an IIFE: this is injected as a banner into the same top-level scope
// as the bundle, and bundled `lib/` code declares its own `listeners`.
const CHROME_STUB = `
(() => {
const noop = () => {};
const listeners = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });
globalThis.chrome = globalThis.chrome || {
	runtime: {
		id: 'res-slim-test',
		getURL: p => 'chrome-extension://res-slim-test/' + String(p).replace(/^\\//, ''),
		getManifest: () => ({ version: '0.0.0-test', name: 'RES-Slim' }),
		sendMessage: (msg, cb) => { if (cb) cb({ data: undefined }); },
		onMessage: listeners(),
		onInstalled: listeners(),
	},
	// A real in-memory store, not a sink. A stub whose get() always returns {}
	// makes every storage-backed assertion vacuous — the code under test writes,
	// reads nothing back, and the test either passes for the wrong reason or fails
	// for a reason that has nothing to do with the product.
	//
	// Mirrors the chrome.storage.local shapes lib/environment/foreground/storage.js
	// actually calls: get(null) for everything, get({key: default}) for defaults,
	// set(items), remove(keyOrKeys), clear().
	storage: { local: (() => {
		const data = new Map();
		const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
		return {
			get(keys, cb) {
				const out = {};
				if (keys === null || keys === undefined) {
					for (const [k, v] of data) out[k] = clone(v);
				} else if (typeof keys === 'string') {
					out[keys] = data.has(keys) ? clone(data.get(keys)) : undefined;
				} else if (Array.isArray(keys)) {
					for (const k of keys) if (data.has(k)) out[k] = clone(data.get(k));
				} else {
					for (const [k, fallback] of Object.entries(keys)) {
						out[k] = data.has(k) ? clone(data.get(k)) : fallback;
					}
				}
				if (cb) cb(out);
			},
			set(items, cb) {
				for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
				if (cb) cb();
			},
			remove(keys, cb) {
				for (const k of [].concat(keys)) data.delete(k);
				if (cb) cb();
			},
			clear(cb) {
				data.clear();
				if (cb) cb();
			},
		};
	})() },
	tabs: { create: noop, query: (q, cb) => cb && cb([]), sendMessage: noop },
	i18n: { getMessage: k => k },
	// isPrivateBrowsing() reads this. Missing, it throws from inside a
	// fire-and-forget promise, which node:test reports as activity *after* the
	// test ended rather than as a failure — so the test looks green-ish and the
	// real error is a footnote.
	extension: { inIncognitoContext: false },
};
})();
`;

const ENVIRONMENT_STUB = `
export const context = { origin: 'https://old.reddit.com', pathname: '/' };
export const isOptionsPage = () => false;
export const getOptionsURL = (hash = '') => 'chrome-extension://res-slim-test/options.html' + hash;
export const getExtensionId = () => 'res-slim-test';
// i18n echoes the key, exactly as the real one does — a missing string renders as
// its own key rather than throwing, and tests must see that same behaviour.
export const i18n = (key, ...args) => String(key);
export const openNewTab = () => {};
export const openNewTabs = () => {};
export const ajax = async () => { throw new Error('ajax() is not stubbed for this test; inject a fake instead'); };
export const Storage = {
	get: async () => null,
	set: async () => {},
	delete: async () => {},
	has: async () => false,
	wrapBlob: () => ({ get: async () => ({}), set: async () => {}, patch: async () => {} }),
	wrapPrefix: () => ({ get: async () => null, set: async () => {}, delete: async () => {} }),
};
export const Session = { get: async () => null, set: async () => {}, has: async () => false, delete: async () => {} };
export const XhrCache = { new: async () => {}, check: async () => null, clear: async () => {} };
export const multicast = () => () => {};
export const addURLToHistory = () => {};
export const isURLVisited = async () => false;
export const download = () => {};
export const loadScript = async () => {};
export const PageAction = { show: () => {}, hide: () => {}, destroy: () => {} };
export const Permissions = { request: async () => true, has: async () => true };
export const getLastRedditLocale = async () => 'en';
export const setLastRedditLocale = async () => {};
export const locale = 'en';
export const _loadI18n = async () => {};
export const isPrivateBrowsing = () => false;
`;

let stubDirPromise;
async function stubDir() {
	if (!stubDirPromise) {
		stubDirPromise = (async () => {
			const dir = path.join(repoRoot, 'tests', 'unit', '.tmp-module-stubs');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'environment.js'), ENVIRONMENT_STUB);
			return dir;
		})();
	}
	return stubDirPromise;
}

// Modules touch the DOM while their module body evaluates, not only inside
// `go()`, so a document has to exist before the import — hence jsdom rather than
// a hand-rolled stub tower. `url` matters: `currentLocation.js` reads
// `location.pathname` to decide page type, and the xmlns attribute is what makes
// `appType()` report old reddit ('r2') instead of the redesign ('d2x').
export function installDom({ url = 'https://old.reddit.com/', html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>' } = {}) {
	const dom = new JSDOM(html, { url, pretendToBeVisual: true });
	const { window } = dom;

	for (const key of ['window', 'document', 'location', 'navigator', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLAnchorElement', 'HTMLLIElement', 'HTMLInputElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'getComputedStyle', 'DOMParser', 'XMLSerializer', 'requestAnimationFrame', 'cancelAnimationFrame']) {
		if (!(key in window)) continue;
		// Node 24 defines `navigator` (and friends) as getter-only on globalThis, so
		// a plain assignment throws. defineProperty replaces them outright.
		Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
	}
	// jsdom implements neither observer; several modules construct one while their
	// module body evaluates, so these must exist before the import, not before the
	// first call. Inert on purpose — a test that needs observer callbacks to fire
	// belongs in tests/e2e/ against a real browser, not here.
	class InertObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() { return []; }
	}
	for (const name of ['IntersectionObserver', 'ResizeObserver', 'PerformanceObserver']) {
		if (!globalThis[name]) globalThis[name] = InertObserver;
	}

	return dom;
}

/**
 * Bundle and evaluate a module, returning its exports.
 *
 * `name` scopes the output directory so parallel suites cannot overwrite each
 * other. `dom` installs a jsdom document first; `globals` is merged into
 * globalThis after that, so a test can override any piece of it.
 */
export async function loadModule(relativePath, name, { globals = {}, dom, stubEnvironment = false } = {}) {
	const stubs = await stubDir();
	if (dom !== false) installDom(dom || {});
	const outDir = path.join(repoRoot, 'tests', 'unit', `.tmp-mod-${name}`);
	fs.mkdirSync(outDir, { recursive: true });
	const outFile = path.join(outDir, `${path.basename(relativePath, '.js')}.cjs`);

	// Enter through `lib/core/modules/modules.js`, then re-export the target.
	//
	// There is a genuine import cycle here: `modules.js` builds its registry from
	// `Object.values()` of the module index at module-body time, and the modules in
	// that index import the registry back. The product survives it because esbuild
	// emits bundled modules in depth-first *post* order — reaching the registry
	// first means the whole index is emitted before the registry's own body runs.
	//
	// Enter at a module file (or at the index) instead and the traversal arrives at
	// `modules.js` from inside the index, so the registry's body is emitted first
	// and every module reads back as `undefined`. `lib/core/init.js` reaches it the
	// same way this does, which is why the shipped bundle works.
	const entryFile = path.join(outDir, '__entry.js');
	// esbuild resolves plain paths, not file:// URLs. Forward slashes so the
	// generated source is valid on Windows too.
	const posix = p => p.split(path.sep).join('/');
	const toTarget = posix(path.join(repoRoot, relativePath));
	const toRegistry = posix(path.join(repoRoot, 'lib', 'core', 'modules', 'modules.js'));
	//
	// The registry is also re-exported as `__registry`. Two `loadModule` calls
	// produce two independent bundles, so a module object reached through one is a
	// *different object* from the one the other bundle's code closes over — setting
	// an option on it changes nothing the code under test can see. Reaching the
	// registry through the same bundle is the only way to mutate the options a
	// module actually reads.
	fs.writeFileSync(entryFile, [
		`import * as __registry from ${JSON.stringify(toRegistry)};`,
		'export { __registry };',
		`export * from ${JSON.stringify(toTarget)};`,
		'',
	].join('\n'));

	await esbuild.build({
		entryPoints: [entryFile],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		outfile: outFile,
		logLevel: 'silent',
		// Same loader map as build.js: several modules import icons, and without
		// these the bundle fails on an asset that has nothing to do with the test.
		loader: { '.svg': 'dataurl', '.gif': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl' },
		// `lib/environment` is the whole browser boundary; everything else in lib/
		// is bundled for real.
		plugins: [{
			// `lib/environment/` is bundled for real — its foreground modules sit
			// directly on the `chrome.*` surface the banner supplies, so stubbing the
			// layer above would mean testing against reimplemented storage semantics
			// instead of the product's. Only the modules that cannot work without a
			// live extension host are replaced, and each replacement is listed
			// explicitly so nothing is silently mocked.
			name: 'stub-environment',
			setup(build) {
				if (stubEnvironment) {
					build.onResolve({ filter: /(^|\/)environment$/ }, () => ({ path: path.join(stubs, 'environment.js') }));
				}
			},
		}, {
			// esbuild cannot parse Flow annotations, so strip them exactly as
			// build.js does — same stripper, so a test can never be reading
			// differently-transformed code than the shipped bundle.
			name: 'remove-flow-types',
			setup(build) {
				build.onLoad({ filter: /\.m?js$/ }, async args => ({
					contents: flowRemoveTypes(await fs.promises.readFile(args.path, 'utf8'), { pretty: true }).toString(),
					loader: 'js',
				}));
			},
		}],
		define: { 'process.env.NODE_ENV': '"test"' },
		banner: { js: CHROME_STUB },
	});

	for (const [key, value] of Object.entries(globals)) globalThis[key] = value;

	// Cache-bust so repeated loads in one process see fresh module state.
	return import(`${pathToFileURL(outFile).href}?t=${fs.statSync(outFile).mtimeMs}`);
}
