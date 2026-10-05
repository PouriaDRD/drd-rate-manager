const COPY = Object.freeze({
	fa: Object.freeze({
		owner: "مالک",
		admin: "ادمین",
		managementPanel: "پنل مدیریت",
		market: "مدیریت بازار",
		sources: "مدیریت منابع",
		admins: "مدیریت ادمین‌ها",
		settings: "تنظیمات",
		help: "راهنما",
		language: "زبان تلگرام",
		languageName: "فارسی",
		languageChanged: "زبان تلگرام روی فارسی تنظیم شد.",
		unauthorizedTitle: "⛔️ دسترسی غیرمجاز",
		unauthorizedBody: "شما اجازه استفاده از این ربات را ندارید.",
		selectAction: "از دکمه‌های زیر برای مدیریت بازار و سیستم استفاده کنید.",
		startDescription: "مدیریت بازار، منابع، انتشار خودکار و وضعیت سیستم از همین ربات انجام می‌شود.",
		helpTitle: "❓ راهنمای DRD RATE MANAGER",
		commands: "دستورات",
		start: "شروع",
		menu: "پنل مدیریت",
		telegramId: "شناسه تلگرام",
	}),
	en: Object.freeze({
		owner: "Owner",
		admin: "Admin",
		managementPanel: "Management panel",
		market: "Market management",
		sources: "Source management",
		admins: "Admin management",
		settings: "Settings",
		help: "Help",
		language: "Telegram language",
		languageName: "English",
		languageChanged: "Telegram language is now English.",
		unauthorizedTitle: "⛔️ Unauthorized",
		unauthorizedBody: "You do not have permission to use this bot.",
		selectAction: "Use the buttons below to manage the market and system.",
		startDescription: "Manage market data, providers, automatic publishing and system health from this bot.",
		helpTitle: "❓ DRD RATE MANAGER Help",
		commands: "Commands",
		start: "Start",
		menu: "Management panel",
		telegramId: "Telegram ID",
	}),
});

export function normalizeTelegramLanguage(value) {
	return value === "en" ? "en" : "fa";
}

export function telegramT(language, key) {
	const lang = normalizeTelegramLanguage(language);
	return COPY[lang][key] ?? COPY.fa[key] ?? key;
}
