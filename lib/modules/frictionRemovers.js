/* @flow */
// RES-Slim: collapse Reddit's friction surfaces on old.reddit.com:
//   - /over18 NSFW interstitial: auto-click "yes" so the next click on an
//     NSFW link does not detour into a confirmation page.
//   - /quarantine opt-in: auto-click "Continue" so quarantined subs open
//     directly.
//   - Inline "use new reddit / open in app" banners: hidden via CSS.
//   - Reddit's "Open in app" floating prompt (if rendered on old.reddit): hidden.
// All four can be opted out individually.

import { Module } from '../core/module';

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
};

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
	const selectors = [];
	for (const key of Object.keys(HIDE_SELECTORS)) {
		if (!module.options[key].value) continue;
		selectors.push(...HIDE_SELECTORS[key]);
	}
	if (!selectors.length) return '';
	return `${selectors.join(', ')} { display: none !important; }`;
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
};
