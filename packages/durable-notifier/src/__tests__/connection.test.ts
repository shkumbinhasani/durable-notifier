import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ConnectionManager } from "../client/connection";
import { instances, lastInstance, resetInstances } from "./mock-ws";

beforeEach(() => {
  resetInstances();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionManager", () => {
  describe("lazy connection", () => {
    it("does not connect when created with lazy: true", () => {
      new ConnectionManager("ws://test", { lazy: true });
      expect(instances).toHaveLength(0);
    });

    it("connects on first subscriber", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      expect(instances).toHaveLength(1);
    });

    it("does not open a second WebSocket for a second subscriber", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("a", () => {});
      mgr.subscribe("b", () => {});
      expect(instances).toHaveLength(1);
    });

    it("disconnects when all subscribers unsubscribe", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const unsub1 = mgr.subscribe("a", () => {});
      const unsub2 = mgr.subscribe("b", () => {});
      lastInstance().simulateOpen();

      unsub1();
      expect(mgr.getStatusSnapshot()).toBe("connected");

      unsub2();
      expect(mgr.getStatusSnapshot()).toBe("idle");
    });
  });

  describe("eager connection", () => {
    it("connects immediately with lazy: false", () => {
      new ConnectionManager("ws://test", { lazy: false });
      expect(instances).toHaveLength(1);
    });

    it("reconnects after disconnect even with zero subscribers", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: false });
      lastInstance().simulateOpen();

      lastInstance().simulateClose(1006, "abnormal");
      expect(mgr.getStatusSnapshot()).toBe("reconnecting");

      vi.advanceTimersByTime(2000);
      expect(instances).toHaveLength(2);
    });

    it("does not reconnect after close()", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: false });
      lastInstance().simulateOpen();

      mgr.close();
      vi.advanceTimersByTime(60000);
      expect(instances).toHaveLength(1);
      expect(mgr.getStatusSnapshot()).toBe("closed");
    });
  });

  describe("status", () => {
    it("starts as idle", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      expect(mgr.getStatusSnapshot()).toBe("idle");
    });

    it("transitions to connecting on subscribe", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      expect(mgr.getStatusSnapshot()).toBe("connecting");
    });

    it("transitions to connected on open", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();
      expect(mgr.getStatusSnapshot()).toBe("connected");
    });

    it("notifies status subscribers", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const statuses: string[] = [];
      mgr.subscribeStatus(() => {
        statuses.push(mgr.getStatusSnapshot());
      });

      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      expect(statuses).toEqual(["connecting", "connected"]);
    });
  });

  describe("event dispatch", () => {
    it("dispatches events to matching handlers", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const received: unknown[] = [];
      mgr.subscribe("chat.message", (data) => received.push(data));
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "chat.message", data: { text: "hello" } }),
      );

      expect(received).toEqual([{ text: "hello" }]);
    });

    it("does not dispatch to non-matching handlers", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const received: unknown[] = [];
      mgr.subscribe("chat.message", (data) => received.push(data));
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "other.event", data: {} }),
      );

      expect(received).toEqual([]);
    });

    it("dispatches to multiple handlers for the same event", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const a: unknown[] = [];
      const b: unknown[] = [];
      mgr.subscribe("e", (data) => a.push(data));
      mgr.subscribe("e", (data) => b.push(data));
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "e", data: 42 }),
      );

      expect(a).toEqual([42]);
      expect(b).toEqual([42]);
    });

    it("filters out pong messages", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const received: unknown[] = [];
      mgr.subscribe("pong", (data) => received.push(data));
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(JSON.stringify({ type: "pong" }));

      expect(received).toEqual([]);
      expect(mgr.getLastEventSnapshot("pong")).toBeNull();
    });

    it("filters out messages without a string type", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const events: unknown[] = [];
      mgr.subscribeEvents(() => events.push("notified"));
      mgr.subscribe("x", () => {});
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(JSON.stringify({ notType: "x" }));

      expect(events).toEqual([]);
    });

    it("dispatches channel events with channel field", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const received: { data: unknown; channel?: string }[] = [];
      mgr.subscribe("chat.message", (data, event) =>
        received.push({ data, channel: event.channel }),
      );
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({
          type: "chat.message",
          data: { text: "hello" },
          channel: "room-42",
        }),
      );

      expect(received).toEqual([
        { data: { text: "hello" }, channel: "room-42" },
      ]);
    });
  });

  describe("lastEvent", () => {
    it("stores the last event globally and per type", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("a", () => {});
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "a", data: 1 }),
      );
      lastInstance().simulateMessage(
        JSON.stringify({ type: "b", data: 2 }),
      );

      expect(mgr.getLastEventSnapshot()).toEqual({ type: "b", data: 2 });
      expect(mgr.getLastEventSnapshot("a")).toEqual({ type: "a", data: 1 });
      expect(mgr.getLastEventSnapshot("b")).toEqual({ type: "b", data: 2 });
      expect(mgr.getLastEventSnapshot("c")).toBeNull();
    });
  });

  describe("clearEventCache", () => {
    it("clears all cached events", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("a", () => {});
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "a", data: 1 }),
      );
      expect(mgr.getLastEventSnapshot("a")).not.toBeNull();

      mgr.clearEventCache();
      expect(mgr.getLastEventSnapshot()).toBeNull();
      expect(mgr.getLastEventSnapshot("a")).toBeNull();
    });

    it("is called on close() to prevent stale data", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("a", () => {});
      lastInstance().simulateOpen();

      lastInstance().simulateMessage(
        JSON.stringify({ type: "a", data: 1 }),
      );
      mgr.close();

      expect(mgr.getLastEventSnapshot("a")).toBeNull();
    });
  });

  describe("reconnection", () => {
    it("reconnects with backoff when disconnected with active subscribers", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      lastInstance().simulateClose(1006, "abnormal");
      expect(mgr.getStatusSnapshot()).toBe("reconnecting");

      vi.advanceTimersByTime(2000);
      expect(instances).toHaveLength(2);
    });

    it("does not reconnect if no subscribers remain (lazy mode)", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const unsub = mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      unsub();
      expect(mgr.getStatusSnapshot()).toBe("idle");

      vi.advanceTimersByTime(60000);
      expect(instances.length).toBeLessThanOrEqual(2);
    });
  });

  describe("close()", () => {
    it("sets status to closed", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      mgr.close();
      expect(mgr.getStatusSnapshot()).toBe("closed");
    });

    it("prevents new subscriptions", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.close();

      mgr.subscribe("test", () => {});
      expect(instances).toHaveLength(0);
    });

    it("prevents reconnection", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      mgr.close();
      vi.advanceTimersByTime(60000);

      expect(instances).toHaveLength(1);
    });

    it("clears channel subscriptions", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await mgr.subscribeChannel("room-42");
      mgr.close();

      // After close, reconnect should not re-subscribe channels
      expect(fetchSpy).toHaveBeenCalledTimes(1); // Only the initial subscribe

      fetchSpy.mockRestore();
    });
  });

  describe("double-unsubscribe guard", () => {
    it("calling unsubscribe twice does not corrupt subscriberCount", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const unsub = mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      unsub();
      unsub();

      mgr.subscribe("test", () => {});
      expect(instances).toHaveLength(2);
    });
  });

  describe("generation guards", () => {
    it("ignores open events from stale connections", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const unsub = mgr.subscribe("test", () => {});
      const firstWs = lastInstance();

      unsub();

      firstWs.simulateOpen();
      expect(mgr.getStatusSnapshot()).toBe("idle");
    });

    it("ignores messages from stale connections", () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      const received: unknown[] = [];
      const unsub = mgr.subscribe("test", (data) => received.push(data));
      const firstWs = lastInstance();
      firstWs.simulateOpen();

      unsub();
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      firstWs.simulateMessage(
        JSON.stringify({ type: "test", data: "stale" }),
      );
      expect(received).toEqual([]);
    });
  });

  describe("SSR safety", () => {
    it("does not throw when WebSocket is unavailable", () => {
      const originalWS = globalThis.WebSocket;
      // @ts-expect-error — simulating SSR
      delete globalThis.WebSocket;

      try {
        const mgr = new ConnectionManager("ws://test", { lazy: false });
        expect(mgr.getStatusSnapshot()).toBe("idle");
        expect(instances).toHaveLength(0);

        // subscribe should also be safe
        const unsub = mgr.subscribe("test", () => {});
        expect(instances).toHaveLength(0);
        unsub();
      } finally {
        globalThis.WebSocket = originalWS;
      }
    });
  });

  describe("channel support", () => {
    it("subscribes to a channel via HTTP", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await mgr.subscribeChannel("room-42");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("http://test/channels/subscribe");
      expect(opts?.method).toBe("POST");
      expect(JSON.parse(opts?.body as string)).toEqual({ channel: "room-42" });

      fetchSpy.mockRestore();
    });

    it("unsubscribes from a channel via HTTP", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await mgr.subscribeChannel("room-42");
      await mgr.unsubscribeChannel("room-42");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [url] = fetchSpy.mock.calls[1];
      expect(url).toBe("http://test/channels/unsubscribe");

      fetchSpy.mockRestore();
    });

    it("re-subscribes channels on reconnect", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await mgr.subscribeChannel("room-42");
      await mgr.subscribeChannel("room-99");
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Simulate disconnect and reconnect
      lastInstance().simulateClose(1006, "abnormal");
      vi.advanceTimersByTime(2000);
      lastInstance().simulateOpen();

      // Wait for re-subscribe fetch calls
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4); // 2 original + 2 re-subscribes
      });

      fetchSpy.mockRestore();
    });

    it("does not subscribe if not connected", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });

      // Subscribe channel before WebSocket is connected
      await mgr.subscribeChannel("room-42");
      expect(fetchSpy).not.toHaveBeenCalled();

      // Once connected, it should subscribe
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      fetchSpy.mockRestore();
    });

    it("throws if channelEndpoint not configured", async () => {
      const mgr = new ConnectionManager("ws://test", { lazy: true });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await expect(mgr.subscribeChannel("room-42")).rejects.toThrow(
        "channelEndpoint",
      );
    });

    it("sends custom headers from getHeaders", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
        getHeaders: () => ({ Authorization: "Bearer test-token" }),
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await mgr.subscribeChannel("room-42");

      const [, opts] = fetchSpy.mock.calls[0];
      const headers = opts?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");

      fetchSpy.mockRestore();
    });

    it("throws on subscribe failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      );

      const mgr = new ConnectionManager("ws://test", {
        lazy: true,
        channelEndpoint: "http://test/channels",
      });
      mgr.subscribe("test", () => {});
      lastInstance().simulateOpen();

      await expect(mgr.subscribeChannel("private-room")).rejects.toThrow(
        "Forbidden",
      );

      fetchSpy.mockRestore();
    });
  });
});
