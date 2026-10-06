import {
	requestIp,
	requestUserAgent,
} from "../auth/web-auth-utils.js";

export const WEB_LOGIN_RESULTS = Object.freeze({
	SUCCESS: "success",
	FAILURE: "failure",
	LOCKED: "locked",
});

const VALID_RESULTS = new Set(Object.values(WEB_LOGIN_RESULTS));

function boundedText(value, maxLength, fallback = "") {
	const text = String(value ?? fallback).trim();
	return text.slice(0, maxLength);
}

function optionalAsn(value) {
	const asn = Number(value);
	return Number.isSafeInteger(asn) && asn >= 0 ? asn : null;
}

export function webLoginRequestMetadata(request) {
	const cf = request?.cf || {};
	return {
		ipAddress: boundedText(requestIp(request), 128, "unknown") || "unknown",
		userAgent: boundedText(requestUserAgent(request), 512),
		cfRay: boundedText(request.headers.get("CF-Ray"), 128),
		country: boundedText(cf.country || request.headers.get("CF-IPCountry"), 8),
		region: boundedText(cf.region, 128),
		city: boundedText(cf.city, 128),
		timezone: boundedText(cf.timezone, 128),
		asn: optionalAsn(cf.asn),
	};
}

function normalizeResult(value) {
	const result = String(value || "").trim().toLowerCase();
	if (!VALID_RESULTS.has(result)) {
		throw new Error("Invalid web login history result.");
	}
	return result;
}

function normalizeSessionRef(value) {
	if (value == null || value === "") return null;
	return boundedText(value, 32) || null;
}

export class LoginHistoryService {
	constructor(repository, { now = () => Date.now() } = {}) {
		this.repository = repository;
		this.now = now;
	}

	async record(request, {
		userId = null,
		username,
		result,
		reason,
		sessionRef = null,
		createdAt = this.now(),
	} = {}) {
		const metadata = webLoginRequestMetadata(request);
		const normalizedResult = normalizeResult(result);
		const record = {
			userId: userId == null ? null : Number(userId),
			username: boundedText(username, 128),
			result: normalizedResult,
			reason: boundedText(reason, 128, "unknown") || "unknown",
			...metadata,
			sessionRef: normalizeSessionRef(sessionRef),
			createdAt: Number(createdAt),
		};
		await this.repository.create(record);
		return record;
	}

	async list(options = {}) {
		return this.repository.list(options);
	}

	async stats() {
		return this.repository.stats();
	}
}
