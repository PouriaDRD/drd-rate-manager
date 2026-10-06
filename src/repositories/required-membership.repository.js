export const REQUIRED_MEMBERSHIP_EXTRA_CHANNELS_KEY = "telegram_required_extra_channels_v1";

function normalizeStoredChannels(value) {
	let parsed;
	try {
		parsed = JSON.parse(String(value || "[]"));
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed
		.map((item) => String(item || "").trim())
		.filter(Boolean)
		.slice(0, 10);
}

/** Persists owner-managed required Telegram channels in the existing settings table. */
export class RequiredMembershipRepository {
	constructor(settings) {
		this.settings = settings;
	}

	async listExtra() {
		return normalizeStoredChannels(
			await this.settings.get(REQUIRED_MEMBERSHIP_EXTRA_CHANNELS_KEY, "[]"),
		);
	}

	async replaceExtra(channels) {
		const normalized = normalizeStoredChannels(JSON.stringify(channels));
		await this.settings.set(
			REQUIRED_MEMBERSHIP_EXTRA_CHANNELS_KEY,
			JSON.stringify(normalized),
		);
		return normalized;
	}
}
