/* @flow */
// The offline home for everything this extension keeps about you.
//
// Saved content, user tags, the vote log and the media manifest were each
// browsable from their own panel injected into old Reddit, which meant you
// needed Reddit up, signed in, and on the old site to look at data that never
// left your machine. All four are now readable from the settings page, which is
// served from the extension's own origin and needs nothing else.
//
// Each set is described by an adapter: how to read it, how to search it, what a
// row says, what an export looks like, and how to put it back after a purge.
// Everything below is written once against that shape.

import { i18n } from '../environment';
import { clearRecords, readRecords, writeRecords } from '../environment/foreground/featureDb';
import * as Storage from '../environment/foreground/storage';
import { downloadText } from '../utils/downloadBlob';
import {
	SAVED_CONTENT_SCHEMA_VERSION,
	buildExport,
	filterSavedItems,
	normalizeSavedRecords,
	normalizeSavedUsername,
} from '../utils/savedBackup';
import type { SavedRecord } from '../utils/savedBackup';

type Row = {| title: string, meta: string |};

type DataSet = {|
	id: string,
	label: string,
	// Reads every record. The account filter is applied afterwards so the
	// account list itself can be built from the whole set.
	load: () => Promise<Array<any>>,
	accountOf: ?(record: any) => string,
	matches: (record: any, query: string) => boolean,
	row: (record: any) => Row,
	exportName: string,
	exportPayload: (records: Array<any>, account: string) => mixed,
	// Removes exactly the records handed to it, and `restore` puts those same
	// records back. A purge is never a whole-store wipe unless the whole store
	// is what is on screen.
	remove: (records: Array<any>) => Promise<void>,
	restore: (records: Array<any>) => Promise<void>,
|};

type TagRecord = {| username: string, tag: string, color: string, ignore: boolean |};

const tagStore = Storage.wrapFeature('userTagger', 'RESmodules.userTagger.tags', ({}: { [string]: any }));

const text = (value: mixed): string => (typeof value === 'string' ? value : '');

function dateLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	return new Date(seconds).toISOString().slice(0, 10);
}

async function loadTagRecords(): Promise<TagRecord[]> {
	const stored = await tagStore.get() || {};
	return Object.keys(stored)
		.map(username => {
			const tag = stored[username] || {};
			return {
				username,
				tag: text(tag.tag),
				color: text(tag.color),
				ignore: tag.ignore === true,
			};
		})
		.sort((a, b) => a.username.localeCompare(b.username));
}

async function writeTagRecords(records: TagRecord[], present: boolean): Promise<void> {
	const stored = { ...(await tagStore.get() || {}) };
	for (const record of records) {
		if (present) stored[record.username] = { tag: record.tag, color: record.color, ignore: record.ignore };
		else delete stored[record.username];
	}
	await tagStore.set(stored);
}

const SETS: DataSet[] = [
	{
		id: 'savedContent',
		label: 'Saved content',
		load: () => readRecords('savedContent'),
		accountOf: record => text(record.username),
		matches: (record, query) => filterSavedItems([record], record.username, query).length > 0,
		row: record => ({
			title: text(record.title) || text(record.body).slice(0, 120) || record.fullname,
			meta: [`r/${text(record.subreddit)}`, `u/${text(record.author)}`, dateLabel(record.createdUtc * 1000), (record.tags || []).join(', ')]
				.filter(Boolean).join(' · '),
		}),
		exportName: 'res-slim-saved-content',
		exportPayload: (records, account) => buildExport(account, ((records: any): SavedRecord[])),
		remove: records => writeRecords('savedContent', [], records.map(record => [record.username, record.fullname])),
		restore: records => writeRecords('savedContent', records),
	},
	{
		id: 'userTags',
		label: 'User tags',
		load: loadTagRecords,
		accountOf: null,
		matches: (record, query) => `${record.username} ${record.tag}`.toLowerCase().includes(query),
		row: record => ({
			title: `u/${record.username}`,
			meta: [record.tag, record.ignore ? 'ignored' : '', record.color].filter(Boolean).join(' · '),
		}),
		exportName: 'res-slim-user-tags',
		exportPayload: records => {
			const map = {};
			for (const record of ((records: any): TagRecord[])) {
				map[record.username] = { tag: record.tag, color: record.color, ignore: record.ignore };
			}
			return map;
		},
		remove: records => writeTagRecords(((records: any): TagRecord[]), false),
		restore: records => writeTagRecords(((records: any): TagRecord[]), true),
	},
	{
		id: 'voteHistory',
		label: 'Vote history',
		load: () => readRecords('voteHistory'),
		accountOf: null,
		matches: (record, query) => `${text(record.snippet)} ${text(record.subreddit)} ${text(record.author)}`.toLowerCase().includes(query),
		row: record => ({
			title: text(record.snippet).slice(0, 120) || text(record.fullname),
			meta: [text(record.direction), `r/${text(record.subreddit)}`, `u/${text(record.author)}`, dateLabel(record.timestamp)]
				.filter(Boolean).join(' · '),
		}),
		exportName: 'res-slim-vote-history',
		exportPayload: records => ({ schemaVersion: 1, exportedAt: Date.now(), records }),
		remove: records => writeRecords('voteHistory', [], records.map(record => record.id)),
		restore: records => writeRecords('voteHistory', records),
	},
	{
		id: 'mediaManifest',
		label: 'Media history',
		load: () => readRecords('mediaManifest'),
		accountOf: null,
		matches: (record, query) => `${text(record.url)} ${text(record.filename)} ${text(record.subreddit)}`.toLowerCase().includes(query),
		row: record => ({
			title: text(record.filename) || text(record.url),
			meta: [text(record.source), `r/${text(record.subreddit)}`, dateLabel(record.timestamp)].filter(Boolean).join(' · '),
		}),
		exportName: 'res-slim-media-history',
		exportPayload: records => ({ schemaVersion: 1, exportedAt: Date.now(), entries: records }),
		remove: records => writeRecords('mediaManifest', [], records.map(record => record.id)),
		restore: records => writeRecords('mediaManifest', records),
	},
];

export const ALL_ACCOUNTS = '__all';

// A purge keeps its records here so the Undo button has something to put back,
// and mirrors them into extension storage so a reload or a crash between the
// purge and the undo does not turn a mistake into a permanent one.
type RestorePoint = {| set: string, account: string, createdAt: number, records: Array<any> |};
const restoreStore = Storage.wrap('RESmodules.dataWorkspace.restorePoint', (null: ?RestorePoint));

// How many rows the table draws. Reading 50,000 vote records is one message;
// building 50,000 rows is a locked-up page, and nobody scrolls that far.
export const PAGE_SIZE = 200;

export function getDataSet(id: mixed): DataSet {
	const found = SETS.find(set => set.id === id);
	if (!found) throw new Error(`Unknown data set: ${String(id)}`);
	return found;
}

export function listDataSets(): Array<{| id: string, label: string |}> {
	return SETS.map(({ id, label }) => ({ id, label }));
}

// The visible rows for a set, a query and an account. Pure, so the filtering
// rules are testable without a page.
export function selectRecords(setId: string, records: Array<any>, query: string, account: string): Array<any> {
	const set = getDataSet(setId);
	const trimmed = query.trim().toLowerCase();
	return records.filter(record => {
		if (set.accountOf && account !== ALL_ACCOUNTS && set.accountOf(record) !== account) return false;
		return !trimmed || set.matches(record, trimmed);
	});
}

export function listAccounts(setId: string, records: Array<any>): string[] {
	const set = getDataSet(setId);
	if (!set.accountOf) return [];
	const accounts = new Set(records.map(record => set.accountOf && set.accountOf(record)).filter(Boolean));
	return [...accounts].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Saved-content import
//
// The same contract the user-tag import already keeps: validate a versioned
// envelope, say what would change before anything is written, then commit only
// the payload that was previewed and keep a rollback of what was there before.

export type SavedImportPreview = {|
	error: ?string,
	incoming: SavedRecord[],
	counts: {| valid: number, invalid: number, newRecords: number, conflicting: number |},
|};

export function inspectSavedImport(raw: mixed, existing: $ReadOnlyArray<SavedRecord>): SavedImportPreview {
	const empty = { valid: 0, invalid: 0, newRecords: 0, conflicting: 0 };
	if (typeof raw !== 'string' || !raw.trim()) {
		return { error: 'Paste an exported saved-content file first.', incoming: [], counts: empty };
	}
	let parsed;
	try { parsed = JSON.parse(raw); } catch (error) {
		return { error: 'That is not valid JSON.', incoming: [], counts: empty };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { error: 'A saved-content export is an object with a schemaVersion and an items list.', incoming: [], counts: empty };
	}
	const version = (parsed: any).schemaVersion;
	if (version !== SAVED_CONTENT_SCHEMA_VERSION) {
		return {
			error: `This export declares schema ${String(version)}; this version reads schema ${SAVED_CONTENT_SCHEMA_VERSION}.`,
			incoming: [],
			counts: empty,
		};
	}
	const account = normalizeSavedUsername((parsed: any).username);
	if (!account) {
		return { error: 'The export does not name the account it belongs to.', incoming: [], counts: empty };
	}
	const rawItems = Array.isArray((parsed: any).items) ? (parsed: any).items : [];
	const incoming = normalizeSavedRecords(rawItems, account).filter(record => record.username === account);
	const known = new Set(existing.filter(record => record.username === account).map(record => record.fullname));
	const conflicting = incoming.filter(record => known.has(record.fullname)).length;
	return {
		error: incoming.length ? null : 'No valid saved-content records in that file.',
		incoming,
		counts: {
			valid: incoming.length,
			invalid: rawItems.length - incoming.length,
			newRecords: incoming.length - conflicting,
			conflicting,
		},
	};
}

// ---------------------------------------------------------------------------
// The panel

type PanelState = {|
	setId: string,
	account: string,
	query: string,
	records: Array<any>,
	visible: Array<any>,
	pending: ?SavedImportPreview,
	pendingRaw: string,
|};

let container: ?HTMLElement = null;
const state: PanelState = { setId: 'savedContent', account: ALL_ACCOUNTS, query: '', records: [], visible: [], pending: null, pendingRaw: '' };

const find = (selector: string): ?HTMLElement => {
	const found = container && container.querySelector(selector);
	return found instanceof HTMLElement ? found : null;
};

function setStatus(message: string, tone: 'info' | 'error' | 'success' = 'info') {
	const status = find('#RESDataWorkspaceStatus');
	if (!status) return;
	status.textContent = message;
	status.dataset.tone = tone;
}

function renderRows() {
	const list = find('#RESDataWorkspaceRows');
	const count = find('#RESDataWorkspaceCount');
	if (!list) return;
	const set = getDataSet(state.setId);
	const shown = state.visible.slice(0, PAGE_SIZE);

	if (count) {
		count.textContent = state.visible.length === state.records.length ?
			i18n('dataWorkspaceCount', state.visible.length) :
			i18n('dataWorkspaceCountFiltered', state.visible.length, state.records.length);
	}

	list.replaceChildren(...shown.map(record => {
		const { title, meta } = set.row(record);
		const item = document.createElement('li');
		item.className = 'dataWorkspaceRow';
		const strong = document.createElement('span');
		strong.className = 'dataWorkspaceRowTitle';
		strong.textContent = title;
		const small = document.createElement('span');
		small.className = 'dataWorkspaceRowMeta';
		small.textContent = meta;
		item.append(strong, small);
		return item;
	}));

	const more = find('#RESDataWorkspaceMore');
	if (more) {
		more.hidden = state.visible.length <= PAGE_SIZE;
		more.textContent = i18n('dataWorkspaceMore', state.visible.length - PAGE_SIZE);
	}

	const empty = find('#RESDataWorkspaceEmpty');
	if (empty) empty.hidden = state.visible.length > 0;
}

function renderAccounts() {
	const picker = find('#RESDataWorkspaceAccount');
	if (!(picker instanceof HTMLSelectElement)) return;
	const accounts = listAccounts(state.setId, state.records);
	picker.hidden = accounts.length === 0;
	const label = find('#RESDataWorkspaceAccountLabel');
	if (label) label.hidden = accounts.length === 0;
	if (!accounts.length) {
		state.account = ALL_ACCOUNTS;
		return;
	}
	if (!accounts.includes(state.account)) state.account = ALL_ACCOUNTS;
	picker.replaceChildren(...[{ value: ALL_ACCOUNTS, label: i18n('dataWorkspaceAllAccounts') }, ...accounts.map(name => ({ value: name, label: `u/${name}` }))]
		.map(({ value, label: optionLabel }) => {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = optionLabel;
			option.selected = value === state.account;
			return option;
		}));
}

function applyFilters() {
	state.visible = selectRecords(state.setId, state.records, state.query, state.account);
	renderRows();
}

async function reload() {
	const set = getDataSet(state.setId);
	setStatus(i18n('dataWorkspaceReading', set.label));
	try {
		state.records = await set.load();
	} catch (error) {
		state.records = [];
		setStatus(i18n('dataWorkspaceReadFailed', set.label), 'error');
		applyFilters();
		return;
	}
	renderAccounts();
	applyFilters();
	setStatus('');
	syncImportVisibility();
}

function syncImportVisibility() {
	const importPanel = find('#RESDataWorkspaceImport');
	if (importPanel) importPanel.hidden = state.setId !== 'savedContent';
}

function exportVisible() {
	const set = getDataSet(state.setId);
	const account = state.account === ALL_ACCOUNTS ? '' : state.account;
	const payload = set.exportPayload(state.visible, account);
	const stamp = new Date().toISOString().slice(0, 10);
	downloadText(JSON.stringify(payload, null, 2), `${set.exportName}-${account || 'all'}-${stamp}.json`, 'application/json');
	setStatus(i18n('dataWorkspaceExported', state.visible.length), 'success');
}

function syncUndo(point: ?RestorePoint) {
	const undo = find('#RESDataWorkspaceUndo');
	if (!(undo instanceof HTMLButtonElement)) return;
	undo.hidden = !point;
	if (point) undo.textContent = i18n('dataWorkspaceUndo', point.records.length);
}

async function purgeVisible() {
	const set = getDataSet(state.setId);
	const purging = state.visible;
	if (!purging.length) return;
	const point: RestorePoint = { set: set.id, account: state.account, createdAt: Date.now(), records: purging };
	try {
		// The restore point is written first. A purge that succeeds while the
		// restore point is still unwritten is the one case that cannot be undone.
		await restoreStore.set(point);
		// Removing every record of a set is the same operation as clearing it,
		// and one message beats fifty thousand keys.
		if (purging.length === state.records.length && set.id !== 'userTags') await clearRecords((set.id: any));
		else await set.remove(purging);
	} catch (error) {
		setStatus(i18n('dataWorkspacePurgeFailed', set.label), 'error');
		return;
	}
	syncUndo(point);
	await reload();
	setStatus(i18n('dataWorkspacePurged', purging.length, set.label), 'success');
}

async function undoPurge() {
	const point = await restoreStore.get();
	if (!point) return;
	const set = getDataSet(point.set);
	try {
		await set.restore(point.records);
	} catch (error) {
		setStatus(i18n('dataWorkspaceRestoreFailed', set.label), 'error');
		return;
	}
	await restoreStore.set(null);
	syncUndo(null);
	state.setId = point.set;
	await reload();
	setStatus(i18n('dataWorkspaceRestored', point.records.length, set.label), 'success');
}

async function previewImport() {
	const input = find('#RESDataWorkspaceImportPayload');
	if (!(input instanceof HTMLTextAreaElement)) return;
	const records = ((await getDataSet('savedContent').load(): any): SavedRecord[]);
	const preview = inspectSavedImport(input.value, records);
	if (preview.error) {
		state.pending = null;
		state.pendingRaw = '';
		setStatus(preview.error, 'error');
		return;
	}
	state.pending = preview;
	state.pendingRaw = input.value;
	setStatus(i18n(
		'dataWorkspaceImportPreview',
		preview.counts.valid,
		preview.counts.invalid,
		preview.counts.newRecords,
		preview.counts.conflicting,
	));
}

async function commitImport() {
	const input = find('#RESDataWorkspaceImportPayload');
	const pending = state.pending;
	if (!pending || !(input instanceof HTMLTextAreaElement)) {
		setStatus(i18n('dataWorkspaceImportNeedsPreview'), 'error');
		return;
	}
	if (input.value !== state.pendingRaw) {
		state.pending = null;
		setStatus(i18n('dataWorkspaceImportChanged'), 'error');
		return;
	}
	const before = ((await getDataSet('savedContent').load(): any): SavedRecord[]);
	const account = pending.incoming[0].username;
	const replaced = before.filter(record => record.username === account &&
		pending.incoming.some(item => item.fullname === record.fullname));
	try {
		await restoreStore.set({ set: 'savedContent', account, createdAt: Date.now(), records: replaced });
		await writeRecords('savedContent', pending.incoming);
	} catch (error) {
		setStatus(i18n('dataWorkspaceImportFailed'), 'error');
		return;
	}
	// The write is verified before the payload is cleared, so a partial commit
	// leaves the text in the box to try again with.
	const after = ((await getDataSet('savedContent').load(): any): SavedRecord[]);
	const landed = pending.incoming.filter(item =>
		after.some(record => record.username === item.username && record.fullname === item.fullname)).length;
	if (landed !== pending.incoming.length) {
		setStatus(i18n('dataWorkspaceImportPartial', landed, pending.incoming.length), 'error');
		return;
	}
	input.value = '';
	state.pending = null;
	state.pendingRaw = '';
	state.setId = 'savedContent';
	state.account = account;
	await reload();
	setStatus(i18n('dataWorkspaceImported', landed, account), 'success');
}

let armedPurge = false;
let armedTimer;

function disarmPurge() {
	armedPurge = false;
	clearTimeout(armedTimer);
	const purge = find('#RESDataWorkspacePurge');
	if (purge instanceof HTMLButtonElement) {
		purge.textContent = i18n('dataWorkspacePurge');
		delete purge.dataset.armed;
	}
}

export function wire(root: HTMLElement) {
	container = root;
	const picker = find('#RESDataWorkspaceSet');
	if (picker instanceof HTMLSelectElement) {
		picker.replaceChildren(...listDataSets().map(({ id, label }) => {
			const option = document.createElement('option');
			option.value = id;
			option.textContent = label;
			option.selected = id === state.setId;
			return option;
		}));
		picker.addEventListener('change', () => {
			state.setId = picker.value;
			state.account = ALL_ACCOUNTS;
			disarmPurge();
			reload();
		});
	}

	const account = find('#RESDataWorkspaceAccount');
	if (account instanceof HTMLSelectElement) {
		account.addEventListener('change', () => { state.account = account.value; disarmPurge(); applyFilters(); });
	}

	const search = find('#RESDataWorkspaceSearch');
	if (search instanceof HTMLInputElement) {
		search.addEventListener('input', () => { state.query = search.value; disarmPurge(); applyFilters(); });
	}

	const exportButton = find('#RESDataWorkspaceExport');
	if (exportButton instanceof HTMLButtonElement) exportButton.addEventListener('click', () => exportVisible());

	const purge = find('#RESDataWorkspacePurge');
	if (purge instanceof HTMLButtonElement) {
		purge.addEventListener('click', () => {
			if (!armedPurge) {
				armedPurge = true;
				purge.dataset.armed = '1';
				purge.textContent = i18n('dataWorkspacePurgeConfirm', state.visible.length);
				armedTimer = setTimeout(disarmPurge, 5000);
				return;
			}
			disarmPurge();
			purgeVisible();
		});
	}

	const undo = find('#RESDataWorkspaceUndo');
	if (undo instanceof HTMLButtonElement) undo.addEventListener('click', () => { undoPurge(); });

	const preview = find('#RESDataWorkspaceImportPreview');
	if (preview instanceof HTMLButtonElement) preview.addEventListener('click', () => { previewImport(); });
	const commit = find('#RESDataWorkspaceImportCommit');
	if (commit instanceof HTMLButtonElement) commit.addEventListener('click', () => { commitImport(); });
}

let opened = false;

export function open() {
	if (!container) return;
	syncImportVisibility();
	restoreStore.get().then(syncUndo, () => {});
	// Reading four data sets on every tab switch would be four round trips for
	// data that has not changed; the first open is what loads them.
	if (opened) return;
	opened = true;
	reload();
}

export function refresh() {
	opened = false;
	open();
}
