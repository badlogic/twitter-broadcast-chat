import { bootstrapBroadcast, connectBroadcastChat, fetchInitialHistory } from "./twitter-chat-api.js";

function formatTimestamp(timestampMs: number): string {
	return new Date(timestampMs).toISOString();
}

async function main(): Promise<void> {
	const url = process.argv[2]?.trim();
	if (!url) {
		console.error("Usage: npx tsx ./twitter-chat-ws-test.ts <broadcast-url>");
		process.exit(1);
	}

	console.log("Bootstrapping...");
	const bootstrap = await bootstrapBroadcast(url);
	console.log(`# ${bootstrap.title ?? bootstrap.broadcastId}`);
	console.log(`# endpoint: ${bootstrap.endpoint}\n`);

	console.log("Fetching initial history...");
	const history = await fetchInitialHistory(bootstrap);
	console.log(`Loaded ${history.length} messages from history.\n`);
	for (const m of history) {
		console.log(`  [${formatTimestamp(m.timestampMs)}] @${m.username}: ${m.text}`);
	}

	const seenUuids = new Set(history.map((m) => m.uuid));

	console.log("\nConnecting WebSocket (using connectBroadcastChat)...\n");

	connectBroadcastChat(
		bootstrap,
		(message) => {
			const isNew = !seenUuids.has(message.uuid);
			seenUuids.add(message.uuid);
			const tag = isNew ? "NEW" : "DUP";
			console.log(`[${tag}] [${formatTimestamp(message.timestampMs)}] @${message.username}: ${message.text}`);
		},
		(error) => {
			console.error(`ERROR: ${error.message}`);
			process.exit(1);
		},
		() => {
			console.log("WebSocket closed.");
			process.exit(0);
		},
	);

	console.log("Listening for messages... Post something in the broadcast chat.\n");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});
