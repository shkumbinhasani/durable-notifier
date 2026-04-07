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
 * @param options - Optional configuration (e.g. `{ lazy: false, channelEndpoint: "..." }`).
 * @returns A {@link Notifier} with `useEvent`, `useStatus`, `useLastEvent`,
 *          `useChannel`, `subscribe`, `unsubscribe`, `close`, and `clearEventCache`.
 *
 * @example
 * ```ts
 * const notifier = createNotifier<MyEvents>("/ws", {
 *   channelEndpoint: "/channels",
 * });
 *
 * function ChatRoom({ roomId }: { roomId: string }) {
 *   notifier.useChannel(roomId);
 *   notifier.useEvent("chat.message", (data) => {
 *     console.log(data);
 *   });
 *   return <div>Status: {notifier.useStatus()}</div>;
 * }
 * ```
 */
export function createNotifier<M extends EventMap = EventMap>(
  url: string,
  options?: NotifierOptions,
): Notifier<M> {
  const manager = new ConnectionManager(url, {
    lazy: options?.lazy ?? true,
    channelEndpoint: options?.channelEndpoint,
    getHeaders: options?.getHeaders,
  });

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

  async function subscribe(channel: string): Promise<void> {
    return manager.subscribeChannel(channel);
  }

  async function unsubscribe(channel: string): Promise<void> {
    return manager.unsubscribeChannel(channel);
  }

  function useChannel(channel: string): void {
    useEffect(() => {
      void manager.subscribeChannel(channel);
      return () => {
        void manager.unsubscribeChannel(channel);
      };
    }, [channel]);
  }

  return {
    useEvent,
    useStatus,
    useLastEvent,
    close,
    clearEventCache,
    subscribe,
    unsubscribe,
    useChannel,
  };
}

export type { Notifier, NotifierOptions, EventHandler, ConnectionStatus } from "./types";
export type { EventMap, WireEvent } from "../shared/types";
