// The declared network surface, checked against the code that uses it.
//
// `connect-src` in both manifests is `https:` — every HTTPS origin. That reads
// like a hole, and a roadmap item asked for it to be narrowed to a fixed list.
// It cannot be, and the reason is worth pinning rather than rediscovering: four
// integrations fetch an origin the *user* supplies at runtime, and no CSP written
// at build time can name those. `connect-src` is therefore not the gate here.
//
// The gates that are enforceable, and what this file checks:
//
//   1. `optional_host_permissions` — the origins the extension may ask for. An
//      entry no code path uses is an over-request, which is exactly what Chrome
//      Web Store's Limited Use policy (enforced 2026-08-01) targets.
//   2. Chrome MV3 and Firefox MV2 declaring the same origins. They spell the
//      field differently (`optional_host_permissions` vs origins mixed into
//      `optional_permissions`), which is how a one-sided edit goes unnoticed.
//   3. The user-configurable origin options themselves. A new one is a new
//      unbounded network destination and should be a deliberate, reviewed act,
//      not a `type: 'text'` option that slipped in.
//
// Every hardcoded URL literal in `lib/` is separately pinned by
// `privacy-outbound-urls.test.mjs`, so a new hardcoded host already fails there.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const readManifest = target => JSON.parse(fs.readFileSync(path.join(repoRoot, target, 'manifest.json'), 'utf8'));

const chrome = readManifest('chrome');
const firefox = readManifest('firefox');

const isOrigin = entry => /^https?:\/\//.test(entry);

// Firefox MV2 has no `optional_host_permissions`; origins live alongside API
// permissions in `optional_permissions`.
const chromeOptionalOrigins = (chrome.optional_host_permissions || []).slice().sort();
const firefoxOptionalOrigins = (firefox.optional_permissions || []).filter(isOrigin).sort();

function libSources() {
	const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
	});
	return walk(path.join(repoRoot, 'lib')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

const allSource = libSources();

// `https://api.tumblr.com/v2/blog/*/posts` is a match pattern, not a URL. Reduce
// it to the part that must appear verbatim in source: the host, plus the leading
// literal path segment if there is one before the first wildcard.
function matchableFragment(pattern) {
	const withoutScheme = pattern.replace(/^https?:\/\//, '');
	const upToWildcard = withoutScheme.split('*')[0];
	// A leading `*.` host wildcard leaves an empty first segment; fall back to the
	// registrable part after it (`*.redd.it/*` -> `redd.it`).
	if (upToWildcard === '' || upToWildcard === '.') {
		return withoutScheme.replace(/^\*\./, '').split('*')[0].replace(/\/$/, '');
	}
	return upToWildcard.replace(/\/$/, '');
}

// The reverse direction, which was missing.
//
// The three checks below all read manifest -> code: every declared origin must
// be used. Nothing read code -> manifest, so a site module could declare a
// `permissions` entry the manifest never lists, and `generateSiteModuleLock`
// would then ask the browser for an origin that is not in
// `optional_host_permissions` - a request the browser refuses outright.
//
// `hosts/tenor.js` shipped in exactly that state: it called
// `api.tenor.co/v1/gifs` with no `permissions` field at all and no manifest
// entry, so its expando could never have worked. Every one of its ten siblings
// that calls an API declares one, which is what made the omission invisible.
function declaredHostPermissions() {
	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const declared = new Map();
	for (const name of fs.readdirSync(hostsDir)) {
		if (!name.endsWith('.js')) continue;
		const source = fs.readFileSync(path.join(hostsDir, name), 'utf8');
		const block = /permissions:\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*[^,\n]*)/.exec(source);
		if (!block) continue;
		// Only literal arrays can be compared statically. mastodon builds its list
		// from KNOWN_INSTANCES, and 'the mastodon handler is the sixth unbounded
		// destination' below already covers it.
		if (!block[1].startsWith('[')) continue;
		const origins = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
		if (origins.length) declared.set(`lib/modules/hosts/${name}`, origins);
	}
	return declared;
}

test('every origin a site module declares is one the manifest can grant', () => {
	const declared = declaredHostPermissions();
	assert.ok(declared.size >= 8, `expected most API hosts to declare permissions, found ${declared.size}`);

	const missing = [];
	for (const [file, origins] of declared) {
		for (const origin of origins) {
			if (!chromeOptionalOrigins.includes(origin)) missing.push(`${file} -> ${origin} (chrome)`);
			if (!firefoxOptionalOrigins.includes(origin)) missing.push(`${file} -> ${origin} (firefox)`);
		}
	}
	assert.deepEqual(missing, [], `site modules ask for origins the manifest never declares:\n  ${missing.join('\n  ')}`);
});

test('every optional host permission is reachable from code', () => {
	assert.ok(chromeOptionalOrigins.length > 0, 'the manifest must declare optional origins, or this test checks nothing');

	const unused = chromeOptionalOrigins.filter(pattern => !allSource.includes(matchableFragment(pattern)));

	assert.deepEqual(
		unused,
		[],
		'an optional host permission no code path uses is an over-request — delete it, or the module that needed it',
	);
});

test('every optional API permission is requested by some code path', () => {
	// The host half of this was already covered; the API half was not, and
	// `geolocation` sat in both shipped manifests for the life of the fork
	// without a single caller — its only other occurrence in the tree was a
	// human-readable label in the permission prompt. Dead surface on the trust
	// prompt of an extension whose whole pitch is that it collects nothing.
	const isApiPermission = entry => !isOrigin(entry) && entry !== '<all_urls>';
	const chromeOptional = (chrome.optional_permissions || []).filter(isApiPermission);
	const firefoxOptional = (firefox.optional_permissions || []).filter(isApiPermission);

	assert.deepEqual(chromeOptional.slice().sort(), firefoxOptional.slice().sort(), 'the two manifests must ask for the same API permissions');
	assert.ok(chromeOptional.length > 0, 'if this list empties, delete this test rather than leaving it vacuous');

	// Whitespace-stripped rather than a regex: the pattern to find is a literal
	// call shape, and escaping it correctly is exactly the sort of detail that
	// silently turns a contract into one that matches nothing.
	const compact = allSource.replace(/\s+/g, '');
	const unused = chromeOptional.filter(name =>
		!compact.includes(`Permissions.request(['${name}'`) &&
		!compact.includes(`Permissions.has(['${name}'`));

	assert.deepEqual(
		unused,
		[],
		'an optional permission nothing ever requests is an over-request the user sees and no feature uses',
	);
});

test('the matchable fragment really is what has to appear in source', () => {
	// Guard for the test above: if `matchableFragment` returned something trivial
	// (an empty string, or a substring present in every file), the check would pass
	// for every pattern including a bogus one.
	assert.equal(matchableFragment('https://*.redd.it/*'), 'redd.it');
	assert.equal(matchableFragment('https://api.tumblr.com/v2/blog/*/posts'), 'api.tumblr.com/v2/blog');
	assert.equal(matchableFragment('https://embed.bsky.app/oembed'), 'embed.bsky.app/oembed');

	for (const pattern of chromeOptionalOrigins) {
		assert.ok(matchableFragment(pattern).length > 3, `${pattern} reduces to too little to be evidence of anything`);
	}

	assert.ok(
		!allSource.includes(matchableFragment('https://not-a-real-host.example/api')),
		'a host the code does not reference must not read as used',
	);
});

test('chrome and firefox declare the same optional origins', () => {
	assert.deepEqual(
		firefoxOptionalOrigins,
		chromeOptionalOrigins,
		'the two manifests spell this field differently, so a one-sided edit is easy to miss and leaves one browser unable to request a permission the other can',
	);
});

test('reddit is the only origin granted up front', () => {
	assert.deepEqual(chrome.host_permissions, ['https://*.reddit.com/*']);
	assert.deepEqual(
		(firefox.permissions || []).filter(isOrigin),
		['https://*.reddit.com/*'],
		'anything beyond reddit must be optional and requested at runtime',
	);
});

test('connect-src permits the localhost integrations and nothing over plain http beyond them', () => {
	const csp = chrome.content_security_policy.extension_pages;
	const connectSrc = (csp.match(/connect-src ([^;]+)/) || [])[1];
	assert.ok(connectSrc, 'connect-src must be declared explicitly, not inherited from default-src');

	const sources = connectSrc.trim().split(/\s+/);
	const insecure = sources.filter(s => s.startsWith('http:'));

	assert.deepEqual(
		insecure.sort(),
		['http://127.0.0.1:*', 'http://localhost:*'],
		'the only cleartext destinations are the user-run local companion; a new http: source is a downgrade',
	);
});

// --- the reason connect-src cannot be a fixed list -------------------------

const Modules = await loadModule('lib/core/modules/modules.js', 'host-permissions');

// Every free-text option that holds a URL, classified. `fetches: true` means the
// value becomes a request destination, which is what forces `connect-src https:`.
// `fetches: false` means it only ever gets matched against — pinned anyway,
// because the difference is the whole point and is not visible from the option.
//
// The roadmap recorded four such surfaces. There are six: it missed both
// Arctic Shift instance fields, which default to a third-party public instance
// that has no host permission and works purely on that server's CORS `*`.
const URL_TEXT_OPTIONS = {
	'arcticShift.instance': { fetches: true },
	'cobaltDownloader.companionUrl': { fetches: true },
	'cobaltDownloader.instance': { fetches: true },
	'editedCommentDiff.instance': { fetches: true },
	'imgurFlatten.mirrors': { fetches: true },
	'localCompanion.companionUrl': { fetches: true },
	// A substring blocklist matched against post URLs. Never requested.
	'scopedFilters.urlSubstrings': { fetches: false },
};

test('the user-configurable network destinations are the ones we think they are', () => {
	const found = [];

	for (const module of Modules.all()) {
		for (const [key, option] of Object.entries(module.options || {})) {
			if (!option || option.type !== 'text') continue;
			// Either it ships a URL as its default, or its title says it takes one.
			const value = String(option.value || '');
			const title = String(option.title || '');
			if (!/:\/\//.test(value) && !/\burls?\b/i.test(title)) continue;
			found.push(`${module.moduleID}.${key}`);
		}
	}

	assert.deepEqual(
		found.sort(),
		Object.keys(URL_TEXT_OPTIONS).sort(),
		'a new free-text URL option may be a new unbounded network destination — classify it here, or narrow its type',
	);
});

test('the mastodon handler is the sixth unbounded destination, and knows it', async () => {
	// Not an option, so the scan above cannot see it: the instance host comes from
	// the *link the user clicked*, and the handler asks that host's own oembed
	// endpoint. Listing every fediverse server is not possible, which is the
	// clearest single reason `connect-src` cannot become a fixed allowlist.
	const source = fs.readFileSync(path.join(repoRoot, 'lib', 'modules', 'hosts', 'mastodon.js'), 'utf8');

	assert.match(source, /KNOWN_INSTANCES/, 'the shipped-permission set must be an explicit, reviewable list');
	assert.match(
		source,
		/permissions:\s*KNOWN_INSTANCES\.map/,
		'the handler must request permission only for the instances it ships, not a wildcard',
	);
});

test('the two localhost-only options are rejected at runtime if they are not localhost', async () => {
	// `optional_host_permissions` grants localhost, but the option is free text and
	// nothing in the manifest stops a user pasting a remote host into it. Both
	// modules validate; this is the assertion that they still do.
	const { isLocalhostUrl } = await loadModule('lib/utils/localCompanion.js', 'host-permissions-localhost');

	assert.equal(isLocalhostUrl('http://127.0.0.1:7860'), true);
	assert.equal(isLocalhostUrl('http://localhost:7860'), true);
	assert.equal(isLocalhostUrl('http://evil.example/'), false);
	assert.equal(isLocalhostUrl('http://127.0.0.1.evil.example/'), false, 'a suffix attack must not read as localhost');
});
