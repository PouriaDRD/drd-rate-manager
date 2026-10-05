const DEFAULTS = Object.freeze({
	admin_ui_language: "fa",
	admin_ui_theme: "system",
	telegram_language: "fa",
});

const LANGUAGES = new Set(["fa", "en"]);
const THEMES = new Set(["system", "dark", "light"]);
const KEYS = Object.freeze(Object.keys(DEFAULTS));

function language(value) {
	return LANGUAGES.has(String(value)) ? String(value) : DEFAULTS.admin_ui_language;
}

function theme(value) {
	return THEMES.has(String(value)) ? String(value) : DEFAULTS.admin_ui_theme;
}

export class PreferencesService {
	constructor(settings) {
		this.settings = settings;
		this.cache = { ...DEFAULTS };
		this.loaded = false;
	}

	async refresh() {
		const values = await this.settings.getMany(KEYS);
		this.cache = {
			admin_ui_language: language(values.admin_ui_language),
			admin_ui_theme: theme(values.admin_ui_theme),
			telegram_language: language(values.telegram_language),
		};
		this.loaded = true;
		return this.snapshot();
	}

	snapshot() {
		return { ...this.cache };
	}

	get adminLanguage() {
		return this.cache.admin_ui_language;
	}

	get adminTheme() {
		return this.cache.admin_ui_theme;
	}

	get telegramLanguage() {
		return this.cache.telegram_language;
	}

	async update(values) {
		const next = {};
		if (Object.hasOwn(values, "admin_ui_language")) next.admin_ui_language = language(values.admin_ui_language);
		if (Object.hasOwn(values, "admin_ui_theme")) next.admin_ui_theme = theme(values.admin_ui_theme);
		if (Object.hasOwn(values, "telegram_language")) next.telegram_language = language(values.telegram_language);
		if (!Object.keys(next).length) return this.snapshot();
		await this.settings.setMany(next);
		this.cache = { ...this.cache, ...next };
		this.loaded = true;
		return this.snapshot();
	}

	async toggleTelegramLanguage() {
		return this.update({ telegram_language: this.telegramLanguage === "fa" ? "en" : "fa" });
	}
}

export const PREFERENCE_DEFAULTS = DEFAULTS;
export const PREFERENCE_KEYS = KEYS;
