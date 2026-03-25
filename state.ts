import type { BroadcastChatMessage, BroadcastBootstrap } from "./types.js";

export interface ActiveWatcherInfo {
	bootstrap: BroadcastBootstrap;
	startedAt: number;
}

export class BroadcastChatStore {
	private messages: BroadcastChatMessage[] = [];
	private seenUuids = new Set<string>();
	private listeners = new Set<() => void>();
	private activeWatcher?: ActiveWatcherInfo;

	replaceMessages(messages: BroadcastChatMessage[]): void {
		this.messages = [];
		this.seenUuids.clear();
		for (const message of messages) {
			this.addMessage(message, false);
		}
		this.notify();
	}

	getMessages(): BroadcastChatMessage[] {
		return [...this.messages];
	}

	getMessageCount(): number {
		return this.messages.length;
	}

	hasMessage(uuid: string): boolean {
		return this.seenUuids.has(uuid);
	}

	addMessage(message: BroadcastChatMessage, notify = true): boolean {
		if (!message.uuid || this.seenUuids.has(message.uuid)) return false;

		this.seenUuids.add(message.uuid);
		this.messages.push(message);
		this.messages.sort((a, b) => a.timestampMs - b.timestampMs || a.uuid.localeCompare(b.uuid));
		if (notify) this.notify();
		return true;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	setActiveWatcher(activeWatcher: ActiveWatcherInfo | undefined): void {
		this.activeWatcher = activeWatcher;
		this.notify();
	}

	getActiveWatcher(): ActiveWatcherInfo | undefined {
		return this.activeWatcher;
	}

	clearActiveWatcher(): void {
		this.activeWatcher = undefined;
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
