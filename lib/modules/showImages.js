/* @flow */

import { once, intersection } from '../utils/functional';
import { Host } from '../core/host';
import { loadOptions } from '../core/init';
import { Module } from '../core/module';
import {
	downcast,
	Thing,
	PagePhases,
	SelectedThing,
	addCSS,
	CreateElement,
	elementInViewport,
	scrollToElement,
	idleThrottle,
	isPageType,
	isAppType,
	stopPageContextScript,
	watchForElements,
	watchForThings,
	watchForRedditEvents,
} from '../utils';
import * as Modules from '../core/modules';
import { registerExpandoCollapser } from '../utils/mediaSilence';
import * as __hosts from './hosts';
import {
	Expando,
	expandos,
	activeExpandos,
} from './showImages/expando';
import { preloadMedia } from './showImages/mediaTypes';
import { scanBody, checkElementForMedia, isSiteModuleEnabled, updateParentHeight } from './showImages/linkScanner';
import vreddit from './hosts/vreddit';

export const siteModules: Map<string, Host<any, any>> = new Map(
	Object.values(__hosts).map(host => [host.moduleID, downcast(host, Host)]), // ensure that all hosts are instances of `Host`
);

export const genericHosts: Host<any, any>[] = [siteModules.get('defaultImage'), siteModules.get('defaultVideo'), siteModules.get('defaultAudio')]
	.map(host => downcast(host, Host));

export const module: Module<{ [string]: any }> = new Module('showImages');

module.moduleName = 'showImagesName';
module.category = 'productivityCategory';
module.description = 'showImagesDesc';
module.bodyClass = true;

export function siteModuleOptionKey(siteModule: *) {
	const id = siteModule.moduleID;
	return `display_${id}`;
}

module.options = {
	mediaBrowse: {
		title: 'showImagesMediaBrowseTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesMediaBrowseDesc',
	},
	browsePreloadCount: {
		title: 'showImagesBrowsePreloadCountTitle',
		type: 'text',
		value: '1',
		description: 'showImagesBrowsePreloadCountDesc',
		dependsOn: options => options.mediaBrowse.value,
	},
	galleryPreloadCount: {
		title: 'showImagesGalleryPreloadCountTitle',
		type: 'text',
		value: '2',
		description: 'showImagesGalleryPreloadCountDesc',
	},
	collapseInlineMedia: {
		title: 'showImagesCollapseInlineMediaTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesCollapseInlineMediaDesc',
	},
	conserveMemory: {
		title: 'showImagesConserveMemoryTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesConserveMemoryDesc',
	},
	maxWidth: {
		title: 'showImagesMaxWidthTitle',
		type: 'text',
		value: '100%',
		description: 'showImagesMaxWidthDesc',
		advanced: true,
	},
	maxHeight: {
		title: 'showImagesMaxHeightTitle',
		type: 'text',
		value: '80%',
		description: 'showImagesMaxHeightDesc',
		advanced: true,
	},
	displayOriginalResolution: {
		title: 'showImagesDisplayOriginalResolutionTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesDisplayOriginalResolutionDesc',
	},
	selfTextMaxHeight: {
		title: 'showImagesSelfTextMaxHeightTitle',
		type: 'text',
		value: '0',
		description: 'showImagesSelfTextMaxHeightDesc',
		advanced: true,
	},
	commentMaxHeight: {
		title: 'showImagesCommentMaxHeightTitle',
		type: 'text',
		value: '0',
		description: 'showImagesCommentMaxHeightDesc',
		advanced: true,
	},
	autoMaxHeight: {
		title: 'showImagesAutoMaxHeightTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesAutoMaxHeightDesc',
		dependsOn: options => !!parseInt(options.selfTextMaxHeight.value, 10) || !!parseInt(options.commentMaxHeight.value, 10),
		advanced: true,
	},
	openInNewWindow: {
		title: 'showImagesOpenInNewWindowTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesOpenInNewWindowDesc',
	},
	hideNSFW: {
		title: 'showImagesHideNSFWTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesHideNSFWDesc',
	},
	highlightNSFWButton: {
		title: 'showImagesHighlightNSFWButtonTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesHighlightNSFWButtonDesc',
		bodyClass: true,
	},
	highlightSpoilerButton: {
		title: 'showImagesHighlightSpoilerButtonTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesHighlightSpoilerButtonDesc',
		bodyClass: true,
	},
	imageZoom: {
		title: 'showImagesImageZoomTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesImageZoomDesc',
	},
	imageMove: {
		title: 'showImagesImageMoveTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesImageMoveDesc',
	},
	mediaControls: {
		title: 'showImagesMediaControlsTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesMediaControlsDesc',
	},
	mediaControlsPosition: {
		title: 'showImagesMediaControlsPositionTitle',
		dependsOn: options => options.mediaControls.value,
		type: 'enum',
		value: 'top-left',
		values: [{
			name: 'Top left',
			value: 'top-left',
		}, {
			name: 'Top right',
			value: 'top-right',
		}, {
			name: 'Bottom left.',
			value: 'bottom-left',
		}, {
			name: 'Bottom right.',
			value: 'bottom-right',
		}],
		description: 'showImagesMediaControlsPositionDesc',
	},
	clippy: {
		title: 'showImagesClippyTitle',
		dependsOn: options => options.mediaControls.value,
		type: 'boolean',
		value: true,
		description: 'showImagesClippyDesc',
	},
	crossposts: {
		title: 'showImagesCrosspostsTitle',
		description: 'showImagesCrosspostsDescription',
		type: 'enum',
		value: 'withMetadata',
		values: [{
			name: 'Do not replace Reddit crosspost expando',
			value: 'none',
		}, {
			name: 'Show with original post\'s metadata',
			value: 'withMetadata',
		}, {
			name: 'Show without metadata',
			value: 'plain',
		}],
	},
	displayImageCaptions: {
		title: 'showImagesDisplayImageCaptionsTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesDisplayImageCaptionsDesc',
		advanced: true,
		bodyClass: true,
	},
	captionsPosition: {
		title: 'showImagesCaptionsPositionTitle',
		dependsOn: options => options.displayImageCaptions.value,
		type: 'enum',
		value: 'titleAbove',
		values: [{
			name: 'Display all captions above image.',
			value: 'allAbove',
		}, {
			name: 'Display title and caption above image, credits below.',
			value: 'creditsBelow',
		}, {
			name: 'Display title above image, caption and credits below.',
			value: 'titleAbove',
		}, {
			name: 'Display all captions below image.',
			value: 'allBelow',
		}],
		description: 'showImagesCaptionsPositionDesc',
		advanced: true,
		bodyClass: true,
	},
	markVisited: {
		title: 'showImagesMarkVisitedTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesMarkVisitedDesc',
		advanced: true,
	},
	markSelftextVisited: {
		title: 'showImagesMarkSelftextVisitedTitle',
		dependsOn: options => options.markVisited.value,
		type: 'boolean',
		value: false,
		description: 'showImagesMarkSelftextVisitedDesc',
		advanced: true,
	},
	sfwHistory: {
		title: 'showImagesSfwHistoryTitle',
		dependsOn: options => options.markVisited.value,
		type: 'enum',
		value: 'add',
		values: [{
			name: 'Add links to history',
			value: 'add',
		}, {
			name: 'Do not add or color links.',
			value: 'none',
		}],
		description: 'showImagesSfwHistoryDesc',
	},
	galleryRememberWidth: {
		title: 'showImagesGalleryRememberWidthTitle',
		dependsOn: options => options.imageZoom.value,
		type: 'boolean',
		value: true,
		description: 'showImagesGalleryRememberWidthDesc',
	},
	galleryAsFilmstrip: {
		title: 'showImagesGalleryAsFilmstripTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesGalleryAsFilmstripDesc',
	},
	filmstripLoadIncrement: {
		title: 'showImagesFilmstripLoadIncrementTitle',
		dependsOn: options => options.galleryAsFilmstrip.value,
		type: 'text',
		value: '30',
		description: 'showImagesFilmstripLoadIncrementDesc',
	},
	useSlideshowWhenLargerThan: {
		title: 'showImagesUseSlideshowWhenLargerThanTitle',
		dependsOn: options => options.galleryAsFilmstrip.value,
		type: 'text',
		value: '0',
		description: 'showImagesUseSlideshowWhenLargerThanDesc',
	},
	showViewImagesTab: {
		title: 'showImagesShowViewImagesTabTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesShowViewImagesTabDesc',
	},
	autoExpandTypes: {
		title: 'showImagesAutoExpandTypesTitle',
		type: 'enum',
		value: 'any',
		values: [{
			name: 'Images (but occasionally also .gif)',
			value: 'image',
		}, {
			name: 'Images, text',
			value: 'image text',
		}, {
			name: 'Images, text, galleries, and muted videos',
			value: 'image text gallery video',
		}, {
			name: 'All muted expandos (includes iframes)',
			value: 'any',
		}],
		description: 'showImagesAutoExpandTypesDesc',
	},
	autoExpandSelfText: {
		title: 'showImagesAutoExpandSelfTextTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesAutoExpandSelfTextDesc',
	},
	autoExpandSelfTextFirstVisibleNonMuted: {
		title: 'showImagesAutoExpandSelfTextFirstVisibleNonMutedTitle',
		dependsOn: options => options.autoExpandSelfText.value,
		type: 'boolean',
		value: true,
		description: 'showImagesAutoExpandSelfTextFirstVisibleNonMutedDesc',
	},
	autoExpandSelfTextNSFW: {
		title: 'showImagesAutoExpandSelfTextNSFWTitle',
		dependsOn: options => options.autoExpandSelfText.value,
		type: 'boolean',
		value: false,
		description: 'showImagesAutoExpandSelfTextNSFWDesc',
	},
	autoExpandCommentMedia: {
		title: 'showImagesAutoExpandCommentMediaTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesAutoExpandCommentMediaDesc',
	},
	showSiteAttribution: {
		title: 'showImagesShowSiteAttributionTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesShowSiteAttributionDesc',
	},
	expandoCommentRedirects: {
		title: 'showImagesExpandoCommentRedirectsTitle',
		type: 'enum',
		value: 'expando',
		values: [{
			name: 'Do nothing',
			value: 'nothing',
		}, {
			name: 'Create expandos',
			value: 'expando',
		}, {
			name: 'Create expandos, redirect the link back to the image',
			value: 'rewrite',
		}],
		description: 'showImagesExpandoCommentRedirectsDesc',
	},
	startVideosMuted: {
		title: 'showImagesStartVideosMutedTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesStartVideosMutedDesc',
	},
	maxSimultaneousPlaying: {
		title: 'showImagesMaxSimultaneousPlayingTitle',
		type: 'text',
		value: '0',
		description: 'showImagesMaxSimultaneousPlayingDesc',
	},
	autoplayVideo: {
		title: 'showImagesAutoplayVideoTitle',
		type: 'boolean',
		value: true,
		description: 'showImagesAutoplayVideoDesc',
	},
	hidePinnedRedditVideos: {
		title: 'showImagesHidePinnedRedditVideosTitle',
		type: 'boolean',
		value: false,
		description: 'showImagesHidePinnedRedditVideosDesc',
		bodyClass: true,
	},
	...Array.from(siteModules.values()).reduce((options, siteModule) => {
		// Ignore default
		if (genericHosts.includes(siteModule)) return options;

		// Create on/off options
		const key = siteModuleOptionKey(siteModule);
		options[key] = {
			title: siteModule.name,
			description: 'showImagesHostToggleDesc',
			value: true,
			type: 'boolean',
		};

		if (siteModule.options) {
			Object.assign(options, siteModule.options);
			Object.values(siteModule.options).map(v => {
				const origDependsOn = (v: any).dependsOn;
				(v: any).dependsOn = options => options[key].value && (!origDependsOn || origDependsOn());
			});
		}

		return options;
	}, {}),
};

const localStorageKeyRemoveNativePlayer = 'RES_forceReplaceNativeExpando';
// $FlowIgnore
export const cachedRemoveNativePlayer = () => localStorage?.getItem(localStorageKeyRemoveNativePlayer) === 'true';

module.onInit = () => {
	if (isAppType('r2')) {
		// Reddit loads scripts which initializes the video player, which will cause a slowdown if not blocked
		// It may also start playing the video, even if replace the expando
		const cachedValue = cachedRemoveNativePlayer()
		if (cachedValue) {
			console.log('Removing Reddit\'s native video player');
			stopPageContextScript(script => (/^\/?videoplayer\./).test(new URL(script.src, location.origin).pathname), 'head', true);
			stopPageContextScript(script => !!script.innerHTML.match('RedditVideoPlayer'), PagePhases.contentStart.then(() => document.querySelector('#siteTable')), false);
		}

		loadOptions.then(() => {
			const actualValue = Modules.isRunning(module) && isSiteModuleEnabled(vreddit) && vreddit.options && vreddit.options.forceReplaceNativeExpando.value;
			if (actualValue !== cachedValue) {
				console.warn('The localStorage value for site module `forceReplaceNativeExpando` was outdated. The video player may not work.');
				localStorage.setItem(localStorageKeyRemoveNativePlayer, String(actualValue));
			}
		});
	}
};

module.exclude = [
	/^\/ads\/[\-\w\._\?=]*/i,
	'submit',
	/^\/subreddits/i,
];

module.beforeLoad = () => {
	const selfTextMaxHeight = parseInt(module.options.selfTextMaxHeight.value, 10);
	if (selfTextMaxHeight) {
		// Strange selector necessary to select tumblr expandos, etc.
		addCSS(`
			.selftext.expanded ~ * .md {
				max-height: ${selfTextMaxHeight}px;
				overflow-y: auto !important;
				position: relative;
			}
		`);
	}

	const commentMaxHeight = parseInt(module.options.commentMaxHeight.value, 10);
	if (commentMaxHeight) {
		addCSS(`
			.comment .md {
				max-height: ${commentMaxHeight}px;
				overflow-y: auto !important;
				position: relative;
			}
		`);
	}

	watchForElements(['selfText'], null, scanBody);
	// The callback function should return a promise which resolves when the expando is built,
	// so that the expando filter can refresh when the expando is loaded
	watchForThings(['comment', 'message'], thing => scanBody(thing.getTextBody()), { id: module });
	watchForThings(['post'], thing => checkElementForMedia(thing.getPostLink()), { id: module });

	watchForRedditEvents('comment', (placeholder, { _: { update } }) => {
		if (update) return;
		const comment = placeholder.closest('.Comment');
		// TODO `comment` should be refined to the text body, but it doesn't yet have a class
		scanBody(comment);
	});

	// selftexts in comment pages evidently does not emit an event
	// TODO this prevent expando from being added when there's already media there
	watchForRedditEvents('postAuthor', (placeholder, { _: { update } }) => {
		if (update) return;
		const body = placeholder.closest('[data-test-id="post-content"]');
		// Ignore posts that has native media
		if (body && body.querySelector('.media-element')) return;
		scanBody(body);
	});
};

module.contentStart = () => {
	if (module.options.showViewImagesTab.value && isAppType('r2')) {
		viewImagesButton();
	}

	if (module.options.mediaBrowse.value) {
		SelectedThing.addListener(mediaBrowse, 'instantly');
	}

	if (module.options.autoMaxHeight.value) {
		document.body.addEventListener('mediaResize', (e: Event) => {
			if (e.target instanceof Element && e.target.matches('.thing > .entry')) {
				updateParentHeight(e);
			}
		});
	}
};

module.go = () => {
	if (isPageType('wiki')) scanBody(document.querySelector('.wiki-page-content'));

	// Handle spotlight next/prev hiding open expando's
	const spotlight = document.querySelector('#siteTable_organic');
	if (spotlight) {
		const nextprev = spotlight.querySelector('.nextprev');
		if (nextprev) {
			nextprev.addEventListener('click', () => {
				const open = spotlight.querySelector('.expando-button.expanded');
				if (open) open.click();
			});
		}
	}
};

module.afterLoad = () => {
	if (module.options.conserveMemory.value) {
		enableConserveMemory();
	}
};

/**
 * enableConserveMemory
 * attempt to unload collapsed expando's & images that are off screen in order
 * to save memory
 */
function enableConserveMemory() {
	// Making elements fullscreen makes the intersectionobserver report that nothing is intersecting
	// $FlowIssue `mozFullScreenElement` is not recognized
	const fullscreenActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement: any);

	// x-axis is set to 100000% in order to not unload images when scrolling too far horizontally
	const rootMargin = '50% 100000%';

	const boxMap = new WeakMap();
	const ioBox = new IntersectionObserver(entries => {
		for (const { isIntersecting, target } of entries) {
			if (!isIntersecting && fullscreenActive()) return;
			const { media } = downcast(boxMap.get(target), Expando);
			if (media) media.setLoaded(isIntersecting);
			else ioBox.unobserve(target);
		}
	}, { rootMargin });

	const buttonMap = new WeakMap();
	const ioButton = new IntersectionObserver(entries => {
		if (fullscreenActive()) return;
		for (const { isIntersecting, target } of entries) {
			const expando = downcast(buttonMap.get(target), Expando);
			const { open } = expando;
			if (!isIntersecting && !open) {
				ioButton.unobserve(target);
				expando.empty();
			}
		}
	}, { rootMargin });

	window.addEventListener('scroll', idleThrottle(() => {
		for (const expando of activeExpandos.values()) {
			if (expando.isAttached()) {
				const { box, media, button } = expando;
				if (!media) continue;
				if (media.supportsUnload()) {
					ioBox.observe(box);
				} else {
					ioBox.unobserve(box);
				}

				boxMap.set(box, expando);
				ioButton.observe(button);
				buttonMap.set(button, expando);
			} else {
				expando.destroy();
			}
		}
	}), { passive: true });
}

let autoExpandActive = false;
let mediaBrowseModeActive = false;

export const viewImagesButton = once(() => CreateElement.tabMenuItem({
	text: 'show images',
	className: 'res-show-images',
	onChange: active => {
		autoExpandActive = active;
		// When activated, open the new ones in addition to the ones already open
		// When deactivated, close all which are open
		for (const expando of expandos.values()) {
			if (!(
				expando instanceof Expando &&
				expando.ready &&
				expando.button.offsetParent
			)) continue;
			const open = isExpandWanted(expando);
			if (open) expando.expand();
			else if (!autoExpandActive) expando.collapse();
		}
	},
}));

// A filter hiding a post cannot reach the `Media` instance an expando owns —
// `lib/utils/mediaSilence.js` would have to import this module to do it, which
// is a cycle. It exposes a seam instead, and this fills it in.
//
// Collapsing rather than destroying, because collapse is the lifecycle that
// already knows how to quieten each kind of media: an embedded player gets the
// pause command its host declared, and re-expanding rebuilds whatever collapse
// took down. A post the user unhides is therefore in the state they left it,
// minus the sound.
// `keepContent`, because two of the media types destroy their content on
// collapse. That is right for a collapse the reader asked for and can undo with
// a click; it is wrong for a filter hiding a post, which takes an in-progress
// CodePen or a filled-in poll with it and gives nothing back.
registerExpandoCollapser((element: Element): number => {
	// Found from inside the hidden subtree rather than by walking the global
	// registry. `expandos` grows for the life of an infinite-scroll session, and
	// this runs once per hidden thing across four different filter modules.
	const buttons = [];
	if (element.matches(Expando.expandoSelector)) buttons.push(element);
	for (const button of element.querySelectorAll(Expando.expandoSelector)) buttons.push(button);

	let collapsed = 0;
	for (const button of buttons) {
		const expando = expandos.get(button);
		if (!(expando instanceof Expando) || !expando.open) continue;
		expando.collapse({ keepContent: true });
		collapsed++;
	}
	return collapsed;
});

export async function toggleThingExpandos(thing: Thing, { scrollOnToggle }: {| scrollOnToggle?: boolean |} = {}) {
	const gate = thing.entry.querySelector('.expando-gate__show-once');
	if (gate) {
		gate.click();
		return;
	}

	const expandos = Expando.getAllExpandosFrom(thing);
	if (!expandos.length) return;

	const openExpandos = expandos.filter(v => v.open);

	// If any open expandos exists within thing, collapse all
	// Else, expand all
	if (openExpandos.length) {
		for (const expando of openExpandos) expando.collapse();

		if (scrollOnToggle) {
			// Only scroll downwards to the top of the entry, to make more space for the expandos
			scrollToElement(thing.entry, null, { scrollStyle: 'directional', restrictDirectionTo: 'up' });
		}
	} else {
		for (const expando of expandos) {
			const lock = expando instanceof Expando && expando.lock;
			if (lock) {
				lock.open();
				await lock.promise; // eslint-disable-line no-await-in-loop
			}

			if (
				!(expando instanceof Expando) ||
				isExpandWanted(expando, { thing, autoExpandFirstVisibleNonMutedInThing: true, autoExpand: true, autoExpandTypes: [], ignoreDuplicatesScope: thing.entry })
			) {
				expando.expand();
			}
		}

		if (scrollOnToggle) {
			// Only scroll downwards to the top of the entry, to make more space for the expandos
			scrollToElement(thing.entry, null, { scrollStyle: 'top', restrictDirectionTo: 'down' });
		}
	}
}

// idleThrottle since this is low-priority
const preloadExpandos = idleThrottle((fromThing, direction, preloadCount = parseInt(module.options.browsePreloadCount.value, 10)) => {
	const pieces = [];
	let target = fromThing;

	do {
		const expando = Expando.getEntryExpandoFrom(target);
		if (expando && expando instanceof Expando) pieces.push(expando);
	} while ((target = target.getNext({ direction })) && pieces.length <= preloadCount);

	preloadMedia(pieces);
});

function mediaBrowse(selected, unselected, options) {
	if (!selected || !options.allowMediaBrowse || autoExpandActive) return;

	const oldExpando = Expando.getEntryExpandoFrom(unselected);
	const newExpando = Expando.getEntryExpandoFrom(selected);

	if (oldExpando) {
		mediaBrowseModeActive = oldExpando.expandWanted || oldExpando.open;
		oldExpando.collapse();
	}

	if (mediaBrowseModeActive && newExpando) {
		newExpando.expand();
		options.scrollStyle = 'top';

		preloadExpandos(selected, options.direction);
	}
}

function hasEntryAnyExpandedNonMuted(thing) {
	return Expando.getTextExpandosFrom(thing).some(expando =>
		expando.types.includes('non-muted') && (expando.open || expando.expandWanted),
	);
}

export const types = ['selftext', 'video', 'image', 'iframe', 'gallery', 'native', 'muted', 'non-muted'];

export function matchesTypes(wantedTypes: string[], expandoTypes: string[] = types): boolean {
	return !wantedTypes.length || !!intersection(expandoTypes, wantedTypes).length;
}

export function isExpandWanted(expando: Expando, {
	thing,
	autoExpand = autoExpandActive,
	autoExpandTypes = module.options.autoExpandTypes.value.replace('any', '').split(' ').filter(Boolean),
	ignoreDuplicates = true,
	ignoreDuplicatesScope,
	onlyExpandMuted = true,
	autoExpandFirstVisibleNonMutedInThing = false,
	treatVideosAsMutedIfStartingMuted = true,
}: {|
	thing?: ?Thing,
	autoExpand?: boolean,
	autoExpandTypes?: string[],
	ignoreDuplicates?: boolean,
	ignoreDuplicatesScope?: HTMLElement,
	onlyExpandMuted?: boolean,
	autoExpandFirstVisibleNonMutedInThing?: boolean,
	treatVideosAsMutedIfStartingMuted?: boolean,
|} = {}) {
	if (ignoreDuplicates) {
		const duplicates = expando.getDuplicates().filter(v => activeExpandos.has(v));
		if (duplicates.length) {
			if (!ignoreDuplicatesScope) return false;
			if (duplicates.some(v => ignoreDuplicatesScope.contains(v.button))) return false;
		}
	}

	const expandoIsNonMuted = expando.types.includes('non-muted');

	const typeCriteriaOK = matchesTypes(autoExpandTypes, expando.types);
	const muteCriteriaOK = !(onlyExpandMuted && expandoIsNonMuted) ||
		(treatVideosAsMutedIfStartingMuted && expando.types.includes('video') && module.options.startVideosMuted.value) ||
		(autoExpandFirstVisibleNonMutedInThing && elementInViewport(expando.button) && !hasEntryAnyExpandedNonMuted(thing));

	return autoExpand && muteCriteriaOK && typeCriteriaOK;
}

// Re-export from sub-modules for external consumers
export { Media } from './showImages/mediaTypes';
export { move, resize, toggleMute } from './showImages/mediaControls';
export { getLinkExpando } from './showImages/linkScanner';
