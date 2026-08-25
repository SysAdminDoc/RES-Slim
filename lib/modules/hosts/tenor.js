/* @flow */

import { Host } from '../../core/host';
import { ajax } from '../../environment';

// A sixth inherited credential lived here until v0.52.0: `key: 'JJHDC7UK73EH'`,
// sent as a query parameter to `api.tenor.co/v1/gifs`. It survived the sweep
// that removed the other five because the credential contract's shapes were
// fitted to how those five were written - an `api_key:` property, a `?key=` in a
// URL string, a `const apiId =`, a `Client-ID` header - and none of them match a
// bare `key:` inside a request's `query` object. The key was still live when
// checked on 2026-08-25.
//
// Same resolution as tumblr and imgur: the key becomes the reader's own, and the
// branch that needs it goes quiet until one is set rather than offering an
// expando that can only fail. `media.tenor.*` serves its files directly, so that
// path keeps working with no key at all.
//
// The `domains` list also said `tenor.co` alone. That host has redirected to
// `tenor.com` for years, and `tenor.com` is what people actually paste into
// reddit, so this host matched almost nothing that gets posted.
export default new Host('tenor', {
	name: 'tenor',
	domains: ['tenor.com', 'tenor.co'],
	permissions: ['https://api.tenor.co/v1/gifs*'],
	options: {
		apiKey: {
			title: 'showImagesTenorApiKeyTitle',
			description: 'showImagesTenorApiKeyDesc',
			value: '',
			type: 'text',
		},
	},
	logo: 'https://tenor.com/favicon.ico',
	detect: (() => {
		const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		const alphabetMap = alphabet
			.split('')
			.reduce((obj, c, i) => {
				obj[c] = i;
				return obj;
			}, {});

		function parseViewShortId(s) {
			return s
				.split('')
				.reduce((n, c) => (n * alphabet.length) + alphabetMap[c], 0);
		}

		return function detect({ hostname, pathname }) {
			// The CDN needs no lookup: some files there are named "raw" with no
			// extension, which is the whole reason this branch exists.
			if (hostname === 'media.tenor.com' || hostname === 'media.tenor.co') return { id: null };

			const hasKey = Boolean(this.options && this.options.apiKey.value);
			if (!hasKey) return null;

			if (hostname === 'tenor.com' || hostname === 'tenor.co') {
				// short URL
				const shortMatch = (/^\/([a-zA-Z0-9]+)\.gif$/i).exec(pathname);
				if (shortMatch) return { id: parseViewShortId(shortMatch[1]) };
			}

			const pathMatch = (/^\/view\/.+-(\d+)(\.gif)?$/i).exec(pathname);
			return pathMatch && { id: pathMatch[1] };
		};
	})(),
	async handleLink(href, { id }) {
		if (id === null) {
			return {
				type: 'IMAGE',
				src: href,
			};
		}

		const { results: [gif] } = await ajax({
			url: 'https://api.tenor.co/v1/gifs',
			query: { key: String(this.options ? this.options.apiKey.value : ''), ids: id },
			type: 'json',
		});

		if (!gif) throw new Error('Tenor returned no result for this link.');

		return {
			type: 'IMAGE',
			src: gif.media[0].gif.url,
			title: gif.h1_title,
			caption: gif.generatedcaption,
		};
	},
});
