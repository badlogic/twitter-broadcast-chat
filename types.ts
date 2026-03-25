export const TWITTER_BROADCAST_CHAT_MESSAGE = "twitter-broadcast-chat-message";
export const POLL_INTERVAL_MS = 2000;
export const X_WEB_BEARER =
	"AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export interface BroadcastChatMessage {
	broadcastId: string;
	uuid: string;
	username: string;
	displayName: string;
	text: string;
	timestampMs: number;
	participantIndex?: number;
	remoteId?: string;
	programDateTime?: string;
	url?: string;
}

export interface BroadcastBootstrap {
	broadcastId: string;
	url: string;
	mediaKey: string;
	chatToken: string;
	endpoint: string;
	accessToken: string;
	readOnly: boolean;
	title?: string;
}
