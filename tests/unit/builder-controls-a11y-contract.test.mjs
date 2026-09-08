// The filter builder's three controls were `div`s with click handlers.
//
// A div is not focusable and announces as nothing, so removing a condition,
// sharing one and reordering one were all mouse-only -- WCAG 2.1.1 for the two
// that act on a click, and 2.5.7 for the drag. The only text describing any of
// them was a hardcoded English `title` that never went through `i18n`.
//
// `makeSortable` grew ArrowUp/ArrowDown on the handle, and this builder is its
// other caller. It got nothing from that, because a keydown never reaches an
// element that cannot take focus.
//
// This builds a real condition group and drives the real handler, because
// "reordering works" is a statement about what a keystroke does to the DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/', html: '<!doctype html><html><body></body></html>' });

// `makeSortable` is the real one -- it is the thing under test on the keyboard
// path. `closestHtml` is four lines of `Element#closest` and is stubbed only
// because `lib/utils/dom.js` drags the whole watcher stack in behind it.
const caseBuilder = await loadFlowModule('lib/utils/caseBuilder.js', 'builder-controls-a11y', {
	deps: ['lib/utils/nativeSortable.js'],
	stubs: {
		'../vendor': [
			'import { makeSortable } from \'./nativeSortable.mjs\';',
			'export const Sortable = { create: (container, options) => makeSortable(container, options) };',
		].join('\n'),
		'./dom': [
			'export const closestHtml = (target, selector) => {',
			'	if (!(target instanceof Element)) return null;',
			'	const found = target.closest(selector);',
			'	return found instanceof HTMLElement ? found : null;',
			'};',
		].join('\n'),
		// The key, so an assertion names the key rather than a translation of it.
		// The messages themselves are checked against `en.json` below.
		'../environment': 'export const i18n = key => key;\n',
		'./createElement': 'export const undo = () => new Promise(() => {});\n',
		'./': [
			'export const Alert = { open: () => Promise.resolve() };',
			'export const downcast = value => value;',
			'export const string = {',
			'	html: (parts, ...values) => {',
			'		const template = document.createElement(\'template\');',
			'		template.innerHTML = String.raw({ raw: parts }, ...values).trim();',
			'		return template.content.firstElementChild;',
			'	},',
			'	_html: (parts, ...values) => String.raw({ raw: parts }, ...values),',
			'};',
		].join('\n'),
	},
});

// The smallest shape that renders a sortable list of conditions: a group whose
// `conditions` field is a `multi`, which is what `commentNavigator` hands it.
const CASES = {
	group: {
		text: 'group',
		defaultConditions: { op: 'AND', of: [] },
		fields: [{ type: 'multi', id: 'of' }],
	},
	subreddit: {
		text: 'subreddit',
		defaultConditions: { name: '' },
		fields: ['subreddit ', { type: 'text', id: 'name' }],
	},
};

function buildGroup(names) {
	const data = { type: 'group', op: 'AND', of: names.map(name => ({ type: 'subreddit', name })) };
	const block = caseBuilder.drawBuilderBlock(data, CASES, false);
	document.body.replaceChildren(block);
	return block;
}

const handlesIn = block => [...block.querySelectorAll('.handle')];
const namesIn = block => [...block.querySelectorAll('input[name=name]')].map(input => input.value);

test('every builder control is a real button, focusable and named', () => {
	const block = buildGroup(['pics', 'videos', 'aww']);
	const handles = handlesIn(block);
	assert.equal(handles.length, 3, `expected one handle per condition, saw ${handles.length}`);

	for (const handle of handles) {
		assert.equal(handle.tagName, 'BUTTON', 'the move handle is still a div');
		assert.equal(handle.getAttribute('type'), 'button');
		assert.equal(handle.getAttribute('aria-label'), 'filterBuilderMoveCondition');
		assert.equal(handle.getAttribute('title'), 'filterBuilderMoveConditionHint');
		// Enter and Space do nothing here, so the keys that do are named.
		assert.equal(handle.getAttribute('aria-keyshortcuts'), 'ArrowUp ArrowDown');
	}

	// The delete control acts on a click, so it is a plain keyboard failure until
	// it can be focused.
	const remove = block.querySelector('.builderControls:not(.handle)');
	assert.equal(remove.tagName, 'BUTTON', 'the remove control is still a div');
	assert.equal(remove.getAttribute('aria-label'), 'filterBuilderRemoveCondition');

	// And nothing in here builds a control out of a div any more.
	const source = readRepoFile('lib/utils/caseBuilder.js');
	assert.ok(
		!/createElement\('div', \{ class: 'res-icon-button/.test(source),
		'a builder control is still built as a div',
	);
});

test('a condition moves one place per press, and keeps focus', async () => {
	// Six, not three. Every move is a remove and an insert, which the container's
	// own MutationObserver sees; a second listener registered there moves the
	// condition twice per press. On a short list the extra move runs off the end
	// and does nothing, so the count comes out right for the wrong reason.
	const start = ['pics', 'videos', 'aww', 'books', 'maps', 'news'];
	const block = buildGroup(start);
	let changes = 0;
	block.addEventListener('change', () => { changes += 1; });

	const [first] = handlesIn(block);
	first.focus();
	assert.equal(document.activeElement, first, 'the handle cannot take focus');

	const press = key => document.activeElement.dispatchEvent(
		new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
	);

	// A MutationObserver callback is a microtask, so a synchronous run of presses
	// never lets the observer see the move it just made -- and the duplicated
	// listener that observer would register is the whole defect this is here for.
	const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });

	for (const target of start.map((_name, index) => index).slice(1)) {
		press('ArrowDown');
		// eslint-disable-next-line no-await-in-loop
		await settle();
		assert.equal(handlesIn(block).indexOf(first), target, `one ArrowDown moved the condition ${handlesIn(block).indexOf(first) - target + 1} places`);
		assert.equal(document.activeElement, first, 'focus did not follow the condition it moved');
		assert.equal(changes, target, `${target} presses reported ${changes} moves`);
	}

	assert.deepEqual(namesIn(block), [...start.slice(1), 'pics'], 'the condition did not walk to the end');

	for (const target of start.map((_name, index) => index).slice(0, -1).reverse()) {
		press('ArrowUp');
		// eslint-disable-next-line no-await-in-loop
		await settle();
		assert.equal(handlesIn(block).indexOf(first), target, 'an ArrowUp did not move exactly one place');
	}

	assert.deepEqual(namesIn(block), start, 'ArrowUp did not undo the moves');
});

test('a move reports the change the mouse path reports', () => {
	// The builder persists on `change`, so a reorder nothing announces is a
	// reorder that is lost on reload.
	const block = buildGroup(['pics', 'videos']);
	let changes = 0;
	block.addEventListener('change', () => { changes += 1; });

	const [first] = handlesIn(block);
	first.focus();
	first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

	assert.deepEqual(namesIn(block), ['videos', 'pics']);
	assert.equal(changes, 1, `one move reported ${changes} changes`);
});

test('the ends of the list leave the key alone, and a modified arrow is not ours', () => {
	const block = buildGroup(['pics', 'videos']);
	const [first] = handlesIn(block);
	first.focus();

	const send = init => {
		const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
		document.activeElement.dispatchEvent(event);
		return event.defaultPrevented;
	};

	// Nowhere to go: swallowing the key here takes it from whatever would scroll.
	assert.equal(send({ key: 'ArrowUp' }), false, 'ArrowUp at the top was swallowed');
	assert.deepEqual(namesIn(block), ['pics', 'videos']);

	// A modified arrow belongs to the browser or the platform.
	for (const modifier of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
		assert.equal(send({ key: 'ArrowDown', [modifier]: true }), false, `${modifier}+ArrowDown was taken`);
		assert.deepEqual(namesIn(block), ['pics', 'videos'], `${modifier}+ArrowDown moved the condition`);
	}

	// And an unmodified one still works, so the guard is the modifier and nothing
	// wider.
	assert.equal(send({ key: 'ArrowDown' }), true);
	assert.deepEqual(namesIn(block), ['videos', 'pics']);
});

test('the control names read as a person wrote them', () => {
	const locale = JSON.parse(readRepoFile('locales/locales/en.json'));
	const names = [
		locale.filterBuilderMoveCondition.message,
		locale.filterBuilderRemoveCondition.message,
		locale.filterBuilderShareCondition.message,
	];
	const messages = [...names, locale.filterBuilderMoveConditionHint.message];

	for (const message of messages) {
		assert.ok(message.length > 0);
		assert.ok(!message.includes('—') && !message.includes('–'), `dashes in reader-facing text: ${message}`);
	}

	// A name is read out on every row, so it names the action rather than the
	// gesture. The description is where the gesture belongs, and it says both.
	for (const name of names) {
		assert.ok(!/^drag/i.test(name), `a control is named after its mouse gesture: ${name}`);
	}

	assert.equal(locale.filterBuilderMoveCondition.message, 'Move condition');
	assert.match(locale.filterBuilderMoveConditionHint.message, /arrow keys/i, 'the hint never says which keys work');
});
