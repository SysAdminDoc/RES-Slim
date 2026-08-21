/* @flow */
// RES-Slim: come back to the page you were on after logging in.
//
// Concept from "old.reddit.com login form redirection fix" (Greasy Fork 494651).
// old.reddit's header login link goes to a bare /login, and reddit's own login
// form carries a `dest` field that the header link never fills in, so signing in
// from a thread lands you on the front page and you lose your place.
//
// The fix is to fill `dest` with the current URL. Doing that carelessly is an
// open-redirect: `dest` is a URL reddit will send the browser to after
// authenticating, so it has to be constrained to a same-site path.

import { Module } from '../core/module';
import { isLoggedIn } from '../utils';
import { safeDest } from '../utils/loginRedirect';

export const module: Module<{ [string]: any }> = new Module('loginRedirectFix');

module.moduleName = 'Return here after login';
module.category = 'myAccountCategory';
module.description = 'Makes the header login link and the login form return you to the page you were reading instead of the front page.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['login', 'sign in', 'redirect', 'dest', 'return'];

module.options = {
	includeQueryString: {
		type: 'boolean',
		value: true,
		title: 'Preserve the query string',
		description: 'Keeps sort and filter parameters. Turn it off if you would rather not have search terms travel through the login round trip.',
	},
};

function currentDest(): string {
	return safeDest(location.pathname, location.search, module.options.includeQueryString.value === true);
}

function fixHeaderLink() {
	const dest = currentDest();
	for (const link of document.querySelectorAll('#header .user a[href*="/login"], #header a.login-required')) {
		if (!(link instanceof HTMLAnchorElement)) continue;
		const href = link.getAttribute('href');
		if (typeof href !== 'string' || !href.includes('/login')) continue;
		const url = new URL(href, location.origin);
		url.searchParams.set('dest', dest);
		link.setAttribute('href', `${url.pathname}?${url.searchParams.toString()}`);
	}
}

function fixLoginForms() {
	const dest = currentDest();
	// Both the header drop-down form and the standalone /login page form.
	for (const form of document.querySelectorAll('form.login-form, #login_login-main, form#login-form')) {
		if (!(form instanceof HTMLFormElement)) continue;
		let field = form.querySelector('input[name="dest"]');
		if (!(field instanceof HTMLInputElement)) {
			field = document.createElement('input');
			field.type = 'hidden';
			field.name = 'dest';
			form.append(field);
		}
		field.value = dest;
	}
}

module.contentStart = () => {
	// Nothing to fix once you are signed in, and rewriting a logged-in header
	// would touch the logout link.
	if (isLoggedIn()) return;
	fixHeaderLink();
	fixLoginForms();
};
