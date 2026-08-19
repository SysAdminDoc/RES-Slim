/* @flow */

import { setTrustedHTML } from '../core/dom/trustedHtml';
import { downcast, waitForEvent, watchForChildren, waitForDescendant, watchForDescendants } from './';

export function stopPageContextScript(test: HTMLScriptElement => boolean, _parent: string | HTMLElement | Promise<HTMLElement>, onlyChildrenOfParent: boolean) {
	const undo = [];
	let stopped = false;

	(async () => {
		if (_parent instanceof Promise) { _parent = await _parent; }
		let parent;
		if (_parent instanceof HTMLElement) {
			parent = _parent;
		} else {
			const selector = _parent;
			const existing = document.documentElement.querySelector(selector);
			if (existing instanceof HTMLElement) {
				parent = existing;
			} else {
				try {
					parent = await waitForDescendant(document.documentElement, selector);
				} catch (e) {
					// The waiter reported which selector never turned up. Without the
					// parent there is nothing to watch, and this used to sit here
					// forever holding an observer on the whole document instead.
					return;
				}
			}
		}
		if (stopped) return;

		(onlyChildrenOfParent ? watchForChildren : watchForDescendants)(parent, 'script', ele => {
			if (stopped) return; // TODO Stop further search
			const script = downcast(ele, HTMLScriptElement);
			if (test(script)) {
				if (process.env.BUILD_TARGET === 'firefox') {
					// Additional processing is necessary to prevent execution in Firefox
					script.addEventListener('beforescriptexecute', e => { e.preventDefault(); });
				}

				const origType = script.type;
				script.type = 'javascript/blocked';
				const origSrc = script.src;
				if (origSrc) script.src = '';
				const origContent = script.innerHTML;
				if (origContent) setTrustedHTML(script, '');

				undo.push(() => {
					const ele = document.createElement('script');
					ele.type = origType;
					if (origSrc) ele.src = origSrc;
					if (origContent) setTrustedHTML(ele, origContent);
					script.after(ele);
					return waitForEvent(ele, 'load');
				});
			}
		});
	})();

	return {
		undo: () => {
			stopped = true;
			// $FlowIssue Promise.allSettled
			return Promise.allSettled(undo.map(fn => fn()));
		},
	};
}
