import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DO and CF types for unit testing the server logic.
// We test createServerNotifier's routing, validation, and error handling
// without needing a real Cloudflare runtime.

function createMockEnv(stubFetch = vi.fn()) {
  const stub = { fetch: stubFetch };
  return {
    USER_CHANNEL: {
      idFromName: vi.fn((name: string) => `id:${name}`),
      get: vi.fn(() => stub),
    },
  } as any;
}

// cloudflare:workers is aliased to cf-mock.ts via vitest.config.ts
import { createServerNotifier } from "../server/index";

describe("createServerNotifier", () => {
  describe("upgrade", () => {
    it("returns 426 for non-WebSocket requests", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const res = await notifier.upgrade(
        new Request("https://example.com/ws"),
        createMockEnv(),
      );
      expect(res.status).toBe(426);
    });

    it("returns 401 when authenticate returns null", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => null,
      });

      const res = await notifier.upgrade(
        new Request("https://example.com/ws", {
          headers: { Upgrade: "websocket" },
        }),
        createMockEnv(),
      );
      expect(res.status).toBe(401);
    });

    it("accepts case-insensitive Upgrade header", async () => {
      const stubFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const res = await notifier.upgrade(
        new Request("https://example.com/ws", {
          headers: { Upgrade: "WebSocket" },
        }),
        env,
      );
      expect(res.status).toBe(200);
    });

    it("routes to the correct DO by userId", async () => {
      const stubFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-42",
      });

      await notifier.upgrade(
        new Request("https://example.com/ws?token=abc", {
          headers: { Upgrade: "websocket" },
        }),
        env,
      );

      expect(env.USER_CHANNEL.idFromName).toHaveBeenCalledWith("user-42");
      expect(env.USER_CHANNEL.get).toHaveBeenCalledWith("id:user-42");

      // Verify query params are stripped
      const fetchedUrl = new URL(stubFetch.mock.calls[0][0].url);
      expect(fetchedUrl.pathname).toBe("/websocket");
      expect(fetchedUrl.search).toBe("");
    });

    it("throws on missing USER_CHANNEL binding", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.upgrade(
          new Request("https://example.com/ws", {
            headers: { Upgrade: "websocket" },
          }),
          {} as any,
        ),
      ).rejects.toThrow("USER_CHANNEL");
    });
  });

  describe("sendToUser", () => {
    it("sends an event to the DO", async () => {
      const stubFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await notifier.sendToUser(env, "user-1", {
        type: "test.event",
        data: { foo: "bar" },
      } as any);

      expect(env.USER_CHANNEL.idFromName).toHaveBeenCalledWith("user-1");
      const body = JSON.parse(await stubFetch.mock.calls[0][0].text());
      expect(body.type).toBe("test.event");
      expect(body.data).toEqual({ foo: "bar" });
      expect(body.id).toBeDefined();
      expect(body.ts).toBeDefined();
    });

    it("throws on non-OK response", async () => {
      const stubFetch = vi.fn().mockResolvedValue(
        new Response("Internal error", { status: 500 }),
      );
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.sendToUser(env, "user-1", {
          type: "test",
          data: {},
        } as any),
      ).rejects.toThrow('Failed to send event to user "user-1"');
    });

    it("throws on missing binding", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.sendToUser({} as any, "user-1", {
          type: "test",
          data: {},
        } as any),
      ).rejects.toThrow("USER_CHANNEL");
    });
  });

  describe("sendToUsers", () => {
    it("sends to all users concurrently", async () => {
      const stubFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const results = await notifier.sendToUsers(
        env,
        ["user-1", "user-2", "user-3"],
        { type: "test", data: {} } as any,
      );

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(env.USER_CHANNEL.idFromName).toHaveBeenCalledTimes(3);
    });

    it("does not fail all users when one fails", async () => {
      let callCount = 0;
      const stubFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return new Response("Error", { status: 500 });
        }
        return new Response("OK", { status: 200 });
      });
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const results = await notifier.sendToUsers(
        env,
        ["user-1", "user-2", "user-3"],
        { type: "test", data: {} } as any,
      );

      expect(results).toHaveLength(3);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(1);
    });
  });

  describe("disconnectUser", () => {
    it("sends a disconnect request to the DO", async () => {
      const stubFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await notifier.disconnectUser(env, "user-1", "Logged out");

      expect(env.USER_CHANNEL.idFromName).toHaveBeenCalledWith("user-1");
      const req = stubFetch.mock.calls[0][0] as Request;
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/disconnect");
      const body = await req.json();
      expect(body).toEqual({ reason: "Logged out" });
    });
  });

  describe("getPresence", () => {
    it("returns true when user is online", async () => {
      const stubFetch = vi.fn().mockResolvedValue(
        Response.json({ online: true, connections: 2 }),
      );
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const online = await notifier.getPresence(env, "user-1");
      expect(online).toBe(true);
    });

    it("returns false when user is offline", async () => {
      const stubFetch = vi.fn().mockResolvedValue(
        Response.json({ online: false, connections: 0 }),
      );
      const env = createMockEnv(stubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const online = await notifier.getPresence(env, "user-1");
      expect(online).toBe(false);
    });
  });
});
