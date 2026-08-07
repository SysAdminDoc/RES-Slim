/* @flow */

import { Module } from '../core/module';
import * as Options from '../core/options';
import { NAMED_KEYS, getViewportSize, frameThrottle, waitForEvent, waitForDetach } from '../utils';

export const module: Module<*> = new Module('hover');

module.moduleName = 'hoverName';
module.category = 'coreCategory';
module.description = 'hoverDesc';
module.alwaysEnabled = true;

module.options = {
	instances: {
		description: 'hoverInstancesDesc',
		title: 'hoverInstancesTitle',
		type: 'table',
		value: ([]: Array<[string, boolean]>),
		fields: [{
			key: 'id',
			name: 'hoverInstancesName',
			type: 'text',
		}, {
			key: 'enabled',
			name: 'hoverInstancesEnabled',
			type: 'boolean',
			value: true,
		}],
	},
	openDelay: {
		type: 'text',
		value: '500',
		description: 'hoverOpenDelayDesc',
		title: 'hoverOpenDelayTitle',
	},
	fadeDelay: {
		type: 'text',
		value: '500',
		description: 'hoverFadeDelayDesc',
		title: 'hoverFadeDelayTitle',
	},
	fadeSpeed: {
		noconfig: true, // broken
		type: 'text',
		value: '0.7',
		description: 'hoverFadeSpeedDesc',
		title: 'hoverFadeSpeedTitle',
	},
	width: {
		type: 'text',
		value: '512',
		description: 'hoverWidthDesc',
		title: 'hoverWidthTitle',
	},
	closeOnMouseOut: {
		type: 'boolean',
		value: true,
		description: 'hoverCloseOnMouseOutDesc',
		title: 'hoverCloseOnMouseOutTitle',
	},
};

module.beforeLoad = () => {
	Hover._defaultOptions = {
		openDelay: parseFloat(module.options.openDelay.value),
		fadeDelay: parseFloat(module.options.fadeDelay.value),
		fadeSpeed: parseFloat(module.options.fadeSpeed.value),
		width: parseFloat(module.options.width.value),
		closeOnMouseOut: module.options.closeOnMouseOut.value,
		enabled: true,
	};
};

const instances: { [string]: Hover } = {};
const getInstance = (TypeClass, id) => instances[id] || (instances[id] = new TypeClass(id));

export const infocard = (name: string) => getInstance(HoverInfoCard, name);
export const dropdownList = (name: string) => getInstance(HoverDropdownList, name);

function getFixedParent(e: Element): ?Element {
	const p = e.parentElement;
	return p && (window.getComputedStyle(p).position === 'fixed' && e || getFixedParent(p));
}

export const pin = {
	bottom: 'bottom',
	right: 'right',
};

type HoverContents = HTMLElement | DocumentFragment | string | null;
type HoverCallback = (self: Hover) => Promise<HoverContents[]> | HoverContents[];

class Hover {
	static _defaultOptions = {};

	template: string = `
		<div class="RESHover">
			<div data-hover-element="0" />
			<div data-hover-element="1" />
			<div data-hover-element="2" />
			<div data-hover-element="3" />
		</div>
	`;

	_options: { [string]: any } = Hover._defaultOptions;
	instanceID: string;

	visible: boolean = false;
	_hideTimer: TimeoutID | null = null;
	_showTimer: TimeoutID | null = null;
	_closeFadeTimer: TimeoutID | null = null;
	_target: HTMLElement | void;
	_callback: HoverCallback | void;
	_container: HTMLElement | void;

	_fixedPosition: boolean = false;

	_closePromise: Promise<*>;
	_closePromiseResolve: () => void;

	constructor(id: string) {
		this.instanceID = id;
	}

	options(options: { [string]: mixed }, persistent: boolean = true) {
		const persistentOptions = persistent ?
			Options.table.getMatchingValueOrAdd(module, 'instances', { id: this.instanceID }, { enabled: true }) : undefined;

		this._options = {
			...this._options,
			...options,
			...persistentOptions,
		};

		return this;
	}

	target(element: HTMLElement) {
		if (this._target && this._target !== element) {
			this.close();
		}

		this._target = element;

		return this;
	}

	getCheckedTarget(): HTMLElement {
		if (!this._target || !this._target.offsetParent) {
			this.close();
			throw new Error('Cannot show hover without target; closing hover.');
		}
		return this._target;
	}

	populateWith(callback: HoverCallback) {
		this._callback = callback;

		return this;
	}

	getContainer() {
		const container = this._container = this._container || this._render();

		if (!document.body.contains(container)) {
			document.body.append(container);
		}

		return container;
	}

	_render(): HTMLElement {
		const temp = document.createElement('div');
		temp.innerHTML = this.template.trim();
		const ele = temp.firstElementChild;
		// `firstElementChild` is nullable, and `removeChild(null)` throws — an empty
		// or whitespace-only template would have failed here with a DOM error naming
		// nothing useful. Declaring the return type is also what lets every
		// `getContainer().style` / `.classList` below type-check: the field says
		// HTMLElement while this returned Element, so seven dereferences were
		// unchecked.
		if (!(ele instanceof HTMLElement)) {
			throw new Error(`Hover template for "${this.instanceID}" produced no element: ${JSON.stringify(this.template)}`);
		}
		temp.removeChild(ele);
		this._addContainerHandlers(ele);
		if (this._options.className) ele.classList.add(this._options.className);
		return ele;
	}

	_checkMouseLeave = frameThrottle(({ target }: MouseEvent) => {
		if (
			this.visible &&
			this._options.closeOnMouseOut &&
			!this.getCheckedTarget().contains(target) &&
			!Object.values(instances).some(instance => instance._container && instance._container.contains(target))
		) this._startHideTimer();
	});

	_addContainerHandlers(ele: HTMLElement) {
		ele.addEventListener('mouseenter', () => {
			this._cancelHideTimer();
			this._clearCloseFade();
		});
		ele.addEventListener('mouseleave', this._checkMouseLeave);
		ele.addEventListener('click', (e: Event) => {
			if (e.target instanceof Element && e.target.closest('.RESCloseButton')) this.close();
		});
		ele.addEventListener('keyup', (e: KeyboardEvent) => {
			if (e.key === NAMED_KEYS.Escape) this.close();
			e.stopImmediatePropagation();
		});
	}

	begin() {
		if (!this._options.enabled) return false;

		if (this._options.openDelay) {
			this._startShowTimer();
		} else {
			this.open();
		}
	}

	watch(selector: string) {
		document.body.addEventListener('mouseenter', (e: MouseEvent) => {
			if (e.target instanceof Element && e.target.matches(selector)) {
				this.target(e.target).begin();
			}
		}, true);
	}

	open() {
		if (!this._options.enabled) return false;

		this._cancelShowTimer();
		this._cancelHideTimer();
		this._clearCloseFade();

		const callback = this._callback;
		if (!callback) throw new Error();

		if (this._closePromiseResolve) this._closePromiseResolve();
		this._closePromise = new Promise(res => { this._closePromiseResolve = res; });

		this._displayLoadIndicator();
		(async () => {
			try {
				this.populate(await callback(this));
			} catch (e) {
				this.close();
				throw e;
			}
		})();

		waitForDetach(this.getCheckedTarget(), this._closePromise).then(() => { this.close(); })
			.catch(() => { /* avoid "uncaught promise rejection" */ });

		if (this._options.closeOnMouseOut) {
			document.body.addEventListener('mousemove', this._checkMouseLeave);
			document.body.addEventListener('mouseover', this._checkMouseLeave);
		}

		this.visible = true;
	}

	_displayLoadIndicator() {}

	async refresh() {
		const callback = this._callback;
		if (callback) this.populate(await callback(this));
	}

	populate(items: HoverContents[]) {
		if (!this._options.enabled) return false;

		const container = this.getContainer();

		items.forEach((item, i) => {
			if (!item) return;
			const element = container.querySelector(`[data-hover-element="${i}"]`);
			if (!element) return;
			// Detach children to allow re-use of elements with event handlers
			while (element.firstChild) element.removeChild(element.firstChild);
			if (typeof item === 'string') {
				element.innerHTML = item;
			} else {
				element.appendChild(item);
			}
		});

		const fixedParent = getFixedParent(this.getCheckedTarget());
		if (fixedParent) {
			this._fixedPosition = true;

			const onScroll = () => {
				this.close(false);
				fixedParent.removeEventListener('scroll', onScroll, true);
			};
			fixedParent.addEventListener('scroll', onScroll, true);
		}

		this._updatePosition();
	}

	_positionContainer({ top = 'auto', right = 'auto', bottom = 'auto', left = 'auto' }: { top?: *, right?: *, bottom?: *, left?: * }) {
		const container = this.getContainer();
		container.style.position = this._fixedPosition ? 'fixed' : 'absolute';
		container.style.top = top !== 'auto' ? `${top + (this._fixedPosition ? 0 : window.scrollY)}px` : 'auto';
		container.style.right = right !== 'auto' ? `${right + (this._fixedPosition ? 0 : window.scrollX)}px` : 'auto';
		container.style.bottom = bottom !== 'auto' ? `${bottom + (this._fixedPosition ? 0 : window.scrollY)}px` : 'auto';
		container.style.left = left !== 'auto' ? `${left + (this._fixedPosition ? 0 : window.scrollX)}px` : 'auto';
	}

	_updatePosition() {
		const target = this.getCheckedTarget();
		const { top, left } = target.getBoundingClientRect();
		this._positionContainer({ top, left });
	}

	_startShowTimer = () => {
		if (this._showTimer) return;
		this._cancelHideTimer();
		waitForEvent(this.getCheckedTarget(), 'mouseleave').then(this._cancelShowTimer);
		this._showTimer = setTimeout(() => this.open(), this._options.openDelay);
	};

	_cancelShowTimer = () => {
		if (!this._showTimer) return;
		clearTimeout(this._showTimer);
		this._showTimer = null;
	};

	resetShowTimer() {
		if (this._showTimer) {
			this._cancelShowTimer();
			this._startShowTimer();
		}
	}

	_startHideTimer = () => {
		if (this._hideTimer || this._closeFadeTimer) return;
		this._cancelShowTimer();
		this._hideTimer = setTimeout(() => this.close(true), this._options.fadeDelay);
	};

	_cancelHideTimer = () => {
		if (!this._hideTimer) return;
		clearTimeout(this._hideTimer);
		this._hideTimer = null;
	};

	_startCloseFade() {
		if (this._closeFadeTimer) return;
		this._closeFadeTimer = setTimeout(() => { this.remove(); }, this._options.fadeSpeed * 1000);
		this.getContainer().style.transitionDuration = `${this._options.fadeSpeed}s`;
		this.getContainer().classList.add('transitionToTransparent');
	}

	_clearCloseFade() {
		if (!this._closeFadeTimer) return;
		clearTimeout(this._closeFadeTimer);
		this.getContainer().style.transitionDuration = '';
		this.getContainer().classList.remove('transitionToTransparent');
		this._closeFadeTimer = null;
	}

	close(fade: boolean = false) {
		if (!this._options.enabled) return false;

		this._cancelShowTimer();
		this._cancelHideTimer();

		if (fade) this._startCloseFade();
		else this.remove();
	}

	remove() {
		this._clearCloseFade();
		this.getContainer().remove();
		if (this._closePromiseResolve) this._closePromiseResolve();
		this.visible = false;

		if (this._options.closeOnMouseOut) {
			document.body.removeEventListener('mousemove', this._checkMouseLeave);
			document.body.removeEventListener('mouseover', this._checkMouseLeave);
		}
	}
}

class HoverInfoCard extends Hover {
	template = `
		<div class="RESHover RESHoverInfoCard RESDialogSmall">
			<h3 class="RESHoverTitle" data-hover-element="0"></h3>
			<div class="RESCloseButton RESCloseButtonTopRight"></div>
			<div class="RESHoverBody RESDialogContents" data-hover-element="1"></div>
		</div>
	`;

	_loadIndicator = '<div class="RESCenteredLoadIndicator"><span class="RESLoadingSpinner"></span></div>';

	_displayLoadIndicator() {
		this.populate(['…', this._loadIndicator]);
	}

	_updatePosition() {
		const target = this.getCheckedTarget();
		const { top, left, bottom, right } = target.getBoundingClientRect();
		const container = this.getContainer();
		container.classList.remove('right', 'below');

		const tooltipWidth = this._options.width;
		let tooltipLeft, tooltipTop;

		if (!this._options.pin && right + tooltipWidth + 25 < getViewportSize().width) {
			tooltipTop = top - 14;
			tooltipLeft = right + 25;
		} else if (this._options.pin === pin.bottom || left - tooltipWidth - 30 < 0) {
			container.classList.add('below');
			tooltipTop = bottom + 10;
			tooltipLeft = Math.min(Math.max(getViewportSize().width - tooltipWidth, 0), left);
		} else {
			container.classList.add('right');
			tooltipTop = top - 14;
			tooltipLeft = left - tooltipWidth - 30;
		}

		container.style.width = `${tooltipWidth}px`;
		this._positionContainer({ left: tooltipLeft, top: tooltipTop });
	}
}

class HoverDropdownList extends Hover {
	template = `
		<div class="RESHover RESHoverDropdownList RESDropdownList">
			<ul class="RESDropdownOptions" data-hover-element="0"></ul>
		</div>
	`;

	_options = {
		...Hover._defaultOptions,
		pin: pin.bottom,
		offsetWidth: 0,
		offsetHeight: 2,
		bottomPadding: 10,
	};

	_updatePosition() {
		const target = this.getCheckedTarget();
		const { top, left, height, width } = target.getBoundingClientRect();
		const container = this.getContainer();

		switch (this._options.pin) {
			case pin.right:
				const bottomAlign = top + container.offsetHeight + this._options.bottomPadding > getViewportSize().height;
				if (bottomAlign) {
					this._positionContainer({ left: left + width, bottom: this._options.bottomPadding });
				} else {
					this._positionContainer({ left: left + width, top: top + this._options.offsetHeight });
				}
				break;
			case pin.bottom:
				// falls through
			default:
				const leftAlign = left + container.offsetWidth < getViewportSize().width;
				if (leftAlign) {
					this._positionContainer({ left, top: top + height + this._options.offsetHeight });
				} else {
					this._positionContainer({ right: getViewportSize().width - left - width + this._options.offsetWidth, top: top + height + this._options.offsetHeight });
				}
				break;
		}
	}
}
