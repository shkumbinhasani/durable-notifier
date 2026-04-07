# durable-notifier

## 0.3.0

### Minor Changes

- [#3](https://github.com/shkumbinhasani/durable-notifier/pull/3) [`ac85649`](https://github.com/shkumbinhasani/durable-notifier/commit/ac856497d2e349bd53e4710374d5db9c4ede4114) Thanks [@shkumbinhasani](https://github.com/shkumbinhasani)! - Add channel support for broadcasting events to groups of users.

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

## 0.2.0

### Minor Changes

- [#1](https://github.com/shkumbinhasani/durable-notifier/pull/1) [`897ed5f`](https://github.com/shkumbinhasani/durable-notifier/commit/897ed5f2fedc6f26517443256e578953c9fed079) Thanks [@shkumbinhasani](https://github.com/shkumbinhasani)! - Add sendToUsers, disconnectUser, getPresence, changesets, OIDC trusted publishing
