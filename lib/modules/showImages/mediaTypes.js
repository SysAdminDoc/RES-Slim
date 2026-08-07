/* @flow */

// $FlowIgnore HLS media requires a fairly big dependency, so load it separately on demand
/* global dashjs:readonly */
/*:: import dashjs from 'dashjs' */

import DOMPurify from 'dompurify';
import { pull, without, once } from '../../utils/functional';
import type {
	ExpandoMedia,
	GalleryMedia,
	ImageMedia,
	VideoMedia,
	AudioMedia,
	TextMedia,
	IframeMedia,
	GenericMedia,
} from '../../core/host';
import {
	positiveModulo,
	downcast,
	filterMap,
	Thing,
	string,
	waitForEvent,
	empty,
	forEachSeq,
	frameThrottle,
	getPercentageVisibleYAxis,
	getViewportSize,
} from '../../utils';
import {
	download,
	openNewTab,
	loadScript,
	Permissions,
	Storage,
} from '../../environment';
import * as Options from '../../core/options';
import * as Notifications from '../notifications';
import * as SettingsNavigation from '../settingsNavigation';
import { module } from '../showImages';
import {
	audioTemplate,
	galleryTemplate,
	imageTemplate,
	iframeTemplate,
	mediaControlsTemplate,
	textTemplate,
	videoTemplate,
} from './templates';
import { addDragListener, move, resize } from './mediaControls';

export function generateMedia(options: ExpandoMedia, context: {| href: string |}): Media {
	if (options.credits) options.credits = DOMPurify.sanitize(options.credits);
	if (options.caption) options.caption = DOMPurify.sanitize(options.caption);

	switch (options.type) {
		case 'GALLERY': return new Gallery(options, context);
		case 'IMAGE': return new Image(options, context);
		case 'TEXT': return new Text(options);
		case 'IFRAME': return new Iframe(options);
		case 'VIDEO': return new Video(options, context);
		case 'AUDIO': return new Audio(options);
		case 'GENERIC_EXPANDO': return new Generic(options);
		default: throw new Error(`Unreachable: invalid media type ${options.type}`);
	}
}

const observed = new WeakMap();
const resizeObserver = new ResizeObserver(entries => {
	for (const { target, contentRect } of entries) {
		const callback = observed.get(target);
		if (callback) callback(contentRect);
	}
});

export class Media {
	element: HTMLElement;

	ready: ?Promise<any>;

	onAttach: ?() => void;
	isAttached(): boolean { return document.body.contains(this.element); }

	expand(): void | Promise<void> { this.setLoaded(true); }
	collapse(): void { this.setLoaded(false); }

	onResize: Array<* => mixed> = [];
	resizing: ?(contentRect: *) => void;
	rotationState: number = 0;

	supportsUnload(): boolean { return false; }
	_loaded: ?boolean = true;
	_unload(): any {}
	_restore(): any {}

	setLoaded(state: boolean) {
		if (state === this._loaded) return;
		this._loaded = state;
		if (state) this._restore();
		else this._unload();
	}

	makeIndependent(element: HTMLElement) {
		const wrapper = document.createElement('div');
		const independent = document.createElement('div');
		element.replaceWith(wrapper);
		wrapper.appendChild(independent);
		independent.appendChild(element);

		independent.classList.add('res-media-independent');
		wrapper.style.willChange = 'height';

		this.resizing = (contentRect: * = element.getBoundingClientRect()) => {
			for (const callback of this.onResize) callback(contentRect);
			wrapper.style.height = `${contentRect.height}px`;
		};

		this.onResize.push(contentRect => {
			this.element.dispatchEvent(new CustomEvent('mediaResize', { detail: contentRect, bubbles: true }));
		});

		observed.set(element, contentRect => {
			if (!this._loaded) return;
			if (this.resizing) this.resizing(contentRect);
		});
		resizeObserver.observe(element);

		waitForEvent(element, 'mediaManuallyMovedVertically').then(() => { resizeObserver.unobserve(element); });
	}

	keepVisible(element: HTMLElement) {
		element.classList.add('res-element-keep-visible');

		const basisLeft = once(() => downcast(element.parentElement, HTMLElement).getBoundingClientRect().left);
		let isAligned = false;

		this.onResize.push(({ width: elementWidth }: *) => {
			const { width: viewportWidth } = getViewportSize();

			if (!isAligned && basisLeft() + elementWidth < viewportWidth) return;

			const { left: elementLeft, right: elementRight } = element.getBoundingClientRect();

			const deltaLeft = elementLeft - basisLeft();

			if (elementWidth > viewportWidth) { // Left align
				isAligned = true;
				move(element, -elementLeft, 0);
			} else if (elementRight - deltaLeft > viewportWidth) { // Right align
				isAligned = true;
				move(element, viewportWidth - elementRight, 0);
			} else if (deltaLeft) { // Reset
				isAligned = false;
				move(element, -deltaLeft, 0);
			}
		});
	}

	setMaxSize(element: HTMLElement) {
		let value = module.options.maxWidth.value;
		let isPercentage = value.endsWith('%');
		const maxWidth = (isPercentage ? getViewportSize().width / 100 : 1) * parseInt(value, 10);
		if (maxWidth) element.style.maxWidth = `${maxWidth}px`;

		value = module.options.maxHeight.value;
		isPercentage = value.endsWith('%');
		const maxHeight = (isPercentage ? getViewportSize().height / 100 : 1) * parseInt(value, 10);
		if (maxHeight) element.style.maxHeight = `${maxHeight}px`;
	}

	makeZoomable(element: HTMLElement, dragInitiater: HTMLElement = element, absoluteSizing: boolean = false) {
		if (!module.options.imageZoom.value) return;

		element.classList.add('res-media-zoomable');

		let initialWidth, initialHeight, initialDiagonal, left, top;

		function getDiagonal(x, y) {
			const w = Math.max(1, x - left);
			const h = Math.max(1, y - top);
			return Math.round(Math.hypot(w, h));
		}

		addDragListener({
			media: this.element,
			element: dragInitiater,
			atShiftKey: false,
			onStart: (x, y) => {
				({ left, top, width: initialWidth, height: initialHeight } = element.getBoundingClientRect());
				initialDiagonal = getDiagonal(x, y);
			},
			onMove: (x, y, deltaX, deltaY) => {
				const conversionFactor = this.rotationState % 2 ? initialHeight / initialWidth : 1;
				if (absoluteSizing) {
					const { width, height } = element.getBoundingClientRect();
					resize(element, (width + deltaX) * conversionFactor, (height + deltaY) / conversionFactor);
				} else {
					const newWidth = getDiagonal(x, y) / initialDiagonal * initialWidth;
					resize(element, newWidth * conversionFactor);
				}
			},
		});
	}

	makeMovable(element: HTMLElement, dragInitiater: HTMLElement = element) {
		if (!module.options.imageMove.value) return;

		element.classList.add('res-media-movable');

		addDragListener({
			media: this.element,
			element: dragInitiater,
			atShiftKey: true,
			onMove(x, y, deltaX, deltaY) { move(element, deltaX, deltaY); },
		});
	}

	addControls(element: HTMLElement, lookupUrl: *, downloadUrl: *) {
		if (!module.options.mediaControls.value) return element;

		const [y, x] = module.options.mediaControlsPosition.value.split('-');

		const wrapper = mediaControlsTemplate({ clippy: module.options.clippy.value, lookupUrl, downloadUrl, x, y });
		element.replaceWith(wrapper);
		wrapper.appendChild(element);

		element.classList.add('res-media-rotatable');

		const compensateTransformedSize = () => {
			const { width, height } = element.getBoundingClientRect();
			Object.assign(wrapper.style, { width: `${width}px`, height: `${height}px` });
		};

		const compensateTransformedSizeObserver = new ResizeObserver(compensateTransformedSize);

		const updateRotation = () => {
			compensateTransformedSizeObserver.observe(element);
			element.setAttribute('rotation', String(positiveModulo(this.rotationState, 4)));
			compensateTransformedSize();
		};

		wrapper.querySelector('.res-media-controls').addEventListener('click', (e: Event) => {
			switch (e.target.dataset.action) {
				case 'rotateLeft':
					--this.rotationState;
					updateRotation();
					break;
				case 'rotateRight':
					++this.rotationState;
					updateRotation();
					break;
				case 'download':
					Permissions.request(['downloads']).then(() => {
						const re = /(?:\.([^.]+))?$/;
						const ext = re.exec(downloadUrl);
						const thing = Thing.from(wrapper);
						let title = thing && thing.getTitle();
						if (title && ext) {
							let extension = ext[1];
							if (extension.includes('?')) extension = extension.split('?')[0];
							title = title.replace(/[*|?:"~<>\\\/]|(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/gi, '');
							title = title.trim();
							const filename = `${title}.${extension}`;
							return download(downloadUrl, filename);
						}

						return download(downloadUrl);
					}).catch(e => {
						console.error('RES-Slim: media download failed', e);
						Notifications.showNotification({
							moduleID: module.moduleID,
							notificationID: 'downloadFailed',
							message: 'Could not start the download. Check the downloads permission and try again.',
							closeDelay: 8000,
						}, 8000);
					});
					break;
				case 'imageLookup':
					// Google doesn't like image url's without a protacol
					lookupUrl = new URL(downcast(lookupUrl, 'string'), location.href).href;

					// Escape query string parameters
					openNewTab(string.encode`https://images.google.com/searchbyimage?client=app&sbisrc=cr_1_5_2&image_url=${lookupUrl}`);
					break;
				case 'showImageSettings':
					SettingsNavigation.open(module.moduleID, 'mediaControls');
					break;
				case 'clippy':
					e.target.textContent = [
						module.options.imageZoom.value && 'drag to resize',
						module.options.imageMove.value && 'shift-drag to move',
					].filter(Boolean).join(' or ');
					module.options.clippy.value = false;
					Options.save(module.options.clippy);
					break;
				default:
					// do nothing if action is unknown
					break;
			}

			e.stopPropagation();
			e.preventDefault();
		});

		return wrapper;
	}
}

class Gallery extends Media {
	filmstripLoadIncrement = parseInt(module.options.filmstripLoadIncrement.value, 10) || Infinity;
	preloadCount = parseInt(module.options.galleryPreloadCount.value, 10) || 0;

	individualCtrl;
	msgPosition;
	ctrlToFilmstrip;
	ctrlConcurrentIncrease;

	pieces: Array<{
		generateMedia: () => Media,
		media: ?Media,
		wrapper: HTMLElement,
	}>;

	lastRevealedPiece = null;
	filmstripActive: boolean;
	rememberResizeWidth: boolean;
	lastResizedWidth: number;

	constructor(options: GalleryMedia, context) {
		super();

		this.element = galleryTemplate({
			title: options.title,
			caption: options.caption,
			credits: options.credits,
			src: options.src,
		});

		const piecesContainer = this.element.querySelector('.res-gallery-pieces');
		this.individualCtrl = this.element.querySelector('.res-step-container');
		const ctrlPrev = this.individualCtrl.querySelector('.res-step-previous');
		const ctrlNext = this.individualCtrl.querySelector('.res-step-next');
		this.msgPosition = this.individualCtrl.querySelector('.res-step-position');
		this.ctrlToFilmstrip = this.individualCtrl.querySelector('.res-gallery-to-filmstrip');
		this.ctrlConcurrentIncrease = this.element.querySelector('.res-gallery-increase-concurrent');

		this.pieces = options.src.map(src => ({
			generateMedia: () => generateMedia(src, context),
			media: null,
			wrapper: string.html`<div hidden></div>`,
		}));
		piecesContainer.append(...this.pieces.map(({ wrapper }) => wrapper));

		const slideshowWhenLargerThan = parseInt(module.options.useSlideshowWhenLargerThan.value, 10) || Infinity;
		this.filmstripActive = module.options.galleryAsFilmstrip.value && this.pieces.length < slideshowWhenLargerThan;

		if (this.filmstripActive || this.pieces.length === 1) {
			this.ready = this.expandFilmstrip();
			this.ctrlConcurrentIncrease.addEventListener('click', () => this.expandFilmstrip());
		} else {
			this.ready = this.changeSlideshowPiece(0);
			ctrlPrev.addEventListener('click', () => { this.changeSlideshowPiece(-1); });
			ctrlNext.addEventListener('click', () => { this.changeSlideshowPiece(1); });

			waitForEvent(this.ctrlToFilmstrip, 'click').then(() => {
				// The filmstrip view will start at thet currently viewed piece
				// Add a way to also also display previous pieces
				const currentIndex = this.pieces.indexOf(this.lastRevealedPiece);
				if (currentIndex > 0) {
					const showFromBeginning = document.createElement('div');
					showFromBeginning.textContent = 'Show earlier pieces';
					showFromBeginning.style.cursor = 'pointer';
					piecesContainer.before(showFromBeginning);
					showFromBeginning.addEventListener('click', () => {
						this.expandFilmstrip({ revealFrom: 0, revealTo: currentIndex });
						showFromBeginning.remove();
					});
				}

				this.expandFilmstrip();
				this.ctrlConcurrentIncrease.addEventListener('click', () => this.expandFilmstrip());
			});
		}
	}

	shouldRememberResizeWidth() {
		return module.options.galleryRememberWidth.value && !this.filmstripActive;
	}

	rememberWidth(piece) {
		const resizedElement = piece.media && piece.media.element.querySelector('.res-media-zoomable');
		// Only resized elements have style.width
		const resizedWidth = resizedElement && parseInt(resizedElement.style.width, 10);
		if (resizedWidth) this.lastResizedWidth = resizedWidth;
	}

	restoreWidth(piece) {
		if (!this.lastResizedWidth) return;
		const resizeElement = piece.media && piece.media.element.querySelector('.res-media-zoomable');
		if (resizeElement) resize(resizeElement, this.lastResizedWidth);
	}

	revealPiece(piece) {
		if (this.shouldRememberResizeWidth() && this.lastRevealedPiece) this.rememberWidth(this.lastRevealedPiece);
		this.lastRevealedPiece = piece;

		piece.media = piece.media || piece.generateMedia();
		const { media, wrapper } = piece;
		if (!media.isAttached()) wrapper.appendChild(media.element);
		wrapper.hidden = false;
		if (this.shouldRememberResizeWidth()) this.restoreWidth(piece);
		// When preloading the gallery object, don't run the `expand` method on the piece as that may cause audio to play
		if (this.isAttached()) media.expand();
	}

	preloadAhead() {
		const preloadFrom = this.pieces.indexOf(this.lastRevealedPiece);
		const preloadTo = Math.min(preloadFrom + this.preloadCount + 1, this.pieces.length);

		return preloadMedia(this.pieces.slice(preloadFrom, preloadTo));
	}

	async expandFilmstrip({
		revealFrom = this.lastRevealedPiece ? this.pieces.indexOf(this.lastRevealedPiece) + 1 : 0,
		revealTo = Math.min(revealFrom + this.filmstripLoadIncrement, this.pieces.length),
	} = {}) {
		this.individualCtrl.remove();

		this.ctrlConcurrentIncrease.hidden = true;

		// reveal new pieces
		await forEachSeq(this.pieces.slice(revealFrom, revealTo), piece => {
			this.revealPiece(piece);
			return piece.media && piece.media.ready;
		});

		if (revealTo < this.pieces.length) {
			this.ctrlConcurrentIncrease.innerText = `Show next ${Math.min(this.filmstripLoadIncrement, this.pieces.length - revealTo)} pieces`;
			this.ctrlConcurrentIncrease.hidden = false;
		}

		return this.preloadAhead();
	}

	changeSlideshowPiece(step) {
		const previous = this.lastRevealedPiece;
		const previousIndex = previous ? this.pieces.indexOf(previous) : 0;

		let newIndex = previousIndex + step;
		// Allow wrap-around
		newIndex = positiveModulo(newIndex, this.pieces.length);

		this.individualCtrl.setAttribute('first-piece', String(newIndex === 0));
		this.individualCtrl.setAttribute('last-piece', String(newIndex === this.pieces.length - 1));
		this.msgPosition.innerText = `${newIndex + 1} / ${this.pieces.length}`;

		this.revealPiece(this.pieces[newIndex]);

		if (previous) {
			const { media, wrapper } = previous;
			if (!media) throw new Error();
			media.collapse();
			wrapper.hidden = true;
		}

		return this.preloadAhead();
	}

	supportsUnload() {
		return true;
	}

	setLoaded(state) {
		for (const { wrapper, media } of this.pieces) {
			if (!wrapper?.hidden && media && media.supportsUnload()) media.setLoaded(state);
		}
	}

	collapse() {
		for (const { media } of this.pieces) {
			if (media) media.collapse();
		}
	}
}

class Image extends Media {
	image: HTMLImageElement;
	src: string;

	constructor({
		title,
		caption,
		credits,
		src,
		href,
	}: ImageMedia, context) {
		super();

		this.src = src;

		this.element = imageTemplate({
			title,
			caption,
			credits,
			src,
			href: href || context.href,
			openInNewWindow: module.options.openInNewWindow.value,
		});
		this.image = downcast(this.element.querySelector('img.res-image-media'), HTMLImageElement);
		const anchor = this.element.querySelector('a.res-expando-link');

		this.ready = waitForEvent(this.image, 'load', 'error');

		this.image.addEventListener('error', () => {
			this.element.classList.add('res-media-load-error');
		});

		if (module.options.displayOriginalResolution.value) {
			this.image.addEventListener('load', () => {
				this.image.title = `${this.image.naturalWidth} × ${this.image.naturalHeight} px`;
			});
		}

		this.setMaxSize(this.image);
		const wrapper = this.addControls(anchor, src, src);
		this.makeZoomable(this.image);
		this.makeMovable(wrapper);
		this.keepVisible(wrapper);
		this.makeIndependent(wrapper);
	}

	supportsUnload() {
		return true;
	}

	_unload() {
		this.image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	}

	_restore() {
		this.image.src = this.src;
	}
}

class Iframe extends Media {
	loaded: boolean = false;
	loadPromise: Promise<*>;
	iframe: HTMLIFrameElement;
	pauseCommand: ?string;
	playCommand: ?string;

	constructor({
		embed,
		embedAutoplay,
		width = '640px',
		height = '360px',
		fixedRatio = false,
		pause: pauseCommand,
		play: playCommand,
	}: IframeMedia) {
		super();

		this.pauseCommand = pauseCommand;
		this.playCommand = playCommand;

		this.element = iframeTemplate({
			url: (module.options.autoplayVideo.value && embedAutoplay) ? embedAutoplay : embed,
			width,
			height,
		});
		this.iframe = downcast(this.element.querySelector('iframe'), HTMLIFrameElement);
		const iframeWrapper = downcast(this.element.firstElementChild, HTMLElement);
		const dragHandle = this.element.querySelector('.res-iframe-expando-drag-handle');

		this.onAttach = () => {
			this.loadPromise = waitForEvent(this.iframe, 'load')
				.then(() => {
					if (this.isAttached() && this.element.offsetParent) {
						this.loaded = true;
					} else {
						return Promise.reject(new Error('Iframe is not visible'));
					}
				});
		};

		this.makeZoomable(this.iframe, dragHandle, !fixedRatio);
		this.makeMovable(iframeWrapper, dragHandle);
		this.keepVisible(iframeWrapper);
		this.makeIndependent(iframeWrapper);
	}

	async expand() {
		if (module.options.autoplayVideo.value && this.playCommand) {
			await this.loadPromise;
			try {
				this.iframe.contentWindow.postMessage(this.playCommand, '*');
			} catch (e) {
				console.error('Could not post "play" command to iframe', this, e);
			}
		}
	}

	collapse() {
		if (this.loaded && this.pauseCommand) {
			try {
				this.iframe.contentWindow.postMessage(this.pauseCommand, '*');
				return;
			} catch (e) {
				console.error('Could not post "pause" command to iframe', this, e);
			}
		}

		// If we couldn't pause the iframe, remove it
		this.element.remove();
		this.loaded = false;
	}
}

class Text extends Media {
	constructor({
		title,
		credits,
		src,
	}: TextMedia) {
		super();

		this.element = textTemplate({
			title,
			credits,
			src: DOMPurify.sanitize(src),
		});
	}
}

class Audio extends Media {
	autoplay: boolean;
	audio: HTMLAudioElement;

	constructor({
		autoplay = false,
		loop,
		sources,
	}: AudioMedia) {
		super();

		this.autoplay = autoplay;

		this.element = audioTemplate({
			loop,
			sources,
		});
		this.audio = downcast(this.element.querySelector('audio'), HTMLAudioElement);
	}

	collapse() {
		// Audio is auto-paused when detached from DOM
		if (!this.isAttached()) return;

		this.autoplay = !this.audio.paused;
		if (!this.audio.paused) this.audio.pause();
	}

	expand() {
		if (this.autoplay) this.audio.play();
	}
}

class Generic extends Media {
	constructor(options: GenericMedia) {
		super();

		this.onAttach = options.onAttach;

		this.element = document.createElement('div');
		this.element.appendChild(options.generate());
	}

	// Always remove content, in case it contains audio or other unwanted things
	collapse() {
		this.element.remove();
	}
}

// When videos is added, this will pause or play them individually depending on their visibility
export const mutedVideoManager = once(() => {
	const maxSimultaneousPlaying = parseInt(module.options.maxSimultaneousPlaying.value, 10) || Infinity;
	const videos: Video[] = [];

	const updatePlay = frameThrottle(() => {
		const all = videos
			.filter(media => !(media.video.paused && !media.autoPaused) && (media.video.muted || !media.video.volume))
			.map(media => {
				const video = media.video;
				const thing = Thing.from(video);
				return {
					media,
					visibility: getPercentageVisibleYAxis(video),
					top: video.getBoundingClientRect().top,
					selected: Number(thing && thing.isSelected()),
				};
			});

		const notVisible = all.filter(({ visibility }) => visibility === 0);
		for (const { media } of notVisible) media.setAutoPause(true);

		without(all, ...notVisible)
			.sort((a, b) => b.selected - a.selected || b.visibility - a.visibility || a.top - b.top)
			.forEach(({ media }, index) => { media.setAutoPause(index >= maxSimultaneousPlaying); });
	});

	let intervalId = null;

	return {
		observe(video) {
			videos.push(video);
			updatePlay();
			if (intervalId === null) intervalId = setInterval(updatePlay, 100);
		},
		unobserve(video) {
			pull(videos, video);
			if (!videos.length && intervalId) {
				clearInterval(intervalId);
				intervalId = null;
			}
		},
	};
});

class Video extends Media {
	static volumeStorage = Storage.wrap('showImages.video.volume', (1: number));

	video: HTMLVideoElement;
	autoplay: boolean;
	time: number;
	frameRate: number;
	autoPaused: boolean;
	dashPlayer: *;
	_loaded = false;

	constructor({
		title,
		caption,
		credits,
		fallback,
		frameRate = 24,
		href,
		loop = false,
		muted = false,
		playbackRate = 1,
		poster,
		reversable = false,
		reversed = false,
		source,
		sources,
		time = 0,
	}: VideoMedia, context) {
		super();

		this.autoplay = muted || module.options.autoplayVideo.value;
		this.time = time;
		this.frameRate = frameRate;

		this.element = videoTemplate({
			title,
			caption,
			credits,
			source: source || href || context.href,
			// Prevent poster from flashing before the video is ready when autoplaying
			poster: !this.autoplay && poster || '',
			hasAudio: !muted,
			loop,
			reversable,
			formattedPlaybackRate: this.formatMultilineNumber(playbackRate, 'x'),
		});
		this.video = downcast(this.element.querySelector('video'), HTMLVideoElement);
		const container = this.element.querySelector('.res-video-container');

		const msgError = this.element.querySelector('.res-video-error');
		const displayError = message => {
			msgError.hidden = false;
			msgError.textContent = `Could not play video: ${message}`;
		};

		const sourceElements = filterMap(sources, v => {
			if (this.video.canPlayType(v.type)) {
				const source = document.createElement('source');
				source.src = v.source;
				source.type = v.type;
				if (v.reverse) source.dataset.reverse = v.reverse;
				return [source];
			} else {
				if (v.type === 'application/dash+xml') {
					// Use external library
					this.dashPlayer = loadScript('/dash.mediaplayer.min.js').then(() => {
						dashjs.skipAutoCreate = true;

						const player = dashjs.MediaPlayer().create(); // eslint-disable-line new-cap
						// The library needs the manifest a URL
						const url = URL.createObjectURL(new Blob([v.source], { type: 'application/dash+xml' }));

						player.initialize();
						player.setAutoPlay(false);
						player.attachView(this.video);
						player.attachSource(url);

						return {
							stop: () => player.attachSource(null),
							continue: () => player.attachSource(url),
						};
					});

					return [document.createElement('span')]; // Return dummy element as the proper `source` element has side effects
				}
			}
		});

		if (!sourceElements.length) {
			if (fallback) {
				return new Image({ // eslint-disable-line no-constructor-return
					type: 'IMAGE',
					title,
					caption,
					credits,
					src: fallback,
				}, context);
			} else {
				displayError('No playable sources were found');
			}
		}

		this.video.append(...sourceElements);

		this.video.addEventListener('play', () => { empty(msgError); msgError.hidden = true; });
		this.video.addEventListener('stalled', () => { displayError('Loading stalled'); });
		this.video.addEventListener('error', () => { displayError('Unknown error'); });

		if (reversed) this.reverse();

		this.ready = Promise.race([
			// 'ended' is not triggered when the video loops
			waitForEvent(this.video, 'ended'),
			waitForEvent(this.video, 'error'),
			waitForEvent(this.video, 'canplaythrough'),
		]);

		const setPlayIcon = () => {
			if (!this.video.paused) this.element.setAttribute('playing', '');
			else this.element.removeAttribute('playing');
		};

		this.video.addEventListener('pause', () => {
			setPlayIcon();
		});
		this.video.addEventListener('play', setPlayIcon);

		this.video.addEventListener('loadedmetadata', () => { if (this.time !== this.video.currentTime) this.video.currentTime = this.time; });
		this.video.playbackRate = playbackRate;

		// Ignore events which might be meant for controls
		this.video.addEventListener('mousedown', (e: MouseEvent) => {
			if (this.video.hasAttribute('controls')) {
				const { height, top } = this.video.getBoundingClientRect();
				let controlsBottomHeight = 0;
				if (process.env.BUILD_TARGET === 'firefox') controlsBottomHeight = 40;
				if ((height - controlsBottomHeight) < (e.clientY - top)) {
					e.stopImmediatePropagation();
				}
			}
		});

		this.video.addEventListener('dblclick', async () => {
			// $FlowIssue `Document#fullscreen` `Video#requestFullscreen` and `Document#exitFullscreen` not typed
			if (document.fullscreen) return;
			const initialControlsState = this.video.controls;
			this.video.controls = true;
			const enterFullscreenPromise = waitForEvent(this.video, 'fullscreenchange', 'fullscreenerror'); // enters fullscreen
			// $FlowIssue `Document#fullscreen` `Video#requestFullscreen` and `Document#exitFullscreen` not typed
			this.video.requestFullscreen();
			await enterFullscreenPromise;
			// $FlowIssue `Document#fullscreen` `Video#requestFullscreen` and `Document#exitFullscreen` not typed
			if (document.fullscreen) await waitForEvent(this.video, 'fullscreenchange', 'dblclick'); // leaves fullscreen
			// $FlowIssue `Document#fullscreen` `Video#requestFullscreen` and `Document#exitFullscreen` not typed
			if (document.fullscreen) document.exitFullscreen();
			this.video.controls = initialControlsState;
		});

		Promise.all([waitForEvent(this.element, 'mouseenter'), waitForEvent(this.video, 'canplay')])
			.then(() => this.addVideoControls());

		new MutationObserver(() =>
			this.element.classList.toggle('res-video-has-native-controls', this.video.hasAttribute('controls')),
		).observe(this.video, { attributes: true });

		if (!loop && this.autoplay) {
			waitForEvent(this.video, 'ended').then(() => this.stopAutoplay());
		}

		if (!muted) {
			if (module.options.startVideosMuted.value) this.video.muted = true;
			Promise.all([waitForEvent(this.video, 'canplay'), Video.volumeStorage.get()]).then(([, volume]) => {
				this.video.volume = volume;
			});
		}

		this.setMaxSize(this.video);
		this.makeZoomable(this.video);
		this.addControls(this.video, undefined, sourceElements[0].getAttribute('src'));
		this.makeMovable(container);
		this.keepVisible(container);
		this.makeIndependent(container);
	}

	reverse() {
		this.time = this.video.duration - this.video.currentTime;
		if (isNaN(this.time)) this.time = 0;

		for (const v of this.video.querySelectorAll('source')) {
			// $FlowIssue
			[v.src, v.dataset.reverse] = [v.dataset.reverse, v.src];
		}

		this.video.load();
		this.video.play();

		// $FlowIssue
		this.element.toggleAttribute('reversed');
	}

	formatMultilineNumber(value: number, suffix: string) {
		return `${value.toFixed(2).replace('.', '.​'/* zwsp */)}${suffix}`;
	}

	addVideoControls() {
		const ctrlContainer = this.element.querySelector('.res-video-controls');
		const ctrlReverse = ctrlContainer.querySelector('.res-video-reverse');
		const ctrlTogglePause = ctrlContainer.querySelector('.res-video-toggle-pause');
		const ctrlSpeedDecrease = ctrlContainer.querySelector('.res-video-speed-decrease');
		const ctrlSpeedIncrease = ctrlContainer.querySelector('.res-video-speed-increase');
		const ctrlTimeDecrease = ctrlContainer.querySelector('.res-video-time-decrease');
		const ctrlTimeIncrease = ctrlContainer.querySelector('.res-video-time-increase');

		const progress = this.element.querySelector('.res-video-progress');
		const indicatorPosition = progress.querySelector('.res-video-position');
		const ctrlPosition = progress.querySelector('.res-video-position-thumb');

		const msgSpeed = ctrlContainer.querySelector('.res-video-speed');
		const msgTime = ctrlContainer.querySelector('.res-video-time');

		ctrlContainer.hidden = false;

		this.video.addEventListener('click', (e: MouseEvent) => {
			this.togglePlay();
			e.preventDefault();
		});

		ctrlTogglePause.addEventListener('click', () => this.togglePlay());
		if (ctrlReverse) ctrlReverse.addEventListener('click', () => this.reverse());

		ctrlSpeedDecrease.addEventListener('click', () => { this.video.playbackRate /= 1.1; });
		ctrlSpeedIncrease.addEventListener('click', () => { this.video.playbackRate *= 1.1; });
		ctrlTimeDecrease.addEventListener('click', () => { this.video.currentTime -= 1 / this.frameRate; });
		ctrlTimeIncrease.addEventListener('click', () => { this.video.currentTime += 1 / this.frameRate; });

		this.video.addEventListener('ratechange', () => {
			msgSpeed.textContent = this.formatMultilineNumber(this.video.playbackRate, 'x');
		});
		this.video.addEventListener('timeupdate', () => {
			indicatorPosition.style.left = `${(this.video.currentTime / this.video.duration) * 100}%`;
			msgTime.textContent = this.formatMultilineNumber(this.video.currentTime, 's');
		});

		progress.addEventListener('mousemove', (e: MouseEvent) => {
			let left = e.offsetX;
			if (e.target === ctrlPosition) { left += e.target.offsetLeft; }
			ctrlPosition.style.left = `${left}px`;

			if (e.buttons === 1 /* left mouse button */) ctrlPosition.click();
		});
		ctrlPosition.addEventListener('click', (e: MouseEvent) => {
			const percentage = (e.target.offsetLeft + e.target.clientWidth / 2) / progress.clientWidth;
			this.video.currentTime = this.video.duration * percentage;
		});

		const ctrlVolume = ctrlContainer.querySelector('.res-video-volume');
		if (ctrlVolume) {
			const ctrlVolumeLevel = ctrlVolume.querySelector('.res-video-volume-level');
			const volumePercentage = ctrlVolume.querySelector('.res-video-volume-percentage');

			const updateVolume = e => {
				const base = ctrlVolumeLevel.clientHeight;
				const click = base - e.offsetY;
				const level = Math.min(click / base, 1);
				// If a lower value is chosen, the user likely is muting the video
				if (level > 0.01) {
					this.video.volume = level;
					this.video.muted = false;
					Video.volumeStorage.set(level);
				}
			};

			ctrlVolume.addEventListener('click', () => {
				this.video.muted = !this.video.muted;
			});
			ctrlVolumeLevel.addEventListener('mousemove', (e: MouseEvent) => {
				if (e.buttons === 1 /* left mouse button */) updateVolume(e);
			});
			ctrlVolumeLevel.addEventListener('click', (e: MouseEvent) => {
				updateVolume(e);
				e.stopPropagation();
			});

			const refresh = () => {
				ctrlVolume.setAttribute('level', (this.video.muted || !this.video.volume) ? '0' : String(Math.ceil(this.video.volume * 3)));
				volumePercentage.style.height = `${this.video.volume * 100}%`;
			};

			this.video.addEventListener('volumechange', refresh);
			refresh();
		}
	}

	togglePlay() {
		if (this.video.paused) this.video.play(); else this.video.pause();
		if (this.video.paused) this.stopAutoplay();
	}

	stopAutoplay() {
		this.autoplay = false;
	}

	setAutoPause(state) {
		this.autoPaused = state;
		if (state !== this.video.paused) {
			if (state) this.video.pause();
			else this.video.play();
		}
	}

	supportsUnload() {
		// Due to issues brougth about by with `pause` and `play` being asynchronous and conserveMemory and mutedVideoManager
		// could end up in a race condition, only unload paused videoes
		return this.video.paused;
	}

	async _unload() {
		// Video is auto-paused when detached from DOM
		if (!this.isAttached()) return;

		if (!this.video.paused) this.video.pause();

		this.time = this.video.currentTime;

		if (this.dashPlayer) {
			// Wait for the dash player to load before continuing
			(await this.dashPlayer).stop();
		} else {
			this.video.setAttribute('src', ''); // this.video.src has precedence over any child source element
			this.video.load();
		}

		mutedVideoManager().unobserve(this);
	}

	async _restore() {
		if (this.dashPlayer) {
			// Wait for the dash player to load before continuing
			(await this.dashPlayer).continue();
		} else if (this.video.hasAttribute('src')) {
			this.video.removeAttribute('src');
			this.video.load();
		}

		this.video.currentTime = this.time;

		// Wait till the meta-data is ready before starting playback
		if (this.video.readyState === 0) await waitForEvent(this.video, 'loadedmetadata');

		if (this.autoplay) this.video.play();

		mutedVideoManager().observe(this);
	}
}

// `preloadMedia` is used by Gallery internally, and also exported for use by linkScanner
let lastPreloadIndex = 0;
export function preloadMedia(pieces: *) {
	// Avoid potentially unwanted side-effects by only allowing one concurrent preload sequence
	const index = ++lastPreloadIndex;

	return forEachSeq(pieces, piece => {
		if (!piece.generateMedia) return;
		if (lastPreloadIndex !== index) return;

		piece.media = piece.media || piece.generateMedia();
		return piece.media.ready;
	});
}

