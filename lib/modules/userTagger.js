/* @flow */
// RES-Slim: local user tagger. Click the [+] next to any username to tag it
// with a free-text label, a colour, and/or an ignore flag. All state lives
// in browser storage; nothing is sent off-host.
//
// Replaces the upstream RES `userTagger` cloud-sync surface (which was
// stripped in v0.1.0) with a local-only, JSON-importable equivalent.

import { Module } from '../core/module';
import * as Options from '../core/options';
import { Thing, watchForThings } from '../utils';
import { Storage, canPersistFeatureData } from '../environment';
import {
	buildTagImportMap,
	commitTagImport,
	inspectTagImport,
	normalizeTag,
	normalizeTagMap,
	normalizeUsername,
	sanitizeColor,
	sanitizeTagText,
	stringifyTags,
	tagBadgeText,
} from '../utils/userTags';
import type { TagImportConflictMode, UserTag, UserTagMap } from '../utils/userTags';

export const module: Module<{ [string]: any }> = new Module('userTagger');

module.moduleName = 'User tagger';
module.category = 'usersCategory';
module.description = 'Tag users with a label, a color, and/or an ignore flag. Tags are stored locally in ordinary windows; private-window edits last only for the page. Imports are previewed before one atomic commit.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.disabledByDefault = true;
module.keywords = ['user', 'tag', 'ignore', 'mute', 'label', 'colour'];

module.options = {
	showTagBadges: {
		type: 'boolean',
		value: true,
		title: 'Show tag badges',
		description: 'Render the tag label next to tagged usernames.',
	},
	colorizeUsername: {
		type: 'boolean',
		value: true,
		title: 'Colorize tagged usernames',
		description: 'Apply the saved color to the username itself, not just the badge.',
	},
	hideIgnored: {
		type: 'boolean',
		value: true,
		title: 'Hide ignored users',
		description: 'Posts and comments by users you have flagged as ignored are removed from the listing.',
	},
	defaultBadgeColor: {
		type: 'color',
		value: '#5b8def',
		title: 'Default badge color',
		description: 'Color used when a tag has no per-user color set.',
	},
	importJson: {
		type: 'text',
		value: '',
		title: 'Import JSON',
		description: 'Paste a JSON object of { "username": { "tag": "...", "color": "#...", "ignore": false } }. Preview it below before importing. The payload is cleared only after a verified commit.',
	},
	importConflicts: {
		type: 'enum',
		value: 'keep',
		values: [
			{ name: 'Keep existing tags', value: 'keep' },
			{ name: 'Replace existing tags', value: 'replace' },
		],
		title: 'Import conflicts',
		description: 'Existing tags win by default. Choose replacement only when the imported record should overwrite a matching username.',
	},
	importActions: {
		type: 'button',
		title: 'Tag data actions',
		description: 'Preview validates every record without writing. Import accepts only the exact payload, conflict choice, and stored map that were previewed.',
		values: [
			{ text: 'Preview import', callback: previewTagImport },
			{ text: 'Import previewed tags', callback: commitPreviewedTagImport },
			{ text: 'Export committed tags', callback: exportCommittedTags },
		],
	},
};

const tagStore = Storage.wrapFeatureBlob('userTagger', 'RESmodules.userTagger.tags', (): UserTag | null => null);
const tagMapStore = Storage.wrapFeature('userTagger', 'RESmodules.userTagger.tags', ({}: UserTagMap));
type TagRollback = {| createdAt: number, tags: UserTagMap |};
const rollbackStore = Storage.wrapFeature('userTagger', 'RESmodules.userTagger.tags.rollback', (null: ?TagRollback));

// Username -> Set of author anchor elements currently rendered for that user.
const authorIndex: Map<string, Set<HTMLElement>> = new Map();
// Username -> in-memory tag cache so we don't await storage on every annotation.
const cache: UserTagMap = {};

const POPOVER_CLASS = 'rsm-userTagger-popover';
const BADGE_CLASS = 'rsm-userTagger-badge';
const BUTTON_CLASS = 'rsm-userTagger-btn';
const HOST_CLASS = 'rsm-userTagger-host';
const COLORIZE_ATTR = 'data-rsm-user-color';

// Single active popover state. The previous implementation attached a fresh
// outside-click listener to `document` on every open, which leaked listeners
// when the user opened a new popover without first closing the old one.
let activePopover: ?{| element: HTMLElement, cleanup: () => void, trigger: ?HTMLButtonElement |} = null;
let popoverSeq = 0;
type PendingTagImport = {|
	raw: string,
	conflictMode: TagImportConflictMode,
	baseSignature: string,
	next: UserTagMap,
	counts: {|
		valid: number,
		invalid: number,
		newRecords: number,
		conflicting: number,
	|},
|};
let pendingTagImport: ?PendingTagImport = null;

function trackAuthor(username: string, el: HTMLElement): void {
	let set = authorIndex.get(username);
	if (!set) {
		set = new Set();
		authorIndex.set(username, set);
	}
	set.add(el);
}

function tagThingForUser(username: string): void {
	const tag = cache[username];
	const hideIgnored = module.options.hideIgnored.value !== false;
	const set = authorIndex.get(username);
	if (!set) return;
	for (const authorEl of set) {
		if (!authorEl.isConnected) {
			set.delete(authorEl);
			continue;
		}
		renderForAuthor(authorEl, tag);
		// Apply / remove ignore at thing level.
		const thing = authorEl.closest('.thing');
		if (thing instanceof HTMLElement) {
			if (hideIgnored && tag && tag.ignore) {
				thing.dataset.rsmIgnored = '1';
				thing.style.display = 'none';
			} else if (thing.dataset.rsmIgnored === '1') {
				delete thing.dataset.rsmIgnored;
				thing.style.display = '';
			}
		}
	}
	if (!set.size) authorIndex.delete(username);
}

function renderForAuthor(authorEl: HTMLElement, tag: ?UserTag): void {
	const host = authorEl.parentNode;
	if (!(host instanceof HTMLElement)) return;
	host.classList.add(HOST_CLASS);

	// Apply username colour.
	const colorizeOn = module.options.colorizeUsername.value !== false;
	if (tag && tag.color && colorizeOn) {
		authorEl.style.color = tag.color;
		authorEl.setAttribute(COLORIZE_ATTR, '1');
	} else if (authorEl.getAttribute(COLORIZE_ATTR) === '1') {
		authorEl.style.color = '';
		authorEl.removeAttribute(COLORIZE_ATTR);
	}

	// Render / refresh badge.
	let badge = host.querySelector(`:scope > .${BADGE_CLASS}`);
	const showBadgesOn = module.options.showTagBadges.value !== false;
	const badgeText = tag ? tagBadgeText(tag) : '';
	if (tag && (badgeText || tag.color) && showBadgesOn) {
		if (!(badge instanceof HTMLElement)) {
			badge = document.createElement('span');
			badge.className = BADGE_CLASS;
			badge.setAttribute('role', 'note');
			authorEl.after(badge);
		}
		const badgeEl: HTMLElement = (badge: any);
		const fillRaw = tag.color || (module.options.defaultBadgeColor.value: any) || '#5b8def';
		const fill = sanitizeColor(fillRaw) || '#5b8def';
		badgeEl.style.background = fill;
		badgeEl.style.color = pickContrastingForeground(fill);
		badgeEl.style.borderColor = fill;
		badgeEl.textContent = badgeText || '\u00a0';
		badgeEl.title = badgeText ? `Tag: ${badgeText}` : 'Tagged user';
		badgeEl.toggleAttribute('data-empty', !badgeText);
	} else if (badge instanceof HTMLElement) {
		badge.remove();
	}
}

function pickContrastingForeground(hex: string): string {
	// Quick YIQ contrast pick — same trick the RES legacy user tagger used.
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) return '#fff';
	const num = parseInt(m[1], 16);
	const r = (num >> 16) & 0xff;
	const g = (num >> 8) & 0xff;
	const b = num & 0xff;
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 150 ? '#111' : '#fff';
}

function findAuthorAnchors(root: HTMLElement): HTMLAnchorElement[] {
	const out: HTMLAnchorElement[] = [];
	// `.author` covers both post taglines and comment taglines.
	const anchors = root.querySelectorAll('a.author');
	for (const a of Array.from(anchors)) {
		if (a instanceof HTMLAnchorElement) out.push(a);
	}
	return out;
}

function usernameFromAuthor(el: HTMLAnchorElement): string {
	// Prefer the data-author on the parent .thing for the post/comment owner.
	const thing = el.closest('.thing');
	if (thing instanceof HTMLElement) {
		const u = thing.getAttribute('data-author');
		if (u) return normalizeUsername(u);
	}
	// Otherwise fall back to the href.
	const m = /\/user\/([^/]+)/.exec(el.getAttribute('href') || '');
	if (m) return normalizeUsername(decodeURIComponent(m[1]));
	return normalizeUsername(el.textContent || '');
}

async function persistTag(username: string, tag: UserTag | null): Promise<void> {
	if (!username) return;
	if (tag) {
		await tagStore.set(username, tag);
		cache[username] = tag;
	} else {
		await tagStore.delete(username);
		delete cache[username];
	}
	tagThingForUser(username);
}

function closeActivePopover(): void {
	if (!activePopover) return;
	const { cleanup, element, trigger } = activePopover;
	activePopover = null;
	cleanup();
	if (element.isConnected) element.remove();
	if (trigger instanceof HTMLButtonElement) {
		trigger.setAttribute('aria-expanded', 'false');
		trigger.removeAttribute('aria-controls');
		if (trigger.isConnected) trigger.focus();
	}
}

// The popover lives inside the tagline so it stays anchored when the .thing
// re-renders, but reddit gives `.entry` `overflow: hidden`. An absolutely
// positioned child is clipped by that, and the entry is shorter than the
// popover — on a post tagline the Save, Clear and Cancel buttons fell outside
// the clip and could be neither seen nor clicked.
//
// `position: fixed` is resolved against the viewport, so `overflow: hidden` on
// an ancestor does not clip it. Coordinates therefore have to be viewport
// coordinates, computed from the trigger.
function placePopover(pop: HTMLElement, anchor: ?HTMLElement): void {
	pop.classList.remove('is-flipped', 'is-above');
	const pad = 12;
	const anchorRect = (anchor && anchor.isConnected ? anchor : pop).getBoundingClientRect();
	const { offsetWidth: width, offsetHeight: height } = pop;

	let left = anchorRect.left;
	if (left + width > window.innerWidth - pad) {
		left = Math.max(pad, window.innerWidth - pad - width);
		pop.classList.add('is-flipped');
	}

	let top = anchorRect.bottom + 6;
	if (top + height > window.innerHeight - pad) {
		const above = anchorRect.top - 6 - height;
		// Only flip up when there is genuinely room; otherwise clamp so the
		// actions stay on screen rather than going off the top edge.
		top = above >= pad ? above : Math.max(pad, window.innerHeight - pad - height);
		pop.classList.add('is-above');
	}

	pop.style.left = `${Math.round(left)}px`;
	pop.style.top = `${Math.round(top)}px`;
}

function setPopoverBusy(pop: HTMLElement, busy: boolean, message: string, state?: 'saved' | 'error'): void {
	pop.setAttribute('aria-busy', busy ? 'true' : 'false');
	const status = pop.querySelector(`.${POPOVER_CLASS}-status`);
	if (status instanceof HTMLElement) {
		status.textContent = message;
		// Outcome is carried by colour as well as wording, and cleared on the
		// next transition so a stale "saved" tint never outlives its message.
		if (state) status.dataset.state = state;
		else delete status.dataset.state;
	}
	for (const control of pop.querySelectorAll('button, input')) {
		if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
			control.disabled = busy;
		}
	}
}

function openPopover(anchorEl: HTMLAnchorElement, username: string, triggerBtn: HTMLButtonElement): void {
	// Tear down any previously-open popover before opening a new one. The
	// outside-click + Esc listeners from the prior popover are detached here.
	closeActivePopover();

	const current: UserTag = cache[username] || ({ tag: '', color: '', ignore: false, ts: 0 }: any);
	const dialogId = `${POPOVER_CLASS}-${++popoverSeq}`;
	const titleId = `${dialogId}-title`;
	const statusId = `${dialogId}-status`;

	const pop = document.createElement('div');
	pop.className = POPOVER_CLASS;
	pop.setAttribute('role', 'dialog');
	pop.setAttribute('aria-labelledby', titleId);
	pop.setAttribute('aria-describedby', statusId);
	pop.setAttribute('aria-busy', 'false');

	const header = document.createElement('div');
	header.className = `${POPOVER_CLASS}-header`;
	const title = document.createElement('h3');
	title.id = titleId;
	title.className = `${POPOVER_CLASS}-title`;
	title.textContent = `u/${username}`;
	const subtitle = document.createElement('p');
	subtitle.className = `${POPOVER_CLASS}-subtitle`;
	subtitle.textContent = 'Local tag';
	header.append(title, subtitle);
	pop.append(header);

	const row1 = document.createElement('label');
	row1.className = `${POPOVER_CLASS}-row`;
	const tagLabel = document.createElement('span');
	tagLabel.textContent = 'Label';
	const tagInput = document.createElement('input');
	tagInput.type = 'text';
	tagInput.value = current.tag || '';
	tagInput.placeholder = 'trusted, noisy, mod, seller…';
	tagInput.maxLength = 120;
	tagInput.className = `${POPOVER_CLASS}-tag`;
	row1.append(tagLabel, tagInput);
	pop.append(row1);

	const row2 = document.createElement('label');
	row2.className = `${POPOVER_CLASS}-row`;
	const colorLabel = document.createElement('span');
	colorLabel.textContent = 'Colour';
	const colorInput = document.createElement('input');
	colorInput.type = 'color';
	colorInput.value = current.color || (module.options.defaultBadgeColor.value: any) || '#5b8def';
	colorInput.className = `${POPOVER_CLASS}-color`;
	row2.append(colorLabel, colorInput);
	pop.append(row2);

	const row3 = document.createElement('label');
	row3.className = `${POPOVER_CLASS}-row ${POPOVER_CLASS}-checkrow`;
	const ignoreInput = document.createElement('input');
	ignoreInput.type = 'checkbox';
	ignoreInput.checked = !!current.ignore;
	ignoreInput.className = `${POPOVER_CLASS}-ignore`;
	const ignoreText = document.createElement('span');
	ignoreText.textContent = 'Hide this user\'s posts and comments';
	row3.append(ignoreInput, ignoreText);
	pop.append(row3);

	const status = document.createElement('p');
	status.id = statusId;
	status.className = `${POPOVER_CLASS}-status`;
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.textContent = 'Changes stay on this browser.';
	pop.append(status);

	const actions = document.createElement('div');
	actions.className = `${POPOVER_CLASS}-actions`;
	const saveBtn = document.createElement('button');
	saveBtn.type = 'button';
	saveBtn.textContent = 'Save';
	saveBtn.className = `${POPOVER_CLASS}-save`;
	const clearBtn = document.createElement('button');
	clearBtn.type = 'button';
	clearBtn.textContent = 'Clear';
	clearBtn.className = `${POPOVER_CLASS}-clear`;
	const cancelBtn = document.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.textContent = 'Cancel';
	cancelBtn.className = `${POPOVER_CLASS}-cancel`;
	actions.append(saveBtn, clearBtn, cancelBtn);
	pop.append(actions);

	const outsideClick = (e: MouseEvent) => {
		if (!(e.target instanceof Node)) return;
		if (!pop.contains(e.target)) closeActivePopover();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeActivePopover();
		}
	};
	// Fixed positioning means scroll moves the page out from under the popover,
	// so it has to be re-anchored to the trigger on both scroll and resize.
	const onResize = () => { if (pop.isConnected) placePopover(pop, triggerBtn); };
	const cleanup = () => {
		document.removeEventListener('click', outsideClick, true);
		document.removeEventListener('keydown', onKey, true);
		window.removeEventListener('resize', onResize, true);
		window.removeEventListener('scroll', onResize, true);
	};

	saveBtn.addEventListener('click', async () => {
		const next = normalizeTag({
			tag: sanitizeTagText(tagInput.value),
			color: sanitizeColor(colorInput.value),
			ignore: ignoreInput.checked,
			ts: Date.now(),
		});
		setPopoverBusy(pop, true, 'Saving tag…');
		try {
			await persistTag(username, next);
			closeActivePopover();
		} catch (e) {
			console.error('RES-Slim userTagger: could not save tag', e);
			setPopoverBusy(pop, false, 'Couldn\'t save. The tag is still only in this box, so try again.', 'error');
		}
	});
	clearBtn.addEventListener('click', async () => {
		setPopoverBusy(pop, true, 'Clearing tag…');
		try {
			await persistTag(username, null);
			closeActivePopover();
		} catch (e) {
			console.error('RES-Slim userTagger: could not clear tag', e);
			setPopoverBusy(pop, false, 'Couldn\'t clear. The tag is still saved, so try again.', 'error');
		}
	});
	cancelBtn.addEventListener('click', closeActivePopover);

	// Position the popover. We append to the host parent so it stays anchored
	// even if the .thing re-renders some descendants.
	const host = anchorEl.parentNode instanceof HTMLElement ? anchorEl.parentNode : document.body;
	host.append(pop);

	triggerBtn.setAttribute('aria-expanded', 'true');
	triggerBtn.setAttribute('aria-controls', dialogId);
	activePopover = { element: pop, cleanup, trigger: triggerBtn };

	// Defer the outside-click listener to the next tick so the click that
	// opened the popover doesn't immediately close it.
	setTimeout(() => {
		if (activePopover && activePopover.element === pop) {
			document.addEventListener('click', outsideClick, true);
			document.addEventListener('keydown', onKey, true);
			window.addEventListener('resize', onResize, true);
			// Re-anchors the popover; passive because it only measures and moves the
			// popover, and it must not delay the scroll it is reacting to.
			window.addEventListener('scroll', onResize, { capture: true, passive: true });
		}
	}, 0);
	placePopover(pop, triggerBtn);
	tagInput.focus();
}

function ensureEditorButton(authorEl: HTMLAnchorElement): void {
	const host = authorEl.parentNode;
	if (!(host instanceof HTMLElement)) return;
	if (host.querySelector(`:scope > .${BUTTON_CLASS}`)) return;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = BUTTON_CLASS;
	btn.textContent = '+';
	btn.title = 'Tag user';
	btn.setAttribute('aria-label', `Tag ${authorEl.textContent || 'user'}`);
	btn.setAttribute('aria-haspopup', 'dialog');
	btn.setAttribute('aria-expanded', 'false');
	btn.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const username = usernameFromAuthor(authorEl);
		if (!username) return;
		openPopover(authorEl, username, btn);
	});
	authorEl.after(btn);
}

function processThing(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const anchors = findAuthorAnchors(el);
	for (const a of anchors) {
		const username = usernameFromAuthor(a);
		if (!username) continue;
		trackAuthor(username, a);
		ensureEditorButton(a);
		renderForAuthor(a, cache[username]);
		const hideIgnored = module.options.hideIgnored.value !== false;
		const tag = cache[username];
		if (hideIgnored && tag && tag.ignore) {
			el.dataset.rsmIgnored = '1';
			el.style.display = 'none';
		}
	}
}

async function loadInitialCache(): Promise<void> {
	replaceCache(normalizeTagMap(await tagMapStore.get()));
}

function replaceCache(next: UserTagMap): void {
	for (const username of Object.keys(cache)) delete cache[username];
	Object.assign(cache, next);
}

function liveOptionValue(optionName: string): any {
	const control = document.getElementById(`userTagger-${optionName}`);
	if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
		return control.value;
	}
	if (control instanceof HTMLElement) {
		const selected = control.querySelector('input[type="radio"]:checked');
		if (selected instanceof HTMLInputElement) return selected.value;
	}
	const staged = Options.stage.get(module.moduleID);
	return staged && staged[optionName] ? staged[optionName].value : module.options[optionName].value;
}

function setImportStatus(message: string, state?: 'error' | 'success'): void {
	const group = document.getElementById('userTagger-importActions');
	if (!(group instanceof HTMLElement)) return;
	let status = group.parentElement && group.parentElement.querySelector('.rsm-userTagger-import-status');
	if (!(status instanceof HTMLElement)) {
		status = document.createElement('p');
		status.className = 'rsm-userTagger-import-status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		group.after(status);
	}
	status.textContent = message;
	if (state) status.dataset.state = state;
	else delete status.dataset.state;
}

function importCountText(counts: $PropertyType<PendingTagImport, 'counts'>): string {
	return `${counts.valid} valid, ${counts.invalid} invalid, ${counts.newRecords} new, ${counts.conflicting} conflicting`;
}

async function previewTagImport(): Promise<void> {
	const raw = String(liveOptionValue('importJson') || '');
	const conflictMode: TagImportConflictMode = liveOptionValue('importConflicts') === 'replace' ? 'replace' : 'keep';
	const current = normalizeTagMap(await tagMapStore.get());
	const preview = inspectTagImport(raw, current);
	const summary = importCountText(preview.counts);
	if (preview.error || preview.counts.valid === 0) {
		pendingTagImport = null;
		setImportStatus(`${summary}. ${preview.error || 'There are no valid tag records to import.'}`, 'error');
		throw new Error(preview.error || 'There are no valid tag records to import.');
	}

	pendingTagImport = {
		raw,
		conflictMode,
		baseSignature: stringifyTags(current),
		next: buildTagImportMap(current, preview.incoming, conflictMode),
		counts: preview.counts,
	};
	const conflictText = conflictMode === 'replace' ? 'Imported conflicts will replace existing tags.' : 'Existing tags will keep conflicting usernames.';
	setImportStatus(`${summary}. ${conflictText} Click Import previewed tags to commit.`);
}

async function clearImportPayload(): Promise<void> {
	await Options.set(module, 'importJson', '');
}

async function commitPreviewedTagImport(): Promise<void> {
	if (!pendingTagImport) {
		setImportStatus('Preview the current payload before importing it.', 'error');
		throw new Error('Preview the current tag payload before importing it.');
	}
	if (!canPersistFeatureData('userTagger')) {
		pendingTagImport = null;
		setImportStatus('User-tag imports are not stored from private windows.', 'error');
		throw new Error('User-tag imports are not stored from private windows.');
	}

	const pending = pendingTagImport;
	const raw = String(liveOptionValue('importJson') || '');
	const conflictMode: TagImportConflictMode = liveOptionValue('importConflicts') === 'replace' ? 'replace' : 'keep';
	const current = normalizeTagMap(await tagMapStore.get());
	if (raw !== pending.raw || conflictMode !== pending.conflictMode || stringifyTags(current) !== pending.baseSignature) {
		pendingTagImport = null;
		setImportStatus('The payload, conflict choice, or stored tags changed. Preview again.', 'error');
		throw new Error('The tag import changed after preview. Preview it again before importing.');
	}

	try {
		await commitTagImport({
			original: current,
			next: pending.next,
			saveRollback: snapshot => rollbackStore.set({ createdAt: Date.now(), tags: snapshot }),
			writeMap: value => tagMapStore.set(value),
			readMap: () => tagMapStore.get(),
			clearPayload: clearImportPayload,
		});
		module.options.importJson.value = '';
		Options.stage.add(module.moduleID, 'importJson', '');
		const input = document.getElementById('userTagger-importJson');
		if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = '';
		pendingTagImport = null;
		setImportStatus(`Imported ${importCountText(pending.counts)}. A pre-import rollback snapshot was saved.`, 'success');
	} catch (error) {
		pendingTagImport = null;
		const message = error instanceof Error ? error.message : String(error);
		setImportStatus(`Import failed. The previous tag map was restored. ${message}`, 'error');
		throw error;
	}
}

async function exportCommittedTags(): Promise<void> {
	const committed = normalizeTagMap(await tagMapStore.get());
	const blob = new Blob([stringifyTags(committed)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `res-slim-user-tags-${new Date().toISOString().slice(0, 10)}.json`;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	setImportStatus(`Exported ${Object.keys(committed).length} committed tag records.`, 'success');
}

// Expose a small read-only view for debugging / tests.
export const _internal = { cache, stringifyTags };

module.contentStart = () => {
	// The watcher has to be registered synchronously. `watchForThings` only
	// appends to a list — it does not replay — and the things already on the page
	// are walked once during this same phase. Registering after an `await` meant
	// the callback was installed too late to see any of them, so on a normal page
	// load the tagger rendered nothing at all: no [+] triggers and no badges,
	// only on things added later by ajax. Loading the cache is what may wait.
	watchForThings(['post', 'comment'], processThing);

	(async () => {
		try { await loadInitialCache(); } catch (e) { /* storage may be unavailable in tests */ }
		// Authors seen before the cache resolved were rendered untagged; now that
		// tags are known, re-render the ones we are tracking.
		for (const username of [...authorIndex.keys()]) tagThingForUser(username);
	})();
};
