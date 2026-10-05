import { nullableNumber } from "./core.js";

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const priceLargeFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
});
const priceSmallFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 4,
	minimumFractionDigits: 0,
});

export function toFaDigits(value) {
	return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

export function formatFaInteger(value) {
	const number = nullableNumber(value);
	return number == null
		? "نامشخص"
		: toFaDigits(integerFormatter.format(number).replace(/,/g, "٬"));
}

export function formatFaPrice(value) {
	const number = nullableNumber(value);
	if (number == null) return "نامشخص";
	const formatter = Math.abs(number) >= 1 ? priceLargeFormatter : priceSmallFormatter;
	return toFaDigits(formatter.format(number).replace(/,/g, "٬").replace(/\./g, "٫"));
}

export function formatOptionalToman(value) {
	const number = nullableNumber(value);
	return number == null ? "<b>نامشخص</b>" : `<b>${formatFaInteger(number)} تومان</b>`;
}

export function formatOptionalUsd(value) {
	const number = nullableNumber(value);
	return number == null ? "<b>نامشخص</b>" : `<b>${formatFaPrice(number)} دلار</b>`;
}

export function changeIcon(value) {
	const number = nullableNumber(value);
	return number == null || number === 0 ? "⚪" : number > 0 ? "🟢" : "🔴";
}

export function formatFaChangeValue(value) {
	const number = nullableNumber(value);
	if (number == null) return "<b>نامشخص</b>";
	const sign = number > 0 ? "+" : number < 0 ? "−" : "";
	return `<b>${sign}${formatFaPrice(Math.abs(number))}٪</b>`;
}

export function roundToNearest(value, step) {
	const number = nullableNumber(value);
	return number == null ? null : Math.round(number / step) * step;
}

export function calculateMazanehFromGram18(value) {
	const gram = nullableNumber(value);
	return gram && gram > 0 ? Math.round(gram * 4.6083 * (705 / 750)) : null;
}
