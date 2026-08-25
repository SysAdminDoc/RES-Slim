/* @flow */

import { memoize } from './functional';
import { getD2xBodyOffset, getHeaderOffset } from './dom';
import * as PagePhases from './pagePhases';
import { frameThrottle } from './async';
import { isAppType } from './currentLocation';
import { html } from './string';

class Container {
	static isAvailable() { return true; }
	static fallback: ?$Keys<typeof containers>;
	static phase: Promise<any> = PagePhases.loadComplete;
	static useList: boolean = true;

	element: HTMLElement = document.createElement('div');
	list: HTMLElement = html`<ul class="res-floater-list"></ul>`;

	constructor() {
		if (this.constructor.useList) this.element.append(this.list);
		this.constructor.phase.then(() => this.go());
	}

	go() {}

	add(element: HTMLElement, { separate, order }: {| separate: boolean, order: number |}) {
		if (separate || !this.constructor.useList) {
			element.style.order = String(order);
			this.element.append(element);
		} else {
			if (element instanceof HTMLLIElement) {
				this.list.append(element);
			} else {
				const li = html`<li style="order: ${order}"></li>`;
				li.append(element);
				this.list.append(li);
			}
		}
	}
}

const containers = {
	inNavbar: class extends Container {
		static isAvailable() { return isAppType('d2x') && !!document.querySelector('.header-user-dropdown'); }
		static fallback = 'userMenu';
		static phase = PagePhases.contentStart;

		go() {
			this.element.classList.add('res-floater-inNavbar');
			document.body.append(this.element);
			this.updateHeaderWidth();
		}

		add(element: *, opts: *) {
			super.add(element, opts);
			this.updateHeaderWidth();
		}

		updateHeaderWidth = frameThrottle(() => {
			// `isAvailable` saw this element once, but d2x is a SPA and re-renders
			// its header; by the time a throttled frame runs the node may be gone.
			const headerButton = document.querySelector('.header-user-dropdown');
			if (!headerButton) return;
			const { width } = this.element.getBoundingClientRect();
			headerButton.style.marginRight = `${width}px`;
		});
	},

	userMenu: class extends Container {
		static isAvailable() { return isAppType('r2'); }
		static phase = PagePhases.contentStart;
		static useList = false;

		go() {
			// `isAvailable` only checks the app type, so this runs on every old
			// reddit page — including logged-out ones, where `#header-bottom-right`
			// holds a login form and has no `ul` at all. Dereferencing the null
			// threw out of a `contentStart.then()` with nothing to catch it, taking
			// down every floater consumer on the page. `tabMenu` below has always
			// handled the same situation; this is the copy that never got it.
			let element = document.body.querySelector('#header-bottom-right ul');

			if (!element) {
				const userbar = document.body.querySelector('#header-bottom-right');
				if (!userbar) {
					if (process.env.NODE_ENV === 'development') {
						console.warn('Could not find the user menu');
					}
					return;
				}
				element = html`<ul />`;
				userbar.append(element);
			}

			// Items may have been added already
			element.append(...this.element.children);
			this.element = element;
		}

		add(element) {
			// A separator only separates. Appending one unconditionally is fine
			// against reddit's own userbar, which already has items — but the
			// fallback above creates an *empty* `ul` when reddit has not provided
			// one (the logged-out case this container exists to survive), and the
			// first item then rendered as a dangling "| storage" with nothing to
			// its left.
			if (this.element.firstChild) {
				this.element.append(html`<span class="separator">|</span>`);
			}
			this.element.append(element);
		}
	},

	belowFixedNavbar: class extends Container {
		static isAvailable() { return isAppType('d2x'); }

		go() {
			this.element.classList.add('res-floater-belowNavbar');
			this.element.style.top = `${5 + getD2xBodyOffset()}px`;
			document.body.append(this.element);
		}
	},

	visibleAfterScroll: class extends Container {
		static isAvailable() { return !isAppType('d2x'); }
		static fallback = 'belowFixedNavbar';

		go() {
			this.element.classList.add('res-floater-visibleAfterScroll');
			document.body.append(this.element);
			this.element.style.top = `${8 + getHeaderOffset()}px`;

			const header = document.querySelector('#header');
			if (header && !document.querySelector('#RESPinnedHeaderSpacer')) { // No need to hide the floater if whole header is pinned
				this.element.hidden = true;
				// Without the `header` guard, `observe(null)` throws — same failure
				// shape as the userMenu bug above, from the same assumption that
				// reddit's chrome is always present.
				// $FlowIssue https://github.com/facebook/flow/pull/4664
				new IntersectionObserver(entries => {
					this.element.hidden = entries[0].isIntersecting;
				}).observe(header);
			}
		}
	},

	tabMenu: class extends Container {
		static isAvailable() { return isAppType('r2'); }
		static fallback = 'belowFixedNavbar';
		static phase = PagePhases.contentStart;
		static useList = false;

		go() {
			let menu = document.querySelector('#header-bottom-left ul.tabmenu');
			if (menu) {
				/* no-op */
			} else if (document.querySelector('#header-bottom-left')) {
				menu = html`<ul class="tabmenu" />`;
				document.querySelector('#header-bottom-left').append(menu);
			} else {
				if (process.env.NODE_ENV === 'development') {
					console.warn('Could not find tab menu');
				}

				return;
			}

			// Items may have been added already
			menu.append(...this.element.children);
			this.element = menu;
		}
	},

	inert: Container,
};

const getContainer: * => Container = memoize((name: $Keys<typeof containers>) => {
	let container;
	if (containers[name].isAvailable()) {
		container = new containers[name]();
	} else if (containers[name].fallback) {
		container = getContainer(containers[name].fallback);
		// If a stack trace overflow gets thrown from here, check
		// container[name].fallback for circular dependencies.
	}

	if (container) {
		return container;
	} else {
		const InertContainer = containers.inert;
		return new InertContainer();
	}
});

export function addFloater(
	element: HTMLElement,
	{
		container: containerName = ['inNavbar', 'belowFixedNavbar', 'visibleAfterScroll'].find(name => containers[name].isAvailable()) || 'inert',
		separate = false,
		order = 0,
	}: {|
		container?: $Keys<typeof containers>,
		separate?: boolean,
		order?: number,
	|} = {},
) {
	getContainer(containerName).add(element, { separate, order });
}
