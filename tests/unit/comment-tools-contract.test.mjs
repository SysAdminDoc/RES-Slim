// commentTools, executed rather than regexed.
//
// At 1,222 lines it was the largest module in the repo with no test at all. This
// covers the parts that are reachable without a live reddit page: the selector
// that decides which textareas RES attaches itself to, the character counter, and
// the Ctrl+Enter submit binding.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';

const CommentTools = await loadModule('lib/modules/commentTools.js', 'comment-tools');
const { commentTextareaSelector, updateCounter, onCtrlEnter } = CommentTools;

test('the module is registered under the comments category', () => {
	assert.equal(CommentTools.module.moduleID, 'commentTools');
	assert.equal(CommentTools.module.category, 'commentsCategory');
});

// The selector is built by joining, and a joined suffix is applied between items
// rather than after each of them — so the final entry silently loses its guard.
test('every textarea in the selector is guarded against readonly', () => {
	const parts = commentTextareaSelector.split(',');

	assert.ok(parts.length > 1, 'sanity: the selector should list several textareas');
	for (const part of parts) {
		assert.match(
			part.trim(),
			/:not\(\[readonly\]\)$/,
			`"${part.trim()}" carries no readonly guard — join() applies a separator between items, not after the last one`,
		);
	}
});

test('the selector matches an editable textarea and skips a readonly one', () => {
	installDom({
		html: `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>
			<textarea name="text" id="editable"></textarea>
			<textarea name="title" id="readonlyTitle" readonly></textarea>
			<textarea name="body" id="readonlyBody" readonly></textarea>
		</body></html>`,
	});

	const matched = [...document.querySelectorAll(commentTextareaSelector)].map(el => el.id);

	assert.ok(matched.includes('editable'), 'an ordinary comment box must match');
	assert.ok(!matched.includes('readonlyBody'), 'a readonly textarea must not match');
	assert.ok(!matched.includes('readonlyTitle'), 'the last entry in the selector list is readonly-guarded too');
});

test('updateCounter reports length against the limit and flags overrun', () => {
	installDom({
		html: `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>
			<div><div><span class="RESCharCounter"></span><textarea data-limit="10"></textarea></div></div>
		</body></html>`,
	});

	const textarea = document.querySelector('textarea');
	const counter = document.querySelector('.RESCharCounter');

	textarea.value = 'abc';
	updateCounter(textarea);
	assert.equal(counter.textContent, '3/10');
	assert.equal(counter.classList.contains('tooLong'), false);

	textarea.value = 'x'.repeat(11);
	updateCounter(textarea);
	assert.equal(counter.textContent, '11/10');
	assert.equal(counter.classList.contains('tooLong'), true, 'over the limit should be flagged');

	// And it must clear again — a counter stuck in the overrun state after the user
	// deletes text is worse than no counter.
	textarea.value = 'ok';
	updateCounter(textarea);
	assert.equal(counter.classList.contains('tooLong'), false);
});

test('updateCounter is a no-op when there is no counter to update', () => {
	installDom({
		html: '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><div><div><textarea data-limit="10"></textarea></div></div></body></html>',
	});

	const textarea = document.querySelector('textarea');
	textarea.value = 'abc';
	assert.doesNotThrow(() => updateCounter(textarea));
});

test('onCtrlEnter fires only for the matched selector, and only with a modifier', () => {
	installDom({
		html: `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>
			<textarea class="target"></textarea>
			<textarea class="other"></textarea>
		</body></html>`,
	});

	const fired = [];
	onCtrlEnter('.target', () => { fired.push('fired'); });

	const press = (el, init) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
	const target = document.querySelector('.target');
	const other = document.querySelector('.other');

	press(target, {});
	assert.deepEqual(fired, [], 'a bare Enter must not submit — it inserts a newline');

	press(other, { ctrlKey: true });
	assert.deepEqual(fired, [], 'a textarea outside the selector must be ignored');

	press(target, { ctrlKey: true });
	assert.equal(fired.length, 1, 'Ctrl+Enter on the target should fire');

	press(target, { metaKey: true });
	assert.equal(fired.length, 2, 'Cmd+Enter should fire too, for macOS');
});

test('onCtrlEnter prevents the default so the form is not double-submitted', () => {
	installDom({
		html: '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><textarea class="target"></textarea></body></html>',
	});

	onCtrlEnter('.target', () => {});

	const event = new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
	document.querySelector('.target').dispatchEvent(event);

	assert.equal(event.defaultPrevented, true);
});
