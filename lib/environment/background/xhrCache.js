/* @flow */
// The shared response cache for `ajax({ cacheFor })`.
//
// Every entry is scoped to the browsing context that asked for it — see
// `lib/utils/xhrCacheScope.js` for why, and for the policy itself. This file
// owns only the parts that cannot be pure: the cache instance and the listener.

import { LRUCache } from '../../utils/Cache';
import { applyCacheOperation } from '../../utils/xhrCacheScope';
import { addListener } from './messaging';

const cache = new LRUCache(512);
addListener('XHRCache', (message, sender) => applyCacheOperation(cache, message, sender));
