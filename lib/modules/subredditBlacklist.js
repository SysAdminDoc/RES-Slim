/* @flow */
// RES-Slim: hide posts from a user-defined list of subreddits on /r/all and /r/popular.
// Minimal replacement for a sliver of the removed filterReddit module.
// Inspired by hpaolini/reddit-all-blacklist (MIT).

import { Module } from '../core/module';
import * as Options from '../core/options';
import { Thing, isCurrentSubreddit, watchForThings } from '../utils';
import { hideAndSilence } from '../utils/mediaSilence';
import { inspectListImport, mergeSubredditList, parseSubredditList } from '../utils/subredditBlacklist';

export const module: Module<{ [string]: any }> = new Module('subredditBlacklist');

module.moduleName = 'Subreddit blacklist';
module.category = 'browsingCategory';
module.description = 'Hides posts from listed subreddits when browsing /r/all or /r/popular. Case-insensitive. Separate multiple with commas.';
// Scoped to old reddit. With no include, no exclude and no asLongAs predicate this ran on
// every page the content script touches, including the extension's own options
// page — the same omission fixed one module at a time in v0.3.5 and v0.4.0.
module.include = ['r2'];
module.descriptionRaw = true;
module.options = {
	blacklist: {
		type: 'text',
		value: '',
		title: 'Blacklist',
		description: 'Comma-separated list of subreddit names to hide on /r/all and /r/popular.',
	},
	alsoOnFrontPage: {
		type: 'boolean',
		value: false,
		title: 'Also filter on front page',
		description: 'Apply the blacklist on your home feed as well.',
	},
	importList: {
		type: 'text',
		value: '',
		title: 'Import a list',
		description: 'Paste subreddits one per line or separated by commas. `pics`, `r/pics`, `/r/pics` and a full link all mean the same thing. Preview it first; nothing is written until you commit, and importing merges rather than replaces.',
	},
	importActions: {
		type: 'button',
		title: 'Blacklist data actions',
		description: 'Preview counts what the payload would add without writing anything. Undo restores the list exactly as it was before the last import.',
		values: [
			{ text: 'Preview import', callback: previewListImport },
			{ text: 'Import previewed list', callback: commitPreviewedListImport },
			{ text: 'Undo last import', callback: undoLastListImport },
		],
	},
	importRollback: {
		type: 'text',
		value: '',
		title: 'Pre-import list',
		description: 'The blacklist exactly as it was before the last import, kept so Undo has something to restore. Written by the import; there is no reason to edit it.',
	},
};

function parseList(): string[] {
	return parseSubredditList(module.options.blacklist.value).valid;
}

// Reads the control if the settings page is open, the staged value if the reader
// has typed without saving, and the stored value otherwise — the same order
// `userTagger` uses, because a preview of the saved value is a preview of the
// wrong thing.
function liveOptionValue(optionName: string): any {
	const control = document.getElementById(`subredditBlacklist-${optionName}`);
	if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return control.value;
	const staged = Options.stage.get(module.moduleID);
	return staged && staged[optionName] ? staged[optionName].value : module.options[optionName].value;
}

function setImportStatus(message: string, state?: 'error' | 'success'): void {
	const group = document.getElementById('subredditBlacklist-importActions');
	if (!(group instanceof HTMLElement)) return;
	let status = group.parentElement && group.parentElement.querySelector('.rsm-subredditBlacklist-import-status');
	if (!(status instanceof HTMLElement)) {
		status = document.createElement('p');
		status.className = 'rsm-subredditBlacklist-import-status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		group.after(status);
	}
	status.textContent = message;
	if (state) status.dataset.state = state;
	else delete status.dataset.state;
}

// What the last preview decided, so the commit writes that rather than whatever
// the field says by the time it is pressed.
type PendingListImport = {| raw: string, base: string, next: string, counts: {| valid: number, invalid: number, newEntries: number, duplicate: number |} |};
let pendingImport: ?PendingListImport = null;

function countText(counts: $PropertyType<PendingListImport, 'counts'>): string {
	return `${counts.valid} valid, ${counts.invalid} invalid, ${counts.newEntries} new, ${counts.duplicate} already listed`;
}

// Synchronous: it reads the fields and counts, and writes nothing. The console
// awaits whatever a button callback returns and catches a throw either way.
function previewListImport(): void {
	const raw = String(liveOptionValue('importList') || '');
	const base = String(liveOptionValue('blacklist') || '');
	const preview = inspectListImport(raw, base);
	const summary = countText(preview.counts);

	if (preview.error) {
		pendingImport = null;
		setImportStatus(`${summary}. ${preview.error}`, 'error');
		throw new Error(preview.error);
	}

	pendingImport = { raw, base, next: mergeSubredditList(base, preview.incoming), counts: preview.counts };
	const rejected = preview.invalid.length ? ` Ignoring ${preview.invalid.slice(0, 3).map(v => `"${v}"`).join(', ')}${preview.invalid.length > 3 ? ' and others' : ''}.` : '';
	setImportStatus(`${summary}.${rejected} Nothing has been written. Click Import previewed list to commit.`);
}

async function commitPreviewedListImport(): Promise<void> {
	if (!pendingImport) {
		setImportStatus('Preview the payload before importing it.', 'error');
		throw new Error('Preview the payload before importing it.');
	}

	const pending = pendingImport;
	// The same refusal `userTagger` makes: a preview describes one payload against
	// one list, and either can change while the reader looks at the counts.
	if (String(liveOptionValue('importList') || '') !== pending.raw || String(liveOptionValue('blacklist') || '') !== pending.base) {
		pendingImport = null;
		setImportStatus('The payload or the list changed after the preview. Preview again.', 'error');
		throw new Error('The import changed after preview. Preview it again before importing.');
	}

	// Rollback first. A merge cannot lose an entry, but the reader is still
	// allowed to change their mind, and an undo that depends on remembering what
	// the field said is not an undo.
	await Options.set(module, 'importRollback', pending.base);
	await Options.set(module, 'blacklist', pending.next);
	await Options.set(module, 'importList', '');

	for (const [name, value] of [['blacklist', pending.next], ['importList', ''], ['importRollback', pending.base]]) {
		module.options[name].value = value;
		Options.stage.add(module.moduleID, name, value);
		const input = document.getElementById(`subredditBlacklist-${name}`);
		if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = value;
	}

	pendingImport = null;
	setImportStatus(`Imported ${countText(pending.counts)}. The previous list was saved, so Undo can put it back.`, 'success');
}

async function undoLastListImport(): Promise<void> {
	const rollback = String(liveOptionValue('importRollback') || '');
	const current = String(liveOptionValue('blacklist') || '');
	if (rollback === current) {
		setImportStatus('There is nothing to undo: the list already matches the saved pre-import copy.', 'error');
		throw new Error('There is nothing to undo.');
	}

	await Options.set(module, 'blacklist', rollback);
	module.options.blacklist.value = rollback;
	Options.stage.add(module.moduleID, 'blacklist', rollback);
	const input = document.getElementById('subredditBlacklist-blacklist');
	if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = rollback;

	pendingImport = null;
	setImportStatus('The blacklist was restored to its pre-import state.', 'success');
}

function shouldRun(): boolean {
	if (isCurrentSubreddit('all') || isCurrentSubreddit('popular')) return true;
	if (module.options.alsoOnFrontPage.value && !isCurrentSubreddit()) return true;
	return false;
}

module.contentStart = () => {
	if (!shouldRun()) return;
	const list = parseList();
	if (!list.length) return;

	watchForThings(['post'], (thing: Thing) => {
		const sub = thing.getSubreddit();
		if (sub && list.includes(sub.toLowerCase())) {
			// Silenced as well as hidden: blacklisting a subreddit mid-playback
			// otherwise left its audio running.
			hideAndSilence(thing.element);
		}
	});
};
