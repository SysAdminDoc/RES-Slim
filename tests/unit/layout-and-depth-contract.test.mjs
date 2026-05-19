import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('layoutTweaks + commentDepthColors are registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as layoutTweaks \} from '\.\/layoutTweaks';/);
	assert.match(index, /import \{ module as commentDepthColors \} from '\.\/commentDepthColors';/);
	assert.match(index, /^\s*layoutTweaks,/m);
	assert.match(index, /^\s*commentDepthColors,/m);
});

test('layoutTweaks defines body class + CSS rule for every option key', () => {
	const source = read('lib/modules/layoutTweaks.js');
	for (const key of ['fullWidth', 'hideSidebar', 'postNumbers', 'hideAwards', 'hideFlair', 'hideLinkFlair', 'hideAvatars']) {
		assert.match(source, new RegExp(`key:\\s*'${key}'`), `expected RULES entry for ${key}`);
	}
});

test('layoutTweaks injects a single deduped style tag and toggles classes per option', () => {
	const source = read('lib/modules/layoutTweaks.js');
	assert.match(source, /STYLE_ID\s*=\s*'RSMLayoutTweaksStyle'/);
	assert.match(source, /body\.classList\.toggle\(className, !!module\.options\[key\]\.value\)/);
});

test('layoutTweaks avoids pill / fully-rounded backdrops in its injected CSS', () => {
	const source = read('lib/modules/layoutTweaks.js');
	assert.doesNotMatch(source, /border-radius:\s*9{2,}px/);
	assert.doesNotMatch(source, /border-radius:\s*50%/);
});

test('commentDepthColors cycles through max depth and respects saturation knob', () => {
	const source = read('lib/modules/commentDepthColors.js');
	assert.match(source, /saturation:\s*\{[\s\S]*?value:\s*'70'/);
	assert.match(source, /maxDepth:\s*\{[\s\S]*?value:\s*'8'/);
	assert.match(source, /hsl\(\$\{hue\.toFixed\(1\)\}/);
});

test('commentDepthColors scopes its rules behind a body class so the rest of the page is unaffected', () => {
	const source = read('lib/modules/commentDepthColors.js');
	assert.match(source, /body\.rsm-depth-colors \.commentarea \.thing\.comment/);
});
