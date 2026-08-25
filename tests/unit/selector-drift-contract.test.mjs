// Selector drift as a structured, dated, per-page-kind record.
//
// Drift already reached the module error log, where it stopped being useful: one
// line among everything that ever went wrong, in prose. Old Reddit's markup is
// what this fork stands on, so "which surfaces are on a fallback, on which kind
// of page, since when" has to be answerable without parsing sentences back into
// structure.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const Drift = await loadFlowModule('lib/utils/selectorDrift.js', 'selector-drift');
const {
	DRIFT_STORAGE_KEY,
	clearDriftFor,
	countDriftedSurfaces,
	describeFinding,
	driftRecords,
	formatDriftReport,
	mergeDrift,
	normalizeDriftState,
	toFindings,
} = Drift;

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const MATCHES = [
	{ surfaceName: 'listingFeed', status: 'fallback', selector: '.linklisting .thing.link' },
	{ surfaceName: 'userbar', status: 'missing', selector: null },
	{ surfaceName: 'header', status: 'stable', selector: '#header' },
];

test('only drifting surfaces are recorded, and in a stable order', () => {
	const findings = toFindings(MATCHES);
	assert.deepEqual(findings.map(f => f.surfaceName), ['listingFeed', 'userbar'], 'a surface that matched its stable selector is not a finding');
	assert.equal(findings[0].status, 'fallback');
	assert.equal(findings[1].selector, null, 'a missing surface has no selector, and must not invent one');

	// Order has to be stable or "the same drift" would look different on every
	// page load, and `firstSeen` would reset each time.
	assert.deepEqual(toFindings([...MATCHES].reverse()), findings);
});

test('firstSeen survives re-observing the same drift and resets when it changes', () => {
	const findings = toFindings(MATCHES);
	let state = mergeDrift({}, 'linklist', findings, T0);
	assert.equal(state.linklist.firstSeen, T0);

	state = mergeDrift(state, 'linklist', findings, T0 + DAY);
	assert.equal(state.linklist.firstSeen, T0, '"drifting since Tuesday" is a different situation from "since ten seconds ago"');
	assert.equal(state.linklist.lastSeen, T0 + DAY);

	const worse = toFindings([...MATCHES, { surfaceName: 'commentList', status: 'missing', selector: null }]);
	state = mergeDrift(state, 'linklist', worse, T0 + (2 * DAY));
	assert.equal(state.linklist.firstSeen, T0 + (2 * DAY), 'a different set of findings is a different situation, and dates from now');
	assert.equal(state.linklist.findings.length, 3);
});

test('page kinds are kept apart', () => {
	let state = mergeDrift({}, 'linklist', toFindings(MATCHES), T0);
	state = mergeDrift(state, 'comments', toFindings([{ surfaceName: 'commentArea', status: 'missing', selector: null }]), T0 + 1000);

	const records = driftRecords(state);
	assert.deepEqual(records.map(r => r.pageType), ['comments', 'linklist'], 'most recently seen first');
	assert.equal(countDriftedSurfaces(state), 3);

	const cleared = clearDriftFor(state, 'comments');
	assert.deepEqual(Object.keys(cleared), ['linklist']);
	assert.equal(clearDriftFor(state, 'nothing-here'), state, 'clearing a page kind that never drifted must not rewrite the state');
});

test('nothing is recorded when nothing drifted', () => {
	assert.deepEqual(mergeDrift({}, 'linklist', [], T0), {}, 'silence when every selector matches is the point');
	assert.deepEqual(mergeDrift({}, '', toFindings(MATCHES), T0), {});
	assert.deepEqual(driftRecords({}), []);
	assert.equal(formatDriftReport({}), '', 'an empty report is empty, not a heading with nothing under it');
});

test('a corrupt stored record is dropped rather than rendered', () => {
	const normalized = normalizeDriftState({
		good: { pageType: 'good', firstSeen: T0, lastSeen: T0, findings: [{ surfaceName: 'a', status: 'missing', selector: null }] },
		noDates: { findings: [{ surfaceName: 'a', status: 'missing', selector: null }] },
		noFindings: { firstSeen: T0, lastSeen: T0, findings: [] },
		badStatus: { firstSeen: T0, lastSeen: T0, findings: [{ surfaceName: 'a', status: 'fine', selector: null }] },
		notAnObject: 5,
	});
	assert.deepEqual(Object.keys(normalized), ['good']);
	assert.deepEqual(normalizeDriftState(null), {});
	assert.deepEqual(normalizeDriftState([]), {});

	// A finding whose status is not one of the two the UI knows how to render
	// would otherwise reach the DOM and be described as neither.
	assert.deepEqual(normalizeDriftState({
		mixed: { firstSeen: T0, lastSeen: T0, findings: [
			{ surfaceName: 'a', status: 'missing', selector: null },
			{ surfaceName: 'b', status: 'nonsense', selector: null },
		] },
	}).mixed.findings.map(f => f.surfaceName), ['a']);
});

test('the report is pasteable and says nothing about where the user was', () => {
	let state = mergeDrift({}, 'linklist', toFindings(MATCHES), T0);
	state = mergeDrift(state, 'comments', toFindings([{ surfaceName: 'commentArea', status: 'missing', selector: null }]), T0 + DAY);

	const report = formatDriftReport(state, '0.37.0');
	assert.match(report, /^RES-Slim selector drift report \(v0\.37\.0\)/);
	assert.match(report, /linklist, first seen 2026-08-10/);
	assert.match(report, /listingFeed: matched fallback selector \.linklisting \.thing\.link/);
	assert.match(report, /userbar: not found/);
	assert.match(report, /No URLs, subreddits or account details are included/);

	// The record itself is the guarantee, not the sentence about it.
	assert.ok(!/https?:\/\//.test(report), 'a report that carries a URL is not local-only in any sense the user cares about');
	assert.ok(!/\/r\//.test(report), 'nor a subreddit');
	// Day precision only: a full timestamp is a browsing-time record.
	assert.ok(!/T\d\d:\d\d/.test(report), 'times of day say when the user was reading reddit');
});

test('a finding describes itself the same way everywhere', () => {
	assert.equal(describeFinding({ surfaceName: 'userbar', status: 'missing', selector: null }), 'userbar: not found');
	assert.equal(describeFinding({ surfaceName: 'listingFeed', status: 'fallback', selector: '.x' }), 'listingFeed: matched fallback selector .x');
	assert.equal(describeFinding({ surfaceName: 'listingFeed', status: 'fallback', selector: null }), 'listingFeed: matched fallback selector (unknown)');
});

test('the diagnostics recorder writes the structured record alongside the log entry', () => {
	const source = read('lib/core/dom/selectorDiagnostics.js');
	assert.match(source, /DRIFT_STORAGE_KEY/);
	assert.match(source, /mergeDrift\(state, `\$\{appType\}:\$\{pageType\}`, toFindings\(matches\), now\)/);
	assert.match(source, /recordModuleErrorOnce/, 'the existing aggregated warning is a shipped contract and must not be dropped');
	assert.equal(DRIFT_STORAGE_KEY, 'RES.selectorDrift');
});

test('the console renders drift only when there is drift', () => {
	const console_ = read('lib/options/settingsConsole.js');
	assert.match(console_, /refreshSelectorDrift\(\)/, 'the panel has to be populated when the console draws');
	assert.match(console_, /if \(!records\.length\) \{\s*\n\s*panel\.hidden = true;/, 'a diagnostics panel that is always on screen is furniture');

	const templates = read('lib/options/templates.js');
	assert.match(templates, /id="RESSelectorDrift"[^>]*hidden/, 'and it ships hidden, so an empty console never flashes it');
	assert.match(templates, /id="RESSelectorDriftCopy"/, 'one-click copyable report');
	assert.match(templates, /id="RESSelectorDriftClear"/);
});
