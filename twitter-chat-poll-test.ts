import { bootstrapBroadcast, fetchInitialHistory, fetchMessagesSince } from "./twitter-chat-api.js";
import { POLL_INTERVAL_MS } from "./types.js";

function formatTimestamp(timestampMs: number): string {
	return new Date(timestampMs).toISOString();
}

async function main(): Promise<void> {
	const url = process.argv[2]?.trim();
	if (!url) {
		console.error("Usage: npx tsx ./twitter-chat-poll-test.ts <broadcast-url>");
		process.exit(1);
	}

	console.log("Bootstrapping...");
	const bootstrap = await bootstrapBroadcast(url);
	console.log(`# ${bootstrap.title ?? bootstrap.broadcastId}`);
	console.log(`# endpoint: ${bootstrap.endpoint}`);
	console.log("");

	console.log("Fetching initial history...");
	const history = await fetchInitialHistory(bootstrap);
	console.log(`Loaded ${history.length} messages from history.`);

	for (const message of history) {
		console.log(`  [${formatTimestamp(message.timestampMs)}] @${message.username}: ${message.text}`);
	}

	let sinceNs = 0;
	for (const message of history) {
		sinceNs = Math.max(sinceNs, message.timestampMs * 1_000_000 + 1);
	}
	console.log(`\nsinceNs cursor: ${sinceNs}`);
	console.log(`Polling every ${POLL_INTERVAL_MS}ms. Post a message now...\n`);

	const seenUuids = new Set(history.map((m) => m.uuid));
	let pollCount = 0;

	while (true) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		pollCount++;

		try {
			// Poll with sinceNs
			const messages = await fetchMessagesSince(bootstrap, sinceNs);
			const newMessages = messages.filter((m) => !seenUuids.has(m.uuid));

			// Every 15 polls, also do a full re-fetch to see if the message is in history at all
			if (pollCount % 15 === 0) {
				console.log(`\n--- [poll ${pollCount}] Full history re-fetch ---`);
				const fullHistory = await fetchInitialHistory(bootstrap);
				console.log(`Full history: ${fullHistory.length} messages`);
				for (const m of fullHistory) {
					const isKnown = seenUuids.has(m.uuid) ? "" : " ** NEW **";
					console.log(`  [${formatTimestamp(m.timestampMs)}] @${m.username}: ${m.text}${isKnown}`);
				}
				console.log("---\n");
			}

			if (newMessages.length > 0) {
				console.log(`[poll ${pollCount}] ${messages.length} returned, ${newMessages.length} NEW:`);
				for (const message of newMessages) {
					seenUuids.add(message.uuid);
					if (message.timestampMs > 0) {
						sinceNs = Math.max(sinceNs, message.timestampMs * 1_000_000 + 1);
					}
					console.log(`  @${message.username}: ${message.text} (uuid: ${message.uuid})`);
				}
			} else if (pollCount % 10 === 0) {
				// Log the 1 repeated message details every 10 polls
				console.log(`[poll ${pollCount}] ${messages.length} returned, 0 new. Returned messages:`);
				for (const m of messages) {
					console.log(`  @${m.username}: "${m.text}" ts=${m.timestampMs} uuid=${m.uuid}`);
				}
			}
		} catch (error) {
			console.error(`[poll ${pollCount}] ERROR: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});
