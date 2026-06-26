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

module.go = () => {
	const header = document.querySelector('#header-bottom-right');
	if (!header) return;

	const sep = document.createTextNode(' | ');
	const trigger = document.createElement('a');
	trigger.id = TRIGGER_ID;
	trigger.href = 'javascript:void 0';
	trigger.textContent = 'storage';
	trigger.addEventListener('click', togglePanel);
	header.append(sep, trigger);
};

let panelOpen = false;

async function togglePanel(e: Event) {
	e.preventDefault();
	const existing = document.getElementById(PANEL_ID);
	if (existing) {
		existing.remove();
		panelOpen = false;
		return;
	}
	panelOpen = true;
	const panel = document.createElement('div');
	panel.id = PANEL_ID;
	panel.className = 'rsm-storageDashboard-panel';
	setTrustedHTML(panel, '<div class="rsm-storageDashboard-loading">Loading storage info...</div>');
	document.body.append(panel);

	try {
		const infos = await getStoreInfos();
		if (!panelOpen) return;

		const rows = infos.map(info => {
			const row = document.createElement('div');
			row.className = 'rsm-storageDashboard-row';

			const label = document.createElement('span');
			label.className = 'rsm-storageDashboard-label';
			label.textContent = formatCount(info);

			const purgeBtn = document.createElement('button');
			purgeBtn.type = 'button';
			purgeBtn.className = 'rsm-storageDashboard-purge';
			purgeBtn.textContent = 'purge';
			purgeBtn.addEventListener('click', async () => {
				purgeBtn.textContent = 'purging...';
				purgeBtn.disabled = true;
				try {
					await clearStore(info.dbName, info.storeName, info.schemaVersion);
					label.textContent = `${info.name}: 0${info.cap ? ` / ${info.cap.toLocaleString()}` : ''}`;
					purgeBtn.textContent = 'purged';
				} catch {
					purgeBtn.textContent = 'failed';
				}
			});

			row.append(label, purgeBtn);
			return row;
		});

		panel.innerHTML = '';
		const title = document.createElement('div');
		title.className = 'rsm-storageDashboard-title';
		title.textContent = 'Local Data Stores';
		panel.append(title, ...rows);

		if (!infos.length) {
			const empty = document.createElement('div');
			empty.className = 'rsm-storageDashboard-empty';
			empty.textContent = 'No data stores in use.';
			panel.append(empty);
		}
	} catch {
		if (panelOpen) {
			setTrustedHTML(panel, '<div class="rsm-storageDashboard-empty">Failed to read storage info.</div>');
		}
	}
}
