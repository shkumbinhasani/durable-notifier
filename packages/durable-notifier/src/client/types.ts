import type { EventData, EventMap, WireEvent } from "../shared/types";

/** WebSocket connection status. */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

/**
 * Callback for handling a received event.
 *
 * @typeParam D - The typed payload for the event.
 * @param data - The event payload (typed when using an {@link EventMap}).
 * @param event - The full {@link WireEvent} envelope including `type`, `id`, and `ts`.
 */
export type EventHandler<D = unknown> = (data: D, event: WireEvent) => void;

/** Options for {@link createNotifier}. */
export interface NotifierOptions {
  /**
   * Only connect when the first `useEvent` subscriber appears.
   *
   * When `true` (default), the WebSocket is opened lazily on the first
   * subscription and closed when the last subscriber unmounts.
   *
   * When `false`, the WebSocket opens immediately and reconnects even
   * with zero subscribers.
   *
   * @default true
   */
  lazy?: boolean;
}

/**
 * Client-side notifier returned by {@link createNotifier}.
 *
 * Provides React hooks for subscribing to events, reading connection status,
 * and accessing the last received event. All hooks share a single WebSocket.
 *
 * @typeParam M - An {@link EventMap} describing all event types and their payloads.
 */
export interface Notifier<M extends EventMap = EventMap> {
  /**
   * React hook: subscribe to a specific event type.
   *
   * The handler is called whenever an event of the given type arrives.
   * The subscription is automatically cleaned up when the component unmounts.
   * The handler always uses the latest callback reference (no stale closures).
   *
   * Only `useEvent` triggers a WebSocket connection — `useStatus` and
   * `useLastEvent` are passive.
   *
   * @param type - The event type to subscribe to.
   * @param handler - Callback receiving the typed payload and full event.
   */
  useEvent<T extends keyof M & string>(
    type: T,
    handler: EventHandler<EventData<M, T>>,
  ): void;

  /**
   * React hook: get the current connection status.
   *
   * Returns one of `"idle"`, `"connecting"`, `"connected"`, `"reconnecting"`,
   * or `"closed"`. SSR-safe — returns `"idle"` on the server.
   */
  useStatus(): ConnectionStatus;

  /**
   * React hook: get the last received event, optionally filtered by type.
   *
   * Returns `null` until the first matching event arrives. The returned
   * reference is stable (same object until a new event arrives), so it
   * works with `React.memo` and dependency arrays. SSR-safe — returns
   * `null` on the server.
   *
   * @param type - If provided, returns the last event of this specific type.
   */
  useLastEvent<T extends keyof M & string>(
    type?: T,
  ): WireEvent<T> | null;

  /**
   * Permanently close the WebSocket and prevent reconnects.
   *
   * Sets status to `"closed"`, clears all listeners and cached events.
   * A new notifier must be created to reconnect.
   */
  close(): void;

  /**
   * Clear cached events without closing the connection.
   *
   * Useful on logout or user switch to prevent `useLastEvent` from
   * returning stale data from the previous session.
   */
  clearEventCache(): void;
}
