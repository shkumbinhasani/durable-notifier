import type { WireEvent } from "../shared/types";
import type { ConnectionStatus, EventHandler } from "./types";

const MAX_BACKOFF_MS = 30_000;
const BASE_DELAY_MS = 1_000;
const JITTER_FACTOR = 0.25;
const PING_INTERVAL_MS = 30_000;

const INTERNAL_TYPES = new Set(["ping", "pong"]);

function hasWebSocket(): boolean {
  return typeof WebSocket !== "undefined";
}

export class ConnectionManager {
  private url: string;
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private destroyed = false;

  // Event listener registry: eventType -> set of handlers
  private listeners = new Map<string, Set<EventHandler>>();
  private subscriberCount = 0;

  // External store subscribers (for useSyncExternalStore)
  private statusSubscribers = new Set<() => void>();
  private eventSubscribers = new Set<() => void>();

  // Last event tracking
  private lastEvent: WireEvent | null = null;
  private lastEventByType = new Map<string, WireEvent>();

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // Whether lazy connection is enabled
  private lazy: boolean;

  // Monotonically increasing ID to distinguish connection generations.
  // Prevents stale close/open events from triggering actions after disconnect.
  private generation = 0;

  constructor(url: string, lazy: boolean = true) {
    this.url = url;
    this.lazy = lazy;

    if (!lazy && hasWebSocket()) {
      this.connect();
    }
  }

  // --- Public API for hooks ---

  subscribe(type: string, handler: EventHandler): () => void {
    if (this.destroyed) return () => {};

    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    this.subscriberCount++;

    if (this.shouldConnect()) {
      this.connect();
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;

      this.listeners.get(type)?.delete(handler);
      if (this.listeners.get(type)?.size === 0) {
        this.listeners.delete(type);
      }
      this.subscriberCount--;

      if (this.subscriberCount === 0 && this.lazy) {
        this.disconnect();
      }
    };
  }

  /** Permanently close the connection and prevent reconnects. */
  close(): void {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.stopPing();

    if (this.ws) {
      this.ws.close(1000, "Client closed");
      this.ws = null;
    }

    this.generation++;
    this.listeners.clear();
    this.subscriberCount = 0;
    this.clearEventCache();
    this.setStatus("closed");
  }

  /** Clear cached events (useful on disconnect/logout). */
  clearEventCache(): void {
    this.lastEvent = null;
    this.lastEventByType.clear();
    this.notifyEventSubscribers();
  }

  subscribeStatus(callback: () => void): () => void {
    this.statusSubscribers.add(callback);
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  getStatusSnapshot(): ConnectionStatus {
    return this.status;
  }

  subscribeEvents(callback: () => void): () => void {
    this.eventSubscribers.add(callback);
    return () => {
      this.eventSubscribers.delete(callback);
    };
  }

  getLastEventSnapshot(type?: string): WireEvent | null {
    if (type) {
      return this.lastEventByType.get(type) ?? null;
    }
    return this.lastEvent;
  }

  // --- Internal ---

  private shouldConnect(): boolean {
    return (
      !this.ws &&
      !this.destroyed &&
      this.status !== "connecting" &&
      hasWebSocket()
    );
  }

  private connect(): void {
    if (this.ws || this.destroyed || !hasWebSocket()) return;

    this.setStatus("connecting");

    const gen = ++this.generation;
    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      if (gen !== this.generation) return;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.startPing();
    });

    ws.addEventListener("message", (event) => {
      if (gen !== this.generation) return;
      this.handleMessage(event);
    });

    ws.addEventListener("close", () => {
      if (gen !== this.generation) return;
      this.ws = null;
      this.stopPing();
      this.handleDisconnect();
    });

    ws.addEventListener("error", () => {
      // The close event will follow; we handle reconnection there.
    });

    this.ws = ws;
  }

  private disconnect(): void {
    this.clearReconnectTimer();
    this.stopPing();
    this.generation++;

    if (this.ws) {
      this.ws.close(1000, "No subscribers");
      this.ws = null;
    }

    this.setStatus("idle");
  }

  private handleMessage(msgEvent: MessageEvent): void {
    try {
      const event: WireEvent = JSON.parse(msgEvent.data as string);

      if (typeof event.type !== "string") return;
      if (INTERNAL_TYPES.has(event.type)) return;

      this.lastEvent = event;
      this.lastEventByType.set(event.type, event);
      this.notifyEventSubscribers();

      const handlers = this.listeners.get(event.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(event.data, event);
        }
      }
    } catch {
      // Malformed message, ignore.
    }
  }

  private handleDisconnect(): void {
    if (this.destroyed) {
      this.setStatus("closed");
    } else if (this.subscriberCount > 0 || !this.lazy) {
      this.scheduleReconnect();
    } else {
      this.setStatus("idle");
    }
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");

    const baseDelay = Math.min(
      BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = baseDelay + jitter;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusSubscribers) {
      cb();
    }
  }

  private notifyEventSubscribers(): void {
    for (const cb of this.eventSubscribers) {
      cb();
    }
  }
}
