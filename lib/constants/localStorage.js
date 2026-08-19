/* @flow */

// No longer written. The dictionary cache was keyed on the reddit locale until
// v0.41.0, when the locale negotiation that made it vary was retired; the key is
// kept only so the stale value can be cleared from existing profiles.
export const STALE_CACHED_LANG_KEY = 'RES.i18nCachedLang';
export const CACHED_MESSAGES_KEY = 'RES.i18nCachedMessages';
export const CACHED_MESSAGES_TOKEN_KEY = 'RES.i18nCachedMessagesToken';
