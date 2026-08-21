/* @flow */

import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { loadSnudown } from '../../utils/snudown';

export default new Host('tumblr', {
	name: 'tumblr',
	domains: ['tumblr.com'],
	permissions: ['https://api.tumblr.com/v2/blog/*/posts'],
	options: {
		apiKey: {
			title: 'showImagesTumblrApiKeyTitle',
			description: 'showImagesTumblrApiKeyDesc',
			value: '',
			type: 'text',
		},
	},
	logo: 'https://secure.assets.tumblr.com/images/favicons/favicon.ico',
	detect({ hostname, pathname }) {
		// Without a key there is nothing to expand, so the link is left alone rather
		// than given an expando button that can only fail. Tumblr's API is the only
		// route to a post body - its oEmbed endpoint stopped returning JSON, checked
		// 2026-08-18 - so unlike the other three hosts there is no key-less path to
		// fall back to. What ships instead is the ability to use your own key.
		if (!this.options || !this.options.apiKey.value) return null;
		const pathMatch = (/^\/(?:post|image)\/(\d+)(?:\/|$)/i).exec(pathname);
		return pathMatch && [hostname, pathMatch[1]];
	},
	async handleLink(href, [blog, id]) {
		const { response } = await ajax({
			url: `https://api.tumblr.com/v2/blog/${blog}/posts`,
			query: {
				api_key: String(this.options ? this.options.apiKey.value : ''),
				id,
				filter: 'raw',
			},
			type: 'json',
		});

		const post = response.posts[0];

		async function render(string) {
			return post.format === 'markdown' ?
				(await loadSnudown()).markdown(string) :
				string;
		}

		const defaults = {
			title: post.title,
			caption: post.caption,
			credits: `Posted by: <a href="${response.blog.url}">${response.blog.name}</a> @ Tumblr`,
		};

		switch (post.type) {
			case 'photo':
				if (!post.photos.length) throw new Error('No images in gallery.');
				return {
					type: 'GALLERY',
					...defaults,
					src: post.photos.map(photo => ({
						type: 'IMAGE',
						src: photo.original_size.url,
						caption: photo.caption,
					})),
				};
			case 'text':
				return {
					type: 'TEXT',
					...defaults,
					src: await render(post.body),
				};
			case 'quote':
				return {
					type: 'TEXT',
					...defaults,
					credits: post.source,
					src: `<blockquote><p>${await render(post.text)}</p></blockquote>`,
				};
			case 'link':
				return {
					type: 'TEXT',
					...defaults,
					title: `<a href="${post.url}">${post.title}</a>`,
					src: await render(post.description),
				};
			case 'chat':
				return {
					type: 'TEXT',
					...defaults,
					src: post.dialogue.reduce((prev, { label, phrase }) => `${prev}<blockquote><p><b>${label}</b> ${phrase}</p></blockquote>`, ''),
				};
			case 'answer':
				const asking = post.asking_url ?
					`<a href="${post.asking_url}">${post.asking_name}</a>` :
					post.asking_name;

				return {
					type: 'TEXT',
					...defaults,
					src: `<blockquote><p>${asking} sent: ${post.question}</p></blockquote>${await render(post.answer)}`,
				};
			default:
				throw new Error(`Unsupported post type: ${post.type}`);
		}
	},
});
