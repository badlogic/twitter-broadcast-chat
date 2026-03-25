import { bootstrapBroadcast, fetchInitialHistory } from "./twitter-chat-api.js";

function formatTimestamp(timestampMs: number): string {
	return new Date(timestampMs).toISOString();
}

async function main(): Promise<void> {
	const url = process.argv[2]?.trim();
	if (!url) {
		console.error("Usage: npm run dump -- <broadcast-url>");
		process.exit(1);
	}

	const bootstrap = await bootstrapBroadcast(url);
	const history = await fetchInitialHistory(bootstrap);

	console.log(`# ${bootstrap.title ?? bootstrap.broadcastId}`);
	console.log(`# ${bootstrap.url}`);
	console.log(`# endpoint: ${bootstrap.endpoint}`);
	console.log(`# messages: ${history.length}`);
	console.log("");

	for (const message of history) {
		console.log(`[${formatTimestamp(message.timestampMs)}] ${message.displayName} (@${message.username})`);
		console.log(message.text);
		console.log("");
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});
