# durable-notifier

Realtime events on Cloudflare Workers — per-user and per-channel. Tiny server API, React hooks on the client, Durable Objects hidden.

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

## Channels

Channels let multiple users subscribe to a shared topic and receive the same events. A single user can be subscribed to many channels — all events arrive over their one WebSocket connection.

### Channel types

| Prefix | Auth required | Description |
|--------|--------------|-------------|
| _(none)_ | No | Public channel. Any authenticated user can subscribe. |
| `private-` | Yes | Private channel. `authorizeChannel` must return truthy. |
| `presence-` | Yes | Reserved for future presence support. Gated by `authorizeChannel`. |

### Server setup

```ts
import { createServerNotifier, UserChannel, Channel } from "durable-notifier/server";

const notifier = createServerNotifier<AppEvents>({
  authenticate: async (request) => {
    const session = await getSession(request);
    return session?.user.id ?? null;
  },
  // Optional — required for private-* and presence-* channels
  authorizeChannel: async (userId, channel) => {
    // e.g. check if user is a member of this org
    const orgId = channel.replace("private-org-", "");
    return db.isOrgMember(userId, orgId);
  },
});

// WebSocket upgrade (existing)
app.get("/ws", (c) => notifier.upgrade(c.req.raw, c.env));

// Channel subscribe/unsubscribe endpoints (new)
app.post("/channels/subscribe", (c) => notifier.subscribe(c.req.raw, c.env));
app.post("/channels/unsubscribe", (c) => notifier.unsubscribe(c.req.raw, c.env));

// Send an event to everyone in a channel
await notifier.sendToChannel(env, "private-org-42", {
  type: "chat.message",
  data: { from: "alice", text: "hello team" },
});

// Re-export both DO classes
export { UserChannel, Channel };
```

### Client setup

```tsx
import { createNotifier } from "durable-notifier/client";

const notifier = createNotifier<AppEvents>("/ws", {
  channelEndpoint: "/channels",
  // Optional — add auth headers for channel HTTP requests
  getHeaders: () => ({
    Authorization: `Bearer ${getToken()}`,
  }),
});

function ChatRoom({ roomId }: { roomId: string }) {
  // Subscribe on mount, unsubscribe on unmount
  notifier.useChannel(`private-org-${roomId}`);

  notifier.useEvent("chat.message", (data, event) => {
    // event.channel tells you which channel it came from
    console.log(`[${event.channel}] ${data.from}: ${data.text}`);
  });

  return <div>Room: {roomId}</div>;
}
```

### wrangler.jsonc (with channels)

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "USER_CHANNEL", "class_name": "UserChannel" },
      { "name": "CHANNEL", "class_name": "Channel" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["UserChannel"] },
    { "tag": "v2", "new_classes": ["Channel"] }
  ]
}
```

### How channels work

```
┌──────────┐  POST /channels/subscribe  ┌──────────────┐
│  Client  │ ────────────────────────── │    Worker     │
│ (React)  │         HTTP               │  (entrypoint) │
└──────────┘                            └──────┬───────┘
     ▲                                    │         │
     │ events over existing WebSocket     │         │
     │                                    ▼         ▼
┌──────────────┐                   ┌──────────────────┐
│ UserChannel  │                   │     Channel      │
│ (per user)   │                   │  (per channel)   │
│  WebSockets  │                   │   member list    │
└──────────────┘                   └──────────────────┘
```

1. Client subscribes to a channel via HTTP POST (auth runs server-side)
2. The Worker tells the `Channel` DO to store the user ID in its member list
3. When `sendToChannel` is called, the Worker reads the member list from the Channel DO, then sends the event to each member's `UserChannel` DO
4. Each `UserChannel` pushes the event to all of that user's WebSocket connections
5. The event includes a `channel` field so the client knows where it came from

One WebSocket per user, regardless of how many channels they're in.

---

## Upgrading from v0.2.x (adding channels)

Channels are **fully opt-in**. Existing code works without changes. To add channel support:

**1. Add the `Channel` DO binding to `wrangler.jsonc`:**

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "USER_CHANNEL", "class_name": "UserChannel" },
      { "name": "CHANNEL", "class_name": "Channel" }        // ← add
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["UserChannel"] },
    { "tag": "v2", "new_classes": ["Channel"] }              // ← add
  ]
}
```

**2. Re-export the `Channel` class from your worker:**

```ts
// Before
export { UserChannel } from "durable-notifier/server";

// After
export { UserChannel, Channel } from "durable-notifier/server";
```

**3. Add subscribe/unsubscribe routes:**

```ts
app.post("/channels/subscribe", (c) => notifier.subscribe(c.req.raw, c.env));
app.post("/channels/unsubscribe", (c) => notifier.unsubscribe(c.req.raw, c.env));
```

**4. (Optional) Add `authorizeChannel` for private channels:**

```ts
const notifier = createServerNotifier({
  authenticate: ...,
  authorizeChannel: async (userId, channel) => {
    return await hasAccess(userId, channel);
  },
});
```

**5. On the client, pass `channelEndpoint`:**

```ts
const notifier = createNotifier<AppEvents>("/ws", {
  channelEndpoint: "/channels",
});
```

**6. Use channels:**

```tsx
// Hook — subscribes on mount, unsubscribes on unmount
notifier.useChannel("room-42");

// Or imperative
await notifier.subscribe("room-42");
await notifier.unsubscribe("room-42");
```

No changes needed to existing `sendToUser`, `useEvent`, `useStatus`, or `useLastEvent` code.

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
  // Optional — required for private-* and presence-* channels
  authorizeChannel: async (userId: string, channel: string) => {
    // Return true to allow, falsy to deny
    return checkAccess(userId, channel);
  },
});
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `authenticate` | `(request) => string \| null` | Yes | Return a user ID or `null` to reject. |
| `authorizeChannel` | `(userId, channel) => boolean \| null` | No | Gate `private-` and `presence-` channels. Not called for public channels. If not provided, all private/presence subscriptions are rejected. |

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

### `notifier.sendToChannel(env, channel, event)`

Send an event to all members of a channel. The event is delivered to each member's `UserChannel` DO with a `channel` field added. Uses `Promise.allSettled` internally — individual delivery failures are silently ignored.

```ts
await notifier.sendToChannel(env, "room-42", {
  type: "chat.message",
  data: { from: "alice", text: "hello room" },
});
```

All recipients receive the same `id` and `ts`.

### `notifier.subscribe(request, env)`

Handle an incoming channel subscribe HTTP request. Authenticates the request, checks `authorizeChannel` for private/presence channels, then adds the user to the channel's member list.

The request body must be JSON with `{ channel: string }`.

```ts
app.post("/channels/subscribe", (c) => notifier.subscribe(c.req.raw, c.env));
```

Returns:
- `200` `{ ok: true }` — Subscribed
- `400` — Missing or invalid channel name
- `401` — Authentication failed
- `403` — Channel authorization denied (or `authorizeChannel` not configured for private channels)

### `notifier.unsubscribe(request, env)`

Handle an incoming channel unsubscribe HTTP request. Authenticates, then removes the user from the channel.

The request body must be JSON with `{ channel: string }`.

```ts
app.post("/channels/unsubscribe", (c) => notifier.unsubscribe(c.req.raw, c.env));
```

### `notifier.getChannelMembers(env, channel)`

Get the list of user IDs subscribed to a channel.

```ts
const members = await notifier.getChannelMembers(env, "room-42");
// ["user-1", "user-2"]
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

The per-user Durable Object class. Re-export it from your worker entry point.

### `notifier.Channel`

The per-channel Durable Object class. Re-export it from your worker entry point when using channels.

```ts
export { UserChannel, Channel } from "durable-notifier/server";
```

### `NotifierEnv`

Type for the required Durable Object bindings. Merge it into your worker's `Env`:

```ts
import type { NotifierEnv } from "durable-notifier/server";

type Env = {
  Bindings: NotifierEnv & {
    // your other bindings
  };
};
```

The `USER_CHANNEL` binding is always required. The `CHANNEL` binding is only needed when using channel features.

---

## Client API

### `createNotifier<M>(url, options?)`

```ts
import { createNotifier } from "durable-notifier/client";

const notifier = createNotifier<AppEvents>("/ws", {
  lazy: true,                    // default — connect on first subscriber
  channelEndpoint: "/channels",  // enables channel support
  getHeaders: () => ({           // custom headers for channel HTTP requests
    Authorization: `Bearer ${getToken()}`,
  }),
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lazy` | `boolean` | `true` | Connect only when the first `useEvent` subscriber mounts. |
| `channelEndpoint` | `string` | — | Base URL for channel HTTP endpoints. Required for channel support. |
| `getHeaders` | `() => Record<string, string>` | — | Extra headers for channel HTTP requests (e.g. auth tokens). Cookies are sent automatically. |

Call this once at module scope — all hooks share the single instance.

### `notifier.useEvent(type, handler)`

Subscribe to events. Cleans up on unmount.

```tsx
notifier.useEvent("chat.message", (data, event) => {
  // data: { from: string; text: string }  — typed from your EventMap
  // event: WireEvent — full envelope with type, data, id, ts, channel
  console.log(data.from, data.text);
  if (event.channel) {
    console.log("from channel:", event.channel);
  }
});
```

- Multiple components can subscribe to the same event type
- Handler always uses the latest callback (no stale closures)
- Only `useEvent` triggers a connection — `useStatus` and `useLastEvent` are passive
- Events from channels include `event.channel` with the channel name

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

### `notifier.useChannel(channel)`

Subscribe to a channel on mount, unsubscribe on unmount. Automatically re-subscribes on WebSocket reconnect.

```tsx
function ChatRoom({ roomId }: { roomId: string }) {
  notifier.useChannel(`room-${roomId}`);
  notifier.useEvent("chat.message", (data) => { ... });
  return <div>...</div>;
}
```

Requires `channelEndpoint` to be set in options. The channel subscription is managed via HTTP requests to the server — the WebSocket only carries events.

### `notifier.subscribe(channel)` / `notifier.unsubscribe(channel)`

Imperative channel subscription. Use when you need to control timing or handle errors.

```ts
try {
  await notifier.subscribe("private-org-42");
} catch (err) {
  console.error("Subscribe failed:", err.message);
}

await notifier.unsubscribe("private-org-42");
```

Subscribed channels are tracked and automatically re-subscribed on WebSocket reconnect.

### `notifier.close()`

Permanently shut down the connection. Sets status to `"closed"`, clears all listeners, cached events, and channel subscriptions, prevents reconnection.

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
  type: string;     // event name
  data?: unknown;   // payload
  id?: string;      // unique ID (UUID, server-generated)
  ts?: number;      // unix ms timestamp (server-generated)
  channel?: string; // channel name (present for channel events)
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

Reconnection resets to attempt 1 on successful connect. Channel subscriptions are automatically re-established on reconnect.

### Heartbeat

The client sends a `ping` every 30 seconds. The server replies with `pong`. This keeps the connection alive through proxies and load balancers that drop idle WebSockets.

### SSR safety

All hooks are safe to use during server-side rendering:
- `useStatus()` returns `"idle"`
- `useLastEvent()` returns `null`
- `useChannel()` is a no-op (no HTTP calls)
- No WebSocket is created when `typeof WebSocket === "undefined"`

---

## Architecture

```
┌──────────┐    WebSocket     ┌──────────────┐     ┌──────────────┐
│  Client  │ ◄─────────────► │ UserChannel   │     │   Channel    │
│ (React)  │   events         │ (per user DO) │     │(per chan. DO)│
└─────┬────┘                  └──────▲───────┘     └──────▲───────┘
      │                              │                     │
      │ POST /channels/subscribe     │ fan out to each     │ get members
      └─────────────────────────►┌───┴─────────────────────┴──┐
                HTTP             │          Worker             │
                                 │       (entrypoint)          │
                                 └─────────────────────────────┘
                                    sendToUser / sendToChannel
```

**sendToUser flow:** Worker → UserChannel DO → WebSocket(s)

**sendToChannel flow:** Worker → Channel DO (get members) → Worker → each UserChannel DO → WebSocket(s)

- **One Durable Object per user** — derived from `idFromName(userId)`
- **One Durable Object per channel** — derived from `idFromName(channelName)`, stores member list
- **Worker coordinates everything** — the Channel DO is a membership store; the Worker reads members and fans out to UserChannel DOs
- **Multi-tab/device fanout** — the UserChannel DO holds all active sockets for a user and broadcasts to each
- **Auth at the edge** — unauthenticated requests are rejected before touching any DO
- **Server-push only** — clients subscribe, the server sends. The WebSocket is not bidirectional for application messages
- **Single WebSocket per user** — channel subscriptions are managed via HTTP; events for all channels arrive over the one connection

---

## Examples

The repo includes working examples:

- **`examples/basic-worker/`** — Hono server with authentication, WebSocket upgrade, channel subscribe/unsubscribe, and event sending
- **`examples/basic-react/`** — Vite + React app with `useEvent`, `useStatus`, `useLastEvent`, and `useChannel`

Run them locally:

```bash
pnpm install
pnpm turbo dev
```

The worker runs on `http://localhost:8787`, the React app on `http://localhost:5173`.

Send a test event to a user:

```bash
curl -X POST http://localhost:8787/send/test-user-1
```

Subscribe a user to a channel and send to the channel:

```bash
# Subscribe
curl -X POST http://localhost:8787/channels/subscribe?userId=test-user-1 \
  -H "Content-Type: application/json" \
  -d '{"channel": "general"}'

# Send to channel
curl -X POST http://localhost:8787/channels/general/send

# Check members
curl http://localhost:8787/channels/general/members
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
const notifier = createNotifier<AppEvents>("/ws", {
  channelEndpoint: "/channels",
});
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
| `Channel` | class |
| `ServerNotifier` | type |
| `ServerNotifierOptions` | type |
| `AuthenticateFn` | type |
| `AuthorizeChannelFn` | type |
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
