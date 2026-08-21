/* @flow */

import { Thing } from '../utils';
import { Module } from '../core/module';
import * as Hover from './hover';

export const module: Module<{ [string]: any }> = new Module('showParent');

module.moduleName = 'showParentName';
module.category = 'myAccountCategory';
module.description = 'showParentDesc';
module.options = {
	hoverDelay: {
		title: 'showParentHoverDelayTitle',
		type: 'text',
		value: '500',
		description: 'showParentHoverDelayDesc',
		advanced: true,
	},
	fadeDelay: {
		title: 'showParentFadeDelayTitle',
		type: 'text',
		value: '200',
		description: 'showParentFadeDelayDesc',
		advanced: true,
	},
	fadeSpeed: {
		title: 'showParentFadeSpeedTitle',
		type: 'text',
		value: '0.7',
		description: 'showParentFadeSpeedDesc',
		advanced: true,
	},
	direction: {
		title: 'showParentDirectionTitle',
		type: 'enum',
		value: 'down',
		values: [{
			name: 'Above',
			value: 'up',
		}, {
			name: 'Below',
			value: 'down',
		}],
		description: 'showParentDirectionDesc',
		bodyClass: true,
	},
};
module.include = [
	'comments',
];

let hover;

module.contentStart = () => {
	hover = Hover.infocard(module.moduleID)
		.options({
			openDelay: parseFloat(module.options.hoverDelay.value),
			fadeDelay: parseFloat(module.options.fadeDelay.value),
			fadeSpeed: parseFloat(module.options.fadeSpeed.value),
		})
		.populateWith(card => showCommentHover(Thing.checkedFrom(card.getCheckedTarget())));
	hover.watch('.comment .buttons :not(:first-child) .bylink');
};

export function startHover(button: HTMLElement) {
	if (hover) hover.target(button).begin();
}

function handleVoteClick(e: Event) {
	const arrow = (e.currentTarget: any);
	const voteClasses = {
		up: 'likes',
		none: 'unvoted',
		down: 'dislikes',
	};
	const midcol = arrow.parentElement;
	const thingEl = midcol && midcol.parentElement;
	const id = thingEl && thingEl.getAttribute('data-fullname');
	let direction = (/(up|down)(?:mod)?/).exec(arrow.className);

	if (!direction) return;

	direction = direction[1];

	const targetThing = document.querySelector(`.content .thing.id-${id}`);
	if (!targetThing) return;
	const targetMidcol = targetThing.querySelector(':scope > .midcol');
	if (!targetMidcol) return;
	const targetButton = targetMidcol.querySelector(`.arrow.${direction}, .arrow.${direction}mod`);

	if (!targetButton) {
		console.error('When attempting to find %s arrow for comment %s no element was returned', direction, id);
		return;
	}

	// Prevent other click handlers from running
	function removeClickHandlers(event: Event) {
		event.stopPropagation();
	}

	targetButton.addEventListener('click', removeClickHandlers);
	targetButton.click();
	targetButton.removeEventListener('click', removeClickHandlers);

	let startDir = 'none';
	for (const [key, value] of Object.entries(voteClasses)) {
		if (midcol.classList.contains(value)) {
			startDir = key;
			break;
		}
	}

	const newDir = direction === startDir ? 'none' : direction;

	// Update classes on parent elements
	if (thingEl) {
		for (const child of thingEl.children) {
			if (child.classList.contains(voteClasses[startDir])) {
				child.classList.remove(voteClasses[startDir]);
				child.classList.add(voteClasses[newDir]);
			}
		}
	}
	const upArrow = midcol.querySelector('.up, .upmod');
	if (upArrow) {
		upArrow.classList.toggle('upmod', newDir === 'up');
		upArrow.classList.toggle('up', newDir !== 'up');
	}
	const downArrow = midcol.querySelector('.down, .downmod');
	if (downArrow) {
		downArrow.classList.toggle('downmod', newDir === 'down');
		downArrow.classList.toggle('down', newDir !== 'down');
	}
}

function showCommentHover(thing: Thing) {
	const direction = module.options.direction.value;

	// Get parent .thing elements
	const parentElements = [];
	let current = thing.element.parentElement;
	while (current) {
		if (current.classList && current.classList.contains('thing')) {
			parentElements.push(current.cloneNode(true));
		}
		current = current.parentElement;
	}

	let topParentURL = '';

	if (parentElements.length === 0) {
		// Get parent URL from visible top comment
		const parentLink = thing.element.querySelector('[data-event-action="parent"]');
		topParentURL = parentLink ? parentLink.getAttribute('data-href-url') : '';
	} else {
		// Find visible top comment before getting parent URL
		const topParent = parentElements[parentElements.length - 1];
		const topParentId = topParent.getAttribute('data-fullname');
		const originalTopParent = document.querySelector(`[data-fullname="${topParentId}"]`);
		if (originalTopParent) {
			const parentLink = originalTopParent.querySelector(':scope > .entry [data-event-action="parent"]');
			topParentURL = parentLink ? parentLink.getAttribute('data-href-url') : '';
		}
	}

	if (direction === 'up') {
		parentElements.reverse();
	}

	for (const parent of parentElements) {
		parent.classList.add('comment', 'parentComment');
		parent.classList.remove('thing', 'even', 'odd');

		// Remove replies and reply edit form
		for (const child of parent.querySelectorAll(':scope > .child')) child.remove();

		// Remove the keyboardNav functionality
		const clonedParent = parent; // already a clone

		// A link to go to the actual comment
		let id = clonedParent.getAttribute('data-fullname');
		if (id) {
			id = id.slice(3);
			const tagline = clonedParent.querySelector(':scope > .entry > .tagline');
			if (tagline) {
				const gotoLink = document.createElement('a');
				gotoLink.className = 'bylink parentlink';
				gotoLink.href = `#${id}`;
				gotoLink.textContent = 'goto comment';
				tagline.appendChild(gotoLink);
			}
		}
	}

	// Batch removals on all parents
	const allParentsFragment = document.createDocumentFragment();
	for (const p of parentElements) allParentsFragment.appendChild(p);
	const tempContainer = document.createElement('div');
	tempContainer.appendChild(allParentsFragment);

	for (const el of tempContainer.querySelectorAll('.parent')) el.remove();
	for (const el of tempContainer.querySelectorAll('.usertext-body')) el.style.display = '';
	for (const el of tempContainer.querySelectorAll('.flat-list.buttons')) el.remove();
	for (const el of tempContainer.querySelectorAll('.usertext-edit')) el.remove();
	for (const el of tempContainer.querySelectorAll('.RESUserTag')) el.remove();
	for (const el of tempContainer.querySelectorAll('.voteWeight')) el.remove();
	for (const el of tempContainer.querySelectorAll('.collapsed')) el.remove();
	for (const el of tempContainer.querySelectorAll('.expand')) el.remove();
	for (const form of tempContainer.querySelectorAll('form')) form.removeAttribute('id');
	for (const arrow of tempContainer.querySelectorAll('.arrow')) {
		arrow.addEventListener('click', handleVoteClick);
	}
	for (const el of tempContainer.querySelectorAll('.res-expando-box, .expando-button')) el.remove();
	for (const el of tempContainer.querySelectorAll('.keyNavAnnotation')) el.remove();

	const container = document.createElement('div');
	container.className = 'parentCommentWrapper';

	// Move children from tempContainer to container
	while (tempContainer.firstChild) container.appendChild(tempContainer.firstChild);

	// Does not show view parent comment when top-most parent is shown
	if (topParentURL) {
		const viewParentLink = document.createElement('a');
		viewParentLink.className = 'bylink';
		viewParentLink.href = topParentURL;
		viewParentLink.textContent = 'View parent comment';
		container.appendChild(viewParentLink);
	}

	// Add "reply to" arrows between parents
	const parents = container.querySelectorAll('.parentComment');
	for (let i = 0; i < parents.length - 1; i++) {
		const arrow = document.createElement('div');
		arrow.className = 'parentArrow';
		arrow.textContent = 'reply to';
		parents[i].after(arrow);
	}

	return ['Parents', container];
}
