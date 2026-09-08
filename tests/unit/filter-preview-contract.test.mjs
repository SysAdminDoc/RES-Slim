// What the filter preview says a rule set would do, and whether it can be
// trusted to say it.
//
// The preview is the one surface that exists to be checked against: a reader
// writes rules, presses Preview, and believes the counts. So a count that is
// silently missing is worse than an error, and a count supplied by the page is
// worse than nothing at all.
//
// Two failures here. A rule whose id is `__proto__` got no entry, because
// assigning a number to that key on an ordinary object is a no-op -- so the
// panel reported "No rules to try" for a set that had matched. And the reply
// crossing the frame boundary was taken on trust, where the two other channels
// into this document both check their payloads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';
import { loadModule } from './helpers/loadModule.mjs';

const preview = await loadFlowModule('lib/utils/filterPreview.js', 'filter-preview');

const HTML = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>
	<div class="content" role="main">
		<div class="thing link" id="thing_t3_a" data-fullname="t3_a" data-subreddit="pics" data-domain="example.com">
			<div class="entry"><p class="title"><a class="title" href="/r/pics/comments/a/">a picture</a></p></div>
		</div>
		<div class="thing link" id="thing_t3_b" data-fullname="t3_b" data-subreddit="news" data-domain="example.org">
			<div class="entry"><p class="title"><a class="title" href="/r/news/comments/b/">some news</a></p></div>
		</div>
	</div>
</body></html>`;

const Filter = await loadModule('lib/modules/filterRules.js', 'filter-preview-rules', {
	stubEnvironment: true,
	dom: { url: 'https://old.reddit.com/r/all/', html: HTML },
});

test('a rule named __proto__ is counted like any other rule', () => {
	// The id is the reader's own label. `__proto__` is a perfectly ordinary
	// string to type into a text field, and the only thing that made it special
	// was the object the counts were kept in.
	const rules = JSON.stringify([
		{ id: '__proto__', action: 'hide', field: 'subreddit', op: 'equals', value: 'pics' },
		{ id: 'ordinary', action: 'dim', field: 'subreddit', op: 'equals', value: 'news' },
	]);

	const result = Filter.previewRules(rules, false);
	assert.deepEqual(result.errors, [], `the rules did not parse: ${result.errors.join('; ')}`);
	assert.equal(result.scanned, 2);
	assert.equal(result.matched, 2);
	// Read through `Object.entries`, because writing the key out is the
	// deprecated accessor rather than the own property this is about.
	const byId = new Map(Object.entries(result.counts));
	assert.equal(byId.get('__proto__'), 1, 'the rule matched and was not counted');
	assert.equal(byId.get('ordinary'), 1);

	// And it reaches the reader, rather than being dropped on the way.
	const described = preview.describePreview(result);
	assert.match(described, /__proto__: 1/, described);
});

test('the other two names that are only dangerous as keys work too', () => {
	const rules = JSON.stringify([
		{ id: 'constructor', action: 'hide', field: 'subreddit', op: 'equals', value: 'pics' },
		{ id: 'prototype', action: 'hide', field: 'subreddit', op: 'equals', value: 'news' },
		{ id: 'toString', action: 'hide', field: 'domain', op: 'equals', value: 'example.com' },
	]);

	const result = Filter.previewRules(rules, false);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(Object.keys(result.counts).sort(), ['constructor', 'prototype', 'toString']);
	assert.equal(result.counts.constructor, 1);
	assert.equal(result.counts.prototype, 1);
	assert.equal(result.counts.toString, 1);

	// Every value is a number this page produced, not something inherited.
	for (const id of Object.keys(result.counts)) assert.equal(typeof result.counts[id], 'number');
});

test('a rule that matches nothing still reports a zero', () => {
	// A count that is absent and a count that is zero are different answers, and
	// the reader is entitled to the second one.
	const rules = JSON.stringify([
		{ id: 'never', action: 'hide', field: 'subreddit', op: 'equals', value: 'nowhere' },
	]);
	const result = Filter.previewRules(rules, false);
	assert.equal(result.matched, 0);
	assert.deepEqual(Object.keys(result.counts), ['never']);
	assert.equal(result.counts.never, 0);
	assert.match(preview.describePreview(result), /never: 0/);
});

test('a reply from the page is checked before it is believed', () => {
	assert.equal(preview.sanitizeFilterPreview(null), null);
	assert.equal(preview.sanitizeFilterPreview({}), null);
	assert.equal(preview.sanitizeFilterPreview({ filterPreview: 'yes' }), null);
	assert.equal(preview.sanitizeFilterPreview({ actionLog: {} }), null, 'another channel\'s message was taken for this one');

	const clean = preview.sanitizeFilterPreview({
		filterPreview: { scanned: 10, matched: 4, counts: { a: 3, b: 1 }, errors: ['rule 0: bad'] },
	});
	assert.equal(clean.scanned, 10);
	assert.equal(clean.matched, 4);
	assert.deepEqual([...clean.errors], ['rule 0: bad']);
	// Spread, because the counts are deliberately prototype-less and
	// `deepStrictEqual` counts that as a difference.
	assert.deepEqual({ ...clean.counts }, { a: 3, b: 1 });
	assert.equal(Reflect.getPrototypeOf(clean.counts), null, 'a rule id could shadow a prototype member again');
});

test('a crafted reply cannot make the preview report things nobody did', () => {
	const hostile = preview.sanitizeFilterPreview({
		filterPreview: {
			scanned: 5,
			// More matches than things looked at is not a number this page made.
			matched: 5000,
			counts: { a: 'lots', b: -3, c: 1.9, d: Infinity },
			errors: [42, null, 'real error'],
		},
	});

	assert.equal(hostile.scanned, 5);
	assert.equal(hostile.matched, 5, `${hostile.matched} matches out of 5 scanned`);
	assert.deepEqual({ ...hostile.counts }, { a: 0, b: 0, c: 1, d: 0 });
	assert.deepEqual(hostile.errors, ['real error']);

	// A `counts` of the wrong type gives an empty one, not the characters of a
	// string.
	const stringy = preview.sanitizeFilterPreview({ filterPreview: { counts: 'abc', scanned: 1 } });
	assert.deepEqual(Object.keys(stringy.counts), []);
	assert.doesNotThrow(() => preview.describePreview(stringy));
});

test('a rule id cannot write its own line in the status', () => {
	// `describePreview` joins the ids into one line for the reader. A newline or a
	// right-to-left override in one makes that line say something else.
	const hostile = preview.sanitizeFilterPreview({
		filterPreview: {
			scanned: 1,
			matched: 1,
			counts: { 'a\nno rules to try': 1, 'b‮c': 1 },
			errors: ['one\ntwo'],
		},
	});
	const described = preview.describePreview(hostile);
	assert.ok(!described.includes('\n'), `the status line has a line break in it: ${JSON.stringify(described)}`);
	assert.ok(!described.includes('‮'), 'a bidi override reached the status line');
	assert.ok(!hostile.errors[0].includes('\n'));
});

test('the ask itself refuses to believe what comes back', async () => {
	// The sanitiser only helps if the one caller goes through it. jsdom gives a
	// top-level document, where `window.parent === window` and the ask bails
	// early, so the frame it lives in is stood up here.
	const parent = {
		posted: [],
		postMessage(message) {
			parent.posted.push(message);
			// The page answers, badly.
			window.dispatchEvent(new window.MessageEvent('message', {
				origin: 'https://old.reddit.com',
				data: { filterPreview: { scanned: 3, matched: 99, counts: { 'a\nfake line': '7' }, errors: [1, 'real'] } },
			}));
		},
	};
	Reflect.defineProperty(window, 'parent', { value: parent, configurable: true });
	try {
		const reply = await preview.requestFilterPreview('[]', false, 'https://old.reddit.com');
		assert.ok(reply, 'the ask never resolved');
		assert.deepEqual(parent.posted, [{ requestFilterPreview: { rulesJson: '[]', reveal: false } }]);
		assert.equal(reply.matched, 3, 'a count larger than the page was believed');
		// `'7'` is a string, and a count is a number. Coercing it would be believing
		// the page about the shape as well as the value.
		assert.deepEqual(Object.values({ ...reply.counts }), [0]);
		assert.ok(!Object.keys({ ...reply.counts })[0].includes('\n'), 'a rule id can still write its own line');
		assert.deepEqual([...reply.errors], ['real']);
	} finally {
		Reflect.deleteProperty(window, 'parent');
	}
});

test('a message that is not a preview reply does not end the ask', async () => {
	// Several shapes are posted to this window. The first one that is not ours
	// must not resolve the wait with nothing.
	const parent = {
		postMessage() {
			for (const data of [{ actionLog: { entries: [] } }, 'hello', { filterPreview: null }]) {
				window.dispatchEvent(new window.MessageEvent('message', { origin: 'https://old.reddit.com', data }));
			}
			window.dispatchEvent(new window.MessageEvent('message', {
				origin: 'https://old.reddit.com',
				data: { filterPreview: { scanned: 2, matched: 1, counts: { only: 1 }, errors: [] } },
			}));
		},
	};
	Reflect.defineProperty(window, 'parent', { value: parent, configurable: true });
	try {
		const reply = await preview.requestFilterPreview('[]', false, 'https://old.reddit.com');
		assert.deepEqual({ ...reply.counts }, { only: 1 }, 'an unrelated message ended the ask');
	} finally {
		Reflect.deleteProperty(window, 'parent');
	}
});
