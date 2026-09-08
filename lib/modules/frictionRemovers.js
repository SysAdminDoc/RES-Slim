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
		title: 'Hide "open in app" prompt',
		description: 'Suppress the floating prompt that opens the Reddit mobile app.',
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

// Only the top two levels. A wall is appended to <body>, occasionally inside one
// wrapper; descending further starts matching layout containers that legitimately
// fill the page.
function candidateOverlays(): HTMLElement[] {
	const out = [];
	if (!document.body) return out;
	for (const child of Array.from(document.body.children)) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
		if (isOurs(child)) continue;
		out.push(child);
		for (const grandchild of Array.from(child.children)) {
			if (grandchild instanceof HTMLElement && !isOurs(grandchild)) out.push(grandchild);
		}
	}
	return out;
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
	return true;
}

function watchForLoginWall() {
	if (!module.options.dismissLoginWall.value) return;
	if (!document.body) return;
	// Disconnect before reassigning: a second setup call would otherwise orphan
	// the first observer while leaving it running.
	if (wallObserver) wallObserver.disconnect();
	wallObserver = new MutationObserver(() => { dismissLoginWall(); });
	wallObserver.observe(document.body, { childList: true });
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
	],
};

// Old Reddit's `/over18` page carries one form with two submit buttons,
// `name="over18" value="yes"` and `value="no"`, and no checkbox at all. Which
// one was pressed *is* the answer. `form.submit()` never includes a submit
// button's name and value, so the POST arrived with no `over18` field, which
// reddit reads as the "no" branch -- an option that is on by default was
// bouncing every reader back where they came from. `requestSubmit(button)`
// submits the form as if that button had been pressed, so the value goes with
// it. The old code also set `.checked` on `input[name="over18"]`, which does not
// exist on the page.
//
// The quarantine interstitial is a different shape again: two forms, one posting
// to `/api/quarantine_optin` and one to `/api/quarantine_optout`. Neither
// matches `form[action="/quarantine"]` or `form[action$="/quarantine"]`, so that
// branch had never fired once. Matching the opt-in action exactly matters here,
// because `$=` on `_optin` would be satisfied by nothing else but an exact match
// keeps the two forms apart with no room for argument.
const CONFIRMATIONS = {
	over18: {
		route: /\/over18(\/|$|\?)/,
		actions: ['/over18'],
		// Required: a form on this route without a yes button is not the form.
		accept: 'button[name="over18"][value="yes"], input[name="over18"][value="yes"]',
	},
	quarantine: {
		route: /\/quarantine(\/|$|\?)/,
		actions: ['/api/quarantine_optin'],
		// The whole form is the opt-in, so any of its submit controls will do, and
		// a form with none still submits.
		accept: 'button[type="submit"], input[type="submit"], button:not([type])',
	},
};

function ensureDest(form: HTMLFormElement) {
	// The dest field tells Reddit where to bounce back to; default to current page if missing.
	if (form.querySelector('input[name="dest"]')) return;
	const dest = document.createElement('input');
	dest.type = 'hidden';
	dest.name = 'dest';
	dest.value = location.href.replace(/\/(over18|quarantine)\b.*$/, '/');
	form.append(dest);
}

function submitWith(form: HTMLFormElement, accept: ?HTMLElement): void {
	// `requestSubmit` is the only route that carries the submitter, and it has
	// been in both browsers since well before this extension's floor. The
	// fallbacks exist so a missing button cannot leave the reader on a page that
	// does nothing at all.
	if (accept && typeof form.requestSubmit === 'function') form.requestSubmit((accept: any));
	else if (accept && typeof (accept: any).click === 'function') (accept: any).click();
	else if (typeof form.requestSubmit === 'function') form.requestSubmit();
	else form.submit();
}

function autoConfirm(kind: 'over18' | 'quarantine'): boolean {
	const { actions, accept } = CONFIRMATIONS[kind];
	for (const action of actions) {
		for (const form of document.querySelectorAll(`form[action="${action}"], form[action$="${action}"]`)) {
			if (!(form instanceof HTMLFormElement)) continue;
			const button = form.querySelector(accept);
			// A form on the right route with no accept control is the opt-*out*
			// form, or markup that has moved. Leaving it alone beats submitting the
			// wrong one.
			if (!button && kind === 'over18') continue;
			ensureDest(form);
			submitWith(form, (button: any));
			return true;
		}
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
