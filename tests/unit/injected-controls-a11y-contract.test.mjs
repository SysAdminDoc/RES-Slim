// Every button this extension injects into reddit's own markup must have a name.
//
// The premium-polish passes gave the settings console and the newer overlays
// proper roles and labels. The controls pushed into reddit's page were never
// covered, so several reached a screen reader as an unnamed button or — worse,
// for the two glyph-only jump buttons — as the name of a Unicode triangle.
//
// This is a source scan, which is normally the shape this repo is trying to get
// rid of. It is the right shape here for one reason: the alternative is
// constructing each control, and every one of these builders needs a slice of
// reddit's DOM around it (a tagline, a `pre`, a `.menuarea`) plus the right
// `pageType`. A scan that covers all of `lib/modules/` is worth more than four
// executed builders and sixty unchecked files — but only if it can fail, so the
// last test here feeds it a deliberately unnamed button and requires a report.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modulesDir = path.join(repoRoot, 'lib', 'modules');

function listModuleFiles(dir = modulesDir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listModuleFiles(full);
		return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
	});
}

// Two shapes create buttons in this codebase.
//   - `document.createElement('button')` assigned to a local, then configured
//     over the following lines.
//   - a `<button …>` literal inside a string.html / html template.
//
// For the first, the naming has to be attributed to the *right variable*. A
// window of "the next N lines contains the word textContent" is not a check: it
// passes as soon as some neighbouring element is named, and the window size ends
// up chosen to make the current tree pass. Binding to the identifier means the
// window can be generous without becoming meaningless.
//
// A name comes from text content, aria-label, or aria-labelledby. `title` is
// deliberately not accepted: it is a tooltip, unreachable by touch and keyboard,
// and browsers only fall back to it when nothing better exists.
function namesVariable(text, variable) {
	const v = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`${v}\\.textContent\\s*=|${v}\\.innerText\\s*=|${v}\\.append\\(|${v}\\.appendChild\\(|` +
		`${v}\\.innerHTML\\s*=|${v}\\.setAttribute\\('aria-label(ledby)?'|${v}\\.ariaLabel\\s*=`,
	).test(text);
}

// One level of indirection, because this codebase uses it: `autoRefreshComments`
// hands its button to `syncToggleButton(button)`, which is where the label and
// `aria-pressed` are set. Following the call is what stops that reading as a
// defect. Deliberately one level and same-file only — deeper would mean writing a
// call graph, and a test that needs one has outgrown being a test.
function namedByHelper(source, scope, variable) {
	const v = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const calls = [...scope.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\(\\s*${v}\\s*[,)]`, 'g'))];

	return calls.some(([, fn]) => {
		if (fn === 'if' || fn === 'return' || fn === 'for' || fn === 'while' || fn === 'switch') return false;
		const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const defined = source.match(new RegExp(`(?:function\\s+${escaped}|(?:const|let)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\()\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`));
		if (!defined) return false;
		const body = source.slice(source.indexOf(defined[0]));
		return namesVariable(body.slice(0, 2000), defined[1]);
	});
}

function findUnnamedButtons() {
	const offenders = [];

	for (const file of listModuleFiles()) {
		const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
		const source = fs.readFileSync(file, 'utf8');
		const lines = source.split(/\r?\n/);

		lines.forEach((line, index) => {
			const created = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(['"]button['"]\)/);
			if (created) {
				// Generous, because the naming is attributed to this identifier and
				// nothing else can satisfy it.
				const scope = lines.slice(index, index + 40).join('\n');
				if (!namesVariable(scope, created[1]) && !namedByHelper(source, scope, created[1])) {
					offenders.push(`${relative}:${index + 1} createElement('button')`);
				}
				return;
			}
			if (/createElement\(['"]button['"]\)/.test(line)) {
				// Not assigned to a plain local — can't attribute naming, so report it
				// rather than skip it. Silence here is how a gap gets in.
				offenders.push(`${relative}:${index + 1} unattributable createElement('button')`);
				return;
			}

			// A literal `<button>` names itself either through an attribute on the
			// tag or through content before the closing tag. Both are on the same
			// line in this codebase, or on the next one or two.
			for (const match of line.matchAll(/<button\b[^>]*>/g)) {
				const tag = match[0];
				const rest = lines.slice(index, index + 3).join('\n');
				const closing = rest.slice(rest.indexOf(tag) + tag.length);
				const content = closing.split('</button>')[0] || '';
				const named = /aria-label|aria-labelledby/.test(tag) || /[A-Za-z]{2}/.test(content.replace(/<[^>]*>/g, ''));
				if (!named) offenders.push(`${relative}:${index + 1} ${tag.trim()}`);
			}
		});
	}

	return offenders.sort();
}

test('no module injects a button without an accessible name', () => {
	assert.deepEqual(
		findUnnamedButtons(),
		[],
		'an injected control with no name reaches a screen reader as "button" — give it text or an aria-label (a title attribute is not a name)',
	);
});

test('the two glyph-only jump buttons carry a real label, not just a tooltip', () => {
	const source = fs.readFileSync(path.join(modulesDir, 'nextTopComment.js'), 'utf8');

	// Their entire visible content is a triangle, so this is the one place where
	// dropping the label would be silently catastrophic rather than merely poor.
	assert.match(source, /aria-label="Previous top-level comment"/);
	assert.match(source, /aria-label="Next top-level comment"/);
	assert.equal(
		(source.match(/<button\b/g) || []).length,
		(source.match(/<button[^>]*type="button"/g) || []).length,
		'a button with no type submits the form it happens to land in',
	);
});

test('a toggle reports its state, not only its next action', () => {
	// `botCollapse`'s label flips between "reveal" and "collapse", which describes
	// what a click will do. It does not say whether the comment is open now, and
	// reddit's own [-]/[+] can change that behind the module's back.
	const source = fs.readFileSync(path.join(modulesDir, 'botCollapse.js'), 'utf8');

	assert.match(source, /aria-expanded/, 'a collapse toggle must expose aria-expanded');
	assert.match(
		source,
		/setAttribute\('aria-expanded', String\(!collapsed\)\)/,
		'aria-expanded must be derived from the live collapsed state, or it desyncs the moment reddit collapses the comment itself',
	);
});

test('the scan reports a button that has no name', () => {
	// The whole file is worthless if `findUnnamedButtons` cannot fail. Written to a
	// real module file and removed again, because the scan walks the directory —
	// a fixture elsewhere would not be looked at.
	const bait = path.join(modulesDir, '__a11y_bait__.js');
	fs.writeFileSync(bait, [
		'/* @flow */',
		'export function build() {',
		"\tconst btn = document.createElement('button');",
		"\tbtn.type = 'button';",
		"\tbtn.className = 'nameless';",
		'\treturn btn;',
		'}',
		'',
		"export const literal = html`<button type=\"button\" class=\"also-nameless\"></button>`;",
		'',
	].join('\n'));

	try {
		const offenders = findUnnamedButtons();
		assert.ok(
			offenders.some(o => o.includes('__a11y_bait__.js') && o.includes("createElement('button')")),
			`the scan missed an unnamed createElement button: ${offenders.join(', ')}`,
		);
		assert.ok(
			offenders.some(o => o.includes('__a11y_bait__.js') && o.includes('<button')),
			`the scan missed an unnamed button literal: ${offenders.join(', ')}`,
		);
	} finally {
		fs.unlinkSync(bait);
	}

	assert.ok(!fs.existsSync(bait), 'the bait must not survive the test');
});
