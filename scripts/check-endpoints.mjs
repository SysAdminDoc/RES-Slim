// Probe every third-party base URL this extension ships as a default.
//
// Stale external defaults are a recurring failure class here, not a one-off:
// rimgo shipped two dead defaults in a row (totaldarkness.net → 502, then
// ri.bcow.xyz → 403) and cobalt shipped one that was bot-protected and
// YouTube-blocked. Each was found by a human months later, with the feature
// visibly broken the whole time.
//
//   yarn check:endpoints
//
// Two kinds of endpoint, and conflating them makes the check lie in both
// directions:
//
//   FETCHED  — the extension itself requests these, from a content script, and
//              parses the response. A non-2xx here means the feature is broken.
//              These gate the exit code.
//   LINKED   — the extension only builds an anchor the user clicks; the request
//              is then a normal top-level navigation with full browser headers.
//              Bot protection answering a scripted probe with 403 or 418 says
//              nothing about whether the user's click works, so these are
//              reported but do not fail the run.
//
// A 429 counts as alive in both groups: rate-limited is not dead, and failing on
// it would make the check flakiest against the hosts that are most used.

import process from 'node:process';

const TIMEOUT_MS = 15000;

const FETCHED = [
	{ name: 'rimgo (imgurFlatten default 1)', url: 'https://imgur.artemislena.eu/' },
	{ name: 'rimgo (imgurFlatten default 2)', url: 'https://rimgo.ducks.party/' },
	{ name: 'Arctic Shift (arcticShift, editedCommentDiff)', url: 'https://arctic-shift.photon-reddit.com/api/comments/search?limit=1' },
	{ name: 'PullPush API (viewDeleted, editedCommentDiff)', url: 'https://api.pullpush.io/reddit/search/comment/?size=1' },
	{ name: 'Wayback availability API (waybackSnapshot)', url: 'https://archive.org/wayback/available?url=example.com' },
	{ name: 'Bluesky oEmbed (hosts/bluesky)', url: 'https://embed.bsky.app/oembed?url=https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l' },
];

const LINKED = [
	{ name: 'PullPush undelete UI (archiveLinks)', url: 'https://undelete.pullpush.io/' },
	{ name: 'Reveddit (archiveLinks)', url: 'https://www.reveddit.com/' },
	{ name: 'RedGifs (redgifsLayoutFix)', url: 'https://www.redgifs.com/' },
	// Loaded in an iframe by the browser, not fetched by us. A bogus paste id
	// legitimately 404s, so probe the host rather than inventing an id.
	{ name: 'Pastebin (hosts/pastebin)', url: 'https://pastebin.com/' },
];

// cobaltDownloader deliberately ships no default instance, so there is nothing
// to probe for it — see lib/utils/cobalt.js.

const healthy = status => status === 429 || (status >= 200 && status < 400);

async function probe({ name, url }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'user-agent': 'RES-Slim endpoint check' },
		});
		return { name, url, status: response.status, ok: healthy(response.status) };
	} catch (e) {
		return { name, url, status: 0, ok: false, error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message };
	} finally {
		clearTimeout(timer);
	}
}

function report(results) {
	for (const r of results) {
		const detail = r.error ? ` (${r.error})` : '';
		console.log(`[${r.ok ? 'ok  ' : 'FAIL'}] ${String(r.status).padStart(3)}  ${r.name}${detail}`);
		console.log(`            ${r.url}`);
	}
}

const [fetched, linked] = await Promise.all([
	Promise.all(FETCHED.map(probe)),
	Promise.all(LINKED.map(probe)),
]);

console.log('Fetched by the extension (these gate the build):');
report(fetched);
console.log('');
console.log('Linked for the user to click (reported only — bot protection here is not a failure):');
report(linked);
console.log('');

const failures = fetched.filter(r => !r.ok);
const linkedFailures = linked.filter(r => !r.ok);
if (linkedFailures.length) {
	console.log(`${linkedFailures.length} linked host(s) refused a scripted probe. Confirm in a browser before changing anything.`);
}

if (failures.length) {
	console.log(`${failures.length} of ${fetched.length} fetched endpoints failed.`);
	console.log('A failing host means the module that ships it is broken out of the box.');
	console.log('Replace the default with a probed, live host — do not just remove the check.');
	process.exit(1);
}
console.log(`All ${fetched.length} fetched endpoints responded.`);
