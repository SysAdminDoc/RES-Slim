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


// A real rimgo instance titles its documents `rimgo`; challenge pages do not.
const RIMGO_BODY = /<title>\s*rimgo\s*<\/title>/i;

const PERMISSION_HOSTS = [
	{ name: 'aar.li API (hosts/aarli)', url: 'https://aar.li/api.php?aarId=zzzz9999', expect: /"error"|"title"/ },
	{ name: 'DeviantArt oEmbed (hosts/deviantart)', url: 'https://backend.deviantart.com/oembed?url=https%3A%2F%2Fwww.deviantart.com%2Fdeviantart%2Fart%2Fprobe-0&format=json', accept: [404], expect: /is not a deviation URL|Deviation id not found/i },
	{ name: 'Flickr oEmbed (hosts/flickr)', url: 'https://www.flickr.com/services/oembed?url=https%3A%2F%2Fwww.flickr.com%2Fphotos%2Fbees%2F2341623661%2F&format=json' },
	{ name: 'Gyazo oEmbed (hosts/gyazo)', url: 'https://api.gyazo.com/api/oembed?url=https%3A%2F%2Fgyazo.com%2F8dc0f8dd1c1b0d2e1e0f2e0d0c0b0a09', accept: [400, 404], expect: /image not found/i },
	{ name: 'Imgur API (hosts/imgur)', url: 'https://api.imgur.com/3/image/HQ2S3Cf', accept: [401, 403], expect: /"data"|"error"|Rate ?limit/i },
	{ name: 'OneDrive shares API (hosts/onedrive)', url: 'https://api.onedrive.com/v1.0/shares/u!aHR0cHM6Ly8xZHJ2Lm1zL3UvcyFBaXZfaQ/root', accept: [400, 401, 403, 404], expect: /itemNotFound|"error"/i },
	{ name: 'Photobucket fromurl API (hosts/photobucket)', url: 'https://api.photobucket.com/v2/media/fromurl?url=http%3A%2F%2Fi1272.photobucket.com%2Falbums%2Fy383%2Fexample%2Fexample.jpg', accept: [400, 401, 403, 404], expect: /"statusCode"|Resource not found/i },
	{
		name: 'Steam published file API (hosts/steamcommunity)',
		url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v0001/?format=json',
		method: 'POST',
		body: 'itemcount=1&publishedfileids%5B0%5D=176396275',
		expect: /"publishedfiledetails"/,
	},
	{ name: 'Tenor GIF API (hosts/tenor)', url: 'https://api.tenor.co/v1/gifs?ids=16989081', accept: [400, 401, 403], expect: /API key missing|"results"/ },
	{ name: 'Tumblr posts API (hosts/tumblr)', url: 'https://api.tumblr.com/v2/blog/staff.tumblr.com/posts', accept: [401, 403], expect: /"meta"\s*:|"response"\s*:/ },
	{ name: 'Twitter/X oEmbed (hosts/twitter)', url: 'https://publish.x.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fjack%2Fstatus%2F20&omit_script=true' },
	{ name: 'Vidble album (hosts/vidble)', url: 'https://vidble.com/album/G2WMPRMH', accept: [404], expect: /<title>\s*Vidble/i },
	{ name: 'xkcd JSON (hosts/xkcd)', url: 'https://xkcd.com/614/info.0.json' },
];

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
	// The example.com root has a large capture index and routinely spends more
	// than 15 seconds finding its final row. This smaller, stable IANA page still
	// exercises the exact CDX query shape the module builds.
	{ name: 'Wayback CDX API (waybackSnapshot)', url: 'https://web.archive.org/cdx/search/cdx?url=iana.org/domains/reserved&output=json&filter=statuscode%3A200&fl=timestamp%2Coriginal&limit=-1' },
	{ name: 'Bluesky oEmbed (hosts/bluesky)', url: 'https://embed.bsky.app/oembed?url=https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l' },
	// v0.40.0 dropped Giphy's API call for the media paths the id already
	// determines, so these two URLs are the whole host now. If the pattern ever
	// stops resolving, the expando breaks with nothing else to notice it.
	{ name: 'Giphy media mp4 (hosts/giphy)', url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.mp4' },
	{ name: 'Giphy media gif fallback (hosts/giphy)', url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif' },
	// Every host that declares an optional permission. Bluesky is above, with the
	// other oEmbed entries; the rest are here so the list stays one thing to keep
	// in step with `lib/modules/hosts/`.
	...PERMISSION_HOSTS,
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
	// Framed by the expando, never fetched, so a scripted refusal here says
	// nothing about whether the reader's frame loads.
	{ name: 'Threads post page (hosts/threads)', url: 'https://www.threads.com/@zuck/post/C2QBoRaRmR1' },
];

// `vreddit` has no entry on purpose. Its permission is `https://*.redd.it/*`,
// which is reddit's own media infrastructure, and probing it would make this gate
// fetch reddit from the machine that runs it -- which the house rules forbid.
// Its DASH manifests are also per-video and mortal, so a 403 there means a
// removed video or a geo-block at least as often as it means a broken host.
//
// cobaltDownloader deliberately ships no default instance, so there is nothing
// to probe for it — see lib/utils/cobalt.js.

export { FETCHED, LINKED, PERMISSION_HOSTS };
