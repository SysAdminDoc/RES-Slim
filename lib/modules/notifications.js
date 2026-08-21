/* @flow */

import DOMPurify from 'dompurify';
import { once } from '../utils/functional';
import { Module } from '../core/module';
import * as Modules from '../core/modules';
import * as Options from '../core/options';
import { Storage, i18n } from '../environment';
import { firstValid, hashCode, string, waitForEvent } from '../utils';
import { createApiBlockNotifier } from '../utils/redditApiStatus';
import * as SettingsNavigation from './settingsNavigation';

export const module: Module<{ [string]: any }> = new Module('notifications');

module.moduleName = 'notificationsName';
module.category = 'coreCategory';
module.description = 'notificationsDesc';
module.options = {
	sticky: {
		description: 'notificationStickyDesc',
		title: 'notificationStickyTitle',
		type: 'enum',
		value: 'notificationType',
		values: [{
			name: 'notificationsPerNotificationType',
			value: 'notificationType',
		}, {
			name: 'notificationsAlwaysSticky',
			value: 'all',
		}, {
			name: 'notificationsNeverSticky',
			value: 'none',
		}],
	},
	closeDelay: {
		type: 'text',
		value: '3000',
		description: 'notificationCloseDelayDesc',
		title: 'notificationCloseDelayTitle',
	},
	fadeOutLength: {
		type: 'text',
		value: '3000',
		description: 'notificationFadeOutLengthDesc',
		title: 'notificationFadeOutLengthTitle',
		advanced: true,
	},
	notificationTypes: {
		description: 'notificationNotificationTypesDesc',
		title: 'notificationNotificationTypesTitle',
		type: 'table',
		advanced: true,
		addRowText: 'notificationsAddNotificationType',
		fields: [{
			key: 'id',
			name: 'notificationsNotificationID',
			type: 'text',
		}, {
			key: 'enabled',
			name: 'notificationsEnabled',
			type: 'boolean',
			value: true,
		}, {
			key: 'sticky',
			name: 'notificationsSticky',
			type: 'boolean',
			value: false,
		}],
		value: ([]: Array<[string, boolean, boolean]>),
	},
};

const notificationsContainer = string.html`<div id="RESNotifications"></div>`;
const lastShownStorage = Storage.wrapBlob('notifications.lastShown', (): number => 0);

module.go = () => {
	document.body.append(notificationsContainer);
};

// Throttled, user-facing notice when Reddit refuses or rate-limits a data request
// (403 anonymous-access removal, 429 throttling). Modules that fetch `.json` call
// this from their error path instead of failing silently. At most one toast per
// 30s window across all callers.
const reportApiBlock = createApiBlockNotifier({
	notify: (kind, status) => {
		showNotification({
			moduleID: 'notifications',
			notificationID: 'redditApiBlock',
			cooldown: 30000,
			message: i18n(kind === 'rateLimited' ? 'redditApiRateLimited' : 'redditApiForbidden', String(status)),
		}, 6000);
	},
});

// Accepts a numeric HTTP status. Returns whether a notice fired (false for
// statuses that are not a Reddit block, or when throttled).
export function notifyRedditApiBlocked(status: mixed): boolean {
	return reportApiBlock(status);
}

const activeNotifications = new Set();

type NotificationOptions = {|
	message: string | HTMLElement,
	cooldown?: number,
	header?: string,
	closeDelay?: number,
	notificationID?: string,
	moduleID?: string,
	optionKey?: string,
	noDisable?: boolean,
|};

export function showNotification(opts: string | NotificationOptions, _delay?: number): { element: HTMLElement, close(): void } {
	const data: NotificationOptions = typeof opts === 'string' ? { message: opts } : opts;
	const id = `${String(firstValid(data.moduleID, '--'))}-${String(firstValid(data.notificationID, data.optionKey, data.header, hashCode(data.message instanceof HTMLElement ? data.message.outerHTML : data.message)))}`;
	const mod = data.moduleID && Modules.getUnchecked(data.moduleID);

	// A notification without a header or an owning module rendered a 40px empty
	// dark bar above the message, which read as a broken or half-loaded panel.
	// Mark that case so the header collapses to just its close button.
	const headerText = data.header || (mod ? i18n(mod.moduleName) : '') || '';
	const headerClass = headerText ? 'RESNotificationHeader' : 'RESNotificationHeader is-untitled';

	const element = string.html`
		<div class="RESNotification" data-id="${id}" role="status">
			<div class="${headerClass}">
				<h3>${headerText}</h3>
				${mod && !mod.hidden ?	string.safe(SettingsNavigation.makeUrlHashLink(mod.moduleID, data.optionKey, ' ', 'gearIcon')) : ''}
				<button type="button" class="RESCloseButton" aria-label="${i18n('notificationsDismiss')}"></button>
			</div>
			<div class="RESNotificationContent"></div>
			<div class="RESNotificationFooter" ${data.noDisable ? 'hidden' : ''}>
				<label class="RESNotificationToggle" title="Show notifications from ${id}">
					<input type="checkbox" checked> ${i18n('notificationsAlwaysShowType')}
				</label>
			</div>
		</div>
	`;

	const notifContent = element.querySelector('.RESNotificationContent');
	if (data.message instanceof HTMLElement) {
		notifContent.appendChild(data.message);
	} else {
		// Sanitize string messages: callers may embed benign markup (links,
		// emphasis), but a future caller interpolating remote text (username,
		// error body) must not be able to inject scripts or event handlers.
		notifContent.insertAdjacentHTML('beforeend', DOMPurify.sanitize(data.message));
	}

	const inner = element.innerHTML;
	const existing = [...activeNotifications.values()].find(({ element }) => element.innerHTML === inner);
	if (existing) {
		existing.element.dispatchEvent(new CustomEvent('notification-reset'));
		return existing;
	}

	const close = once(() => {
		activeNotifications.delete(notification);
		element.remove();
	});

	const notification = { element, close };
	activeNotifications.add(notification);

	const storage = Options.table.getMatchingValueOrAdd(module, 'notificationTypes', { id }, data);

	element.querySelector('.RESNotificationToggle input').addEventListener('change', (e: any) => {
		storage.enabled = e.currentTarget.checked;
	});

	element.querySelector('.RESCloseButton').addEventListener('click', () => { close(); });

	const isSticky = module.options.sticky.value === 'all' ||
		(module.options.sticky.value === 'notificationType' && storage.sticky);
	const delay = +firstValid(_delay, data.closeDelay, parseInt(module.options.closeDelay.value, 10), (module.options.closeDelay: any).default);
	const fadeDuration = +firstValid(parseInt(module.options.fadeOutLength.value, 10), (module.options.fadeOutLength: any).default);

	async function resetCloseTimer() {
		await new Promise(requestAnimationFrame); // Only start timer when frame becomes visible
		if (element.matches(':hover')) await waitForEvent(element, 'mouseleave');

		let fadeTimer;
		const hideTimer = setTimeout(() => {
			element.classList.add('transitionToTransparent');
			element.style.transitionDuration = `${fadeDuration / 1000}s`;
			fadeTimer = setTimeout(() => close(), fadeDuration);
		}, delay);

		await waitForEvent(element, 'mouseenter', 'notification-reset');

		element.classList.remove('transitionToTransparent');

		if (fadeTimer) clearTimeout(fadeTimer);
		if (hideTimer) clearTimeout(hideTimer);

		resetCloseTimer();
	}

	(async () => {
		if (!storage.enabled || !Modules.isRunning(module)) return;

		if (data.cooldown) {
			if (data.cooldown > Date.now() - await lastShownStorage.get(id)) return;
			lastShownStorage.set(id, Date.now());
		}

		requestAnimationFrame(() => {
			if (window.getComputedStyle(element).maxHeight === 'initial') return;
			element.style.maxHeight = '100vh';
		});

		notificationsContainer.prepend(element);

		if (!isSticky && delay !== Infinity) resetCloseTimer();
	})();

	return notification;
}
