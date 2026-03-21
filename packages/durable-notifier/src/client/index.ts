import { useEffect, useRef, useSyncExternalStore } from "react";
import type { EventData, EventMap, WireEvent } from "../shared/types";
import { ConnectionManager } from "./connection";
import type {
  ConnectionStatus,
  EventHandler,
  Notifier,
  NotifierOptions,
} from "./types";

/**
 * Create a client-side notifier with React hooks for realtime events.
 *
 * Call this once at module scope. All hooks returned share a single WebSocket
 * connection, multiplexing event subscriptions through an internal registry.
 *
 * @typeParam M - An {@link EventMap} describing all event types and their payloads.
 * @param url - WebSocket URL (e.g. `"wss://my-worker.example.com/ws"`).
 * @param options - Optional configuration (e.g. `{ lazy: false }`).
 * @returns A {@link Notifier} with `useEvent`, `useStatus`, `useLastEvent`,
 *          `close`, and `clearEventCache`.
 *
 * @example
 * ```ts
 * const notifier = createNotifier<MyEvents>("/ws");
 *
 * function Inbox() {
 *   notifier.useEvent("inbox.invalidate", () => {
 *     queryClient.invalidateQueries({ queryKey: ["inbox"] });
 *   });
 *   return <div>Status: {notifier.useStatus()}</div>;
 * }
 * ```
 */
export function createNotifier<M extends EventMap = EventMap>(
  url: string,
  options?: NotifierOptions,
): Notifier<M> {
  const manager = new ConnectionManager(url, options?.lazy ?? true);

  function useEvent<T extends keyof M & string>(
    type: T,
    handler: EventHandler<EventData<M, T>>,
  ): void {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
      const stableHandler: EventHandler = (data, event) => {
        handlerRef.current(data as EventData<M, T>, event);
      };
      return manager.subscribe(type, stableHandler);
    }, [type]);
  }

  // Stable references — created once per createNotifier call,
  // so useSyncExternalStore won't re-subscribe on every render.
  const subscribeStatus = (cb: () => void) => manager.subscribeStatus(cb);
  const getStatusSnapshot = () => manager.getStatusSnapshot();
  const getStatusServerSnapshot = () => "idle" as ConnectionStatus;

  function useStatus(): ConnectionStatus {
    return useSyncExternalStore(
      subscribeStatus,
      getStatusSnapshot,
      getStatusServerSnapshot,
    );
  }

  const subscribeEvents = (cb: () => void) => manager.subscribeEvents(cb);
  const getEventsServerSnapshot = () => null;

  function useLastEvent<T extends keyof M & string>(
    type?: T,
  ): WireEvent<T> | null {
    return useSyncExternalStore(
      subscribeEvents,
      () => manager.getLastEventSnapshot(type) as WireEvent<T> | null,
      getEventsServerSnapshot,
    );
  }

  function close(): void {
    manager.close();
  }

  function clearEventCache(): void {
    manager.clearEventCache();
  }

  return { useEvent, useStatus, useLastEvent, close, clearEventCache };
}

export type { Notifier, NotifierOptions, EventHandler, ConnectionStatus } from "./types";
export type { EventMap, WireEvent } from "../shared/types";
