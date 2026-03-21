import { useEffect, useRef, useSyncExternalStore } from "react";
import type { EventData, EventMap, WireEvent } from "../shared/types";
import { ConnectionManager } from "./connection";
import type {
  ConnectionStatus,
  EventHandler,
  Notifier,
  NotifierOptions,
} from "./types";

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
    // getLastEventSnapshot returns stored references directly (no cloning),
    // so useSyncExternalStore's Object.is comparison works correctly —
    // same event object = no re-render, new event object = re-render.
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
