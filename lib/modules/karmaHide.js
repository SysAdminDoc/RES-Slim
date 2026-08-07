/* @flow */
// RES-Slim: hide the numbers.
//
// Concept from "Reddit Dekarmacator" (Greasy Fork 3313), itself modelled on
// Benjamin Grosser's Facebook Demetricator, plus "Fuck Reddit Karma + Extras".
// The point is to read a thread on what it says rather than on what it scored,
// so it hides scores before they are rendered rather than after — a fade-in
// would still show the number long enough to read it.
//
// Everything is CSS. Nothing is removed from the DOM, so vote buttons keep
// working, RES-Slim's own score-based filters keep seeing real values, and
// turning the module off restores the page without a reload.

import { Module } from '../core/module';
import { addCSS } from '../utils';
import { karmaHideRules } from '../utils/karmaHide';

export const module: Module<*> = new Module('karmaHide');

module.moduleName = 'Hide karma and scores';
module.category = 'appearanceCategory';
module.description = 'Hides score numbers on posts, comments and profiles so a discussion reads on its content rather than its rank. Scores are hidden with CSS, so voting still works and score-based filters still see the real values.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['karma', 'score', 'points', 'demetricator', 'hide', 'votes'];

module.options = {
	hidePostScores: {
		type: 'boolean',
		value: true,
		title: 'Hide post scores',
		description: 'The number in the vote column on listing pages and above a thread.',
	},
	hideCommentScores: {
		type: 'boolean',
		value: true,
		title: 'Hide comment scores',
		description: 'The "N points" in every comment tagline.',
	},
	hideUserKarma: {
		type: 'boolean',
		value: true,
		title: 'Hide your karma and profile karma',
		description: 'The counters in the header and in the sidebar of a user profile.',
	},
	hideCommentCounts: {
		type: 'boolean',
		value: false,
		title: 'Also hide comment counts',
		description: 'Off by default: the comment count says how much discussion there is, which is information rather than a score.',
	},
	revealOnHover: {
		type: 'boolean',
		value: true,
		title: 'Reveal on hover',
		description: 'Show the hidden number when you hover it, so it is out of the way rather than unavailable.',
	},
};

function rules(): string {
	const o = module.options;
	return karmaHideRules({
		hidePostScores: o.hidePostScores.value === true,
		hideCommentScores: o.hideCommentScores.value === true,
		hideUserKarma: o.hideUserKarma.value === true,
		hideCommentCounts: o.hideCommentCounts.value === true,
		revealOnHover: o.revealOnHover.value === true,
	});
}

module.contentStart = () => {
	const css = rules();
	if (css) addCSS(css);
};
