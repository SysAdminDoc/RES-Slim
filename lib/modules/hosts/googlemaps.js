/* @flow */

import { Host } from '../../core/host';

export default new Host('googlemaps', {
	domains: ['maps.google.ca', 'maps.google.com', 'google.co.uk', 'google.com', 'google.ca'],
	logo: 'https://maps.google.com/favicon.ico',
	// Still detects Google Maps links; the preview itself is rendered by
	// OpenStreetMap, which is what the name has to say so nobody is surprised.
	name: 'Google Maps (OpenStreetMap preview)',
	detect: ({ host, searchParams, pathname }) => {
		// Only valid if we can find some coords to display
		if (host.startsWith('maps.') || pathname.startsWith('/maps')) {
			const coords = searchParams.get('ll') || searchParams.get('q');
			if (coords) {
				// Handle old style maps.google urls
				return [
					coords,
					searchParams.get('z'),
					searchParams.has('maptype') ? searchParams.get('maptype') : 'roadmap',
				];
			} else {
				// Parse new style google map urls
				const location = pathname.split('/').find(part => part.startsWith('@'));
				if (location) {
					const [long, lat, zoom] = location.substring(1).split(',');

					return [
						`${long},${lat}`,
						zoom.endsWith('z') ? zoom : 16, // passing a meter zoom level to maps does not make it happy
						zoom.endsWith('z') ? 'roadmap' : 'satellite',
					];
				}
			}
		}
	},
	handleLink(href, [coords, zoom]) {
		// Google's Embed API requires a key, and the one inherited from upstream is
		// not this project's to spend: it is a live quota credential in a public
		// repo, revocable by its owner without notice, at which point every map
		// preview would break with nothing to diagnose it by. OpenStreetMap's embed
		// needs no key and no quota, so the preview keeps working for everyone
		// rather than working for as long as someone else's key survives.
		//
		// The trade is tiles and the `maptype` parameter - OSM has no satellite
		// layer - for a feature that does not depend on a stranger's credential.
		const [lat, lon] = String(coords).split(',').map(Number);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
			return { type: 'IFRAME', embed: 'about:blank', muted: true };
		}

		// The embed takes a bounding box rather than a centre and zoom. Web-mercator
		// tiles are 256px and the world is 360 degrees wide at zoom 0, so one pixel
		// spans 360 / (256 * 2^z) degrees of longitude; latitude is narrowed by the
		// cosine of the parallel. Half of a ~640x480 viewport gives the box.
		const level = Math.min(19, Math.max(1, parseInt(String(zoom || 16), 10) || 16));
		const degreesPerPixel = 360 / (256 * (2 ** level));
		const halfWidth = 320 * degreesPerPixel;
		const halfHeight = 240 * degreesPerPixel * Math.max(0.1, Math.cos(lat * Math.PI / 180));
		const bbox = [lon - halfWidth, lat - halfHeight, lon + halfWidth, lat + halfHeight]
			.map(n => n.toFixed(6)).join(',');

		return {
			type: 'IFRAME',
			embed: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`,
			muted: true,
		};
	},
});
