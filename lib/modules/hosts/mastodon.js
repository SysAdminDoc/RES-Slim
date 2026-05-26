/* @flow */
// RES-Slim: federated Mastodon embed. Detects `<instance>/@<user>/<id>`
// URLs and `<instance>/users/<user>/statuses/<id>` URLs, then asks the
// instance's own oembed endpoint for the embed HTML. Per-instance
// permissions are surfaced via `optional_host_permissions` in the manifest.

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';

const MASTODON_PATTERNS = [
	/^https?:\/\/([^/]+)\/@[\w-]+(?:@[\w.-]+)?\/(\d+)(?:[?#].*)?$/i,
	/^https?:\/\/([^/]+)\/users\/[\w-]+\/statuses\/(\d+)(?:[?#].*)?$/i,
];

// Default well-known instances we ship perms for. Users running niche servers
// can add the instance under chrome.permissions in the extension settings.
const KNOWN_INSTANCES: $ReadOnlyArray<string> = Object.freeze([
	'mastodon.social',
	'mastodon.online',
	'fosstodon.org',
	'hachyderm.io',
	'mas.to',
	'infosec.exchange',
	'mstdn.social',
]);

function detect(href: string): ?{| instance: string, id: string |} {
	if (typeof href !== 'string') return null;
	for (const re of MASTODON_PATTERNS) {
		const m = re.exec(href);
		if (m) return { instance: m[1], id: m[2] };
	}
	return null;
}

export default new Host('mastodon', {
	name: 'mastodon',
	logo: '',
	permissions: KNOWN_INSTANCES.map(host => `https://${host}/api/oembed`),
	domains: KNOWN_INSTANCES.slice(),
	detect: ({ href }) => detect(href),
	async handleLink(href) {
		const parsed = detect(href);
		if (!parsed) return undefined;
		const oembedUrl = `https://${parsed.instance}/api/oembed`;
		let post;
		try {
			post = await ajax({
				url: oembedUrl,
				query: { url: href },
				type: 'json',
			});
		} catch (e) {
			return undefined;
		}
		if (!post || typeof post !== 'object' || typeof post.html !== 'string') return undefined;
		const dummy = document.createElement('div');
		const sanitized = DOMPurify.sanitize(post.html);
		return {
			type: 'GENERIC_EXPANDO',
			muted: true,
			expandoClass: 'selftext',
			generate: () => dummy,
			onAttach: () => { setTrustedHTML(dummy, sanitized); },
		};
	},
});
