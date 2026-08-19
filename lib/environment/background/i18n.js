/* @flow */

import { getLocaleDictionary } from '../../../locales';
import { addListener } from './messaging';

// No locale argument: there is one dictionary, and passing a value that
// cannot change the answer is how the dead negotiation stayed plausible.
addListener('i18n', () => getLocaleDictionary());
