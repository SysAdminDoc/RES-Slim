/* @flow */

import { Module } from '../core/module';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { getStoreInfos, clearStore, formatCount } from '../utils/storageDashboard';

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

function closePanel() {
	const existing = document.getElementById(PANEL_ID);
	if (existing) existing.remove();
	panelOpen = false;
	syncTriggerExpanded(false);
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
	setTrustedHTML(panel, '<div class="rsm-storageDashboard-loading" role="status">Loading storage info...</div>');
	document.body.append(panel);

	try {
		const infos = await getStoreInfos();
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
		closeBtn.addEventListener('click', closePanel);
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
			purgeBtn.setAttribute('aria-label', `Purge ${info.name} store`);
			purgeBtn.addEventListener('click', async () => {
				row.dataset.state = 'busy';
				purgeBtn.textContent = 'Purging...';
				purgeBtn.disabled = true;
				try {
					await clearStore(info.dbName, info.storeName, info.schemaVersion);
					label.textContent = `${info.name}: 0${info.cap ? ` / ${info.cap.toLocaleString()}` : ''}`;
					row.dataset.state = 'success';
					purgeBtn.textContent = 'Purged';
				} catch {
					row.dataset.state = 'error';
					purgeBtn.textContent = 'Failed';
					purgeBtn.disabled = false;
				}
			});

			row.append(label, purgeBtn);
			return row;
		});

		panel.replaceChildren(header, ...rows);

		if (!infos.length) {
			const empty = document.createElement('div');
			empty.className = 'rsm-storageDashboard-empty';
			empty.setAttribute('role', 'status');
			empty.textContent = 'No data stores in use.';
			panel.append(empty);
		}
	} catch {
		if (panelOpen) {
			setTrustedHTML(panel, '<div class="rsm-storageDashboard-empty is-error" role="alert">Failed to read storage info.</div>');
		}
	}
}
