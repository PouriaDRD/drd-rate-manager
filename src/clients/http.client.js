/** Timeout-aware HTTP client with compact source errors. */
export class HttpClient {
	async fetch(url, init = {}, timeoutMs = 8000) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	async sourceError(response) {
		let text = "";
		try {
			text = await response.text();
		} catch {
			// Status code remains useful when the response body cannot be read.
		}
		text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
		return `HTTP ${response.status}${text ? `: ${text}` : ""}`;
	}
}
