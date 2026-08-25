// The first-run greeting appears exactly once, to someone with no context, and
// cannot be re-read. Two things therefore have to be right: when it fires, and
// that it never fires twice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';
import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

// A reddit URL, because the behavioural half at the bottom needs `isRunning` to
// answer the way it does on a real page — it consults `matchesPageLocation`.
installDom({ url: 'https://old.reddit.com/r/test/' });

const { shouldGreet, greetingText, shouldAnnounceUpdate, updateText } = await loadFlowModule('lib/utils/firstRun.js', 'first-run');

test('a fresh install is greeted', () => {
	assert.equal(shouldGreet({ pendingGreeting: true }), true);
});

test('nobody else is', () => {
	// `chrome.storage.local` returns undefined for a key never set, and the flag is
	// cleared to `false` once used. Both must read as "do not greet".
	assert.equal(shouldGreet({ pendingGreeting: undefined }), false);
	assert.equal(shouldGreet({ pendingGreeting: false }), false);
	assert.equal(shouldGreet({ pendingGreeting: null }), false);
	// Strict, so a leftover value from some future change to what the background
	// writes does not read as a fresh install.
	assert.equal(shouldGreet({ pendingGreeting: 'true' }), false);
	assert.equal(shouldGreet({ pendingGreeting: 1 }), false);
});

test('the background only records an actual install, not an update', () => {
	// `onInstalled` fires with reason 'update' and 'chrome_update' too, on every
	// release, for every existing user.
	// In lib/environment/, not background.entry.js: that is where direct chrome.*
	// access belongs, and the nested eslintrc scoping the webextensions env is what
	// caught the first draft reaching outside it.
	const source = codeOnly(readRepoFile('lib/environment/background/firstRun.js'));
	assert.match(codeOnly(readRepoFile('lib/background.entry.js')), /background\/firstRun/, 'the entrypoint must still load it');
	assert.match(source, /onInstalled\.addListener/);
	// Was `reason !== 'install'` when a fresh install was the only thing this
	// listener acted on. It now handles `update` as well, so what has to hold is
	// that the two reasons stay separated — an unfiltered listener greets every
	// existing user on every release.
	assert.match(source, /reason === 'install'/, 'the greeting must still be gated on a genuine install');
	assert.match(source, /RESmodules\.version\.pendingGreeting/, 'the flag the foreground reads');
	const greetingBranch = source.slice(source.indexOf('reason === \'install\''), source.indexOf('reason !== \'update\''));
	assert.match(greetingBranch, /return;/, 'the install branch must not fall through into the update branch');
});

test('the greeting says what is on and that nothing leaves the machine', () => {
	const text = greetingText(61);

	assert.match(text, /61/, 'the count is the one thing a new user cannot see for themselves');
	assert.ok(!/^RES-Slim/.test(text), 'the notification header already says RES-Slim');
	assert.match(text, /configurable/i, 'a list of things that turned themselves on needs a route to turning them off');
	assert.match(text, /nothing is sent anywhere/i, 'the privacy claim is the reason this fork exists');
	assert.ok(!/welcome/i.test(text), 'no greeting-card voice');
});

// --- the wiring ------------------------------------------------------------

const Version = await loadModule('lib/modules/version.js', 'first-run-version');
const version = Version.__registry.getUnchecked('version');

test('the greeting is wired into a stage that actually runs', () => {
	assert.equal(typeof version.afterLoad, 'function');

	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	assert.match(source, /greetOnFirstRun\(\)/, 'afterLoad must call it');
	assert.match(source, /Storage\.wrapFeature\('versionLifecycle'/, 'the flag has to persist through a declared feature policy, or it fires once per page load');
});

test('the flag is written before the toast, not after', () => {
	// `afterLoad` runs in every tab. Two tabs opening together would both read
	// `false` and both greet if the write came after the notification. Ordering is
	// the whole mitigation, so it is asserted rather than assumed.
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	const body = source.slice(source.indexOf('async function greetOnFirstRun'));

	// Slice past the early-return guard first. There are *two* `set(true)` calls —
	// the guard also records the flag for an existing user — and searching the whole
	// body finds that one, which always precedes the toast. The first version of
	// this assertion did exactly that and passed against the bug it exists to
	// catch, verified by moving the real write below `showNotification`.
	// `return false;` since the greeting became one of two notices and has to tell
	// its caller whether it fired.
	const guardEnd = body.indexOf('return false;');
	assert.ok(guardEnd > 0, 'the early-return guard must still be there, or this slice is wrong');
	const greetPath = body.slice(guardEnd);

	const setIndex = greetPath.indexOf('pendingGreetingStorage.set(false)');
	const notifyIndex = greetPath.indexOf('showNotification');

	assert.ok(setIndex > 0, 'the greet path must record the flag');
	assert.ok(notifyIndex > 0, 'the greet path must show the toast');
	assert.ok(setIndex < notifyIndex, 'the flag must be set before the toast is shown');
});

test('the settings link is inserted as markup, not escaped into visible angle brackets', () => {
	// `makeUrlHashLink` returns a markup string; every other caller wraps it in
	// `string.safe()`. Interpolating it directly renders the anchor as text.
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	assert.match(source, /string\.safe\(SettingsNavigation\.makeUrlHashLink/);
});

// --- the update notice -----------------------------------------------------
//
// Three mechanisms for announcing an update existed and none of them reached a
// user: the background returned early for reason `update`, `Metadata.updatedURL`
// was built and read by nothing, and `highestVersion` was written by a migration
// nothing consulted. These assert that exactly one of them is now live and the
// other two are gone, because three unread mechanisms is how this got here.

test('a minor or major release is announced, and nothing else is', () => {
	assert.equal(shouldAnnounceUpdate('0.45.0', '0.46.0'), true, 'a minor bump is the boundary the release process already treats as meaningful');
	assert.equal(shouldAnnounceUpdate('0.45.3', '1.0.0'), true);
	assert.equal(shouldAnnounceUpdate('0.45.0', '1.0.0'), true);

	// A notice that fires on every fix is a notice people stop reading, and then
	// the release that does change something visible gets dismissed with the rest.
	assert.equal(shouldAnnounceUpdate('0.45.0', '0.45.1'), false, 'patch releases are fixes');
	assert.equal(shouldAnnounceUpdate('0.45.1', '0.45.9'), false);

	// Swapping back to an older unpacked build fires `onInstalled` with reason
	// `update` exactly like a real release does.
	assert.equal(shouldAnnounceUpdate('0.46.0', '0.45.0'), false, 'a downgrade is not a release');
	assert.equal(shouldAnnounceUpdate('1.0.0', '0.46.0'), false);
	assert.equal(shouldAnnounceUpdate('0.45.0', '0.45.0'), false, 'and neither is standing still');

	// `previousVersion` is absent on `chrome_update`, and a flag written by some
	// future build should not be announced on its word.
	assert.equal(shouldAnnounceUpdate(undefined, '0.46.0'), false);
	assert.equal(shouldAnnounceUpdate('0.45.0', undefined), false);
	assert.equal(shouldAnnounceUpdate('', ''), false);
	assert.equal(shouldAnnounceUpdate('not a version', '0.46.0'), false);
});

test('the update text names both versions and says settings survived', () => {
	const text = updateText('0.45.0', '0.46.0');
	assert.match(text, /0\.45\.0/);
	assert.match(text, /0\.46\.0/);
	// The question anyone has on seeing an extension announce itself.
	assert.match(text, /settings carried over/i);
	assert.ok(!/^RES-Slim/.test(text), 'the notification header already says RES-Slim');
});

test('the background records the version pair, which is knowable nowhere else', () => {
	const source = codeOnly(readRepoFile('lib/environment/background/firstRun.js'));
	assert.match(source, /reason === 'install'/, 'an install is still a greeting, not an update');
	assert.match(source, /reason !== 'update'/, 'chrome_update is the browser updating, not us');
	assert.match(source, /details\.previousVersion/, 'this is the only moment the old version exists');
	assert.match(source, /getManifest\(\)\.version/);
	assert.match(source, /RESmodules\.version\.pendingUpdate/, 'the flag the foreground reads');
	assert.match(source, /shouldAnnounceUpdate/, 'filtering in the background keeps a patch release from writing a flag at all');
});

test('the update flag is cleared before the toast, and re-checked rather than trusted', () => {
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	const body = source.slice(source.indexOf('async function announceUpdate'));
	assert.ok(body, 'announceUpdate has to exist');

	// Same race as the greeting: `afterLoad` runs in every tab, so two tabs
	// opening together would both read the flag and both announce.
	const setIndex = body.lastIndexOf('pendingUpdateStorage.set(null)');
	const notifyIndex = body.indexOf('showNotification');
	assert.ok(setIndex > 0 && notifyIndex > 0);
	assert.ok(setIndex < notifyIndex, 'the flag must be cleared before the toast is shown');

	// The flag persists, so a profile updated with no reddit tab open reads it
	// arbitrarily later.
	assert.match(body, /shouldAnnounceUpdate\(pending\.previousVersion, pending\.currentVersion\)/);
	assert.match(body, /Metadata\.updatedURL/, 'the notice has to link somewhere, and that is what updatedURL is for');
	assert.match(body, /rel="noopener noreferrer"/, 'an external link opened in a new tab');
});

test('only one notice fires on a page load', () => {
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	assert.match(source, /if \(await greetOnFirstRun\(\)\) return;/,
		'a leftover flag from an interrupted run must not stack two toasts');
});

test('updatedURL is a link that resolves, which it was not while nothing read it', () => {
	// It was `CHANGELOG.md#v${version}`: relative, so unresolvable from a reddit
	// page, and the wrong anchor besides — GitHub slugifies `## v0.46.0 - date`
	// to `#v0460---2026-08-19`. Being unread is what let it stay broken.
	const build = readRepoFile('build.js');
	const assignment = /const updatedURL[^=]*=\s*(.+);/.exec(build);
	assert.ok(assignment, 'build.js must still define updatedURL');
	assert.match(assignment[1], /packageInfo\.homepage/, 'absolute, or it cannot be opened from reddit.com');
	assert.match(assignment[1], /releases\/tag\/v\$\{version\}/, 'the release tag carries the notes and is created by yarn release');
	assert.doesNotMatch(assignment[1], /CHANGELOG\.md#/);
});

// The assertions above read source, and a source assertion cannot tell you
// whether the code runs — this repo has already shipped a module that was green
// for its whole life while doing nothing. The rest of this file drives the real
// `afterLoad` against the real storage stub and looks at the resulting DOM.
//
// `notifications` has to be enabled and its `go` stage run first: `isRunning` is
// one of the two guards `showNotification` checks before attaching anything, and
// `go` is where the `#RESNotifications` container is appended to the body. On a
// real page both have happened long before `version.afterLoad` fires.
const notifications = Version.__registry.getUnchecked('notifications');
await Version.__registry.setEnabled(notifications, true);
notifications.go();

const pendingUpdateKey = 'RESmodules.version.pendingUpdate';
const storage = globalThis.chrome.storage.local;
const setPendingUpdate = value => new Promise(resolve => { storage.set({ [pendingUpdateKey]: value }, resolve); });
const readPendingUpdate = () => new Promise(resolve => { storage.get(pendingUpdateKey, r => resolve(r[pendingUpdateKey])); });

// `afterLoad` fires a floating async chain: a storage read, the announce
// decision, a storage write, then the toast. One timeout long enough to cover
// all of it, rather than a poll loop — the probe that established this settles
// in well under 100ms.
const settle = (ms = 400) => new Promise(resolve => { setTimeout(resolve, ms); });

test('the notice actually renders, with a link to the release it is announcing', async () => {
	await new Promise(resolve => { storage.clear(resolve); });
	await setPendingUpdate({ previousVersion: '0.45.0', currentVersion: '0.46.0' });

	version.afterLoad();
	await settle();

	const notice = [...document.querySelectorAll('.RESNotification')]
		.find(n => /Updated from/.test(n.textContent));
	assert.ok(notice, 'an update across a minor boundary has to produce a visible notice');
	assert.match(notice.textContent, /0\.45\.0/);
	assert.match(notice.textContent, /0\.46\.0/);
	assert.match(notice.textContent, /settings carried over/i);

	const link = notice.querySelector('a[href]');
	assert.ok(link, 'the notice has to link to the release notes, which is the whole point of it');
	assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
	assert.equal(link.getAttribute('target'), '_blank');

	// Cleared, so the next page load in the next tab does not announce again.
	assert.equal(await readPendingUpdate(), null, 'the flag must not survive the notice');
});

test('a patch update that somehow reached storage is dropped, not announced', async () => {
	for (const n of document.querySelectorAll('.RESNotification')) n.remove();
	// The background filters patch releases before writing anything, so reaching
	// this state means an older build wrote the flag. The foreground re-check is
	// what makes that harmless instead of a wrong notice.
	await setPendingUpdate({ previousVersion: '0.46.0', currentVersion: '0.46.1' });

	version.afterLoad();
	await settle(150);

	assert.ok(![...document.querySelectorAll('.RESNotification')].some(n => /Updated from/.test(n.textContent)),
		'a patch release must not interrupt anyone');
	assert.equal(await readPendingUpdate(), null, 'and the flag is dropped rather than left to be retried on every page load');
});

test('an announced update is announced once, not on every page load', async () => {
	for (const n of document.querySelectorAll('.RESNotification')) n.remove();
	await setPendingUpdate({ previousVersion: '0.45.0', currentVersion: '0.46.0' });

	version.afterLoad();
	await settle();
	for (const n of document.querySelectorAll('.RESNotification')) n.remove();

	// Second page load, same profile, flag already consumed.
	version.afterLoad();
	await settle(150);
	assert.ok(![...document.querySelectorAll('.RESNotification')].some(n => /Updated from/.test(n.textContent)),
		'the notice fires on the first reddit page after the update and never again');
});

test('the unread highestVersion key is gone rather than left for a fourth mechanism', () => {
	// Written by the 5.17.0 migration, read by nothing since the fork stripped
	// upstream's reader. The migration's cleanup half is the part that mattered.
	const migrate = codeOnly(readRepoFile('lib/core/migrate/migrate.js'));
	assert.doesNotMatch(migrate, /highestVersion/);
	assert.match(migrate, /firstRunStorage\.deleteMultiple/, 'the cleanup half still has to run');
});
