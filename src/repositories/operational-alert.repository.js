import { safeJson } from "../utils/core.js";

export const OPERATIONAL_ALERT_STATE_KEY =
	"internal.operational_alert_state_v1";

const EMPTY_STATE = Object.freeze({
	active: false,
	fingerprint: null,
	severity: null,
	reasons: [],
	firstSentAt: 0,
	lastSentAt: 0,
	recoveredAt: 0,
});

function normalizeState(value) {
	const state = value && typeof value === "object" ? value : {};
	return {
		active: Boolean(state.active),
		fingerprint: state.fingerprint ? String(state.fingerprint) : null,
		severity: state.severity ? String(state.severity) : null,
		reasons: Array.isArray(state.reasons)
			? state.reasons.map(String).slice(0, 20)
			: [],
		firstSentAt: Number(state.firstSentAt || 0),
		lastSentAt: Number(state.lastSentAt || 0),
		recoveredAt: Number(state.recoveredAt || 0),
	};
}

export class OperationalAlertRepository {
	constructor(settings) {
		this.settings = settings;
	}

	async get() {
		const raw = await this.settings.get(OPERATIONAL_ALERT_STATE_KEY, null);
		if (!raw) return { ...EMPTY_STATE };
		return normalizeState(safeJson(raw, EMPTY_STATE));
	}

	async set(state) {
		const normalized = normalizeState(state);
		await this.settings.set(
			OPERATIONAL_ALERT_STATE_KEY,
			JSON.stringify(normalized),
		);
		return normalized;
	}
}

export const EMPTY_OPERATIONAL_ALERT_STATE = EMPTY_STATE;
