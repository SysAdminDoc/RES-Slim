import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadModule, installDom } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('frictionRemovers is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as frictionRemovers \} from '\.\/frictionRemovers';/);
	assert.match(index, /^\s*frictionRemovers,/m);
});

test('frictionRemovers wires every friction surface to its own opt-out switch', () => {
	const source = read('lib/modules/frictionRemovers.js');
	for (const opt of [
		'autoConfirmOver18',
		'autoConfirmQuarantine',
		'hideNewRedditBanner',
		'hideAppPrompt',
	]) {
		assert.match(source, new RegExp(`${opt}:\\s*\\{[\\s\\S]*?value:\\s*true`), `${opt} should default to true`);
	}
});

test('frictionRemovers submits the confirmations as a button press, not a bare form', () => {
	// This used to assert that the string `autoSubmitForm('/over18')` appears in
	// the file. It did appear, and it did not work: the function called
	// `form.submit()`, which never carries the pressed button's name and value,
	// and reddit's answer to `/over18` is only ever that value. A source match on
	// a call is not a claim about what the call does, which is why the three
	// tests at the bottom of this file drive the real forms and read the body.
	//
	// What is left here is the one thing those cannot see: that `requestSubmit`,
	// the only DOM route that carries the submitter, is what the module reaches
	// for first. A refactor back to `form.submit()` would still pass in jsdom
	// while losing the field in a browser.
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /form\.requestSubmit\(/, 'the submitter has to be carried into the submission');
	assert.match(source, /\[name="over18"\]\[value="yes"\]/, 'the yes button is the answer');
	assert.match(source, /\/api\/quarantine_optin/, 'the quarantine form posts here, not to /quarantine');
	// Against code, not prose: the comment above the fix names the two selectors
	// that never matched, so the unstripped source contains the very string this
	// forbids. Stripping is proven by the assertion that follows it.
	const code = source.split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
	assert.match(source, /form\[action\$="\/quarantine"\]/, 'the comment should still explain what never matched');
	assert.doesNotMatch(code, /action\$?="\/quarantine"/, 'that action does not exist on the page');
});

test('frictionRemovers injects a CSS rule that hides all enabled banner selectors', () => {
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /display:\s*none\s*!important/);
	assert.match(source, /'#new-reddit-pref-modal'/);
	assert.match(source, /'#redditmobile-app-banner'/);
});

test('frictionRemovers stays in the privacy category and runs on both renderers', () => {
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	// Both renderers since v0.45.0. The over-18 and quarantine handlers are
	// old-Reddit forms that simply do not match elsewhere, but the login wall is
	// on www.reddit.com too and the dismisser matches on shape, not on markup.
	assert.match(source, /module\.include\s*=\s*\['r2', 'd2x'\]/);
});

// The two interstitials, executed rather than grepped.
//
// Everything above this line reads source text, which is how both of these
// shipped broken while looking covered: the contract asserted that
// `autoSubmitForm('/over18')` appears in the file, and it did, and it did not
// work. What reddit receives is a POST body, so that is what these assert.

const OVER18 = `<!doctype html><html><body>
	<div class="content" role="main">
		<h1>you must be 18+ to view this community</h1>
		<form action="/over18" method="post">
			<input type="hidden" name="uh" value="fixturemodhash">
			<input type="hidden" name="dest" value="/r/fixture/">
			<button class="btn" name="over18" value="yes" type="submit">continue</button>
			<button class="btn" name="over18" value="no" type="submit">no thank you</button>
		</form>
	</div>
</body></html>`;

// Two forms, and only one of them is the answer the reader wants.
const QUARANTINE = `<!doctype html><html><body>
	<div class="content" role="main">
		<form action="/api/quarantine_optout" method="post">
			<input type="hidden" name="sr_name" value="fixture">
			<button type="submit">go back</button>
		</form>
		<form action="/api/quarantine_optin" method="post">
			<input type="hidden" name="sr_name" value="fixture">
			<input type="hidden" name="uh" value="fixturemodhash">
			<button type="submit">continue</button>
		</form>
	</div>
</body></html>`;

// What the form would actually post, including which button was pressed.
// `new FormData(form, submitter)` is how the platform answers that question, and
// it is the difference the whole item is about: `form.submit()` carries no
// submitter, so the field is simply absent.
async function captureSubmission(url, html, name, prepare) {
	// The DOM goes up before the module is loaded, because the module reads
	// `document` at import time.
	installDom({ url, html });
	const FrictionRemovers = await loadModule('lib/modules/frictionRemovers.js', name, { dom: false });
	if (prepare) prepare(FrictionRemovers);

	const submissions = [];
	document.addEventListener('submit', event => {
		event.preventDefault();
		const form = event.target;
		submissions.push({
			action: form.getAttribute('action'),
			fields: [...new globalThis.window.FormData(form, event.submitter)],
		});
	}, true);
	FrictionRemovers.module.contentStart();
	return submissions;
}

test('the over-18 confirmation posts the answer, not an empty form', async () => {
	const submissions = await captureSubmission(
		'https://old.reddit.com/over18?dest=%2Fr%2Ffixture%2F',
		OVER18,
		'friction-over18',
	);

	assert.equal(submissions.length, 1, 'the form should have been submitted exactly once');
	const [submitted] = submissions;
	assert.equal(submitted.action, '/over18');

	const fields = new Map(submitted.fields);
	// The whole point. Old Reddit's page has two submit buttons and no checkbox,
	// so which button was pressed *is* the answer, and `form.submit()` never
	// carries one -- the POST arrived with no `over18` field at all, which reddit
	// reads as the "no" branch.
	assert.equal(fields.get('over18'), 'yes', `the answer must be in the body, got ${JSON.stringify(submitted.fields)}`);
	assert.equal(fields.get('uh'), 'fixturemodhash', 'and the modhash has to survive with it');
	assert.ok(fields.get('dest'), 'reddit needs somewhere to send the reader back to');
});

test('a form the reader never asked to submit is left alone', async () => {
	// Off by choice.
	const declined = await captureSubmission('https://old.reddit.com/over18', OVER18, 'friction-over18-off',
		mod => { mod.module.options.autoConfirmOver18.value = false; });
	assert.deepEqual(declined, [], 'an option that is off must do nothing');

	// And on a page that is not the interstitial, whatever forms happen to be
	// there are none of this module's business.
	const elsewhere = await captureSubmission('https://old.reddit.com/r/fixture/', OVER18, 'friction-over18-elsewhere');
	assert.deepEqual(elsewhere, [], 'the route guard has to hold');
});

test('the quarantine confirmation opts in, and never opts out by accident', async () => {
	const submissions = await captureSubmission(
		'https://old.reddit.com/quarantine?sr_name=fixture',
		QUARANTINE,
		'friction-quarantine',
	);

	assert.equal(submissions.length, 1, 'exactly one of the two forms should go');
	// The page posts to `/api/quarantine_optin`, which matches neither
	// `form[action="/quarantine"]` nor `form[action$="/quarantine"]`, so this
	// branch had never fired once since it was written.
	assert.equal(submissions[0].action, '/api/quarantine_optin', 'the opt-out form must not be the one that goes');
	const fields = new Map(submissions[0].fields);
	assert.equal(fields.get('sr_name'), 'fixture');
	assert.equal(fields.get('uh'), 'fixturemodhash');
});
