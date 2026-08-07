/* @flow */

import { once, memoize } from '../../utils/functional';
import {
	downcast,
	Thing,
	string,
	forEachSeq,
	isPageType,
	waitForEvent,
} from '../../utils';
import {
	Permissions,
} from '../../environment';
import * as Options from '../../core/options';
import * as Notifications from '../notifications';
import * as SettingsNavigation from '../settingsNavigation';
import {
	crosspostMetadataTemplate,
} from './templates';
import {
	Expando,
	expandos,
	activeExpandos,
} from './expando';
import { generateMedia, preloadMedia } from './mediaTypes';
import { trackMediaLoad, addSiteAttribution, markVisitedIfKnown } from './mediaControls';
import { module, siteModules, genericHosts, siteModuleOptionKey, isExpandWanted } from '../showImages';

export function isSiteModuleEnabled(siteModule: *) {
	const key = siteModuleOptionKey(siteModule);
	return !module.options[key] || module.options[key].value;
}

export const sitesMap = once(() =>
	Array.from(siteModules.values())
		.filter(isSiteModuleEnabled)
		.reduce((map, siteModule) => {
			for (const domain of siteModule.domains) {
				map.set(domain, (map.get(domain) || []).concat(siteModule));
			}
			return map;
		}, new Map()),
);

// A missing subdomain matches all subdomains, for example:
// A module with `domains: ['example.com']` will match `www.example.com` and `example.com`
// A module with `domains: ['www.example.com']` will match only `www.example.com`
export function* modulesForHostname(hostname: string) {
	do {
		for (const m of sitesMap().get(hostname) || []) yield m;
	} while ((hostname = hostname.replace(/^.+?(\.|$)/, '')));

	for (const m of genericHosts) yield m;
}

export function resolveMediaUrl(element: *, thing: *) {
	if (
		module.options.expandoCommentRedirects.value !== 'nothing' &&
		thing &&
		element.classList.contains('title')
	) {
		// In old.reddit.com, a reddit gallery's title link can be misleadingly set
		// to the source link in the gallery's caption instead of the normal reddit.com/gallery/<id> URL.
		// The only reliable way to detect a reddit gallery is to check the "data-is-gallery" attribute in the Thing element.
		if (thing.element.dataset.isGallery === 'true') {
			const galleryId = thing.getFullname().replace('t3_', '');
			return new URL(`/gallery/${galleryId}`, location.href);
		}

		const dataUrl = thing.element.getAttribute('data-url');
		const fullDataUrl = dataUrl && new URL(dataUrl, location.href);
		const commentLink = thing.getCommentsLink();
		if (fullDataUrl && commentLink && fullDataUrl.href !== commentLink.href) {
			return fullDataUrl;
		}
	}

	return new URL(element.href, location.href);
}

export function promptSiteModulePermissions(siteModule: *) {
	const { name, permissions = [] } = siteModule;
	const urlStripRe = /((?:\w+\.)+\w+)(?=\/|$)/i;

	const message = string.html`<div>
		<p>In order to inline expand content from ${name}, RES needs permission to access these sites:</p>
		<p><code>${permissions.map(url => `${(urlStripRe.exec(url): any)[0]}`).join(', \n')}</code></p>
		<p>Be assured RES does not access/modify any of your information on these domains - it only accesses the public API.</p>
		<hr>
		<p>If you prefer not to use RES' expando for these sites, you may:</p>
		<button>Disable this host</button>
	</div>`;

	const notification = Notifications.showNotification({
		header: 'Permission required',
		moduleID: 'permissions',
		closeDelay: Infinity,
		message,
	});

	const disableHostButton = message.querySelector('button');

	return Promise.race([
		Permissions.request(permissions).catch(() => new Promise(() => { /* don't resolve if permissions aren't granted */ })),
		waitForEvent(disableHostButton, 'click').then(() => {
			const opt = module.options[siteModuleOptionKey(siteModule)];
			opt.value = false;
			Options.save(opt);
			return Promise.reject(new Error('Host disabled'));
		}),
	]).finally(() => { notification.close(); });
}

export const generateSiteModuleLock = memoize(async siteModule => {
	if (!siteModule.permissions || await Permissions.has(siteModule.permissions)) return;

	let resolve, reject;
	return {
		promise: new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject; }),
		open: () => promptSiteModulePermissions(siteModule).then(resolve, reject),
	};
});

export function scanBody(element: ?Element) {
	if (!element) return;
	const promises = [...element.querySelectorAll('a')]
		.filter(link => {
			// Skip links that already have media
			const existingContent = link.querySelector('img, video');

			// Except those inline in posts -- let's just remove them and create an expando instead
			if (existingContent && module.options.collapseInlineMedia.value && existingContent.matches('[src^="https://external-preview.redd.it"')) {
				// Rewrite the anchor to avoid RES querying the 3rd party host for media data
				if (existingContent.hasAttribute('src')) { (link: any).href = existingContent.getAttribute('src'); }
				existingContent.replaceWith(string.html`<i>Collapsed inline media</i>`);
				return true;
			}

			return !existingContent;
		})
		.map(link => checkElementForMedia(downcast(link, HTMLAnchorElement)));
	// $FlowIssue Promise#allSettled is not typed
	return Promise.allSettled(promises);
}

const linksMap: WeakMap<HTMLAnchorElement, Expando> = new WeakMap();
export function getLinkExpando(link: HTMLAnchorElement): ?Expando {
	return linksMap.get(link);
}

export const inText = (element: *) => !!element.closest('.md, .search-result-footer');

export async function checkElementForMedia(element: HTMLAnchorElement) {
	// Restore the visited mark for links expanded on an earlier page load. Not
	// awaited: whether this link was seen before has no bearing on whether it can
	// host an expando, and blocking the scan on a storage read would delay every
	// expando on the page behind it.
	markVisitedIfKnown(element);

	const thing = Thing.from(element);
	const entryExpando = !inText(element) && Expando.getEntryExpandoFrom(thing);
	const nativeExpando = entryExpando instanceof Expando ? null : entryExpando;

	if (module.options.hideNSFW.value && thing && thing.isNSFW()) {
		if (nativeExpando) nativeExpando.detach();
		return;
	}

	if (nativeExpando) {
		trackNativeExpando(nativeExpando, element, thing);
	}

	if (thing && thing.isCrosspost() && module.options.crossposts.value === 'none') {
		return;
	}

	const mediaUrl = resolveMediaUrl(element, thing);

	if (mediaUrl && module.options.expandoCommentRedirects.value === 'rewrite') {
		element.href = mediaUrl.href;
		element.removeAttribute('data-inbound-url');
	}

	for (const siteModule of modulesForHostname(mediaUrl.hostname)) {
		const detectResult = siteModule.detect(mediaUrl, thing);
		if (!detectResult) continue;

		if (nativeExpando) {
			const forceReplaceNativeExpandoOption = siteModule.options && siteModule.options.forceReplaceNativeExpando;
			if (nativeExpando.open && !(forceReplaceNativeExpandoOption && forceReplaceNativeExpandoOption.value)) {
				console.log('Native expando has already been opened; skipping.', element.href);
				return;
			}

			nativeExpando.detach();
		}

		const expando = new Expando(mediaUrl.href);

		placeExpando(expando, element, thing);
		expando.onExpand(() => { trackMediaLoad(element, thing); });
		linksMap.set(element, expando);

		const lock = await generateSiteModuleLock(siteModule); // eslint-disable-line no-await-in-loop
		if (lock) expando.setLock(lock);

		try {
			if (lock) await lock.promise; // eslint-disable-line no-await-in-loop
			await completeExpando(expando, thing, siteModule, detectResult); // eslint-disable-line no-await-in-loop
			break;
		} catch (e) {
			console.error(`showImages: could not create expando for ${mediaUrl.href}`, e);
			if (nativeExpando) nativeExpando.reattach();
			expando.destroy();
			linksMap.delete(element);
		}
	}
}

export function placeExpando(expando: *, element: *, thing: *) {
	if (!inText(element) && thing && thing.getTitleElement()) {
		if (element.parentElement) element.parentElement.after(expando.button);
		// Position our expando button after the original button if possible, to not break Reddit's expando
		const sibling = expando.button.nextElementSibling;
		if (sibling && sibling.classList.contains('expando-button')) sibling.after(expando.button);
		thing.entry.appendChild(expando.box);
	} else {
		const freetextSpan = document.createElement('span');
		freetextSpan.className = 'res-freetext-expando';
		freetextSpan.appendChild(expando.button);
		// Insert after keyNavAnnotation if present, otherwise after element
		const keyNavAnnotation = element.nextElementSibling && element.nextElementSibling.classList.contains('keyNavAnnotation') ? element.nextElementSibling : null;
		const insertAfter = keyNavAnnotation || element;
		insertAfter.after(freetextSpan);
		insertAfter.after(expando.box);
	}
}

export async function completeExpando(expando: *, thing: *, siteModule: *, detectResult: *) {
	const mediaOptions = await siteModule.handleLink(expando.href, detectResult);

	if (mediaOptions.title && thing && string.areSimilar(mediaOptions.title, thing.getTitle())) {
		mediaOptions.title = '';
	}

	const attribution = module.options.showSiteAttribution.value &&
		thing && thing.isPost() && !thing.isSelfPost() &&
		siteModule.domains.length && siteModule.attribution !== false;

	const isMuted = media => media.muted || ['IMAGE', 'TEXT'].includes(media.type);
	const muted = mediaOptions.type === 'GALLERY' ? mediaOptions.src.every(isMuted) : isMuted(mediaOptions);

	expando.initialize({
		types: [
			mediaOptions.type,
			muted ? 'muted' : 'non-muted',
			...((mediaOptions.expandoClass || '').split(' ')),
		].filter(v => v).map(s => s.toLowerCase()),
		buttonInfo: getMediaButtonInfo(mediaOptions),
		generateMedia() {
			const media = generateMedia(mediaOptions, { href: expando.href });
			if (module.options.crossposts.value === 'withMetadata' && thing && thing.isCrosspost()) {
				media.element.prepend(crosspostMetadataTemplate(thing.element.dataset));
			}
			if (attribution) addSiteAttribution(siteModule, media);
			return media;
		},
	});

	expando.button.setAttribute('data-host', siteModule.moduleID);
	expando.box.setAttribute('data-host', siteModule.moduleID);

	const hideButton = thing && thing.getHideElement();
	if (hideButton) hideButton.addEventListener('click', () => { expando.destroy(); });

	if (thing && thing.isComment()) {
		expando.onExpand(once(() => {
			let wasOpen;

			// Collapse / restore expandos when toggling comment visibility
			const entries = [thing, ...thing.getParents()].map(e => e.entry);
			for (const entry of entries) {
				for (const toggle of entry.querySelectorAll('.tagline > .expand, :scope > .buttons .toggleChildren')) {
					toggle.addEventListener('click', () => {
						if (thing.isContentVisible()) {
							if (wasOpen && expando.media) expando.expand();
						} else {
							wasOpen = expando.open;
							if (expando.open) expando.collapse();
						}
					});
				}
			}
		}));
	}

	// The d2x lightbox hides overflowing media
	expando.onExpand(() => {
		const lightbox = expando.media.element.closest('#overlayScrollContainer');
		if (lightbox) lightbox.firstChild.style.overflowY = 'initial';
	});

	// Start loading media early to make it snappier
	expando.button.addEventListener('mousedown', () => { preloadMedia([expando]); });

	if (!expando.open) {
		let autoExpand;
		let autoExpandFirstVisibleNonMutedInThing;

		if (module.options.autoExpandSelfText.value && inText(expando.button) && thing && thing.isSelfPost() && !isPageType('comments')) {
			const dontAutoExpandNSFW = !module.options.autoExpandSelfTextNSFW.value && thing.isNSFW();
			autoExpand = !dontAutoExpandNSFW;
			autoExpandFirstVisibleNonMutedInThing = module.options.autoExpandSelfTextFirstVisibleNonMuted.value;
		}

		if (module.options.autoExpandCommentMedia.value && inText(expando.button) && thing && thing.isComment()) {
			autoExpand = true;
		}

		if (isExpandWanted(expando, { thing, autoExpand, autoExpandFirstVisibleNonMutedInThing })) {
			expando.expand();
		}
	}
}

export function updateParentHeight(e: *) {
	const thing = Thing.checkedFrom(e.currentTarget);

	const basisHeight = (
		thing.isSelfPost() && parseInt(module.options.selfTextMaxHeight.value, 10) ||
		thing.isComment() && parseInt(module.options.commentMaxHeight.value, 10) ||
		0
	);

	if (basisHeight > 0) {
		// .expando-button causes a line break
		const expandoHeight = Array
			.from(thing.entry.querySelectorAll('.res-expando-box, .expando-button.expanded'))
			.reduce((a, b) => a + b.getBoundingClientRect().height, 0);

		thing.getTextBody().style.maxHeight = `${basisHeight + expandoHeight}px`;
	}
}

export function trackNativeExpando(expando: *, element: *, thing: *) {
	if (!module.options.markSelftextVisited.value && expando.button.classList.contains('selftext')) return;

	const trackLoad = once(() => trackMediaLoad(element, thing));

	if (expando.open) trackLoad();
	else expando.button.addEventListener('click', trackLoad);
}

export function getMediaButtonInfo(options: *) {
	let title = '';

	let type = options.type;

	if (options.type === 'GALLERY') {
		if (options.src.length === 1) {
			type = options.src[0].type;
		} else {
			title += `${options.src.length} items in gallery`;
		}
	}

	const defaultClass = {
		IMAGE: 'image',
		GALLERY: 'image gallery',
		TEXT: 'selftext',
		VIDEO: options.muted ? 'video-muted' : 'video',
		IFRAME: options.muted ? 'video-muted' : 'video',
		AUDIO: 'video', // yes, still class "video", that's what reddit uses.
		GENERIC_EXPANDO: 'selftext',
	}[type];

	return {
		title,
		mediaClass: options.expandoClass || defaultClass,
	};
}
