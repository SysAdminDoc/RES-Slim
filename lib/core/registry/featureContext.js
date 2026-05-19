/* @flow */

function callSafely(fn) {
	try {
		fn();
	} catch (error) {
		console.error('Error during feature cleanup:', error);
	}
}

export function createFeatureContext(feature, services = {}) {
	const cleanupStack = [];
	let destroyed = false;

	function cleanup(fn) {
		if (typeof fn !== 'function') throw new TypeError(`Cleanup for ${feature.id} must be a function`);
		if (destroyed) {
			callSafely(fn);
			return fn;
		}
		cleanupStack.push(fn);
		return fn;
	}

	return {
		feature,
		featureId: feature.id,
		services,
		cleanup,

		on(target, eventName, handler, options) {
			target.addEventListener(eventName, handler, options);
			return cleanup(() => target.removeEventListener(eventName, handler, options));
		},

		observe(target, options, callback) {
			const observer = new MutationObserver(callback);
			observer.observe(target, options);
			cleanup(() => observer.disconnect());
			return observer;
		},

		addClass(element, className) {
			element.classList.add(className);
			return cleanup(() => element.classList.remove(className));
		},

		appendNode(parent, node) {
			parent.appendChild(node);
			return cleanup(() => {
				if (node.parentNode === parent) node.remove();
			});
		},

		addStyle(css, id) {
			if (typeof document === 'undefined') return null;
			const style = document.createElement('style');
			style.type = 'text/css';
			style.dataset.rsmFeature = feature.id;
			if (id) style.id = id;
			style.textContent = css;
			document.head.appendChild(style);
			cleanup(() => style.remove());
			return style;
		},

		setTimer(fn, delay) {
			const timer = window.setTimeout(fn, delay);
			cleanup(() => window.clearTimeout(timer));
			return timer;
		},

		setInterval(fn, delay) {
			const timer = window.setInterval(fn, delay);
			cleanup(() => window.clearInterval(timer));
			return timer;
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;
			while (cleanupStack.length) {
				const cleanup = cleanupStack.pop();
				callSafely(cleanup);
			}
		},
	};
}
