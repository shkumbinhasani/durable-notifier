type Listener = (event: any) => void;

export const instances: MockWebSocket[] = [];

export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(_data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
  }

  close(_code?: number, _reason?: string): void {
    if (
      this.readyState === MockWebSocket.CLOSED ||
      this.readyState === MockWebSocket.CLOSING
    ) {
      return;
    }
    this.readyState = MockWebSocket.CLOSING;
    // Fire close async like real WebSockets
    queueMicrotask(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", {});
    });
  }

  // --- Test helpers ---

  /** Simulate the server accepting the connection. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  /** Simulate a message from the server. */
  simulateMessage(data: string): void {
    this.emit("message", { data });
  }

  /** Simulate the server closing the connection. */
  simulateClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  /** Simulate a connection error. */
  simulateError(): void {
    this.emit("error", {});
  }

  private emit(type: string, event: any): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }
}

export function resetInstances(): void {
  instances.length = 0;
}

export function lastInstance(): MockWebSocket {
  return instances[instances.length - 1];
}
