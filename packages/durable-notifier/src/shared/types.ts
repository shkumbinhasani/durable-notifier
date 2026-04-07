/** Wire format for all events sent over the WebSocket. */
export interface WireEvent<T extends string = string> {
  type: T;
  data?: unknown;
  id?: string;
  ts?: number;
  /** Channel name, present when the event was sent via a channel. */
  channel?: string;
}

/**
 * User-defined event map for type safety.
 *
 * @example
 * ```ts
 * type MyEvents = {
 *   "order.updated": { orderId: string; status: string };
 *   "message.created": { messageId: string };
 * };
 * ```
 */
export type EventMap = Record<string, unknown>;

/** Extract the data type for a given event type from an event map. */
export type EventData<M extends EventMap, T extends keyof M & string> = M[T];
