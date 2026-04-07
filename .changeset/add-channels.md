---
"durable-notifier": minor
---

Add channel support for broadcasting events to groups of users.

**Server:**
- New `Channel` Durable Object for managing channel membership
- `subscribe(request, env)` / `unsubscribe(request, env)` — HTTP handlers for channel subscription with auth
- `sendToChannel(env, channel, event)` — broadcast to all channel members
- `getChannelMembers(env, channel)` — list subscribed user IDs
- `authorizeChannel` option to gate `private-` and `presence-` prefixed channels

**Client:**
- `useChannel(channel)` hook — subscribe on mount, unsubscribe on unmount
- `subscribe(channel)` / `unsubscribe(channel)` — imperative channel API
- `channelEndpoint` and `getHeaders` options for channel HTTP requests
- Automatic channel re-subscribe on WebSocket reconnect

**Wire protocol:**
- `WireEvent` now includes an optional `channel` field for channel events

All changes are additive — existing code works without modification.
