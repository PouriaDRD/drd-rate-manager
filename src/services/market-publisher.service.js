/** Channel publisher with an explicit rendering dependency. */
export class MarketPublisher {
	constructor(config, telegram, builder) {
		this.config = config;
		this.telegram = telegram;
		this.builder = builder;
	}

	async publish(snapshot) {
		if (!this.config.channelId) throw new Error("TELEGRAM_CHANNEL_ID is missing");
		return this.telegram.sendRichMessage(
			this.config.channelId,
			this.builder.buildRichMessage(snapshot),
		);
	}
}
