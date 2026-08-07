// Notification sanitisation, executed rather than pattern-matched.
//
// This contract used to assert that `notifications.js` *contained* the string
// `insertAdjacentHTML('beforeend', DOMPurify.sanitize(data.message))`. That
// proves the call is written; it cannot prove DOMPurify is configured to strip
// anything, that the sanitised branch is the one a string takes, or that a
// payload actually comes out inert. A source assertion of exactly that shape is
// how `eventTrackingSabotage` shipped a fetch blocker that blocked nothing.
//
// The risk is real: several modules interpolate remote text into a notification
// message — usernames, subreddit rules, API error bodies — so an unsanitised
// string branch is a live injection point.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom();
const Notifications = await loadModule('lib/modules/notifications.js', 'notifications-sanitize');
const { showNotification } = Notifications;

let seq = 0;
function notify(message) {
	// A distinct notificationID per call: showNotification de-duplicates on
	// identical rendered markup, and a reused id would return the first
	// notification and silently skip the payload under test.
	const { element } = showNotification({
		moduleID: 'notifications',
		notificationID: `sanitize-${seq++}`,
		header: 'Test',
		message,
	});
	return element.querySelector('.RESNotificationContent');
}

test('script-bearing markup is rendered inert', () => {
	const payloads = [
		'<img src=x onerror=alert(1)>',
		'<script>alert(1)</script>',
		'<svg onload=alert(1)></svg>',
		'<iframe src="javascript:alert(1)"></iframe>',
		'<body onload=alert(1)>',
		'<a href="javascript:alert(1)">click</a>',
		'<div onclick="alert(1)">x</div>',
		'<object data="data:text/html,<script>alert(1)</script>"></object>',
	];

	for (const payload of payloads) {
		const content = notify(payload);
		const html = content.innerHTML;

		assert.ok(!/<script/i.test(html), `script element survived: ${html}`);
		assert.ok(!/\son\w+\s*=/i.test(html), `inline event handler survived: ${html}`);
		assert.ok(!/javascript:/i.test(html), `javascript: URL survived: ${html}`);
	}

	// And nothing executable was attached to the live document along the way.
	assert.equal(document.querySelectorAll('script').length, 0);
});

test('benign formatting survives, because callers rely on it', () => {
	// Several callers embed links and emphasis deliberately. Sanitising to plain
	// text would silently break those messages, so this is not a "strip
	// everything" guard.
	const content = notify('<b>bold</b> and <a href="https://old.reddit.com/r/x">a link</a>');
	const html = content.innerHTML;

	assert.match(html, /<b>bold<\/b>/i);
	assert.match(html, /<a[^>]+href="https:\/\/old\.reddit\.com\/r\/x"/i);
});

test('an HTMLElement message bypasses sanitisation intentionally and is attached as-is', () => {
	// The element branch is for markup this codebase built itself, and it is
	// appended rather than parsed from a string. Pinning it makes the split
	// explicit: only the *string* branch is untrusted input.
	const node = document.createElement('span');
	node.className = 'built-by-res';
	node.textContent = 'from a module';

	const { element } = showNotification({
		moduleID: 'notifications',
		notificationID: `sanitize-element-${seq++}`,
		header: 'Test',
		message: node,
	});

	const content = element.querySelector('.RESNotificationContent');
	assert.equal(content.querySelector('.built-by-res'), node, 'a real element should be appended, not re-parsed');
});

test('a plain-string call is treated as a message, not as options', () => {
	// showNotification accepts a bare string. That shorthand must land on the same
	// sanitised path, or it becomes an unguarded side door.
	const { element } = showNotification('<img src=x onerror=alert(1)>');
	const html = element.querySelector('.RESNotificationContent').innerHTML;

	assert.ok(!/\son\w+\s*=/i.test(html), `the string shorthand must be sanitised too: ${html}`);
});

test('an empty message renders without throwing', () => {
	// Reachable: a caller can legitimately build an empty summary string.
	//
	// Deliberately *not* asserting null/undefined here. Those throw
	// ("str8 is not iterable", from hashCode over the message), but the Flow type
	// is `string | HTMLElement` — not optional — and every live caller passes a
	// real string or element. Asserting a behaviour nobody promised would pin an
	// accident, and "fixing" it would churn working code for an unreachable case.
	assert.doesNotThrow(() => showNotification({
		moduleID: 'notifications',
		notificationID: `sanitize-empty-${seq++}`,
		header: 'Test',
		message: '',
	}));
});
