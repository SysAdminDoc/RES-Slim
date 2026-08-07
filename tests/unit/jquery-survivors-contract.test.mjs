// jQuery was removed in v0.1.0. Two calls to it survived until 2026-08-07.
//
// `commentNavigator` built its condition-builder block and then called
// `$builderBlock.on('change input', …)` and `$builderBlock.get(0)`. Both are
// jQuery; `drawBuilderBlock` returns a plain DOM element. Clicking "by
// conditions" therefore threw `$builderBlock.on is not a function` — and because
// the click handler was wrapped in `once()`, the click was already marked spent,
// so a second click did nothing at all. The feature was dead in every build since
// the fork began.
//
// Nothing caught it. eslint does not know the type of an expression, and the unit
// contract for that module was a source scan for other things entirely. It was
// found by running Flow, which had been installed and never invoked.
//
// This file is the cheap standing guard for the same class of survivor: an API
// that only ever existed on a jQuery object, called on something that is not one.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom();

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libRoot = path.join(repoRoot, 'lib');

function listSources(dir = libRoot) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listSources(full);
		return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
	});
}

// Methods that exist on a jQuery object and on nothing in the DOM. `.on` is
// deliberately absent from this list: EventSource, sockets and several node
// libraries have a real `.on`, so matching it by name alone is noise. It is
// covered by the executing test below instead.
const JQUERY_ONLY = [
	{ pattern: /\.get\(\s*\d+\s*\)/, name: '.get(<index>)', instead: 'the element itself, or [index] on a NodeList' },
	{ pattern: /\.appendTo\(/, name: '.appendTo()', instead: 'parent.append(child)' },
	{ pattern: /\.prependTo\(/, name: '.prependTo()', instead: 'parent.prepend(child)' },
	{ pattern: /\.addClass\(/, name: '.addClass()', instead: 'classList.add()' },
	{ pattern: /\.removeClass\(/, name: '.removeClass()', instead: 'classList.remove()' },
	{ pattern: /\.attr\(/, name: '.attr()', instead: 'getAttribute/setAttribute' },
	{ pattern: /\.outerWidth\(|\.outerHeight\(/, name: '.outerWidth()/.outerHeight()', instead: 'getBoundingClientRect()' },
	{ pattern: /\$\(\s*(?:document|window|'|")/, name: '$(…)', instead: 'querySelector / querySelectorAll' },
];

test('no jQuery-only call survives in lib/', () => {
	const offenders = [];

	for (const file of listSources()) {
		const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
		const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

		lines.forEach((line, index) => {
			// Comments describe the removal; they are not calls.
			const code = line.replace(/\/\/[^\r\n]*$/, '');
			for (const { pattern, name, instead } of JQUERY_ONLY) {
				if (pattern.test(code)) offenders.push(`${relative}:${index + 1} ${name} — use ${instead}`);
			}
		});
	}

	assert.deepEqual(
		offenders,
		[],
		'jQuery was removed in v0.1.0; a call to its API throws TypeError at runtime',
	);
});

test('the scan finds a jQuery call when there is one', () => {
	// Without this the file above is a list of patterns nobody has confirmed match
	// anything. Written into lib/ because the scan walks that tree.
	const bait = path.join(libRoot, 'utils', '__jquery_bait__.js');
	fs.writeFileSync(bait, ['/* @flow */', "export const x = el => el.addClass('y');", ''].join('\n'));

	try {
		const found = [];
		for (const file of listSources()) {
			const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
			lines.forEach(line => {
				if (/\.addClass\(/.test(line)) found.push(path.basename(file));
			});
		}
		assert.ok(found.includes('__jquery_bait__.js'), 'the scan missed a planted jQuery call');
	} finally {
		fs.unlinkSync(bait);
	}
});

// --- the executing half ------------------------------------------------------
//
// The scan cannot see `.on()`, and `.on()` was the call that actually broke.
// What can see it is the thing the product depends on: `drawBuilderBlock` returns
// a DOM element, and a DOM element has no `.on`. Assert that directly, so the day
// someone reintroduces a jQuery-shaped return value the assumption fails loudly.

const caseBuilder = await loadModule('lib/utils/caseBuilder.js', 'jquery-survivors');

test('drawBuilderBlock returns a DOM node, not a jQuery object', () => {
	const cases = {
		demo: {
			fields: [],
			validate() {},
		},
	};

	const block = caseBuilder.drawBuilderBlock({ type: 'demo' }, cases, false);

	assert.ok(block instanceof window.Node, 'commentNavigator appends this straight into the page');
	assert.equal(typeof block.addEventListener, 'function', 'listeners are attached with the DOM API');
	assert.equal(typeof block.on, 'undefined', 'a `.on` here would mean jQuery came back');
	assert.equal(typeof block.get, 'undefined', '`.get(0)` was the other survivor');
});

test('commentNavigator attaches its builder listeners with the DOM API', () => {
	const source = fs.readFileSync(path.join(libRoot, 'modules', 'commentNavigator.js'), 'utf8');

	// jQuery's `.on('change input')` is two listeners. Collapsing it to one would
	// half-fix the bug: a select fires `change`, a text field fires `input`, and
	// the condition builder has both.
	assert.match(source, /builderBlock\.addEventListener\('change'/);
	assert.match(source, /builderBlock\.addEventListener\('input'/);
	assert.ok(!/\$builderBlock/.test(source), 'the $-prefixed name implied a jQuery object that was never there');
});
