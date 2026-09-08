/* @flow */

import DOMPurify from 'dompurify';

// The last thing that touches the comment preview before it is written.
//
// snudown is a C library compiled to JavaScript, and what goes into it is
// whatever the reader typed into a comment box. Its output goes to
// `setTrustedHTML`, which is the point at which nothing else is looking.
//
// Measured against the shipped build on 2026-09-08: snudown escapes every
// dangerous construct tried against it, so nothing this function currently
// receives is changed by it in any way that matters. That is the honest state of
// it, and it is why this is defence in depth rather than a fix. A renderer
// parsing untrusted input is the kind of thing that has a hole eventually, and by
// the time it does the output has already been written. Every other HTML sink in
// this codebase goes through DOMPurify; upstream added the same second layer on
// 2026-09-01.
//
// Extracted rather than inlined so it can be driven with the output a *regressed*
// renderer would produce, which is the only way to test a layer whose input is
// currently always safe.
//
// The configuration is deliberately the default. The preview renders reddit's
// own markdown dialect -- tables, spoilers, superscript, fenced code with
// highlight classes, and the wiki table of contents with its `id` anchors and
// `data-level` attributes -- and DOMPurify's defaults keep all of it while
// removing scripts, event handlers and `javascript:` URLs.
export function sanitizePreviewHtml(html: string): string {
	return DOMPurify.sanitize(html);
}
