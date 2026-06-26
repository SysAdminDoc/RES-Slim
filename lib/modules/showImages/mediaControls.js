/* @flow */

import {
	batch,
	downcast,
	Thing,
	frameThrottle,
	string,
	waitForEvent,
} from '../../utils';
import {
	addURLToHistory,
	ajax,
	isPrivateBrowsing,
} from '../../environment';
import * as SettingsNavigation from '../settingsNavigation';
import { siteAttributionTemplate } from './templates';
import { module, siteModuleOptionKey } from '../showImages';

export const trackVisitNative = batch(async things => {
	// this API only works for gold users
	if (!document.body.classList.contains('gold')) return;

	if (isPrivateBrowsing()) return;

	await ajax({
		method: 'POST',
		url: '/api/store_visits',
		data: { links: things.map(t => t.getFullname()).join(',') },
	});
}, { delay: 10000, size: 50 });

export function trackMediaLoad(link: *, thing: *) {
	if (!module.options.markVisited.value) return;

	if (thing) trackVisitNative(thing);

	if (!(thing && thing.isNSFW() && module.options.sfwHistory.value !== 'add')) {
		addURLToHistory(link.href);
	}
}

export function addSiteAttribution(siteModule: *, media: *) {
	const element = siteAttributionTemplate({
		name: siteModule.name,
		url: siteModule.landingPage || `https://${siteModule.domains[0]}`,
		logoUrl: siteModule.logo,
		settingsLink: SettingsNavigation.makeUrlHash(module.moduleID, siteModuleOptionKey(siteModule)),
	});
	const replace = media.element.querySelector('.res-expando-siteAttribution');
	if (replace) {
		replace.replaceWith(element);
	} else {
		element.classList.add('res-expando-siteAttribution-generic');
		media.element.appendChild(element);
	}
}

export function addDragListener({ media, element, atShiftKey, onStart, onMove }: {|
	media: HTMLElement,
	element: HTMLElement,
	atShiftKey: boolean,
	onStart?: (x: number, y: number) => void,
	onMove: (x: number, y: number, moveX: number, moveY: number) => void,
|}) {
	// Invoke handleMove immediately to avoid pauses, but only once per frame
	let hasFrameExecution = false;
	const setFrameExecution = (() => {
		const throttle = frameThrottle(() => { hasFrameExecution = false; });
		return () => {
			throttle();
			hasFrameExecution = true;
		};
	})();

	let isActive, hasMoved, lastX, lastY;

	const handleMove = (e: MouseEvent) => {
		const movementX = e.clientX - lastX;
		const movementY = e.clientY - lastY;

		if (!movementX && !movementY) {
			// Mousemove may be triggered even without movement
			return;
		} else if (1 & ~e.buttons) {
			// Mouseup may not trigger in some circumstances
			stop();
			return;
		} else if (atShiftKey !== e.shiftKey) {
			isActive = false;
			({ clientX: lastX, clientY: lastY } = e);
			return;
		}

		if (!isActive) {
			if (onStart) onStart(lastX, lastY);
			isActive = true;
			hasMoved = true;
			requestAnimationFrame(() => { media.classList.add('res-media-dragging'); });
		}

		if (hasFrameExecution) return;
		setFrameExecution();

		onMove(e.clientX, e.clientY, movementX, movementY);
		({ clientX: lastX, clientY: lastY } = e);
	};

	function handleClick(e: Event) {
		if (hasMoved) e.preventDefault();
	}

	function stop() {
		requestAnimationFrame(() => { media.classList.remove('res-media-dragging'); });

		document.removeEventListener('mousemove', handleMove);
		document.removeEventListener('mouseup', stop);

		// `handleClick` is only invoked if the mouse target is `element`
		// `setTimeout` is necessary since `mouseup` is emitted before `click`
		setTimeout(() => document.removeEventListener('click', handleClick));
	}

	function initiate(e: MouseEvent) {
		if (e.button !== 0) return;

		({ clientX: lastX, clientY: lastY } = e);

		hasMoved = false;
		isActive = false;

		document.addEventListener('mousemove', handleMove);
		document.addEventListener('mouseup', stop);
		document.addEventListener('click', handleClick);

		e.preventDefault();
	}

	element.addEventListener('mousedown', initiate);
}

export function move(ele: HTMLElement, deltaX: number, deltaY: number): void {
	ele.style.marginLeft = `${((parseFloat(ele.style.marginLeft) || 0) + deltaX).toFixed(2)}px`;
	ele.style.marginTop = `${((parseFloat(ele.style.marginTop) || 0) + deltaY).toFixed(2)}px`;

	if (deltaY) ele.dispatchEvent(new CustomEvent('mediaManuallyMovedVertically', { bubbles: true }));
}

export function resize(ele: HTMLElement, newWidth: number, newHeight?: number): void {
	// ele should always be grippable, so ignore resizes that are too tiny
	if (newWidth < 20) return;

	if (typeof newHeight === 'number') {
		ele.style.height = `${newHeight}px`;
	} else if (ele.style.height) { // If height is previously set, keep the ratio
		const { width, height } = ele.getBoundingClientRect();
		ele.style.height = `${((height / width) * newWidth).toFixed(2)}px`;
	}

	ele.style.width = `${newWidth}px`;
	ele.style.maxWidth = ele.style.maxHeight = 'none';
}

export function toggleMute(ele: HTMLElement): void {
	const video = downcast(ele.querySelector('video'), HTMLVideoElement);
	if (video) {
		video.muted = !video.muted;
	}
}
