/* @flow */
// Pure helpers for the dragResize module. Computes the next size from a drag
// delta with min/max clamping and an optional aspect-ratio lock. Dependency-
// free for unit testing.

export type Size = {| width: number, height: number |};

export function clampSize(
	width: number,
	height: number,
	minWidth: number,
	maxWidth: number,
	minHeight: number,
	maxHeight: number,
): Size {
	const w = Math.max(minWidth, Math.min(maxWidth, width));
	const h = Math.max(minHeight, Math.min(maxHeight, height));
	return { width: w, height: h };
}

export function applyAspectRatio(
	startW: number,
	startH: number,
	nextW: number,
	nextH: number,
	mode: 'free' | 'lock-w' | 'lock-h',
): Size {
	const ratio = startH / Math.max(1, startW);
	if (mode === 'lock-w') return { width: nextW, height: nextW * ratio };
	if (mode === 'lock-h') return { width: nextH / Math.max(0.001, ratio), height: nextH };
	return { width: nextW, height: nextH };
}

export function computeNextSize(
	startW: number,
	startH: number,
	startX: number,
	startY: number,
	currentX: number,
	currentY: number,
	options: {|
		minWidth: number,
		maxWidth: number,
		minHeight: number,
		maxHeight: number,
		keepAspect: boolean,
	|},
): Size {
	const dx = currentX - startX;
	const dy = currentY - startY;
	let nextW = startW + dx;
	let nextH = startH + dy;
	if (options.keepAspect) {
		const ratio = startH / Math.max(1, startW);
		// Prefer the larger relative delta as the dominant axis.
		const relW = Math.abs(dx) / Math.max(1, startW);
		const relH = Math.abs(dy) / Math.max(1, startH);
		if (relW >= relH) nextH = nextW * ratio;
		else nextW = nextH / Math.max(0.001, ratio);
	}
	return clampSize(nextW, nextH, options.minWidth, options.maxWidth, options.minHeight, options.maxHeight);
}
