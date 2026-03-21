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

/** Options for {@link createServerNotifier}. */
export interface ServerNotifierOptions {
  /** Derive the user ID from an incoming request. Return `null` to reject. */
  authenticate: AuthenticateFn;
}

/**
 * The Durable Object binding the consumer must add to their `Env`.
 *
 * The binding name in `wrangler.jsonc` must be `USER_CHANNEL`.
 *
 * @example
 * ```ts
 * type Env = { Bindings: NotifierEnv & { DB: D1Database } };
 * ```
 */
export interface NotifierEnv {
  USER_CHANNEL: DurableObjectNamespace;
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

  /** The Durable Object class to export from your worker. */
  UserChannel: typeof import("./durable-object").UserChannel;
}
