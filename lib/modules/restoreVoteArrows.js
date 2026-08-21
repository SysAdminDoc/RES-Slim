/* @flow */
// RES-Slim: force the vote arrows back into view.
//
// Concept from "Restore Downvote Arrows" (Greasy Fork 1339). A large number of
// subreddits hide the downvote arrow — sometimes both arrows — through their
// stylesheet, which does not stop the vote registering but does stop you seeing
// which way you already voted.
//
// disableSubredditStyles solves this by throwing the whole stylesheet away.
// This is the narrow version for people who want the subreddit's design and just
// want the arrows back.

import { Module } from '../core/module';
import { addCSS } from '../utils';
import { voteArrowRules } from '../utils/voteArrows';

export const module: Module<{ [string]: any }> = new Module('restoreVoteArrows');

module.moduleName = 'Restore hidden vote arrows';
module.category = 'appearanceCategory';
module.description = 'Forces the up and down arrows visible in subreddits whose stylesheet hides them, without discarding the rest of the subreddit\'s styling.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['vote', 'arrow', 'downvote', 'upvote', 'subreddit', 'css'];

module.options = {
	restoreDownvote: {
		type: 'boolean',
		value: true,
		title: 'Restore the downvote arrow',
		description: 'The one subreddits hide most often.',
	},
	restoreUpvote: {
		type: 'boolean',
		value: true,
		title: 'Restore the upvote arrow',
		description: 'A few subreddits hide both.',
	},
	restoreDefaultSprite: {
		type: 'boolean',
		value: false,
		title: 'Also restore the default arrow graphic',
		description: 'Subreddits often replace the arrows with a custom sprite that is hard to read. This puts reddit\'s own back — turn it off if you like the custom one.',
	},
};

function rules(): string {
	const o = module.options;
	return voteArrowRules({
		restoreUpvote: o.restoreUpvote.value === true,
		restoreDownvote: o.restoreDownvote.value === true,
		restoreDefaultSprite: o.restoreDefaultSprite.value === true,
	});
}

module.contentStart = () => {
	const css = rules();
	if (css) addCSS(css);
};
