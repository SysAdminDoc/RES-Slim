/* @flow */

import { makeModuleErrorEntry } from '../../utils/moduleErrorLog';
import { recordModuleErrorOnce } from '../modules/storage';
import {
	formatSelectorDriftMessage,
	selectorDriftForPage,
} from './selectors';

const MODULE_ID = 'oldRedditSelectors';

export async function recordSelectorDiagnostics(pageType: ?string, root: Document | HTMLElement = document): Promise<boolean> {
	if (!pageType) return false;
	const findings = selectorDriftForPage(pageType, root);
	if (!findings.length) return false;
	await recordModuleErrorOnce(makeModuleErrorEntry(
		MODULE_ID,
		`selector-drift:${pageType}`,
		formatSelectorDriftMessage(pageType, findings),
	));
	return true;
}
