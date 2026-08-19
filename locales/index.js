/* @flow */

import locales from './locales';

const localeDictionaries: { [string]: { [string]: { message: string } } } = (locales: any);

// This fork ships one dictionary.
//
// Upstream carried a Transifex locale negotiation here - `lol` to `en_lolcat`,
// `pir` to `en_pirate`, `es-ar` to `es_419`, then a three-way merge of exact
// match over region match over `en`. Every branch of it resolved to `en`,
// because `locales/locales/` has held exactly one file since v0.1.0, and the
// README pointed translators at *upstream's* Transifex project, where any work
// they did would never reach this fork. Machinery that cannot produce a
// different answer is not a feature, it is a claim.
//
// Reddit's locale is still read, and still matters: `lib/utils/localization.js`
// uses it to choose a dayjs locale, so timestamps format in the reader's
// language even though the interface strings do not. Detection and translation
// are separate concerns, and only the second one is gone.
//
// `tests/unit/single-locale-contract.test.mjs` fails if a second dictionary
// appears, and names what has to come back with it.
export function getLocaleDictionary(): { [string]: string } {
	return Object.fromEntries(
		Object.entries(localeDictionaries.en).map(([key, entry]) => [key, entry.message]),
	);
}
