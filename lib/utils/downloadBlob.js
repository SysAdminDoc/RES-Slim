/* @flow */

// Hand a generated file to the browser.
//
// Seven places built this by hand and six of them agreed on the shape: create an
// object URL, point an anchor at it, attach the anchor to the document, click,
// then release the URL on a timer. The seventh, the settings console's selector
// override export, did neither the attach nor the delay - it clicked a detached
// anchor and revoked the URL on the very next line. Both halves matter:
//
//   * Firefox will not follow a click on an anchor that is not in the document,
//     so that export simply did nothing there;
//   * revoking synchronously after `click()` can beat the download starting,
//     because the navigation the click schedules has not happened yet.
//
// The bug was invisible because there was nothing to compare against. One
// helper, and the odd one out stops being possible.
//
// The delay is deliberately generous. `revokeObjectURL` frees the blob, and the
// only cost of holding it a little longer is memory that is about to be freed
// anyway; the cost of freeing it too early is a download that silently does not
// happen.
const RELEASE_DELAY_MS = 1500;

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	// Hidden rather than merely off-screen: an attached anchor is otherwise a
	// stray focusable element in the tab order for as long as it is there.
	anchor.style.display = 'none';
	anchor.setAttribute('aria-hidden', 'true');
	anchor.tabIndex = -1;

	if (document.body) document.body.append(anchor);
	anchor.click();

	setTimeout(() => {
		URL.revokeObjectURL(url);
		anchor.remove();
	}, RELEASE_DELAY_MS);
}

// The common case: some text with a known type.
export function downloadText(text: string, filename: string, type: string = 'application/json'): void {
	downloadBlob(new Blob([text], { type }), filename);
}
