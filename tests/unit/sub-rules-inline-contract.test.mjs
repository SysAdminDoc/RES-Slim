import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(import.meta.dirname, '.tmp-sub-rules');
fs.mkdirSync(tmpDir, { recursive: true });

const helperSrc = read('lib/utils/subRules.js');
const stripped = helperSrc
	.replace(/\/\* @flow \*\//, '')
	.replace(/export type \w+ = \{\|[\s\S]*?\|\};/g, '')
	.replace(/: SubRule\[\]/g, '')
	.replace(/: SubRule/g, '')
	.replace(/: string/g, '')
	.replace(/: mixed/g, '')
	.replace(/: number/g, '')
	.replace(/: \?\{[^}]+\}/g, '')
	.replace(/: \{ \[string\][^}]+\}/g, '')
	.replace(/import.*Storage.*\n/g, '')
	.replace(/import.*rateLimiter.*\n/g, '')
	.replace(/import.*redditJson.*\n/g, '')
	.replace(/const limiter[^;]+;/g, '')
	.replace(/const CACHE_KEY[^;]+;/g, '')
	.replace(/const CACHE_TTL[^;]+;/g, '')
	.replace(/let cache[^;]+= null;/g, '')
	.replace(/async function loadCache[\s\S]*?^}/m, '')
	.replace(/async function saveCache[\s\S]*?^}/m, '')
	.replace(/export async function fetchRules[\s\S]*?^}/m, '')
	.replace(/\(json: any\)/g, '(json)')
	.replace(/\(r: any\)/g, '(r)')
	// The escape is shared now, so it is emitted beside this module rather than
	// stripped out with the other imports: having one of it is the point.
	.replace('from \'./html\'', 'from \'./html.mjs\'');
fs.writeFileSync(
	path.join(tmpDir, 'html.mjs'),
	read('lib/utils/html.js')
		.replace(/\/\* @flow \*\//, '')
		.replace(/: \?string/g, '')
		.replace(/: string/g, '')
		.replace(/: mixed/g, ''),
);
const helperPath = path.join(tmpDir, 'subRules.mjs');
fs.writeFileSync(helperPath, stripped);
const modUrl = pathToFileURL(helperPath).href;

test('parseRulesResponse extracts rules from standard Reddit response', async () => {
	const mod = await import(modUrl);
	const rules = mod.parseRulesResponse({
		rules: [
			{ kind: 'all', short_name: 'Be civil', description: 'No personal attacks', violation_reason: 'uncivil' },
			{ kind: 'link', short_name: 'No spam', description: '', violation_reason: 'spam' },
		],
	});
	assert.equal(rules.length, 2);
	assert.equal(rules[0].short_name, 'Be civil');
	assert.equal(rules[1].kind, 'link');
});

test('parseRulesResponse returns empty for bad input', async () => {
	const mod = await import(modUrl);
	assert.deepEqual(mod.parseRulesResponse(null), []);
	assert.deepEqual(mod.parseRulesResponse({}), []);
	assert.deepEqual(mod.parseRulesResponse('string'), []);
});

test('buildRulesUrl encodes subreddit name', async () => {
	const mod = await import(modUrl);
	assert.equal(mod.buildRulesUrl('AskReddit'), '/r/AskReddit/about/rules.json');
});

test('formatRulesHtml renders rule items', async () => {
	const mod = await import(modUrl);
	const html = mod.formatRulesHtml([
		{ kind: 'all', short_name: 'Be nice', description: 'Treat others well', violation_reason: '' },
	], 'test');
	assert.ok(html.includes('Be nice'));
	assert.ok(html.includes('Treat others well'));
	assert.ok(html.includes('r/test rules'));
});

test('formatRulesHtml handles empty rules', async () => {
	const mod = await import(modUrl);
	const html = mod.formatRulesHtml([], 'empty');
	assert.ok(html.includes('No rules found'));
});

test('formatRulesHtml escapes HTML in rule text', async () => {
	const mod = await import(modUrl);
	const html = mod.formatRulesHtml([
		{ kind: 'all', short_name: '<script>alert(1)</script>', description: '', violation_reason: '' },
	], 'xss');
	assert.ok(!html.includes('<script>'));
	assert.ok(html.includes('&lt;script&gt;'));
});

test('subRulesInline module is registered and disabled by default', () => {
	const src = read('lib/modules/subRulesInline.js');
	assert.ok(src.includes('disabledByDefault = true'));
	assert.ok(src.includes("popover.setAttribute('role', 'tooltip')"));
	assert.ok(src.includes("anchor.addEventListener('focus', showPopover)"));
	assert.ok(src.includes("anchor.addEventListener('blur', hidePopover)"));
	assert.ok(src.includes("anchor.setAttribute('aria-describedby', POPOVER_ID)"));
	const index = read('lib/modules/index.js');
	assert.ok(index.includes("from './subRulesInline'"));
	assert.ok(index.includes('subRulesInline,'));
});

test('subRulesInline popover styles include polished states', () => {
	const scss = read('lib/css/modules/_subRulesInline.scss');
	assert.ok(scss.includes('.rsm-subrules-popover'));
	assert.ok(scss.includes('width: min(420px, calc(100vw - 24px))'));
	assert.ok(scss.includes('.rsm-subrules-empty.is-error'));
	assert.ok(scss.includes('.rsm-subrules-item'));
});

test('a rule containing an apostrophe is escaped like every other special character', async () => {
	// This file's private escape had drifted from the other three copies: it had
	// no rule for the apostrophe, so a rule text carrying one was inserted into
	// the popover's markup unescaped. Harmless where it lands today - the value
	// goes between tags, not into an attribute - but it is the difference that
	// made four copies of one function worth collapsing into one.
	const mod = await import(modUrl);
	const html = mod.formatRulesHtml(
		[{ kind: 'all', short_name: 'Don\'t be a jerk', description: 'It\'s simple', violation_reason: '' }],
		'example',
	);
	assert.ok(!/Don't/.test(html), `an apostrophe reached the markup raw: ${html}`);
	assert.match(html, /Don&#39;t be a jerk/);
	assert.match(html, /It&#39;s simple/);
});

test('the four private escapes are gone, and the shared one is what they call', () => {
	for (const file of ['lib/utils/commentTreeExport.js', 'lib/utils/fencedCode.js', 'lib/utils/textDiff.js', 'lib/utils/subRules.js']) {
		const source = read(file);
		assert.match(source, /import \{ escapeHtmlText \} from '\.\/html'/, `${file} does not use the shared escape`);
		assert.doesNotMatch(source, /replace\(\/&\/g, '&amp;'\)/, `${file} still carries its own copy`);
	}
	assert.match(read('lib/utils/html.js'), /export function escapeHtmlText\(/);
});
