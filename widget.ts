import { DynamicBorder, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import type { ActiveWatcherInfo } from "./state.js";
import type { BroadcastChatMessage } from "./types.js";
import { xProfileLink } from "./links.js";

export class BroadcastChatWidget extends Container {
	constructor(
		private readonly theme: Theme,
		private readonly activeWatcher: ActiveWatcherInfo | undefined,
		private readonly messages: BroadcastChatMessage[],
	) {
		super();
		this.build();
	}

	override invalidate(): void {
		super.invalidate();
	}

	private build(): void {
		if (!this.activeWatcher) {
			this.addChild(new Text(this.theme.fg("dim", "𝕏 no active broadcast watcher"), 0, 0));
			return;
		}

		const title = this.activeWatcher.bootstrap.title ?? this.activeWatcher.bootstrap.broadcastId;
		const broadcastUrl = this.activeWatcher.bootstrap.url;
		const relevantMessages = this.messages
			.filter((message) => message.broadcastId === this.activeWatcher?.bootstrap.broadcastId)
			.slice(-3);

		this.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));
		this.addChild(new Text(this.theme.fg("accent", title), 0, 0));
		this.addChild(new Text(this.theme.fg("dim", broadcastUrl), 0, 0));
		this.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));

		if (relevantMessages.length === 0) {
			this.addChild(new Text(this.theme.fg("dim", "No chat messages yet"), 0, 0));
			return;
		}

		for (const message of relevantMessages) {
			const handle = this.theme.fg("muted", xProfileLink(message.username));
			this.addChild(new Text(`${handle} ${message.text}`, 0, 0));
		}
	}
}
