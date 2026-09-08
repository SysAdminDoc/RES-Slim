/* @flow */
// RES-Slim: collapse Reddit's friction surfaces on old.reddit.com:
//   - /over18 NSFW interstitial: auto-click "yes" so the next click on an
//     NSFW link does not detour into a confirmation page.
//   - /quarantine opt-in: auto-click "Continue" so quarantined subs open
//     directly.
//   - Inline "use new reddit / open in app" banners: hidden via CSS.
//   - Reddit's "Open in app" floating prompt (if rendered on old.reddit): hidden.
//   - The mandatory-login interstitial (opt-in): dismissed structurally.
// All of them can be opted out individually.

import { Module } from '../core/module';
import { makeModuleErrorEntry } from '../utils/moduleErrorLog';
import { recordModuleErrorOnce } from '../core/modules/storage';
import { findSurface } from '../core/dom/selectors';
import { appType } from '../utils/currentLocation';
import { frameThrottle } from '../utils/async';

export const module: Module<{ [string]: any }> = new Module('frictionRemovers');

module.moduleName = 'Friction removers';
module.category = 'privacyCategory';
module.description = 'Auto-confirm /over18 and /quarantine gates; hide "use new Reddit" + "open in app" banners.';
module.descriptionRaw = true;
// Both renderers. The over-18 and quarantine interstitials are old-Reddit forms
// and simply do not match on current Reddit, but the login wall does: Reddit
// began showing a login modal on www.reddit.com in mid-2026, and the dismisser
// matches on *shape* - a viewport-covering fixed element paired with a scroll
// lock - rather than on any old-Reddit markup.
module.include = ['r2', 'd2x'];
module.keywords = ['nsfw', 'over18', 'quarantine', 'app prompt', 'new reddit', 'gate'];

module.options = {
	autoConfirmOver18: {
		type: 'boolean',
		value: true,
		title: 'Auto-confirm /over18 NSFW gate',
		description: 'Submit the "yes" form on /over18 so NSFW links open directly.',
	},
	autoConfirmQuarantine: {
		type: 'boolean',
		value: true,
		title: 'Auto-confirm quarantined subreddit opt-in',
		description: 'Submit the "continue" form on /quarantine pages.',
	},
	hideNewRedditBanner: {
		type: 'boolean',
		value: true,
		title: 'Hide "use new Reddit" banner',
		description: 'Suppress the floating banner that nudges you toward new Reddit.',
	},
	hideAppPrompt: {
		type: 'boolean',
		value: true,
		title: 'Hide "open in app" prompts',
		description: 'Suppress the banners and buttons that push you toward the Reddit mobile app, on both designs. On current Reddit that is the bar across the bottom, the "Get the app" button in the header, and the QR-code dialog an NSFW post shows.',
	},
	hideCookieBanner: {
		type: 'boolean',
		value: true,
		title: 'Hide the cookie banner',
		description: 'Suppress the cookie consent bar on current Reddit. It hides the bar; it does not answer it, so whatever Reddit does with no answer is what happens.',
	},
	hideOnboardingPrompts: {
		type: 'boolean',
		value: true,
		title: 'Hide onboarding and tour prompts',
		description: 'Suppress the guided-tour bubbles current Reddit shows over the page.',
	},
	dismissLoginWall: {
		type: 'boolean',
		value: false,
		title: 'Dismiss the mandatory-login overlay',
		description: 'Hide the full-screen "log in to continue" interstitial and restore scrolling. This only uncovers content Reddit actually sent. Where Reddit redirects you to the login page instead of serving the page, there is nothing behind the wall and no extension can bring it back. Off by default: it hides whatever is covering the page, so it is deliberately something you turn on after seeing the wall.',
	},
};

// --- login wall --------------------------------------------------------------
//
// Reddit began requiring login on old.reddit.com on 2026-06-30, and users have
// been hand-rolling uBlock zaps for it ever since. The obvious implementation is
// a list of class names, and it is the wrong one twice over: the rollout is
// geographic and gradual, so there is no single DOM to write the list against,
// and a class name is the easiest thing in the world for reddit to change.
//
// So this matches on shape. A login wall is a very large, fixed or absolutely
// positioned element covering the page, paired with scrolling locked on the
// document. None of that depends on what it is called.
//
// The cost of matching on shape is false positives, so the checks are narrow:
// the element must cover nearly the whole viewport, must not be ours, and — the
// one that matters — the real content must still be present underneath. If
// reddit sent a page with nothing behind the wall, there is nothing to reveal,
// and hiding the overlay would turn a wall the user can see into a blank page
// they cannot explain. That case is reported, not performed.
//
// The boundary, stated because it shrinks: there are two variants of this wall.
// The overlay-over-content one is the only one anything here can help with.
// Where the rollout has completed, the wall is *server-side* — a 302 to
// `old.reddit.com/login/?reason=lor2` with no content served at all (documented
// 2026-08-17, https://news.ycombinator.com/item?id=49326106). No amount of DOM
// work reaches a page that was never sent, and the redirect happens before any
// content script runs. So the served-overlay share is what this module covers,
// and that share falls as the rollout completes. The option description says so
// in the user's own words rather than leaving them to infer it from a feature
// that quietly stops applying.

const UNWALLED_CLASS = 'rsm-friction-unwalled';
const CONTENT_ANCHORS = ['#siteTable', '.commentarea', '.content[role="main"] .thing', '.content[role="main"] .sitetable'];
// Those four are old Reddit's, and for a while they were the whole list, on a
// module that declares `include = ['r2', 'd2x']` and whose header says the wall
// is matched on shape so it works on www.reddit.com. None of them exists there.
// So on current Reddit `hasContentBehind()` was always false: the wall was never
// hidden, and the module logged "reddit sent no content behind it" once a page
// with a full feed sitting behind the overlay.
//
// Named as surfaces rather than spelled out here, because that is where every
// other module's current-Reddit selectors live and where a selector override can
// reach them when reddit renames one.
const D2X_CONTENT_SURFACES = ['listingFeed', 'post', 'comment'];
// Enough of the viewport that nothing but a deliberate interstitial qualifies: a
// sticky header is wide but never tall, a modal is tall but never both.
const COVERAGE = 0.9;

let wallObserver: MutationObserver | null = null;
let reportedMissingContent = false;

function hasText(found: ?HTMLElement): boolean {
	return !!found && !!found.textContent && found.textContent.trim().length > 0;
}

function hasContentBehind(root: Document | HTMLElement = document): boolean {
	if (CONTENT_ANCHORS.some(selector => hasText((root.querySelector(selector): any)))) return true;
	// Only asked on current Reddit, so an old-Reddit page cannot start matching a
	// custom element that happens to share a name with something reddit ships.
	if (appType() !== 'd2x') return false;
	return D2X_CONTENT_SURFACES.some(surface => hasText(findSurface(surface, root, 'd2x')));
}

function isOurs(element: HTMLElement): boolean {
	if (element.dataset && element.dataset.rsmFriction) return true;
	if (element.id && /^(RES|res-|rsm-)/i.test(element.id)) return true;
	const className = element.getAttribute('class') || '';
	return /(^|\s)(RES|res-|rsm-)/i.test(className);
}

function coversPage(element: HTMLElement): boolean {
	const style = getComputedStyle(element);
	if (style.position !== 'fixed' && style.position !== 'absolute') return false;
	if (style.display === 'none' || style.visibility === 'hidden') return false;
	if (parseFloat(style.opacity) < 0.05) return false;

	const rect = element.getBoundingClientRect();
	const width = window.innerWidth || document.documentElement.clientWidth;
	const height = window.innerHeight || document.documentElement.clientHeight;
	if (!width || !height) return false;
	return rect.width >= width * COVERAGE && rect.height >= height * COVERAGE;
}

// Two levels below each root, and `<shreddit-app>` is a root as well as
// `<body>`. On old Reddit a wall is appended to the body, occasionally inside one
// wrapper, and two levels was the whole story. On current Reddit everything the
// page renders lives inside `<shreddit-app>`, so counting from the body alone
// put an overlay at depth three or more out of reach: `findLoginWalls()` returned
// empty and `hasContentBehind()` was never even consulted.
//
// Still bounded rather than a whole-document sweep. `coversPage` is a
// `getComputedStyle` and a `getBoundingClientRect` per candidate, and descending
// without a limit starts offering it every layout container on the page.
const OVERLAY_ROOT_SELECTOR = 'shreddit-app';

function collectTwoLevels(root: HTMLElement, out: HTMLElement[]): void {
	for (const child of Array.from(root.children)) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
		if (isOurs(child)) continue;
		out.push(child);
		for (const grandchild of Array.from(child.children)) {
			if (grandchild instanceof HTMLElement && !isOurs(grandchild)) out.push(grandchild);
		}
	}
}

function candidateOverlays(): HTMLElement[] {
	const out = [];
	if (!document.body) return out;
	collectTwoLevels(document.body, out);
	for (const root of document.body.querySelectorAll(OVERLAY_ROOT_SELECTOR)) {
		if (root instanceof HTMLElement && !isOurs(root)) collectTwoLevels(root, out);
	}
	// `<shreddit-app>` is itself a body child, so its own children are collected
	// twice. One `getComputedStyle` each is cheap; a duplicate *wall* would be
	// hidden twice, which is harmless, but de-duplicating keeps the count honest
	// for anything reading `findLoginWalls().length`.
	return [...new Set(out)];
}

export function findLoginWalls(): HTMLElement[] {
	return candidateOverlays().filter(coversPage);
}

export function dismissLoginWall(): boolean {
	if (!module.options.dismissLoginWall.value) return false;
	if (!document.body) return false;

	const walls = findLoginWalls();
	if (!walls.length) return false;

	if (!hasContentBehind()) {
		if (!reportedMissingContent) {
			reportedMissingContent = true;
			recordModuleErrorOnce(makeModuleErrorEntry(
				module.moduleID,
				'login-wall',
				`A full-page overlay covers ${location.pathname}, but reddit sent no content behind it, so there\'s nothing to uncover. Log in, or open the page in a logged-in tab.`,
			)).catch(() => {});
		}
		return false;
	}

	for (const wall of walls) wall.style.setProperty('display', 'none', 'important');
	document.documentElement.classList.add(UNWALLED_CLASS);
	document.body.classList.add(UNWALLED_CLASS);
	for (const element of [document.documentElement, document.body]) {
		element.classList.remove(...SCROLL_LOCK_CLASSES);
		// The offset the lock parked the document at. Left behind, it holds the
		// page at whatever position the wall appeared over.
		if (element.style.top) element.style.removeProperty('top');
	}
	return true;
}

function watchForLoginWall() {
	if (!module.options.dismissLoginWall.value) return;
	if (!document.body) return;
	// Disconnect before reassigning: a second setup call would otherwise orphan
	// the first observer while leaving it running.
	if (wallObserver) wallObserver.disconnect();
	// `subtree`, because a wall that arrives late arrives inside the app shell,
	// not as a body child -- without it the observer never woke for the renderer
	// the wall is actually being rolled out on. Throttled to a frame because a
	// subtree childList observer on current Reddit fires constantly and each run
	// is a `getComputedStyle` per candidate.
	wallObserver = new MutationObserver(frameThrottle(() => { dismissLoginWall(); }));
	wallObserver.observe(document.body, { childList: true, subtree: true });
}

export function stopWatchingForLoginWall() {
	if (wallObserver) wallObserver.disconnect();
	wallObserver = null;
	reportedMissingContent = false;
}

const HIDE_SELECTORS = {
	hideNewRedditBanner: [
		'#redesign-beta-optin-btn',
		'#new-reddit-pref-modal',
		'.listing-chooser .layout-button',
		'.global-modal-redesign-optin',
		'.usetextless-redesign-banner',
		'.top-matter .pinnable-message',
	],
	hideAppPrompt: [
		'#redditmobile-app-banner',
		'.use-app-banner',
		'.app-overlay',
		'.use-mobile-redirect-button',
		// Current Reddit. Element names and data attributes rather than text,
		// because the text is translated: uAssets has to carry a separate German
		// rule beside its English one for exactly this reason, and a rule keyed on
		// a word only ever works in one language.
		'.configured-xpromo',
		'[id^="xpromo-"]',
		'shreddit-async-loader[bundlename="bottom_bar_xpromo"]',
		'span[data-part="get-app-btn"]',
		'#nsfw-qr-dialog',
	],
	hideCookieBanner: [
		'shreddit-cookie-banner',
		'shreddit-async-loader[bundlename="reddit_cookie_banner"]',
	],
	hideOnboardingPrompts: [
		'shreddit-experience-tree',
	],
};

// Current Reddit locks scrolling with a class rather than an inline style, and
// that class does more than `overflow: hidden` -- it can pin the document with a
// negative `top`, so lifting the overflow alone leaves the page scrolled to a
// position it cannot leave. The class is removed as well as overridden.
const SCROLL_LOCK_CLASSES = ['rpl-scroll-lock'];

// Both interstitials are rendered by r2's `utils.html` `submit_form`, called as
// `<%utils:submit_form _class="pretty-form">` with no action argument, so the
// form it emits carries `action=""` (verified against reddit-archive/reddit on
// 2026-09-08: `r2/r2/templates/over18interstitial.html`,
// `quarantineinterstitial.html` and `utils.html:77-89`). That is why matching the
// form by its action never worked: `form[action="/over18"]` does not match
// `action=""`, and neither does `form[action$="/over18"]`. The quarantine arm was
// looking for `/quarantine`, which is the route and the POST target but not the
// attribute, so it had never fired once either.
//
// So the button is what is matched, and the form is whatever contains it. Each
// page carries exactly one form with two submit buttons and no checkbox, and
// which button was pressed is the entire answer:
//
//   over18:     <button type="submit" name="over18" value="no">no thank you</button>
//               <button type="submit" name="over18" value="yes">continue</button>
//   quarantine: <button type="submit" name="accept" value="no">no thank you</button>
//               <button type="submit" name="accept" value="yes">continue</button>
//
// "no" comes first in both, which is why the selector pins the value rather than
// taking the form's first submit control. `form.submit()` never carries a submit
// button's name and value, so the POST arrived with no answer field at all and
// reddit read it as the "no" branch; `requestSubmit(button)` submits as though
// that button had been pressed.
//
// Nothing injects a `dest`. An empty action posts back to the document's own URL,
// query string included, and `POST_over18` reads `dest` off the request params --
// so reddit already has it. The old code appended a body `dest` of the site root,
// which beats the query parameter and dropped the reader on the front page
// instead of the community they had clicked.
const CONFIRMATIONS = {
	over18: {
		route: /\/over18(\/|$|\?)/,
		accept: '[name="over18"][value="yes"]',
	},
	quarantine: {
		route: /\/quarantine(\/|$|\?)/,
		accept: '[name="accept"][value="yes"]',
	},
};

function submitWith(form: HTMLFormElement, accept: HTMLElement): boolean {
	// `requestSubmit` is the only route that carries the submitter, and it has
	// been in both browsers since long before this extension's floor.
	try {
		form.requestSubmit(accept);
		return true;
	} catch (e) {
		// It throws `TypeError` when the control is not a submit button and
		// `NotFoundError` when it does not belong to the form. The selector below
		// asks for `button` and `input[type="submit"]`, and a bare `<button>`
		// defaults to `type="submit"` -- but `<button type="button">` and
		// `type="reset"` match that selector too, and both make `requestSubmit`
		// throw. So this is a reachable path rather than a formality, and an
		// uncaught throw would abort `contentStart`: `_runModuleStage` records the
		// module as errored, and the login-wall dismisser below never starts for
		// the rest of the page.
	}
	// `.click()` on a non-submit control does nothing at all, so the caller is
	// told the attempt failed rather than left to assume the gate was answered.
	(accept: any).click();
	return false;
}

function autoConfirm(kind: 'over18' | 'quarantine'): boolean {
	const { accept } = CONFIRMATIONS[kind];
	for (const button of document.querySelectorAll(`button${accept}, input[type="submit"]${accept}`)) {
		if (!(button instanceof HTMLElement)) continue;
		const form = button.closest('form');
		if (!(form instanceof HTMLFormElement)) continue;
		if (submitWith(form, button)) return true;
	}
	return false;
}

function maybeAutoConfirmOver18() {
	if (!module.options.autoConfirmOver18.value) return;
	if (!CONFIRMATIONS.over18.route.test(location.pathname)) return;
	autoConfirm('over18');
}

function maybeAutoConfirmQuarantine() {
	if (!module.options.autoConfirmQuarantine.value) return;
	if (!CONFIRMATIONS.quarantine.route.test(location.pathname)) return;
	autoConfirm('quarantine');
}

function buildHideStyle(): string {
	const rules = [];
	const selectors = [];
	for (const key of Object.keys(HIDE_SELECTORS)) {
		if (!module.options[key].value) continue;
		selectors.push(...HIDE_SELECTORS[key]);
	}
	if (selectors.length) rules.push(`${selectors.join(', ')} { display: none !important; }`);
	if (module.options.dismissLoginWall.value) {
		// An `!important` stylesheet rule beats a non-important inline style, which
		// is how the lock is normally applied. Scoped to a class this module adds,
		// so nothing is unlocked on a page where no wall was found.
		rules.push(`html.${UNWALLED_CLASS}, body.${UNWALLED_CLASS} { overflow: auto !important; position: static !important; }`);
	}
	return rules.join('\n');
}

let injectedStyle: ?HTMLStyleElement = null;

function applyHideStyle() {
	const css = buildHideStyle();
	if (!css) return;
	if (!injectedStyle) {
		injectedStyle = document.createElement('style');
		injectedStyle.dataset.rsmFriction = 'true';
		(document.head || document.documentElement).append(injectedStyle);
	}
	injectedStyle.textContent = css;
}

module.beforeLoad = () => {
	applyHideStyle();
};

module.contentStart = () => {
	applyHideStyle();
	maybeAutoConfirmOver18();
	maybeAutoConfirmQuarantine();
	dismissLoginWall();
	watchForLoginWall();
};
