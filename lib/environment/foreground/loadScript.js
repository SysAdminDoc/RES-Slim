/* @flow */

import { memoize } from '../../utils/functional';
import { sendMessage } from './messaging';

export const loadScript = memoize((url: string) => sendMessage('loadScript', { url }));
