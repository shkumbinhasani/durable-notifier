import type { EventData, EventMap, WireEvent } from "../shared/types";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export type EventHandler<D = unknown> = (data: D, event: WireEvent) => void;

export interface NotifierOptions {
  /** Only connect when the first subscriber appears. Default: true. */
  lazy?: boolean;
}

export interface Notifier<M extends EventMap = EventMap> {
  /** Subscribe to a specific event type. Cleans up on unmount. */
  useEvent<T extends keyof M & string>(
    type: T,
    handler: EventHandler<EventData<M, T>>,
  ): void;

  /** Get the current connection status. */
  useStatus(): ConnectionStatus;

  /** Get the last event received, optionally filtered by type. */
  useLastEvent<T extends keyof M & string>(
    type?: T,
  ): WireEvent<T> | null;

  /** Permanently close the connection and prevent reconnects. */
  close(): void;

  /** Clear cached events (e.g. on logout or user switch). */
  clearEventCache(): void;
}
