import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { BroadcastChatStore } from "./state.js";
import type { BroadcastChatMessage } from "./types.js";
import { xProfileLink } from "./links.js";

const BOX_WIDTH = 100;
const BOX_HEIGHT = 24;
const BODY_HEIGHT = BOX_HEIGHT - 6;

export class BroadcastChatOverlay {
	readonly width = BOX_WIDTH;

	private scrollTop = 0;
	private unsubscribe?: () => void;
	private lastBodyLineCount = 0;

	constructor(
		private readonly store: BroadcastChatStore,
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly done: () => void,
	) {
		this.unsubscribe = this.store.subscribe(() => {
			const nextLineCount = this.computeBodyLines(this.width - 2).length;
			const wasAtBottom = this.scrollTop >= Math.max(0, this.lastBodyLineCount - BODY_HEIGHT);
			this.lastBodyLineCount = nextLineCount;
			if (wasAtBottom) {
				this.scrollTop = Math.max(0, nextLineCount - BODY_HEIGHT);
			}
			this.requestRender();
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q") {
			this.done();
			return;
		}

		const maxScroll = Math.max(0, this.lastBodyLineCount - BODY_HEIGHT);
		if (matchesKey(data, "up")) {
			this.scrollTop = Math.max(0, this.scrollTop - 1);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			this.scrollTop = Math.min(maxScroll, this.scrollTop + 1);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scrollTop = Math.max(0, this.scrollTop - BODY_HEIGHT);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scrollTop = Math.min(maxScroll, this.scrollTop + BODY_HEIGHT);
			this.requestRender();
			return;
		}
		if (matchesKey(data, "home")) {
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "end")) {
			this.scrollTop = maxScroll;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const actualWidth = Math.min(width, this.width);
		const innerWidth = actualWidth - 2;
		const lines: string[] = [];
		const bodyLines = this.computeBodyLines(innerWidth);
		const maxScroll = Math.max(0, bodyLines.length - BODY_HEIGHT);
		if (this.lastBodyLineCount === 0) {
			this.scrollTop = maxScroll;
		}
		this.lastBodyLineCount = bodyLines.length;
		this.scrollTop = Math.min(this.scrollTop, maxScroll);

		lines.push(this.border("top", innerWidth));
		lines.push(this.row(innerWidth, ` ${this.theme.fg("accent", "𝕏 Broadcast Chat")}`));

		const active = this.store.getActiveWatcher();
		const subtitle = active
			? `${active.bootstrap.title ?? active.bootstrap.broadcastId}  (${this.store.getMessageCount()} messages)`
			: `Stored messages: ${this.store.getMessageCount()}`;
		lines.push(this.row(innerWidth, ` ${this.theme.fg("dim", truncateToWidth(subtitle, innerWidth - 1))}`));

		const visibleBody = bodyLines.slice(this.scrollTop, this.scrollTop + BODY_HEIGHT);
		for (let i = 0; i < BODY_HEIGHT; i++) {
			lines.push(this.row(innerWidth, visibleBody[i] ?? ""));
		}

		lines.push(this.row(innerWidth, ""));
		lines.push(
			this.row(
				innerWidth,
				` ${this.theme.fg(
					"dim",
					truncateToWidth(`↑↓ scroll • fn+↑/↓ page • Home/End • Esc close`, innerWidth - 1),
				)}`,
			),
		);
		lines.push(this.border("bottom", innerWidth));
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private computeBodyLines(innerWidth: number): string[] {
		const messageWidth = Math.max(10, innerWidth - 2);
		const messages = this.store.getMessages();
		if (messages.length === 0) {
			return [this.theme.fg("dim", " No chat messages yet")];
		}

		const lines: string[] = [];
		for (const message of messages) {
			lines.push(...this.renderMessage(message, messageWidth));
			lines.push("");
		}
		if (lines[lines.length - 1] === "") lines.pop();
		return lines;
	}

	private renderMessage(message: BroadcastChatMessage, width: number): string[] {
		const time = new Date(message.timestampMs).toLocaleTimeString();
		const handle = this.theme.fg("muted", xProfileLink(message.username));
		const header = `${this.theme.fg("dim", `[${time}]`)} ${handle}`;
		const body = wrapTextWithAnsi(message.text, width);
		return [header, ...body];
	}

	private row(innerWidth: number, content: string): string {
		const padded = this.pad(content, innerWidth);
		return this.theme.fg("border", "│") + padded + this.theme.fg("border", "│");
	}

	private border(kind: "top" | "bottom", innerWidth: number): string {
		if (kind === "top") return this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
		return this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
	}

	private pad(content: string, width: number): string {
		const truncated = truncateToWidth(content, width, "");
		const visible = visibleWidth(truncated);
		return truncated + " ".repeat(Math.max(0, width - visible));
	}
}
