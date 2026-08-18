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

export const module: Module<*> = new Module('frictionRemovers');

module.moduleName = 'Friction removers';
module.category = 'privacyCategory';
module.description = 'Auto-confirm /over18 and /quarantine gates; hide "use new Reddit" + "open in app" banners.';
module.descriptionRaw = true;
module.include = ['r2'];
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
		description: 'Suppress the floating banner that nudges users to redesign Reddit.',
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
		description: 'Hide the full-screen "log in to continue" interstitial and restore scrolling, when the page underneath it was actually delivered. Off by default: it hides whatever is covering the page, so it is deliberately something you turn on after seeing the wall.',
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

const UNWALLED_CLASS = 'rsm-friction-unwalled';
const CONTENT_ANCHORS = ['#siteTable', '.commentarea', '.content[role="main"] .thing', '.content[role="main"] .sitetable'];
// Enough of the viewport that nothing but a deliberate interstitial qualifies: a
// sticky header is wide but never tall, a modal is tall but never both.
const COVERAGE = 0.9;

let wallObserver: MutationObserver | null = null;
let reportedMissingContent = false;

function hasContentBehind(root: Document | HTMLElement = document): boolean {
	return CONTENT_ANCHORS.some(selector => {
		const found = root.querySelector(selector);
		return !!found && !!found.textContent && found.textContent.trim().length > 0;
	});
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
				`A full-page overlay covers ${location.pathname}, but reddit sent no content behind it — there is nothing to uncover. Log in, or open the page in a logged-in tab.`,
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

function autoSubmitForm(action: string) {
	for (const form of document.querySelectorAll(`form[action="${action}"], form[action$="${action}"]`)) {
		if (!(form instanceof HTMLFormElement)) continue;
		// The dest field tells Reddit where to bounce back to; default to current page if missing.
		if (!form.querySelector('input[name="dest"]')) {
			const dest = document.createElement('input');
			dest.type = 'hidden';
			dest.name = 'dest';
			dest.value = location.href.replace(/\/(over18|quarantine)\b.*$/, '/');
			form.append(dest);
		}
		// Mark the "over18" / "yes" checkbox if present.
		for (const yes of form.querySelectorAll('input[name="over18"], input[name="accept"]')) {
			if (yes instanceof HTMLInputElement) yes.checked = true;
		}
		form.submit();
		return true;
	}
	return false;
}

function maybeAutoConfirmOver18() {
	if (!module.options.autoConfirmOver18.value) return;
	if (!/\/over18(\/|$|\?)/.test(location.pathname)) return;
	autoSubmitForm('/over18');
}

function maybeAutoConfirmQuarantine() {
	if (!module.options.autoConfirmQuarantine.value) return;
	if (!/\/quarantine(\/|$|\?)/.test(location.pathname)) return;
	autoSubmitForm('/quarantine');
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
