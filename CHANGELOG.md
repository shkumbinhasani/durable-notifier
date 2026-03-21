# Changelog

## 0.1.0 (2026-03-22)

Initial release.

### Server

- `createServerNotifier()` — create a notifier with an `authenticate` function
- `upgrade()` — handle WebSocket upgrade requests with server-derived auth
- `sendToUser()` — send a typed event to all of a user's active connections
- `sendToUsers()` — send to multiple users concurrently via `Promise.allSettled`
- `disconnectUser()` — close all connections for a user
- `getPresence()` — check if a user has any active connections
- `UserChannel` — Durable Object class (re-export in your worker)
- Binding validation — helpful error if `USER_CHANNEL` is missing from env

### Client

- `createNotifier()` — create a client-side notifier with React hooks
- `useEvent()` — subscribe to typed events, auto-cleanup on unmount
- `useStatus()` — reactive connection status (`idle` | `connecting` | `connected` | `reconnecting` | `closed`)
- `useLastEvent()` — read the most recent event, optionally filtered by type
- `close()` — permanently shut down the connection
- `clearEventCache()` — clear stale event data (e.g. on logout)
- Lazy connection — connects on first subscriber, disconnects on last unmount
- Eager mode — `lazy: false` keeps the connection alive with zero subscribers
- Auto-reconnect — exponential backoff with jitter (1s → 30s cap)
- Heartbeat — 30s ping/pong to keep connections alive through proxies
- SSR safe — no WebSocket created when `typeof WebSocket === "undefined"`
- Shared connection — multiple hooks share a single WebSocket per notifier

### Wire Protocol

- JSON envelope: `{ type, data?, id?, ts? }`
- `id` (UUID) and `ts` (timestamp) auto-generated server-side
- Internal `ping`/`pong` messages filtered from event handlers

### Type Safety

- Generic `EventMap` for compile-time checked event types and payloads
- Works across both server (`sendToUser`) and client (`useEvent`) APIs
