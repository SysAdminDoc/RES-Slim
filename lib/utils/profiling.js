/* @flow */

let counter = 0;
export function markStart(): string {
	const tag = (++counter).toString();
	performance.mark(tag);
	return tag;
}

export function markEnd(tag: string, name: string) {
	performance.measure(name, tag);
	// The mark has done its job once the measure exists, and nothing ever cleared
	// either: about five hundred entries accumulated per page, half of them marks
	// nobody reads. The measures stay - they are what the support dump reports
	// when a reader asks for one, and what `window.rsmDiagnostics` reads.
	performance.clearMarks(tag);
}

export type ModuleTiming = {|
	moduleID: string,
	stage: string,
	durationMs: number,
|};

export function getModuleTimings(): ModuleTiming[] {
	return performance.getEntriesByType('measure')
		.filter(e => e.name.includes(' ('))
		.map(e => {
			const match = e.name.match(/^(.+) \((.+)\)$/);
			if (!match) return null;
			return {
				moduleID: match[1],
				stage: match[2],
				durationMs: Math.round(e.duration * 100) / 100,
			};
		})
		.filter(Boolean);
}

export function getModuleSummary(): { moduleID: string, totalMs: number, stages: { [string]: number } }[] {
	const timings = getModuleTimings();
	const byModule: { [string]: { totalMs: number, stages: { [string]: number } } } = {};
	for (const { moduleID, stage, durationMs } of timings) {
		if (!byModule[moduleID]) byModule[moduleID] = { totalMs: 0, stages: {} };
		byModule[moduleID].totalMs += durationMs;
		byModule[moduleID].stages[stage] = (byModule[moduleID].stages[stage] || 0) + durationMs;
	}
	return Object.entries(byModule)
		.map(([moduleID, data]) => ({ moduleID, ...(data: any) }))
		.sort((a, b) => b.totalMs - a.totalMs);
}
