import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';

import { launchWithExtension, repoRoot, saveScreenshotDir } from './harness.mjs';

const THREAD_FIXTURE = path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'thread.html');
const MEDIA_IMAGE = path.join(repoRoot, 'images', 'promo440x280.png');
const THREAD_URL = 'https://www.reddit.com/r/example/comments/thread01/current_reddit_thread/';
const VIEWPORTS = [
	{ width: 2048, height: 987 },
	{ width: 960, height: 800 },
	{ width: 640, height: 900 },
];
const THEMES = ['classic', 'gruvbox'];

function fulfillThreadRequest(route) {
	const request = route.request();
	const url = new URL(request.url());
	if (request.resourceType() === 'document' && url.hostname === 'www.reddit.com') {
		return route.fulfill({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			body: fs.readFileSync(THREAD_FIXTURE, 'utf8'),
		});
	}
	if (url.hostname === 'preview.redd.it' && url.pathname.endsWith('.png')) {
		return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(MEDIA_IMAGE) });
	}
	return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
}

async function setTheme(worker, theme) {
	await worker.evaluate(value => new Promise(resolve => {
		chrome.storage.local.set({
			'RES.modulePrefs': { pageTheme: true },
			'RESoptions.pageTheme': { theme: { value }, refinedLayout: { value: true } },
		}, resolve);
	}), theme);
}

async function dismissNotifications(page) {
	await page.locator('#RESNotifications .RESCloseButton').evaluateAll(buttons => {
		buttons.forEach(button => button.click());
	});
}

async function captureDiscussion(page, file) {
	await page.evaluate(() => {
		const spacer = document.createElement('div');
		spacer.dataset.rsmScreenshotSpacer = 'true';
		spacer.style.height = '100vh';
		document.body.append(spacer);
	});
	await page.evaluate(() => {
		const header = document.querySelector('comment-body-header');
		scrollTo(0, Math.max(0, header.getBoundingClientRect().top + scrollY - 50));
	});
	await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
	await page.locator('[data-rsm-screenshot-spacer]').evaluate(element => element.remove());
}

function readParityState(page) {
	return page.evaluate(() => {
		const rect = element => {
			if (!element) return null;
			const value = element.getBoundingClientRect();
			return {
				x: Math.round(value.x * 100) / 100,
				y: Math.round(value.y * 100) / 100,
				width: Math.round(value.width * 100) / 100,
				height: Math.round(value.height * 100) / 100,
			};
		};
		const comments = [...document.querySelectorAll('shreddit-comment')].map(comment => {
			const details = comment.querySelector(':scope > details');
			const summary = details?.querySelector(':scope > summary');
			const meta = summary?.querySelector('[slot="commentMeta"]');
			const body = details?.querySelector(':scope > .comment-main-grid [slot="comment"]');
			const actions = details?.querySelector(':scope > .comment-main-grid [slot="actionRow"]');
			const actionHost = actions?.querySelector('shreddit-comment-action-row');
			const vote = actionHost?.shadowRoot?.querySelector('[upvote]');
			const award = actions?.querySelector('award-button')?.shadowRoot?.querySelector('[data-award-button]');
			const nativeCollapse = details?.querySelector('.collapse-container');
			return {
				depth: Number(comment.getAttribute('depth')),
				host: rect(comment),
				summary: rect(summary),
				meta: rect(meta),
				body: rect(body),
				actions: rect(actions),
				summaryPosition: getComputedStyle(summary).position,
				summaryMarker: getComputedStyle(summary, '::before').content,
				metaFont: getComputedStyle(meta).fontSize,
				bodyFont: getComputedStyle(body).fontSize,
				actionFont: getComputedStyle(actions).fontSize,
				nativeCollapseDisplay: getComputedStyle(nativeCollapse).display,
				vote: vote ? {
					part: vote.getAttribute('part'),
					background: getComputedStyle(vote).backgroundColor,
					borderRadius: getComputedStyle(vote).borderRadius,
					height: getComputedStyle(vote).height,
				} : null,
				award: award ? {
					part: award.getAttribute('part'),
					background: getComputedStyle(award).backgroundColor,
					borderColor: getComputedStyle(award).borderColor,
					borderRadius: getComputedStyle(award).borderRadius,
					height: getComputedStyle(award).height,
				} : null,
			};
		});
		const composer = document.querySelector('faceplate-textarea-input');
		const composerBoundary = composer?.shadowRoot?.querySelector('.input-boundary-box');
		const composerInput = composer?.shadowRoot?.querySelector('textarea');
		const sort = document.querySelector('shreddit-sort-dropdown')?.shadowRoot?.querySelector('#comment-sort-button');
		const search = document.querySelector('pdp-comment-search-input')?.shadowRoot?.querySelector('#expand-pdp-comment-search-button');
		const commentsHeading = document.querySelector('#comment-tree > section[aria-label="Comments"] > h1');
		const pluralAd = document.querySelector('shreddit-comment-tree-ads');
		// Reddit declares its own RPL token set on `div.grid-container.theme-rpl`,
		// below the root the palette remaps. Read the tokens where Reddit paints
		// from them rather than at the root, and read one element Reddit paints
		// that the theme has never restyled.
		const grid = document.querySelector('.grid-container');
		const gridStyles = getComputedStyle(grid);
		const branchline = document.querySelector('.more-comments-partial .branchline');
		return {
			classes: document.documentElement.className,
			tokens: {
				palette: getComputedStyle(document.documentElement).getPropertyValue('--rsm-th-bg').trim(),
				gridBackground: gridStyles.getPropertyValue('--color-neutral-background').trim(),
				gridContent: gridStyles.getPropertyValue('--color-neutral-content').trim(),
				paletteText: getComputedStyle(document.documentElement).getPropertyValue('--rsm-th-txt').trim(),
				branchline: getComputedStyle(branchline).backgroundColor,
			},
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			bodyHeader: rect(document.querySelector('comment-body-header')),
			composer: rect(composer),
			composerBoundary: rect(composerBoundary),
			composerInput: rect(composerInput),
			sort: rect(sort),
			search: rect(search),
			commentsHeadingDisplay: getComputedStyle(commentsHeading).display,
			pluralAdDisplay: getComputedStyle(pluralAd).display,
			stickyDisplay: getComputedStyle(document.querySelector('#sticky-comment-composer-wrapper')).display,
			comments,
		};
	});
}

function rgb(hex) {
	const value = hex.replace('#', '');
	const full = value.length === 3 ? [...value].map(c => c + c).join('') : value;
	const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
	return `rgb(${r}, ${g}, ${b})`;
}

function assertParity(state, viewport, theme) {
	assert.match(state.classes, new RegExp(`\\bres-pageTheme--${theme}\\b`));
	// The palette has to win where Reddit defines its tokens, not only at the
	// root. It declares the whole RPL set again on `.theme-rpl`, so a map that
	// only lands on `<html>` reaches the header and nothing below it: on Gruvbox
	// that painted the branch lines beside every "more replies" fold white, and
	// the right rail's community title at about 2:1.
	assert.equal(state.tokens.gridBackground, state.tokens.palette,
		`${theme} lost --color-neutral-background below .theme-rpl`);
	assert.equal(state.tokens.gridContent, state.tokens.paletteText,
		`${theme} lost --color-neutral-content below .theme-rpl`);
	assert.equal(state.tokens.branchline, rgb(state.tokens.palette),
		`${theme} paints a branch line that is not the page ground`);
	assert.match(state.classes, /\bres-pageTheme--refined\b/);
	assert.ok(state.overflow <= 1, `${theme} at ${viewport.width}px overflowed by ${state.overflow}px`);
	assert.equal(state.commentsHeadingDisplay, 'none');
	assert.equal(state.pluralAdDisplay, 'none');
	assert.equal(state.stickyDisplay, 'none');
	const expectedContentWidth = viewport.width > 960 ? viewport.width - 340 : viewport.width - 20;
	assert.ok(state.bodyHeader.width >= expectedContentWidth, `discussion header lost the content width at ${viewport.width}px`);
	assert.ok(state.composer.width >= state.bodyHeader.width - 15, `composer collapsed to ${state.composer.width}px`);
	assert.ok(state.composerBoundary.width >= state.composer.width - 1, `composer boundary collapsed to ${state.composerBoundary.width}px`);
	assert.ok(state.composerInput.height >= 24, `composer input target collapsed to ${state.composerInput.height}px`);
	assert.equal(state.sort.height, 24);
	assert.equal(state.search.height, 24);
	assert.ok(Math.abs(state.sort.y - state.search.y) <= 1, 'sort and search controls must share one toolbar row');
	assert.equal(state.comments.length, 4);

	for (const [index, comment] of state.comments.entries()) {
		assert.equal(comment.depth, index);
		assert.equal(comment.summaryPosition, 'relative');
		assert.equal(comment.summaryMarker, '"[-]"');
		assert.equal(comment.summary.height, 24);
		assert.equal(comment.meta.height, 14);
		assert.equal(comment.metaFont, '10px');
		assert.equal(comment.bodyFont, '14px');
		assert.equal(comment.actionFont, '10px');
		assert.ok(comment.actions.height >= 24, `depth ${index} action target collapsed to ${comment.actions.height}px`);
		assert.equal(comment.nativeCollapseDisplay, 'none');
		assert.ok(comment.meta.width > state.bodyHeader.width - 100, `depth ${index} metadata was squeezed to ${comment.meta.width}px`);
		assert.ok(comment.body.width > state.bodyHeader.width - 100, `depth ${index} body was squeezed to ${comment.body.width}px`);
		assert.ok(comment.meta.y < comment.body.y && comment.body.y < comment.actions.y, `depth ${index} row order broke`);
		assert.equal(comment.vote.background, 'rgba(0, 0, 0, 0)');
		assert.equal(comment.vote.borderRadius, '0px');
		assert.equal(comment.vote.height, '24px');
		assert.match(comment.vote.part, /\brsm-vote-button\b/);
		if (index > 0) {
			assert.ok(Math.abs(comment.host.x - state.comments[index - 1].host.x - 18) <= 1, `depth ${index} did not use one 18px nesting step`);
		}
	}

	assert.deepEqual(state.comments[0].award, {
		part: 'rsm-comment-action-button',
		background: 'rgba(0, 0, 0, 0)',
		borderColor: 'rgba(0, 0, 0, 0)',
		borderRadius: '0px',
		height: '24px',
	});
}

test('current Reddit discussion UI keeps old Reddit geometry across themes and widths', async t => {
	const { context, worker, dispose } = await launchWithExtension({ viewport: VIEWPORTS[0] });
	t.after(dispose);

	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', error => pageErrors.push(String(error)));
	await page.route('**/*', fulfillThreadRequest);
	const screenshots = saveScreenshotDir();

	for (const theme of THEMES) {
		for (const viewport of VIEWPORTS) {
			await setTheme(worker, theme); // eslint-disable-line no-await-in-loop
			await page.setViewportSize(viewport); // eslint-disable-line no-await-in-loop
			await page.goto(THREAD_URL, { waitUntil: 'domcontentloaded' }); // eslint-disable-line no-await-in-loop
			await page.waitForFunction( // eslint-disable-line no-await-in-loop
				value => document.documentElement.classList.contains(`res-pageTheme--${value}`) &&
					document.querySelectorAll('shreddit-comment[data-res-shreddit-compat]').length === 4,
				theme,
				{ timeout: 30000 },
			);
			await page.waitForFunction(() => { // eslint-disable-line no-await-in-loop
				const composer = document.querySelector('faceplate-textarea-input');
				const action = document.querySelector('shreddit-comment-action-row');
				return composer?.shadowRoot?.querySelector('[part~="rsm-comment-composer-boundary"]') &&
					action?.shadowRoot?.querySelector('[part~="rsm-vote-button"]');
			}, null, { timeout: 30000 });
			await dismissNotifications(page); // eslint-disable-line no-await-in-loop
			const state = await readParityState(page); // eslint-disable-line no-await-in-loop
			assertParity(state, viewport, theme);
			await captureDiscussion( // eslint-disable-line no-await-in-loop
				page,
				path.join(screenshots, `current-thread-${theme}-${viewport.width}.png`),
			);
		}
	}

	await setTheme(worker, 'classic');
	await page.setViewportSize(VIEWPORTS[0]);
	await page.goto(THREAD_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('shreddit-comment[data-res-shreddit-compat] > details[open] > summary', { timeout: 30000 });
	const accessibility = await new AxeBuilder({ page })
		.include('#comment-tree')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		// Live Reddit places author and permalink anchors inside the native summary.
		// The extension preserves that markup and its details-toggle behavior, so
		// this focused check owns the sizing rule and leaves Reddit's nesting alone.
		.disableRules(['nested-interactive'])
		.analyze();
	assert.ok(accessibility.passes.length > 0, 'axe found no passing checks in the discussion tree');
	assert.deepEqual(
		accessibility.violations.map(violation => violation.id),
		[],
		`discussion accessibility violations: ${accessibility.violations.map(violation =>
			`${violation.id} (${violation.nodes.map(node => node.target.join(' ')).join(', ')})`).join('; ')}`,
	);
	const summary = page.locator('shreddit-comment[depth="0"] > details > summary');
	await summary.focus();
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => document.querySelector('shreddit-comment[depth="0"]')?.classList.contains('collapsed'));
	assert.equal(await page.locator('shreddit-comment[depth="0"] > details').getAttribute('open'), null);
	assert.equal(await summary.evaluate(element => getComputedStyle(element, '::before').content), '"[+]"');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => !document.querySelector('shreddit-comment[depth="0"]')?.classList.contains('collapsed'));
	assert.notEqual(await page.locator('shreddit-comment[depth="0"] > details').getAttribute('open'), null);

	const search = page.locator('pdp-comment-search-input').evaluateHandle(host => host.shadowRoot.querySelector('#expand-pdp-comment-search-button'));
	const searchButton = await search;
	await searchButton.asElement().focus();
	assert.equal(await searchButton.asElement().getAttribute('aria-expanded'), 'false');
	assert.deepEqual(pageErrors, [], 'current Reddit discussion must initialise without uncaught errors');
});
