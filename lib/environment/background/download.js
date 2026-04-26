/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

const downloadFile = apiToPromise((options, callback) => chrome.downloads.download(options, callback));

addListener('download', ({ url, filename }, { tab: { incognito } }) =>
	downloadFile({ url, filename, ...(process.env.BUILD_TARGET !== 'firefox' ? {} : { incognito }) }));
