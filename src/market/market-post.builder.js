import {
	changeIcon,
	formatFaChangeValue,
	formatOptionalToman,
	formatOptionalUsd,
	roundToNearest,
} from "../utils/formatters.js";
import { coinNameFa, escapeHtml } from "../utils/core.js";
import { formatIranDate, formatIranTime } from "../utils/datetime.js";

/** Pure market-post renderer. No network or database access. */
export class MarketPostBuilder {
	constructor(config) {
		this.config = config;
	}

	buildRichMessage(snapshot) {
		const LRI = "\u2066";
		const PDI = "\u2069";
		const ltr = (value) => `${LRI}${value}${PDI}`;
		const cryptoItem = (coin) => {
			const name = escapeHtml(coinNameFa(coin.id, coin.name));
			const price = coin.price == null ? "<b>نامشخص</b>" : formatOptionalUsd(coin.price);
			const change = coin.change24h == null
				? "⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>"
				: `${changeIcon(coin.change24h)} تغییر ۲۴ ساعته: ${formatFaChangeValue(coin.change24h)}`;
			return `<p><b>${name}</b><br>${price}<br>${change}</p>`;
		};
		const [firstCoin, ...remainingCoins] = snapshot.crypto || [];
		const firstCryptoHtml = firstCoin ? cryptoItem(firstCoin) : "<p><b>نامشخص</b></p>";
		const remainingCryptoHtml = remainingCoins.map(cryptoItem).join("");
		const mazaneh = snapshot.metals?.mazaneh == null
			? null
			: roundToNearest(snapshot.metals.mazaneh, 1000);
		const remainingMetalsHtml = [
			`<p><b>مظنه طلا</b><br>${formatOptionalToman(mazaneh)}</p>`,
			`<p><b>انس طلا</b><br>${formatOptionalUsd(snapshot.metals?.gold)}</p>`,
			`<p><b>نقره</b><br>${formatOptionalUsd(snapshot.metals?.silver)}</p>`,
		].join("");
		const footerTime = ltr(
			`🕒 ${formatIranTime(this.config, snapshot.createdAt)} · 📅 ${formatIranDate(this.config, snapshot.createdAt)}`,
		);
		const handle = this.config.channelHandle;
		const footerChannel = handle ? ltr(`🚀 ${escapeHtml(handle)}`) : "";
		const html = [
			"<p><b>⚡️ نبض بازار</b></p>",
			`<p>💵 <b>تتر</b><br>${formatOptionalToman(snapshot.usdt?.price)}</p>`,
			"<p><br></p>",
			"<p><b>🪙 رمزارزها</b></p>",
			firstCryptoHtml,
			remainingCoins.length
				? `<details><summary>برای مشاهده بقیه، ضربه بزنید ↓</summary>${remainingCryptoHtml}</details>`
				: "",
			"<p><br></p>",
			"<p><b>🥇 طلا و فلزات</b></p>",
			`<p><b>طلای ۱۸ عیار</b><br>${formatOptionalToman(snapshot.metals?.gram18)}</p>`,
			`<details><summary>برای مشاهده بقیه، ضربه بزنید ↓</summary>${remainingMetalsHtml}</details>`,
			"<p><br></p>",
			"<hr/>",
			`<p>${footerTime}</p>`,
			handle ? `<blockquote>${footerChannel}</blockquote>` : "",
		].join("");
		return { html, is_rtl: true, skip_entity_detection: false };
	}

	buildFallbackHtml(snapshot) {
		const lines = [
			"⚡️ <b>نبض بازار</b>",
			"",
			"💵 <b>تتر</b>",
			formatOptionalToman(snapshot.usdt?.price),
			"",
			"",
			"🪙 <b>رمزارزها</b>",
			"",
		];
		for (const coin of snapshot.crypto || []) {
			lines.push(
				`<b>${escapeHtml(coinNameFa(coin.id, coin.name))}</b>`,
				formatOptionalUsd(coin.price),
				coin.change24h == null
					? "⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>"
					: `${changeIcon(coin.change24h)} تغییر ۲۴ ساعته: ${formatFaChangeValue(coin.change24h)}`,
				"",
			);
		}
		lines.push(
			"",
			"🥇 <b>طلا و فلزات</b>",
			"",
			"<b>طلای ۱۸ عیار</b>",
			formatOptionalToman(snapshot.metals?.gram18),
			"",
			"<b>مظنه طلا</b>",
			formatOptionalToman(roundToNearest(snapshot.metals?.mazaneh, 1000)),
			"",
			"<b>انس طلا</b>",
			formatOptionalUsd(snapshot.metals?.gold),
			"",
			"<b>نقره</b>",
			formatOptionalUsd(snapshot.metals?.silver),
			"",
			"",
			"━━━━━━━━━━━━",
			"",
			`🕒 <b>${escapeHtml(formatIranTime(this.config, snapshot.createdAt))}</b> · 📅 <b>${escapeHtml(formatIranDate(this.config, snapshot.createdAt))}</b>`,
		);
		if (this.config.channelHandle) {
			lines.push("", `<blockquote>🚀 ${escapeHtml(this.config.channelHandle)}</blockquote>`);
		}
		return lines.join("\n");
	}
}
