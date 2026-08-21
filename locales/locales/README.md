# Strings

`en.json` is the only dictionary this fork ships, and it is edited by hand.

Upstream generated this directory from Transifex and told contributors to submit
translations there. That was never true of this fork: it is a personal fork with
no translator pipeline, and work submitted to upstream's Transifex project would
not reach it. The locale negotiation that consumed those files was retired in
v0.41.0. See the comment in `locales/index.js`, and
`tests/unit/single-locale-contract.test.mjs`, which fails if a second dictionary
appears without the negotiation coming back with it.

Reddit's own locale is still detected, and still used: `lib/utils/localization.js`
selects a dayjs locale from it, so timestamps format in the reader's language.

## Adding strings

Add them to `en.json`. `yarn lint` runs `scripts/i18n-lint.mjs`, which fails on a
key referenced in code but missing here, and reports keys defined here that
nothing reads.

## Translating modules

Interface text goes through the `i18n` function. Module and option names,
categories and descriptions are translated automatically. A module sets
`moduleName`/`description` to a key and the settings console resolves it.

### Naming conventions

* camelCase.
* Start a module's keys with its `moduleID`.
  * Option titles: `{moduleID}Options{OptionName}Title`
  * Option descriptions: `{moduleID}Options{OptionName}Desc`

`lib/modules/hover.js` shows both forms in a module that still ships; the
`userbarHider` this file used to point at was removed in v0.1.0.
