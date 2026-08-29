import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { launchWithExtension, repoRoot } from './harness.mjs';

const SHREDDIT_LISTING = path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'listing.html');
const SHREDDIT_MEDIA_IMAGE = path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'media.png');
const SHREDDIT_MEDIA_VIDEO = path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'media.mp4');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const MODULES = Object.fromEntries([
	'infiniteScroll', 'userTagger', 'filterRules', 'threadMinimap', 'commentNavigator',
	'voteEnhancements', 'absoluteTimestamps', 'authorContextBadge', 'roleHighlights', 'layoutTweaks',
].map(id => [id, true]));

function fulfill(route, documentFixture) {
	const request = route.request();
	const url = new URL(request.url());
	if (request.resourceType() === 'document' && url.hostname === 'www.reddit.com') {
		return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(documentFixture, 'utf8') });
	}
	if (url.hostname === 'preview.redd.it' && url.pathname.endsWith('.png')) {
		return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(SHREDDIT_MEDIA_IMAGE) });
	}
	if (url.hostname === 'v.redd.it' && url.pathname.endsWith('.mp4')) {
		return route.fulfill({ status: 200, contentType: 'video/mp4', body: fs.readFileSync(SHREDDIT_MEDIA_VIDEO) });
	}
	return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
}

const palette = process.argv[2] || 'classic';
const { context, worker, dispose } = await launchWithExtension();
await worker.evaluate(([mods, theme]) => new Promise(resolve => {
	chrome.storage.local.set({
		'RES.modulePrefs': mods,
		'RESoptions.pageTheme': { theme: { value: theme } },
		'RESoptions.infiniteScroll': { limitCurrentReddit: { value: true }, currentRedditLimit: { value: '1' } },
		'RESoptions.filterRules': {
			rulesJson: { value: JSON.stringify([{ id: 'a11y-badge', field: 'keyword', op: 'contains', value: 'e', action: 'badge', enabled: true }]) },
		},
	}, resolve);
}), [MODULES, palette]);

const page = await context.newPage();
await page.route('**/*', route => fulfill(route, SHREDDIT_LISTING));
await page.goto('https://www.reddit.com/r/example/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('html.res-pageTheme shreddit-post[data-res-shreddit-compat]', { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('[id^="rsm-"], [class*="rsm-"]').length > 2, null, { timeout: 30000 });

const info = await page.evaluate(() => {
	const SURFACE = '[id^="rsm-"], [class*="rsm-"]';
	const skip = new Set([document.documentElement, document.body]);
	const candidates = [...document.querySelectorAll(SURFACE)].filter(el => !skip.has(el));
	const seen = new Set();
	const detail = [];
	for (const el of candidates) {
		const container = el.parentElement && el.parentElement.closest(SURFACE);
		if (container && !skip.has(container)) continue;
		const cls = el.className.toString().trim().split(/\s+/).find(c => c.startsWith('rsm-'));
		if (el.id) seen.add(`#${el.id}`);
		else if (cls) seen.add(`.${cls}`);
		detail.push({ tag: el.tagName, id: el.id, cls: el.className.toString(), descendants: el.querySelectorAll('*').length });
	}
	const ts = [...document.querySelectorAll('.res-slim-abs-ts')].map(s => ({
		color: getComputedStyle(s).color,
		inRoot: seen.size ? [...seen].some(sel => { try { return [...document.querySelectorAll(sel)].some(r => r.contains(s)); } catch { return false; } }) : false,
		parent: s.parentElement && s.parentElement.tagName,
	}));
	return { roots: [...seen], detail, totalCandidates: candidates.length, ts, inkMuted: getComputedStyle(document.documentElement).getPropertyValue('--rsm-ink-muted') };
});
console.log(JSON.stringify(info, null, 1));

let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
for (const root of info.roots) builder = builder.include(root);
const results = await builder.analyze();
console.log('passes:', results.passes.length, 'violations:', results.violations.map(v => v.id));
console.log('inspected node count (passes):', results.passes.reduce((n, r) => n + r.nodes.length, 0));
console.log('rules run:', results.passes.map(p => p.id).join(','));

await page.close();
await dispose();
