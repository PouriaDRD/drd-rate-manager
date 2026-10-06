const SENSITIVE_KEY_PATTERN =
	/(authorization|cookie|token|secret|password|api[_-]?key|session|csrf|webhook)/i;
const MAX_STRING_LENGTH = 1000;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 25;
const MAX_OBJECT_KEYS = 50;

function truncate(value, max = MAX_STRING_LENGTH) {
	const text = String(value ?? "");
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function redactOperationalValue(value, depth = 0) {
	if (value == null) return value;
	if (depth >= MAX_DEPTH) return "[truncated]";

	if (typeof value === "string") return truncate(value);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return String(value);

	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((item) => redactOperationalValue(item, depth + 1));
	}

	if (value instanceof Error) {
		return {
			name: truncate(value.name || "Error", 100),
			message: truncate(value.message || "Unknown error"),
			stack: value.stack ? truncate(value.stack, 4000) : null,
		};
	}

	if (typeof value === "object") {
		const result = {};
		for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
			result[key] = SENSITIVE_KEY_PATTERN.test(key)
				? "[redacted]"
				: redactOperationalValue(item, depth + 1);
		}
		return result;
	}

	return truncate(value);
}

function safePath(request) {
	try {
		return new URL(request.url).pathname || "/";
	} catch {
		return "/";
	}
}

function safeId(factory) {
	try {
		const value = String(factory?.() || "").trim();
		if (value) return truncate(value, 128);
	} catch {
		// Fall through to a timestamp/random fallback.
	}
	return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OperationalLogger {
	constructor({
		consoleRef = console,
		now = () => Date.now(),
		idFactory = () => crypto.randomUUID(),
	} = {}) {
		this.console = consoleRef;
		this.now = now;
		this.idFactory = idFactory;
	}

	beginHttp(request) {
		return {
			id: safeId(this.idFactory),
			kind: "http",
			startedAt: this.now(),
			method: String(request?.method || "GET").toUpperCase(),
			path: safePath(request),
			cfRay: request?.headers?.get?.("cf-ray") || null,
		};
	}

	beginScheduled() {
		return {
			id: safeId(this.idFactory),
			kind: "cron",
			startedAt: this.now(),
		};
	}

	start(context, fields = {}) {
		this.#write("info", `${context.kind}.start`, context, fields);
	}

	complete(context, fields = {}) {
		this.#write("info", `${context.kind}.complete`, context, {
			...fields,
			durationMs: Math.max(0, this.now() - Number(context.startedAt || 0)),
		});
	}

	fail(context, error, fields = {}) {
		this.#write("error", `${context.kind}.error`, context, {
			...fields,
			durationMs: Math.max(0, this.now() - Number(context.startedAt || 0)),
			error,
		});
	}

	warn(event, fields = {}) {
		this.#emit("warn", event, fields);
	}

	info(event, fields = {}) {
		this.#emit("info", event, fields);
	}

	#write(level, event, context, fields) {
		this.#emit(level, event, {
			operationId: context.id,
			kind: context.kind,
			method: context.method,
			path: context.path,
			cfRay: context.cfRay,
			...fields,
		});
	}

	#emit(level, event, fields) {
		const record = redactOperationalValue({
			timestamp: new Date(this.now()).toISOString(),
			level,
			event,
			...fields,
		});
		const writer =
			level === "error"
				? this.console.error
				: level === "warn"
					? this.console.warn
					: this.console.log;
		writer.call(this.console, record);
	}
}

export function withRequestId(response, requestId) {
	if (!(response instanceof Response)) return response;
	const headers = new Headers(response.headers);
	headers.set("X-Request-Id", String(requestId));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
