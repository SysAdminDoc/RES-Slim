/* @flow */

import { Module } from '../core/module';
import { clearModuleErrorLog, getModuleErrorLog } from '../core/modules/storage';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { getStoreInfos, clearStore, formatCount } from '../utils/storageDashboard';
import { formatModuleErrorLog } from '../utils/moduleErrorLog';

export const module: Module<*> = new Module('storageDashboard');

module.moduleName = 'Storage dashboard';
module.category = 'coreCategory';
module.description = 'View and manage local data stores (IndexedDB). Adds a "storage" link in the userbar.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['storage', 'database', 'idb', 'purge', 'data', 'dashboard'];

const TRIGGER_ID = 'rsm-storageDashboard-trigger';
const PANEL_ID = 'rsm-storageDashboard-panel';
const PANEL_TITLE_ID = 'rsm-storageDashboard-title';

module.go = () => {
	const header = document.querySelector('#header-bottom-right');
	if (!header) return;

	const sep = document.createTextNode(' | ');
	const trigger = document.createElement('a');
	trigger.id = TRIGGER_ID;
	trigger.href = '#';
	trigger.textContent = 'storage';
	trigger.setAttribute('role', 'button');
	trigger.setAttribute('aria-controls', PANEL_ID);
	trigger.setAttribute('aria-expanded', 'false');
	trigger.addEventListener('click', togglePanel);
	header.append(sep, trigger);
};

let panelOpen = false;

function syncTriggerExpanded(expanded: boolean) {
	const trigger = document.getElementById(TRIGGER_ID);
	if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

// Escape and click-outside both dismiss the panel, matching how every other
// RES-Slim popover behaves. Without these the only way out was to hunt for the
// trigger again, which reads as a stuck panel.
function onDocumentKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape' && panelOpen) {
		e.preventDefault();
		closePanel({ restoreFocus: true });
	}
}

function onDocumentPointerDown(e: Event) {
	if (!panelOpen) return;
	const target = e.target;
	if (!(target instanceof Node)) return;
	const panel = document.getElementById(PANEL_ID);
	const trigger = document.getElementById(TRIGGER_ID);
	if (panel && panel.contains(target)) return;
	if (trigger && trigger.contains(target)) return;
	closePanel();
}

function closePanel(opts: { restoreFocus?: boolean } = {}) {
	const existing = document.getElementById(PANEL_ID);
	if (existing) existing.remove();
	panelOpen = false;
	syncTriggerExpanded(false);
	document.removeEventListener('keydown', onDocumentKeydown, true);
	document.removeEventListener('pointerdown', onDocumentPointerDown, true);
	if (opts.restoreFocus) {
		const trigger = document.getElementById(TRIGGER_ID);
		if (trigger instanceof HTMLElement) trigger.focus();
	}
}

async function togglePanel(e: Event) {
	e.preventDefault();
	const existing = document.getElementById(PANEL_ID);
	if (existing) {
		closePanel();
		return;
	}
	panelOpen = true;
	syncTriggerExpanded(true);
	const panel = document.createElement('div');
	panel.id = PANEL_ID;
	panel.className = 'rsm-storageDashboard-panel';
	panel.setAttribute('role', 'region');
	panel.setAttribute('aria-labelledby', PANEL_TITLE_ID);
	setTrustedHTML(panel, '<div class="rsm-storageDashboard-loading" role="status">Reading local data stores…</div>');
	document.body.append(panel);
	document.addEventListener('keydown', onDocumentKeydown, true);
	document.addEventListener('pointerdown', onDocumentPointerDown, true);

	try {
		const infos = await getStoreInfos();
		const errors = await getModuleErrorLog();
		if (!panelOpen) return;

		const header = document.createElement('div');
		header.className = 'rsm-storageDashboard-header';
		const title = document.createElement('h2');
		title.id = PANEL_TITLE_ID;
		title.className = 'rsm-storageDashboard-title';
		title.textContent = 'Local data stores';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'rsm-storageDashboard-close';
		closeBtn.textContent = 'Close';
		closeBtn.addEventListener('click', () => closePanel({ restoreFocus: true }));
		header.append(title, closeBtn);

		const rows = infos.map(info => {
			const row = document.createElement('div');
			row.className = 'rsm-storageDashboard-row';

			const label = document.createElement('span');
			label.className = 'rsm-storageDashboard-label';
			label.textContent = formatCount(info);

			const purgeBtn = document.createElement('button');
			purgeBtn.type = 'button';
			purgeBtn.className = 'rsm-storageDashboard-purge';
			purgeBtn.textContent = 'Purge';
			purgeBtn.setAttribute('aria-label', `Purge the ${info.name} store`);

			// Purging drops the whole store and cannot be undone, so the button
			// arms first and only wipes on a deliberate second click. Inline,
			// not a dialog — same pattern the settings console uses for
			// discarding unsaved changes.
			let armed = false;
			let disarmTimer;
			const disarm = () => {
				armed = false;
				clearTimeout(disarmTimer);
				delete row.dataset.armed;
				purgeBtn.textContent = 'Purge';
				purgeBtn.setAttribute('aria-label', `Purge the ${info.name} store`);
			};

			purgeBtn.addEventListener('click', async () => {
				if (!armed) {
					armed = true;
					row.dataset.armed = '1';
					purgeBtn.textContent = 'Confirm purge';
					purgeBtn.setAttribute('aria-label', `Confirm purging the ${info.name} store — this cannot be undone`);
					disarmTimer = setTimeout(disarm, 4000);
					return;
				}
				clearTimeout(disarmTimer);
				delete row.dataset.armed;
				row.dataset.state = 'busy';
				purgeBtn.textContent = 'Purging…';
				purgeBtn.disabled = true;
				try {
					await clearStore(info.dbName, info.storeName, info.schemaVersion);
					label.textContent = `${info.name}: 0${info.cap ? ` / ${info.cap.toLocaleString()}` : ''}`;
					row.dataset.state = 'success';
					purgeBtn.textContent = 'Purged';
					purgeBtn.setAttribute('aria-label', `${info.name} store purged`);
				} catch (err) {
					console.error(`RES-Slim storageDashboard: could not purge ${info.name}`, err);
					row.dataset.state = 'error';
					purgeBtn.textContent = 'Retry';
					purgeBtn.setAttribute('aria-label', `Purging ${info.name} failed — retry`);
					purgeBtn.disabled = false;
					armed = true;
				}
			});

			row.append(label, purgeBtn);
			return row;
		});

		panel.replaceChildren(header, ...rows);

		if (infos.length) {
			const hint = document.createElement('p');
			hint.className = 'rsm-storageDashboard-hint';
			hint.textContent = 'Stored on this device only. Purging frees space and cannot be undone.';
			panel.append(hint);
		} else {
			const empty = document.createElement('div');
			empty.className = 'rsm-storageDashboard-empty';
			empty.setAttribute('role', 'status');
			empty.textContent = 'Nothing stored yet. Modules that keep local history — vote log, media manifest, user tags — will appear here once they save something.';
			panel.append(empty);
		}

		const errorsSection = document.createElement('section');
		errorsSection.className = 'rsm-storageDashboard-errors';
		const errorsTitle = document.createElement('h3');
		errorsTitle.className = 'rsm-storageDashboard-errors-title';
		errorsTitle.textContent = `Module errors (${errors.length})`;
		const errorsOutput = document.createElement('textarea');
		errorsOutput.className = 'rsm-storageDashboard-errors-output';
		errorsOutput.rows = 5;
		errorsOutput.readOnly = true;
		errorsOutput.spellcheck = false;
		errorsOutput.setAttribute('aria-label', 'Module error log');
		errorsOutput.placeholder = 'No module failures recorded.';
		errorsOutput.value = formatModuleErrorLog(errors);
		const errorsActions = document.createElement('div');
		errorsActions.className = 'rsm-storageDashboard-errors-actions';
		const clearErrors = document.createElement('button');
		clearErrors.type = 'button';
		clearErrors.className = 'rsm-storageDashboard-errors-clear';
		clearErrors.textContent = 'Clear log';
		clearErrors.disabled = errors.length === 0;
		clearErrors.addEventListener('click', async () => {
			clearErrors.disabled = true;
			try {
				await clearModuleErrorLog();
				errorsOutput.value = '';
				errorsOutput.placeholder = 'No module failures recorded.';
				errorsTitle.textContent = 'Module errors (0)';
			} catch (err) {
				console.error('RES-Slim storageDashboard: could not clear module error log', err);
				clearErrors.disabled = false;
			}
		});
		errorsActions.append(clearErrors);
		errorsSection.append(errorsTitle, errorsOutput, errorsActions);
		panel.append(errorsSection);

		// Keyboard users land inside the panel they just opened rather than
		// continuing from the trigger in the page behind it.
		closeBtn.focus({ preventScroll: true });
	} catch (err) {
		console.error('RES-Slim storageDashboard: could not read storage info', err);
		if (panelOpen) {
			setTrustedHTML(panel, '<div class="rsm-storageDashboard-empty is-error" role="alert">Couldn\'t read local storage. Reload the page and try again — if it keeps failing, your browser may be blocking IndexedDB for this site.</div>');
		}
	}
}
