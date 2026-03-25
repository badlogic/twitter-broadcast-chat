# twitter-broadcast-chat

A [pi](https://github.com/badlogic/pi-mono) extension that connects to X (Twitter) broadcast live streams and surfaces chat messages in your terminal.

## What it does

- Fetches full chat history for any X broadcast (live or replay)
- Receives new messages in real-time via WebSocket
- Shows the last 3 messages in a widget above the editor
- Provides a scrollable overlay with the full chat log
- Handles are clickable links to X profiles (OSC 8)
- Auto-reconnects on disconnect with token refresh

## Install

Try it for a single session:

```bash
pi -e https://github.com/badlogic/twitter-broadcast-chat
```

Or install it permanently:

```bash
pi install https://github.com/badlogic/twitter-broadcast-chat
```

No dependencies to install. Uses pi's bundled packages.

## Commands

| Command | Description |
|---------|-------------|
| `/twitter-broadcast <url>` | Connect to a broadcast and start watching chat |
| `/twitter-broadcast-view` | Open scrollable overlay with full chat history |

## Standalone CLI

Dump chat history for any broadcast without pi:

```bash
npm run dump -- https://x.com/i/broadcasts/<id>
```

## How it works

1. Activates a guest token via the public X web bearer
2. Resolves broadcast metadata and media key
3. Exchanges a chat token for a Periscope chat access token
4. Loads initial history via `/chatapi/v1/history`
5. Connects a WebSocket to `/chatapi/v1/chatnow` for real-time messages
6. Parses `kind === 1` messages from the nested JSON payload

No X login required. Works with public broadcasts.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Pi extension entry point, commands, widget, WebSocket loop |
| `twitter-chat-api.ts` | X broadcast bootstrap, history fetching, WebSocket connection |
| `twitter-chat-dump.ts` | Standalone CLI for dumping chat |
| `overlay.ts` | Scrollable chat overlay component |
| `widget.ts` | Compact widget showing last 3 messages |
| `state.ts` | In-memory chat message store |
| `links.ts` | OSC 8 hyperlink helper for X handles |
| `types.ts` | Shared types and constants |

## Typecheck

Requires path aliases to a local `pi-mono` checkout. See `tsconfig.json`.

```bash
npm run typecheck
```

## License

MIT
