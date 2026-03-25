import type { BroadcastBootstrap, BroadcastChatMessage } from "./types.js";
import { X_WEB_BEARER } from "./types.js";

interface XBroadcastShowResponse {
	broadcasts?: Record<string, { media_key?: string; status?: string }>;
}

interface XLiveStatusResponse {
	chatToken?: string;
}

interface AccessChatPublicResponse {
	access_token?: string;
	replay_access_token?: string;
	endpoint?: string;
	replay_endpoint?: string;
	read_only?: boolean;
}

interface HistoryResponse {
	messages?: Array<{ kind?: number; payload?: string }>;
	cursor?: string;
}

export class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message);
	}
}

export function extractBroadcastId(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("Usage: /twitter-broadcast <x broadcast url>");

	try {
		const url = new URL(trimmed);
		const match = url.pathname.match(/^\/i\/broadcasts\/([^/?#]+)/);
		if (!match?.[1]) throw new Error();
		return match[1];
	} catch {
		if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
		throw new Error(`Could not extract broadcast id from: ${trimmed}`);
	}
}

export async function bootstrapBroadcast(inputUrl: string): Promise<BroadcastBootstrap> {
	const broadcastId = extractBroadcastId(inputUrl);
	const guestToken = await activateGuestToken();

	const show = await requestJson<XBroadcastShowResponse>(
		`https://x.com/i/api/1.1/broadcasts/show.json?ids=${encodeURIComponent(broadcastId)}`,
		{
			headers: xApiHeaders(guestToken),
		},
	);

	const broadcast = show.broadcasts?.[broadcastId];
	const mediaKey = broadcast?.media_key;
	if (!mediaKey) throw new Error(`No media_key found for broadcast ${broadcastId}`);

	const status = await requestJson<XLiveStatusResponse>(
		`https://x.com/i/api/1.1/live_video_stream/status/${encodeURIComponent(mediaKey)}?client=web&use_syndication_guest_id=false&cookie_set_host=x.com`,
		{
			headers: xApiHeaders(guestToken),
		},
	);

	if (!status.chatToken) throw new Error(`No chatToken found for broadcast ${broadcastId}`);

	const access = await requestJson<AccessChatPublicResponse>("https://proxsee-cf.pscp.tv/api/v2/accessChatPublic", {
		method: "POST",
		headers: {
			accept: "*/*",
			origin: "https://x.com",
			referer: "https://x.com/",
			"content-type": "application/json",
			"x-periscope-user-agent": "Twitter/m5",
			"x-attempt": "1",
			"x-idempotence": `${Date.now()}`,
		},
		body: JSON.stringify({ chat_token: status.chatToken }),
	});

	const endpoint = access.endpoint ?? access.replay_endpoint;
	const accessToken = access.access_token ?? access.replay_access_token;
	if (!endpoint || !accessToken) {
		throw new Error(`Could not resolve chat endpoint for broadcast ${broadcastId}`);
	}

	return {
		broadcastId,
		url: `https://x.com/i/broadcasts/${broadcastId}`,
		mediaKey,
		chatToken: status.chatToken,
		endpoint,
		accessToken,
		readOnly: access.read_only ?? true,
		title: broadcast?.status,
	};
}

export async function fetchInitialHistory(bootstrap: BroadcastBootstrap): Promise<BroadcastChatMessage[]> {
	const messages: BroadcastChatMessage[] = [];
	let cursor = "";
	const seenCursors = new Set<string>();
	let page = 0;

	while (page < 200) {
		const response = await fetchHistoryPage(bootstrap, {
			cursor,
			limit: 1000,
			since: null,
			quickGet: true,
		});
		messages.push(...response.messages);
		page++;

		const nextCursor = response.cursor ?? "";
		if (!nextCursor || seenCursors.has(nextCursor)) break;
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}

	return dedupeAndSort(messages);
}

export async function fetchMessagesSince(
	bootstrap: BroadcastBootstrap,
	sinceNs: number,
): Promise<BroadcastChatMessage[]> {
	const response = await fetchHistoryPage(bootstrap, {
		since: sinceNs,
		limit: 200,
		quickGet: false,
	});
	return dedupeAndSort(response.messages);
}

function dedupeAndSort(messages: BroadcastChatMessage[]): BroadcastChatMessage[] {
	const byUuid = new Map<string, BroadcastChatMessage>();
	for (const message of messages) {
		if (!message.uuid) continue;
		byUuid.set(message.uuid, message);
	}
	return [...byUuid.values()].sort((a, b) => a.timestampMs - b.timestampMs || a.uuid.localeCompare(b.uuid));
}

async function fetchHistoryPage(
	bootstrap: BroadcastBootstrap,
	options: { since?: number | null; cursor?: string; limit: number; quickGet: boolean },
): Promise<{ messages: BroadcastChatMessage[]; cursor?: string; rawCount: number }> {
	const body: Record<string, unknown> = {
		access_token: bootstrap.accessToken,
		cursor: options.cursor ?? "",
		limit: options.limit,
		since: options.since ?? null,
		quick_get: options.quickGet,
	};

	const response = await requestJson<HistoryResponse>(`${bootstrap.endpoint.replace(/\/$/, "")}/chatapi/v1/history`, {
		method: "POST",
		headers: {
			accept: "*/*",
			origin: "https://x.com",
			referer: "https://x.com/",
			"content-type": "application/json",
			"x-periscope-user-agent": "Twitter/m5",
			"x-attempt": "1",
			"x-idempotence": `${Date.now()}`,
		},
		body: JSON.stringify(body),
	});

	const parsedMessages = (response.messages ?? [])
		.map((message) => parseHistoryMessage(message, bootstrap.broadcastId, bootstrap.url))
		.filter((message): message is BroadcastChatMessage => Boolean(message));

	return {
		messages: parsedMessages,
		cursor: response.cursor,
		rawCount: response.messages?.length ?? 0,
	};
}

export function parseHistoryMessage(
	message: { kind?: number; payload?: string },
	broadcastId: string,
	url: string,
): BroadcastChatMessage | null {
	if (message.kind !== 1 || !message.payload) return null;

	let outer: any;
	try {
		outer = JSON.parse(message.payload);
	} catch {
		return null;
	}

	let inner: any = outer?.body;
	if (typeof inner === "string") {
		try {
			inner = JSON.parse(inner);
		} catch {
			return null;
		}
	}

	const text = typeof inner?.body === "string" ? inner.body.trim() : "";
	if (!text) return null;

	const timestampMs =
		typeof inner?.timestamp === "number"
			? inner.timestamp
			: typeof inner?.programDateTime === "string"
				? Date.parse(inner.programDateTime)
				: Date.now();

	const username =
		typeof inner?.username === "string"
			? inner.username
			: typeof outer?.sender?.username === "string"
				? outer.sender.username
				: "unknown";

	const displayName =
		typeof inner?.displayName === "string"
			? inner.displayName
			: typeof outer?.sender?.display_name === "string"
				? outer.sender.display_name
				: username;

	const uuid =
		typeof inner?.uuid === "string" && inner.uuid.length > 0
			? inner.uuid
			: `${broadcastId}:${username}:${timestampMs}:${text}`;

	return {
		broadcastId,
		uuid,
		username,
		displayName,
		text,
		timestampMs,
		participantIndex:
			typeof inner?.participant_index === "number"
				? inner.participant_index
				: typeof outer?.sender?.participant_index === "number"
					? outer.sender.participant_index
					: undefined,
		remoteId: typeof inner?.remoteID === "string" ? inner.remoteID : undefined,
		programDateTime: typeof inner?.programDateTime === "string" ? inner.programDateTime : undefined,
		url,
	};
}

async function activateGuestToken(): Promise<string> {
	const response = await requestJson<{ guest_token?: string }>("https://api.x.com/1.1/guest/activate.json", {
		method: "POST",
		headers: xApiHeaders(),
	});
	if (!response.guest_token) throw new Error("Could not activate X guest token");
	return response.guest_token;
}

function xApiHeaders(guestToken?: string): Record<string, string> {
	return {
		authorization: `Bearer ${X_WEB_BEARER}`,
		accept: "application/json, text/plain, */*",
		"x-twitter-active-user": "yes",
		"x-twitter-client-language": "en",
		...(guestToken ? { "x-guest-token": guestToken } : {}),
	};
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: {
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
			...(init.headers ?? {}),
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, text);
	}
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`Invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function isAuthLikeError(error: unknown): boolean {
	return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

export interface BroadcastChatConnection {
	close(): void;
}

export function connectBroadcastChat(
	bootstrap: BroadcastBootstrap,
	onMessage: (message: BroadcastChatMessage) => void,
	onError: (error: Error) => void,
	onClose: () => void,
): BroadcastChatConnection {
	const wsUrl = `${bootstrap.endpoint.replace(/^http/, "ws").replace(/\/$/, "")}/chatapi/v1/chatnow`;
	const ws = new WebSocket(wsUrl);
	let closed = false;

	ws.addEventListener("open", () => {
		ws.send(
			JSON.stringify({
				payload: JSON.stringify({ access_token: bootstrap.accessToken }),
				kind: 3,
			}),
		);

		ws.send(
			JSON.stringify({
				payload: JSON.stringify({
					body: JSON.stringify({ room: bootstrap.broadcastId }),
					kind: 1,
				}),
				kind: 2,
			}),
		);
	});

	ws.addEventListener("message", (event) => {
		const raw = typeof event.data === "string" ? event.data : String(event.data);
		try {
			const msg = JSON.parse(raw);
			if (msg.kind === 1 && msg.payload) {
				const parsed = parseHistoryMessage(msg, bootstrap.broadcastId, bootstrap.url);
				if (parsed) onMessage(parsed);
			}
		} catch {}
	});

	ws.addEventListener("error", () => {
		if (!closed) {
			closed = true;
			onError(new Error(`WebSocket error for broadcast ${bootstrap.broadcastId}`));
		}
	});

	ws.addEventListener("close", () => {
		if (!closed) {
			closed = true;
			onClose();
		}
	});

	return {
		close() {
			if (closed) return;
			closed = true;
			ws.close();
		},
	};
}
