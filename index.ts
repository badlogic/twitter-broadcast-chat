import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BroadcastChatOverlay } from "./overlay.js";
import { BroadcastChatStore } from "./state.js";
import { POLL_INTERVAL_MS, type BroadcastBootstrap, type BroadcastChatMessage } from "./types.js";
import { bootstrapBroadcast, fetchInitialHistory, fetchMessagesSince, isAuthLikeError } from "./twitter-chat-api.js";
import { BroadcastChatWidget } from "./widget.js";

interface RuntimeWatcher {
	stop(): void;
	bootstrap: BroadcastBootstrap;
}

type UiContext = Pick<ExtensionContext, "ui" | "hasUI">;

const store = new BroadcastChatStore();
const WIDGET_ID = "twitter-broadcast-chat";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("aborted"));
		};

		if (signal.aborted) {
			onAbort();
			return;
		}

		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export default function twitterBroadcastChat(pi: ExtensionAPI): void {
	let watcher: RuntimeWatcher | undefined;
	let currentUiContext: UiContext | undefined;

	function rememberUiContext(ctx: UiContext): void {
		currentUiContext = ctx;
	}

	function clearStore(): void {
		store.replaceMessages([]);
		store.clearActiveWatcher();
	}

	function updateUi(ctx?: UiContext): void {
		const activeCtx = ctx ?? currentUiContext;
		if (!activeCtx?.hasUI) return;

		const active = store.getActiveWatcher();
		if (!active) {
			activeCtx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		activeCtx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
			return new BroadcastChatWidget(theme, store.getActiveWatcher(), store.getMessages());
		});
	}

	function stopWatcher(ctx?: UiContext, notifyMessage?: string): void {
		watcher?.stop();
		watcher = undefined;
		clearStore();
		updateUi(ctx);
		if (ctx?.hasUI && notifyMessage) ctx.ui.notify(notifyMessage, "info");
	}

	async function startWatcher(url: string, ctx: ExtensionCommandContext): Promise<void> {
		rememberUiContext(ctx);
		stopWatcher();

		const bootstrap = await bootstrapBroadcast(url);
		const initialHistory = await fetchInitialHistory(bootstrap);

		store.setActiveWatcher({ bootstrap, startedAt: Date.now() });
		store.replaceMessages(initialHistory);
		updateUi(ctx);

		ctx.ui.notify(
			`Watching ${bootstrap.title ?? bootstrap.broadcastId}. Loaded ${initialHistory.length} chat messages.`,
			"info",
		);

		const controller = new AbortController();
		watcher = {
			bootstrap,
			stop: () => controller.abort(),
		};

		void pollLoop(url, bootstrap, controller.signal, ctx, () => watcher, (message) => {
			if (!store.addMessage(message)) return;
			updateUi(ctx);
			ctx.ui.notify(`New X chat from @${message.username}`, "info");
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		rememberUiContext(ctx);
		stopWatcher();
		updateUi(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		rememberUiContext(ctx);
		stopWatcher(ctx, "Stopped X broadcast watcher due to session switch.");
	});

	pi.on("session_fork", async (_event, ctx) => {
		rememberUiContext(ctx);
		stopWatcher(ctx, "Stopped X broadcast watcher due to session fork.");
	});

	pi.on("session_shutdown", async () => {
		stopWatcher();
	});

	pi.registerCommand("twitter-broadcast", {
		description: "Watch an X broadcast chat and show recent messages in a widget",
		handler: async (args, ctx) => {
			rememberUiContext(ctx);
			try {
				ctx.ui.notify(`Connecting to broadcast ${args.trim()}`, "info");
				await startWatcher(args, ctx);
			} catch (error) {
				stopWatcher();
				ctx.ui.notify(`twitter-broadcast failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("twitter-broadcast-view", {
		description: "Show a scrollable overlay with all currently loaded X broadcast chat messages",
		handler: async (_args, ctx) => {
			rememberUiContext(ctx);
			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => new BroadcastChatOverlay(store, theme, () => tui.requestRender(), () => done(undefined)),
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-right",
						width: 100,
						maxHeight: 24,
						margin: 1,
					},
				},
			);
		},
	});
}

async function pollLoop(
	url: string,
	initialBootstrap: BroadcastBootstrap,
	signal: AbortSignal,
	ctx: ExtensionCommandContext,
	getWatcher: () => RuntimeWatcher | undefined,
	onMessage: (message: BroadcastChatMessage) => void,
): Promise<void> {
	let bootstrap = initialBootstrap;
	let sinceNs = getNextSinceNs(store.getMessages(), bootstrap.broadcastId);
	let consecutiveErrors = 0;

	while (!signal.aborted) {
		try {
			await sleep(POLL_INTERVAL_MS, signal);
			const currentWatcher = getWatcher();
			if (!currentWatcher || currentWatcher.bootstrap.broadcastId !== bootstrap.broadcastId) return;

			const messages = await fetchMessagesSince(bootstrap, sinceNs);
			consecutiveErrors = 0;

			for (const message of messages) {
				if (message.timestampMs > 0) {
					sinceNs = Math.max(sinceNs, message.timestampMs * 1_000_000 + 1);
				}
				if (store.hasMessage(message.uuid)) continue;
				onMessage(message);
			}
		} catch (error) {
			if (signal.aborted) return;
			consecutiveErrors++;

			if (isAuthLikeError(error)) {
				try {
					bootstrap = await bootstrapBroadcast(url);
					store.setActiveWatcher({ bootstrap, startedAt: Date.now() });
					ctx.ui.notify("Refreshed X broadcast chat token.", "info");
					continue;
				} catch (refreshError) {
					if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
						ctx.ui.notify(
							`twitter-broadcast poll failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
							"error",
						);
					}
				}
			}

			if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
				ctx.ui.notify(
					`twitter-broadcast poll failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		}
	}
}

function getNextSinceNs(messages: BroadcastChatMessage[], broadcastId: string): number {
	let max = 0;
	for (const message of messages) {
		if (message.broadcastId !== broadcastId) continue;
		max = Math.max(max, message.timestampMs * 1_000_000 + 1);
	}
	return max;
}
