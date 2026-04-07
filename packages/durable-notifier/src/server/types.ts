import type { EventMap, WireEvent } from "../shared/types";

/**
 * Authenticate an incoming WebSocket upgrade request.
 *
 * Return a `userId` string to accept the connection, or `null` to reject it
 * with a 401 response. If the function throws, the upgrade returns 500.
 *
 * @param request - The incoming HTTP request (contains cookies, headers, query params).
 * @returns The authenticated user's ID, or `null` to reject.
 */
export type AuthenticateFn = (
  request: Request,
) => string | null | Promise<string | null>;

/**
 * Authorize a user's subscription to a channel.
 *
 * Called for channels prefixed with `private-` or `presence-`.
 * Return `true` to allow, or a falsy value to deny.
 *
 * @param userId - The authenticated user's ID.
 * @param channel - The channel name being subscribed to.
 * @returns `true` to allow subscription, falsy to deny.
 */
export type AuthorizeChannelFn = (
  userId: string,
  channel: string,
) => boolean | null | Promise<boolean | null>;

/** Options for {@link createServerNotifier}. */
export interface ServerNotifierOptions {
  /** Derive the user ID from an incoming request. Return `null` to reject. */
  authenticate: AuthenticateFn;

  /**
   * Authorize a user's subscription to a private or presence channel.
   *
   * Only called for channels prefixed with `private-` or `presence-`.
   * Public channels (no prefix) are open to all authenticated users.
   * If not provided, all private/presence channel subscriptions are rejected.
   */
  authorizeChannel?: AuthorizeChannelFn;
}

/**
 * The Durable Object bindings the consumer must add to their `Env`.
 *
 * The binding name `USER_CHANNEL` is required. The `CHANNEL` binding is
 * only needed when using channel features.
 *
 * @example
 * ```ts
 * type Env = { Bindings: NotifierEnv & { DB: D1Database } };
 * ```
 */
export interface NotifierEnv {
  USER_CHANNEL: DurableObjectNamespace;
  /** Required only when using channel features (subscribe, sendToChannel, etc.). */
  CHANNEL?: DurableObjectNamespace;
}

/**
 * Server-side notifier returned by {@link createServerNotifier}.
 *
 * @typeParam M - An {@link EventMap} describing all event types and their payloads.
 */
export interface ServerNotifier<M extends EventMap = EventMap> {
  /**
   * Handle an incoming WebSocket upgrade request.
   *
   * Authenticates the request, then routes the connection to the user's
   * Durable Object channel.
   *
   * @param request - The incoming HTTP request.
   * @param env - Worker env containing the `USER_CHANNEL` binding.
   * @returns `101` on success, `401` if unauthenticated, `426` if not a WebSocket upgrade.
   */
  upgrade(request: Request, env: NotifierEnv): Promise<Response>;

  /**
   * Send an event to all of a user's active connections.
   *
   * Fans out to every open WebSocket (multiple tabs, devices).
   * Generates `id` (UUID) and `ts` (timestamp) automatically if not provided.
   *
   * @param env - Worker env containing the `USER_CHANNEL` binding.
   * @param userId - The target user's ID.
   * @param event - The event to send, with `type` and `data`.
   * @throws If the Durable Object returns a non-OK response.
   */
  sendToUser<T extends keyof M & string>(
    env: NotifierEnv,
    userId: string,
    event: WireEvent<T> & { data: M[T] },
  ): Promise<void>;

  /**
   * Send an event to multiple users.
   *
   * Equivalent to calling {@link sendToUser} for each user ID, but executed
   * concurrently via `Promise.allSettled`. Individual failures do not prevent
   * delivery to other users.
   *
   * @param env - Worker env containing the `USER_CHANNEL` binding.
   * @param userIds - Array of target user IDs.
   * @param event - The event to send.
   * @returns Results for each user — either `{status: "fulfilled"}` or `{status: "rejected", reason}`.
   */
  sendToUsers<T extends keyof M & string>(
    env: NotifierEnv,
    userIds: string[],
    event: WireEvent<T> & { data: M[T] },
  ): Promise<PromiseSettledResult<void>[]>;

  /**
   * Disconnect all of a user's active WebSocket connections.
   *
   * @param env - Worker env containing the `USER_CHANNEL` binding.
   * @param userId - The user to disconnect.
   * @param reason - Optional close reason string.
   */
  disconnectUser(
    env: NotifierEnv,
    userId: string,
    reason?: string,
  ): Promise<void>;

  /**
   * Check whether a user has any active WebSocket connections.
   *
   * @param env - Worker env containing the `USER_CHANNEL` binding.
   * @param userId - The user to check.
   * @returns `true` if the user has at least one open connection.
   */
  getPresence(
    env: NotifierEnv,
    userId: string,
  ): Promise<boolean>;

  /** The UserChannel Durable Object class to export from your worker. */
  UserChannel: typeof import("./durable-object").UserChannel;

  // --- Channel methods ---

  /**
   * Handle an incoming channel subscribe request.
   *
   * Authenticates the request, checks authorization for private channels,
   * then adds the user to the channel's member list.
   *
   * The request body must be JSON with `{ channel: string }`.
   *
   * @param request - The incoming HTTP request.
   * @param env - Worker env containing `USER_CHANNEL` and `CHANNEL` bindings.
   * @returns JSON response with `{ ok: true }` on success, or an error.
   */
  subscribe(request: Request, env: NotifierEnv): Promise<Response>;

  /**
   * Handle an incoming channel unsubscribe request.
   *
   * Authenticates the request, then removes the user from the channel's
   * member list.
   *
   * The request body must be JSON with `{ channel: string }`.
   *
   * @param request - The incoming HTTP request.
   * @param env - Worker env containing `USER_CHANNEL` and `CHANNEL` bindings.
   * @returns JSON response with `{ ok: true }` on success, or an error.
   */
  unsubscribe(request: Request, env: NotifierEnv): Promise<Response>;

  /**
   * Send an event to all members of a channel.
   *
   * Looks up the channel's member list, then fans out to each member's
   * UserChannel DO. The event includes the `channel` field so clients
   * can identify its origin. Individual delivery failures are silently
   * ignored (uses `Promise.allSettled`).
   *
   * @param env - Worker env containing `USER_CHANNEL` and `CHANNEL` bindings.
   * @param channel - The channel name to send to.
   * @param event - The event to send, with `type` and `data`.
   */
  sendToChannel<T extends keyof M & string>(
    env: NotifierEnv,
    channel: string,
    event: WireEvent<T> & { data: M[T] },
  ): Promise<void>;

  /**
   * Get the list of user IDs subscribed to a channel.
   *
   * @param env - Worker env containing the `CHANNEL` binding.
   * @param channel - The channel name to query.
   * @returns Array of user IDs.
   */
  getChannelMembers(
    env: NotifierEnv,
    channel: string,
  ): Promise<string[]>;

  /** The Channel Durable Object class to export from your worker. */
  Channel: typeof import("./channel-object").Channel;
}
