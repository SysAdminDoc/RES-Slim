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
//
// Two refinements this check needed, both learned on 2026-08-18:
//
//   anyOf   — some settings ship an ordered *list* of interchangeable hosts and
//             use the first that answers. Probing those as independent entries
//             made the run exit 1 while the feature was working fine off its
//             second mirror, and reporting "the module is broken out of the box"
//             when it was not. An `anyOf` group fails only when every member
//             does; each member's own status is still printed.
//   expect  — a status code cannot tell a working host from an anti-bot
//             interstitial. imgur.artemislena.eu shipped as the first-choice
//             rimgo default while answering 200 with a bot challenge, so both
//             this check and the module's runtime probe read it as healthy. Where
//             a host has a recognisable body, assert against it.

import process from 'node:process';

const TIMEOUT_MS = 15000;

// A real rimgo instance titles its documents `rimgo`; challenge pages do not.
const RIMGO_BODY = /<title>\s*rimgo\s*<\/title>/i;

const FETCHED = [
	{
		name: 'rimgo mirrors (imgurFlatten defaults)',
		anyOf: [
			{ name: 'rimgo.reallyaweso.me', url: 'https://rimgo.reallyaweso.me/', expect: RIMGO_BODY },
			{ name: 'rmgur.com', url: 'https://rmgur.com/', expect: RIMGO_BODY },
		],
	},
	// Probe the routes `buildCommentUrl`/`buildPostUrl` actually construct. This
	// used to probe `/api/comments/search?limit=1`, an endpoint the extension
	// never calls — and on 2026-08-18 that route began answering 422 because it
	// now requires a constraining parameter. The check would have reported a
	// broken module while the module's own endpoint was fine, which is the same
	// class of lie as reporting a working one healthy.
	{ name: 'Arctic Shift comments (arcticShift, editedCommentDiff)', url: 'https://arctic-shift.photon-reddit.com/api/comments/ids?ids=abc123' },
	{ name: 'Arctic Shift posts (arcticShift)', url: 'https://arctic-shift.photon-reddit.com/api/posts/ids?ids=abc123' },
	{ name: 'PullPush API (viewDeleted, editedCommentDiff)', url: 'https://api.pullpush.io/reddit/search/comment/?size=1' },
	{ name: 'Wayback CDX API (waybackSnapshot)', url: 'https://web.archive.org/cdx/search/cdx?url=example.com&output=json&filter=statuscode%3A200&fl=timestamp%2Coriginal&limit=-1' },
	{ name: 'Bluesky oEmbed (hosts/bluesky)', url: 'https://embed.bsky.app/oembed?url=https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l' },
	// v0.40.0 dropped Giphy's API call for the media paths the id already
	// determines, so these two URLs are the whole host now. If the pattern ever
	// stops resolving, the expando breaks with nothing else to notice it.
	{ name: 'Giphy media mp4 (hosts/giphy)', url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.mp4' },
	{ name: 'Giphy media gif fallback (hosts/giphy)', url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif' },
];

const LINKED = [
	{ name: 'PullPush undelete UI (archiveLinks)', url: 'https://undelete.pullpush.io/' },
	{ name: 'Reveddit (archiveLinks)', url: 'https://www.reveddit.com/' },
	{ name: 'RedGifs (redgifsLayoutFix)', url: 'https://www.redgifs.com/' },
	// Loaded in an iframe by the browser, not fetched by us. A bogus paste id
	// legitimately 404s, so probe the host rather than inventing an id.
	{ name: 'Pastebin (hosts/pastebin)', url: 'https://pastebin.com/' },
	// The map preview, since Google's Embed API needs a key this project will not
	// ship. Loaded in an iframe by the browser rather than fetched by us.
	{ name: 'OpenStreetMap embed (hosts/googlemaps)', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-0.13,51.50,-0.11,51.52&layer=mapnik' },
];

// cobaltDownloader deliberately ships no default instance, so there is nothing
// to probe for it — see lib/utils/cobalt.js.

const healthy = status => status === 429 || (status >= 200 && status < 400);

async function probeOne({ name, url, expect }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'user-agent': 'RES-Slim endpoint check' },
		});
		const status = response.status;
		if (!healthy(status)) return { name, url, status, ok: false };
		// Only read the body where there is something to assert; a 429 has no
		// meaningful body and reading it would just slow the run down.
		if (expect && status !== 429) {
			const body = await response.text();
			if (!expect.test(body)) {
				return { name, url, status, ok: false, error: 'responded, but the body is not the expected service (bot challenge?)' };
			}
		}
		return { name, url, status, ok: true };
	} catch (e) {
		return { name, url, status: 0, ok: false, error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message };
	} finally {
		clearTimeout(timer);
	}
}

// A group stands in for one ordered setting: the feature works if any member
// answers, so the group's verdict is the disjunction of its members'.
async function probe(entry) {
	if (!entry.anyOf) return probeOne(entry);
	const members = await Promise.all(entry.anyOf.map(probeOne));
	return { name: entry.name, members, ok: members.some(m => m.ok) };
}

function report(results) {
	for (const r of results) {
		if (r.members) {
			const alive = r.members.filter(m => m.ok).length;
			console.log(`[${r.ok ? 'ok  ' : 'FAIL'}]      ${r.name} (${alive}/${r.members.length} alive)`);
			for (const m of r.members) {
				const detail = m.error ? ` (${m.error})` : '';
				console.log(`         ${m.ok ? ' ok ' : 'FAIL'} ${String(m.status).padStart(3)}  ${m.name}${detail}`);
				console.log(`                   ${m.url}`);
			}
			continue;
		}
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
