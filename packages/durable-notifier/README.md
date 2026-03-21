# durable-notifier

Authenticated per-user realtime events on Cloudflare Workers. Tiny server API, React hooks on the client, Durable Objects hidden.

```
npm install durable-notifier
```

## Quick start

### Server

```ts
import { createServerNotifier, UserChannel } from "durable-notifier/server";

const notifier = createServerNotifier({
  authenticate: async (request) => {
    const session = await getSession(request);
    if (!session) return null;
    return session.user.id;
  },
});

// Hono example — any framework works
app.get("/ws", (c) => notifier.upgrade(c.req.raw, c.env));

// Send events from any route or queue handler
await notifier.sendToUser(env, userId, {
  type: "inbox.invalidate",
  data: { inboxId: "main" },
});

// Re-export the Durable Object class for wrangler
export { UserChannel };
```

### Client

```tsx
import { createNotifier } from "durable-notifier/client";

const notifier = createNotifier("/ws");

function Inbox() {
  notifier.useEvent("inbox.invalidate", () => {
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
  });

  const status = notifier.useStatus();
  // "idle" | "connecting" | "connected" | "reconnecting" | "closed"

  return <div>Connection: {status}</div>;
}
```

### wrangler.jsonc

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "USER_CHANNEL", "class_name": "UserChannel" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["UserChannel"] }
  ]
}
```

---

## Type-safe events

Define an event map and pass it as a generic to both server and client:

```ts
type AppEvents = {
  "order.updated": { orderId: string; status: string };
  "chat.message": { from: string; text: string };
  "inbox.invalidate": { inboxId: string };
};

// Server — data is type-checked
const notifier = createServerNotifier<AppEvents>({ authenticate });

await notifier.sendToUser(env, userId, {
  type: "order.updated",
  data: { orderId: "abc", status: "shipped" }, // ✓ typed
});

// Client — handler receives typed data
const client = createNotifier<AppEvents>("/ws");

client.useEvent("order.updated", (data) => {
  console.log(data.orderId); // string
  console.log(data.status);  // string
});
```

---

## Server API

### `createServerNotifier<M>(options)`

```ts
import { createServerNotifier } from "durable-notifier/server";

const notifier = createServerNotifier<AppEvents>({
  authenticate: async (request: Request) => {
    // Return a userId string, or null to reject (401)
    return getUserIdFromCookie(request);
  },
});
```

### `notifier.upgrade(request, env)`

Handle a WebSocket upgrade request. Authenticates, then routes to the user's Durable Object.

```ts
app.get("/ws", (c) => notifier.upgrade(c.req.raw, c.env));
```

Returns:
- `101` — WebSocket established
- `401` — Authentication failed
- `426` — Not a WebSocket upgrade request

### `notifier.sendToUser(env, userId, event)`

Send an event to all of a user's active connections (multiple tabs, devices).

```ts
await notifier.sendToUser(env, "user-123", {
  type: "chat.message",
  data: { from: "alice", text: "hello" },
});
```

The `id` (UUID) and `ts` (timestamp) fields are auto-generated if not provided. Throws if delivery to the Durable Object fails.

### `notifier.sendToUsers(env, userIds, event)`

Send to multiple users concurrently. Uses `Promise.allSettled` — one failure won't block others.

```ts
const results = await notifier.sendToUsers(env, ["user-1", "user-2", "user-3"], {
  type: "announcement",
  data: { text: "Server maintenance at 2am" },
});

for (const r of results) {
  if (r.status === "rejected") console.error(r.reason);
}
```

### `notifier.disconnectUser(env, userId, reason?)`

Close all of a user's active WebSocket connections.

```ts
await notifier.disconnectUser(env, "user-123", "Session expired");
```

### `notifier.getPresence(env, userId)`

Check whether a user has any active connections.

```ts
const online = await notifier.getPresence(env, "user-123");
// true if at least one WebSocket is open
```

### `notifier.UserChannel`

The Durable Object class. Re-export it from your worker entry point so wrangler can find it:

```ts
export { UserChannel } from "durable-notifier/server";
// or
export const UserChannel = notifier.UserChannel;
```

### `NotifierEnv`

Type for the required Durable Object binding. Merge it into your worker's `Env`:

```ts
import type { NotifierEnv } from "durable-notifier/server";

type Env = {
  Bindings: NotifierEnv & {
    // your other bindings
  };
};
```

The binding name must be `USER_CHANNEL`.

---

## Client API

### `createNotifier<M>(url, options?)`

```ts
import { createNotifier } from "durable-notifier/client";

const notifier = createNotifier<AppEvents>("/ws", {
  lazy: true, // default — connect on first subscriber
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lazy` | `boolean` | `true` | When `true`, connects only when the first `useEvent` subscriber mounts. When `false`, connects immediately. |

Call this once at module scope — all hooks share the single instance.

### `notifier.useEvent(type, handler)`

Subscribe to events. Cleans up on unmount.

```tsx
notifier.useEvent("chat.message", (data, event) => {
  // data: { from: string; text: string }  — typed from your EventMap
  // event: WireEvent — full envelope with type, data, id, ts
  console.log(data.from, data.text);
});
```

- Multiple components can subscribe to the same event type
- Handler always uses the latest callback (no stale closures)
- Only `useEvent` triggers a connection — `useStatus` and `useLastEvent` are passive

### `notifier.useStatus()`

Reactive connection status.

```tsx
const status = notifier.useStatus();
// "idle" | "connecting" | "connected" | "reconnecting" | "closed"
```

| Status | Meaning |
|--------|---------|
| `idle` | No connection. Either no subscribers (lazy) or not yet started. |
| `connecting` | WebSocket handshake in progress. |
| `connected` | Connection open and receiving events. |
| `reconnecting` | Disconnected unexpectedly, attempting to reconnect. |
| `closed` | Permanently closed via `close()`. Will not reconnect. |

### `notifier.useLastEvent(type?)`

Read the most recent event, optionally filtered by type.

```tsx
const lastMessage = notifier.useLastEvent("chat.message");
// WireEvent<"chat.message"> | null
```

Returns `null` until the first matching event arrives. The returned reference is stable — same object until a new event arrives, so it works with `React.memo` and dependency arrays.

### `notifier.close()`

Permanently shut down the connection. Sets status to `"closed"`, clears all listeners and cached events, prevents reconnection.

```ts
notifier.close();
```

### `notifier.clearEventCache()`

Clear cached events without closing the connection. Useful on logout or user switch to prevent `useLastEvent` from returning stale data.

```ts
notifier.clearEventCache();
```

---

## Wire protocol

All messages are JSON with this envelope:

```ts
interface WireEvent {
  type: string;    // event name
  data?: unknown;  // payload
  id?: string;     // unique ID (UUID, server-generated)
  ts?: number;     // unix ms timestamp (server-generated)
}
```

Internal protocol messages (`ping`, `pong`) are filtered and never exposed to event handlers or cached.

---

## Connection behavior

### Lazy mode (default)

- Connection opens when the first `useEvent` subscriber mounts
- Connection closes when the last subscriber unmounts
- Re-opens automatically when a new subscriber appears

### Eager mode (`lazy: false`)

- Connection opens immediately on `createNotifier`
- Stays connected even with zero subscribers
- Reconnects after disconnect regardless of subscriber count

### Reconnection

Automatic exponential backoff with jitter:

| Attempt | Base delay | Range (with ±25% jitter) |
|---------|-----------|--------------------------|
| 1 | 1s | 0.75s – 1.25s |
| 2 | 2s | 1.5s – 2.5s |
| 3 | 4s | 3s – 5s |
| 4 | 8s | 6s – 10s |
| 5+ | 30s (cap) | 22.5s – 37.5s |

Reconnection resets to attempt 1 on successful connect.

### Heartbeat

The client sends a `ping` every 30 seconds. The server replies with `pong`. This keeps the connection alive through proxies and load balancers that drop idle WebSockets.

### SSR safety

All hooks are safe to use during server-side rendering:
- `useStatus()` returns `"idle"`
- `useLastEvent()` returns `null`
- No WebSocket is created when `typeof WebSocket === "undefined"`

---

## Architecture

```
┌──────────┐       upgrade        ┌──────────────┐
│  Client  │ ──────────────────── │    Worker     │
│ (React)  │   WebSocket          │  (entrypoint) │
└──────────┘       ▲              └──────┬───────┘
                   │                     │ idFromName(userId)
                   │                     ▼
                   │              ┌──────────────┐
                   └───────────── │ UserChannel   │
                    fanout to     │ (Durable Obj) │
                    all sockets   └──────────────┘
                                         ▲
┌──────────┐    sendToUser(env,          │
│ Any route│ ─── userId, event) ─────────┘
│ or queue │     (internal fetch)
└──────────┘
```

- **One Durable Object per user** — derived from `idFromName(userId)`
- **Multi-tab/device fanout** — the DO holds all active sockets for a user and broadcasts to each
- **Auth at the edge** — unauthenticated requests are rejected before touching the DO
- **Server-push only** — clients subscribe, the server sends. The WebSocket is not bidirectional for application messages.

---

## Examples

The repo includes working examples:

- **`examples/basic-worker/`** — Hono server with authentication, WebSocket upgrade, and event sending
- **`examples/basic-react/`** — Vite + React app with `useEvent`, `useStatus`, and `useLastEvent`

Run them locally:

```bash
pnpm install
pnpm turbo dev
```

The worker runs on `http://localhost:8787`, the React app on `http://localhost:5173`.

Send a test event:

```bash
curl -X POST http://localhost:8787/send/test-user-1
```

---

## Sharing types between server and client

Define your event map once and import it in both your worker and your React app:

```ts
// shared/events.ts
export type AppEvents = {
  "order.updated": { orderId: string; status: string };
  "chat.message": { from: string; text: string };
};
```

```ts
// worker
import type { AppEvents } from "../shared/events";
const notifier = createServerNotifier<AppEvents>({ authenticate });
```

```ts
// client
import type { AppEvents } from "../shared/events";
const notifier = createNotifier<AppEvents>("/ws");
```

This gives you compile-time safety across the entire pipeline — if you rename an event type or change its payload shape, TypeScript will catch mismatches on both sides.

In a monorepo (like this repo's `examples/shared/events.ts`), just import directly. For separate repos, publish the type file as a shared package or copy the type definition.

---

## Exports

### `durable-notifier/server`

| Export | Kind |
|--------|------|
| `createServerNotifier` | function |
| `UserChannel` | class |
| `ServerNotifier` | type |
| `ServerNotifierOptions` | type |
| `AuthenticateFn` | type |
| `NotifierEnv` | type |
| `EventMap` | type |
| `WireEvent` | type |

### `durable-notifier/client`

| Export | Kind |
|--------|------|
| `createNotifier` | function |
| `Notifier` | type |
| `NotifierOptions` | type |
| `EventHandler` | type |
| `ConnectionStatus` | type |
| `EventMap` | type |
| `WireEvent` | type |

---

## License

MIT
