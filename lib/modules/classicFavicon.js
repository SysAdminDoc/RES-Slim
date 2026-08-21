/* @flow */

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('classicFavicon');

module.moduleName = 'classicFaviconName';
module.category = 'appearanceCategory';
module.description = 'classicFaviconDesc';
module.include = ['r2', 'd2x'];
module.keywords = ['favicon', 'icon', 'logo', 'tab'];

const CLASSIC_FAVICON_ID = 'res-classic-reddit-favicon';

// Inspired by chairmanbrando's "Reddit: Old Favicon" userscript:
// https://github.com/chairmanbrando/userthings/blob/cabe18ad9d75411c29b24761f296e9a5e3669993/reddit-favicon.js
const CLASSIC_FAVICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAD5UlEQVR4Aa3XA5BcSxTG8Xm2XyEuxba1+2Lbtm3btm3btm3bdjK7//dN3b1V6d07ySCn6rc77tPudvkS5HJ9I0mlkyyWo/JY3BEey+GI9zpIEvnGFXCYBWeX8XJZwoTPcMtFGSdZ5JtAC48jg+WeEKC7MlBi+lt4Vtkl4UKQwmWbZPC18HxyTvjCTkvo5wrP5nfh/0mohESwn9tyGU5Jhk/1+U7BZ6FSPzUsGgrjWkLrUCgXA9rnhaUjoVdZyPNN5O9tltiRC/9aBgt+JzCzO+xfDfMHwJ4VcHQLPLwFAI9uK8FUTi3RW77+OIEcAY/2tZNhSF3I6YLCv0KDNHBmHwA8uAF1kjslcFcyW4XnVu2teY7ffV/0DziwFtrkMvu/cUaY3B465De7wDREvvbUPplcCqj566WE49ugXCwVbr5HiDEInVySpK6I5TXM51rbP5xTBtWALXMgz3dmgb5xS0NPAosEm2Mt7KYt9hd0yAcze8CKMXDhEFw6BgsHw8iGVv8X+Mn8jt01uRxN8CRw1LGmVeNB/yrQPBuUiwljm8PJnfD2FY4RHg5PH1gzoX9lND6sAdihAJSJ7i2JI54EHkepeZNMVs0Anj2AKyfA/R6f4+1razreuwYf3sPJXWi8OHXRY08C7ii1XzwMx3j9Ap7cgzC3QwuEwcsn8P4djjGjm1MCbt8TuHcVuhWHmolh3ZTIpcPKcdAwLQytC0/vEyVm9fCawOMoCTRMB5ePY8SmWXrvG8jugla5zLHw6hk0ymy9l+d72LUMI66dRr/plMAjTwKHBUNOUU0gPOqPaLVjdm9r0Nnh/gAjG1mLTq2kcPUkRoxqAiGOg/Cw8zQMkfb54d0bjLhzGU7vhjcviRLPHsLu5XD5GEaEhUGfCt4SGOtJoL3jONCuxqWjBB13r0DNRE7N/0EauCIOkBcc14JxLazmteP5Y5jdCw5vMlvn/Vs4uhVmdIfHd8y1YWpnyPWVU+0vSGJ7Kx7rmEDh32HZSGsug/V/+wIYWB0GVLP6XRhYw7J1vpWM3fRrJkKJf70tQgPkq4/PgHe8JjG6Cep/cz04ux92LbHosV4DsLdhazcs9o+3/eG2pI98IBnoZQOSr6B2MpjYBg5vRPPcXIz0WCumtTNO6WgdQnJ9bdbc1N2u/cdJxJSt3rffCIV/s5LpUhSt+VIFuhaDuimhyO/OZ0HTOonh7VyYUU77dQgVY9fM9UnHJfXnTsYhjkkE77hk8fVukF42C19AuKyXVP7ejmJJb7krBOiOdJcYwVxOM8kQuSRuH49aF2SgpP+St+Qk0lAmyBHM6/kjOSzjpIEk9rXg/wEYGM5JXiwPQwAAAABJRU5ErkJggg==';

let observer: MutationObserver | null = null;

function getOrCreateFavicon(): HTMLLinkElement | void {
	const head = document.head;
	if (!head) return;

	let favicon = document.getElementById(CLASSIC_FAVICON_ID);
	if (!(favicon instanceof HTMLLinkElement)) {
		favicon = document.createElement('link');
		favicon.id = CLASSIC_FAVICON_ID;
		favicon.rel = 'icon';
		favicon.type = 'image/png';
		favicon.setAttribute('sizes', '32x32');
		head.append(favicon);
	}

	return favicon;
}

function applyClassicFavicon() {
	const head = document.head;
	if (!head) return;

	for (const link of Array.from(head.querySelectorAll('link[rel~="icon"]'))) {
		if (link.id !== CLASSIC_FAVICON_ID) {
			link.remove();
		}
	}

	const favicon = getOrCreateFavicon();
	if (favicon && favicon.href !== CLASSIC_FAVICON_DATA_URL) {
		favicon.href = CLASSIC_FAVICON_DATA_URL;
	}
}

function ensureObserver() {
	if (observer) return;

	const target = document.head || document.documentElement;
	if (!target) return;

	observer = new MutationObserver(() => {
		const currentObserver = observer;
		if (target === document.documentElement && document.head && currentObserver) {
			currentObserver.disconnect();
			observer = null;
			ensureObserver();
			return;
		}

		applyClassicFavicon();
	});

	// Upstream #5574: Firefox re-resolves the document favicon at load and can
	// land back on the site default without mutating the DOM, so the observer
	// above never fires for it. Re-apply once after load as insurance.
	window.addEventListener('load', () => { applyClassicFavicon(); }, { once: true });

	observer.observe(target, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['href', 'rel'],
	});

	applyClassicFavicon();
}

module.beforeLoad = () => {
	ensureObserver();
};

module.contentStart = () => {
	ensureObserver();
};
