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

// The keyboard half of the same resize.
//
// WCAG 2.2 SC 2.5.7 Dragging Movements: any function operated by dragging needs
// a single-pointer alternative unless dragging is essential. Resizing is not,
// and the handle was pointer-only, so it was unusable without a mouse and
// unreachable with a keyboard at all.
//
// Pure and separate from the module for the same reason `computeNextSize` is:
// the arithmetic is where the off-by-one lives, and it can be checked without a
// DOM. Returns null for a key this does not handle, so the caller knows whether
// to consume the event.

export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;

export function computeKeyboardSize(
	startW: number,
	startH: number,
	key: string,
	shiftKey: boolean,
	options: {|
		minWidth: number,
		maxWidth: number,
		minHeight: number,
		maxHeight: number,
		keepAspect: boolean,
	|},
): Size | null {
	const step = shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
	const ratio = startH / Math.max(1, startW);

	let nextW = startW;
	let nextH = startH;

	switch (key) {
		// The handle sits at the bottom right corner, so the directions match
		// where it would go under a pointer: right and down grow.
		case 'ArrowRight': nextW = startW + step; break;
		case 'ArrowLeft': nextW = startW - step; break;
		case 'ArrowDown': nextH = startH + step; break;
		case 'ArrowUp': nextH = startH - step; break;
		// A keyboard user should not have to hold an arrow down to cross the whole
		// range, which is the other half of what makes a drag-only control hostile.
		case 'Home': nextW = options.minWidth; nextH = options.minWidth * ratio; break;
		case 'End': nextW = options.maxWidth; nextH = options.maxWidth * ratio; break;
		default: return null;
	}

	if (options.keepAspect && key !== 'Home' && key !== 'End') {
		if (nextW !== startW) nextH = nextW * ratio;
		else nextW = nextH / Math.max(0.001, ratio);
	}

	return clampSize(nextW, nextH, options.minWidth, options.maxWidth, options.minHeight, options.maxHeight);
}
