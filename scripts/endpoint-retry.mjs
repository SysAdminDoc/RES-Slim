export const MAX_TRANSPORT_ATTEMPTS = 3;

const defaultWait = attempt => new Promise(resolve => {
	setTimeout(resolve, attempt * 250);
});

export function withTransportRetries(run, options = {}) {
	const maxAttempts = options.maxAttempts || MAX_TRANSPORT_ATTEMPTS;
	const wait = options.wait || defaultWait;

	async function attempt(number) {
		const result = await run();
		if (result.ok || result.status !== 0 || number >= maxAttempts) {
			return { ...result, attempts: number };
		}
		await wait(number);
		return attempt(number + 1);
	}

	return attempt(1);
}
