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

test('frictionRemovers matches the interstitials by button, never by form action', () => {
	// This used to assert that the string `autoSubmitForm('/over18')` appears in
	// the file. It did appear, and it did not work: the function matched the form
	// by its action and then called `form.submit()`. Both halves were wrong. r2
	// renders both interstitials through `submit_form` with no action argument,
	// so the form carries `action=""` and no action selector can ever match it;
	// and `form.submit()` never carries the pressed button's name and value,
	// which on these pages is the entire answer.
	//
	// So this forbids the class of match that cannot work, rather than pinning
	// the particular spelling that was there. Everything else is executed by the
	// tests at the bottom of this file.
	const source = read('lib/modules/frictionRemovers.js');
	// Comments are stripped, because the block above the fix quotes the selectors
	// that never matched; the assertion that follows proves the stripping ran.
	const code = source.split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
	assert.match(source, /form\[action\$="\/over18"\]/, 'the comment should still explain what never matched');
	assert.doesNotMatch(code, /form\[action/, 'the form is found through its button, not its action');

	assert.match(code, /form\.requestSubmit\(/, 'the submitter has to be carried into the submission');
	assert.match(code, /\[name="over18"\]\[value="yes"\]/, 'the over-18 answer is the yes button');
	assert.match(code, /\[name="accept"\]\[value="yes"\]/, 'and the quarantine answer is its own yes button');
	// Both pages put "no thank you" first, so a selector that does not pin the
	// value takes the wrong one.
	assert.doesNotMatch(code, /button\[type="submit"\], input\[type="submit"\], button:not/, 'never take the first submit control');
	assert.doesNotMatch(code, /function ensureDest/, 'a body dest overrides the one reddit put in the query string');

	// The selector narrows to submit controls, which is most of the protection.
	assert.match(code, /`button\$\{accept\}, input\[type="submit"\]\$\{accept\}`/,
		'only submit controls may be chosen as the submitter');
	// It is not all of it, though: `<button type="button">` and `type="reset"`
	// match `button[name=…][value=…]` too, and both make `requestSubmit` throw.
	// So the catch is a reachable path, and a failed attempt is reported rather
	// than swallowed -- `.click()` on a non-submit control does nothing at all,
	// and returning true there would have the module believe it answered a gate
	// it did not touch.
	assert.match(code, /function submitWith\(form: HTMLFormElement, accept: HTMLElement\): boolean/);
	assert.match(code, /if \(submitWith\(form, button\)\) return true;/,
		'a submission that did not happen must not read as success');
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
//
// The fixtures are r2's own markup, not a guess at it. Both pages come from
// `utils.html`'s `submit_form`, invoked as `<%utils:submit_form
// _class="pretty-form">` with no action argument, so the form carries
// `action=""` and a `uh` hidden input and nothing else. Read from
// reddit-archive/reddit on 2026-09-08: over18interstitial.html,
// quarantineinterstitial.html, utils.html:77-89 and config/routing.py:84.
//
// Two details in here are the whole point. The form has no useful `action`, so
// anything matching on one matches nothing; and "no thank you" comes *first* in
// both, so anything taking the form's first submit control declines the gate on
// the reader's behalf.

const OVER18 = `<!doctype html><html><body>
	<div class="interstitial">
		<h1>you must be 18+ to view this community</h1>
		<form class="pretty-form" onsubmit="" action="" method="post">
			<input type="hidden" name="uh" value="fixturemodhash">
			<div class="buttons">
				<button class="c-btn c-btn-primary" type="submit" name="over18" value="no">no thank you</button>
				<button class="c-btn c-btn-primary" type="submit" name="over18" value="yes">continue</button>
			</div>
		</form>
	</div>
</body></html>`;

const QUARANTINE = `<!doctype html><html><body>
	<div class="interstitial">
		<form class="pretty-form" onsubmit="" action="" method="post">
			<input type="hidden" name="uh" value="fixturemodhash">
			<input type="hidden" name="sr_name" value="fixture">
			<div class="buttons">
				<button class="c-btn c-btn-primary" type="submit" name="accept" value="no">no thank you</button>
				<button class="c-btn c-btn-primary" type="submit" name="accept" value="yes">continue</button>
			</div>
		</form>
	</div>
</body></html>`;

// What the form would actually post, including which button was pressed.
// `new FormData(form, submitter)` is how the platform answers that question, and
// it is the difference the whole item is about: `form.submit()` carries no
// submitter, so the answer field is simply absent.
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

test('the over-18 confirmation posts yes, on a form with no action to match', async () => {
	const submissions = await captureSubmission(
		'https://old.reddit.com/over18?dest=%2Fr%2Ffixture%2F',
		OVER18,
		'friction-over18',
	);

	assert.equal(submissions.length, 1, 'the form should have been submitted exactly once');
	const [submitted] = submissions;
	assert.equal(submitted.action, '', 'the fixture must keep the empty action the real page has');

	const fields = new Map(submitted.fields);
	// Which button was pressed is the whole answer, and "no thank you" is first in
	// the source. `form.submit()` carries no submitter at all, so the POST arrived
	// with no `over18` field, which reddit reads as the "no" branch.
	assert.equal(fields.get('over18'), 'yes', `the answer must be yes, got ${JSON.stringify(submitted.fields)}`);
	assert.equal(fields.get('uh'), 'fixturemodhash', 'and the modhash has to survive with it');

	// Nothing may add a `dest`. The empty action posts back to this URL with its
	// query string, where reddit reads the real destination from; a body `dest`
	// beats that and drops the reader on the front page.
	assert.equal(fields.has('dest'), false, `an injected dest overrides the one in the URL: ${JSON.stringify(submitted.fields)}`);
});

test('the quarantine confirmation posts yes, not the no button beside it', async () => {
	const submissions = await captureSubmission(
		'https://old.reddit.com/quarantine?sr_name=fixture',
		QUARANTINE,
		'friction-quarantine',
	);

	assert.equal(submissions.length, 1, 'the single form on the page should go exactly once');
	const fields = new Map(submissions[0].fields);
	// One form, two answers, "no thank you" first. Taking the form's first submit
	// control here would decline the gate for the reader.
	assert.equal(fields.get('accept'), 'yes', `the answer must be yes, got ${JSON.stringify(submissions[0].fields)}`);
	assert.equal(fields.get('sr_name'), 'fixture', 'reddit needs to know which community it is');
	assert.equal(fields.get('uh'), 'fixturemodhash');
	assert.equal(fields.has('dest'), false);
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

test('an answer that is not a submit button is left alone, not thrown over', async () => {
	// `requestSubmit` throws `TypeError` when the submitter is not a submit
	// button. Uncaught, that aborts `contentStart`, and `_runModuleStage` then
	// records the module as errored -- so `dismissLoginWall()` and
	// `watchForLoginWall()`, the two calls after this one, never start for the
	// rest of the page. A gate the extension cannot answer is a bad afternoon; a
	// module that switches itself off over it is a worse one.
	//
	// Two things stop it, and only the first is reachable from here: the selector
	// matches `button` and `input[type="submit"]` and nothing else, so a hidden
	// input carrying the same name and value is simply not found. The `catch` in
	// `submitWith` is the second, and it cannot be provoked through this path by
	// construction -- it is there so that widening the selector later cannot take
	// the module down.
	const HIDDEN_ANSWER = `<!doctype html><html><body><div class="interstitial">
		<form class="pretty-form" action="" method="post">
			<input type="hidden" name="over18" value="yes">
			<button type="submit">continue</button>
		</form>
	</div></body></html>`;

	// Reaching this line at all is the assertion about not throwing: an exception
	// out of `contentStart` would propagate through `captureSubmission`.
	const submissions = await captureSubmission('https://old.reddit.com/over18', HIDDEN_ANSWER, 'friction-over18-hidden');
	assert.deepEqual(submissions, [], 'a hidden input is not an answer this can press');
});
