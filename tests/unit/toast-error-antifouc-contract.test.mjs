import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const foregroundEntry = read('lib/foreground.entry.js');
const antiFouc = read('lib/core/theme/antiFouc.js');
const toastHost = read('lib/core/dom/toastHost.js');
const errorLog = read('lib/core/errors/errorLog.js');
const registry = read('lib/core/registry/featureRegistry.js');
const resCss = read('lib/css/res.scss');
const toastStyles = read('lib/css/modules/_toastHost.scss');
const optionsStyles = read('lib/options/options.scss');

test('document-start foreground entry applies and cleans up OLED anti-FOUC classes', () => {
	assert.match(foregroundEntry, /import \{ applyAntiFoucTheme \} from '\.\/core\/theme\/antiFouc'/);
	assert.match(foregroundEntry, /const cleanupAntiFoucTheme = applyAntiFoucTheme\(\)/);
	assert.match(foregroundEntry, /cleanupAntiFoucTheme\(\)/);
	assert.match(foregroundEntry, /init\(\)/);

	assert.match(antiFouc, /ANTI_FOUC_STYLE_ID = 'rsm-anti-fouc-style'/);
	assert.match(antiFouc, /'rsm-root'/);
	assert.match(antiFouc, /'rsm-theme-dark'/);
	assert.match(antiFouc, /'rsm-theme-oled'/);
	assert.match(antiFouc, /'res-nightmode'/);
	assert.match(antiFouc, /color-scheme: dark/);
	assert.match(antiFouc, /documentRef\.documentElement/);
	assert.match(antiFouc, /style\.textContent = EARLY_DARK_CSS/);
	assert.doesNotMatch(antiFouc, /innerHTML|insertAdjacentHTML|confirm|alert/);
});

test('toast host renders accessible no-dialog feedback with DOM-safe primitives', () => {
	assert.match(toastHost, /TOAST_HOST_ID = 'rsm-toast-host'/);
	assert.match(toastHost, /createToastHost\(/);
	assert.match(toastHost, /host\.setAttribute\('role', 'region'\)/);
	assert.match(toastHost, /host\.setAttribute\('aria-live', 'polite'\)/);
	assert.match(toastHost, /toast\.setAttribute\('role', tone === 'error' \? 'alert' : 'status'\)/);
	assert.match(toastHost, /documentRef\.createElement\(tagName\)/);
	assert.match(toastHost, /element\.textContent = text/);
	assert.match(toastHost, /host\.prepend\(toast\)/);
	assert.match(toastHost, /host\.replaceChildren\(\)/);
	assert.match(toastHost, /window\.clearTimeout\(timer\)/);
	assert.doesNotMatch(toastHost, /innerHTML|insertAdjacentHTML|confirm\(|alert\(|keydown/);
});

test('local error log records isolated feature errors and uses pointer-safe inactive panel states', () => {
	assert.match(errorLog, /ERROR_LOG_PANEL_ID = 'rsm-error-log-panel'/);
	assert.match(errorLog, /createErrorLog\(/);
	assert.match(errorLog, /normalizeError\(error\)/);
	assert.match(errorLog, /panel\.hidden = true/);
	assert.match(errorLog, /panel\.setAttribute\('aria-hidden', 'true'\)/);
	assert.match(errorLog, /list\.replaceChildren/);
	assert.match(errorLog, /toastHost\.showToast/);
	assert.match(errorLog, /getEntries: \(\) => \[\.\.\.entries\]/);
	assert.doesNotMatch(errorLog, /innerHTML|insertAdjacentHTML|confirm|alert|keydown/);

	assert.match(registry, /services\.errorLog\.record\(error, \{ featureId: feature\.id, stage \}\)/);
	assert.match(registry, /services\.toast\.showToast \|\| services\.toast/);
});

test('toast and error-log styles are dark-only, scoped, and reduced-motion aware', () => {
	assert.match(resCss, /@import 'modules\/toastHost'/);
	assert.match(toastStyles, /#rsm-toast-host/);
	assert.match(toastStyles, /pointer-events: none/);
	assert.match(toastStyles, /\.rsm-toast/);
	assert.match(toastStyles, /pointer-events: auto/);
	assert.match(toastStyles, /background: linear-gradient\(180deg, rgb\(16 22 32/);
	assert.match(toastStyles, /\.rsm-error-log-panel/);
	assert.match(toastStyles, /&\.is-active \{/);
	assert.match(toastStyles, /@media \(prefers-reduced-motion: reduce\)/);
	assert.doesNotMatch(toastStyles, /#fff;[\s\S]*background: #fff/);
});

test('inactive settings overlays do not intercept pointer events', () => {
	assert.match(optionsStyles, /#moduleOptionsScrim \{[\s\S]*pointer-events: none/);
	assert.match(optionsStyles, /&\.visible \{[\s\S]*pointer-events: auto/);
});
