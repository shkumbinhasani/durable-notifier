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

function createMockEnvWithChannel(
  userStubFetch = vi.fn(),
  channelStubFetch = vi.fn(),
) {
  const userStub = { fetch: userStubFetch };
  const channelStub = { fetch: channelStubFetch };
  return {
    USER_CHANNEL: {
      idFromName: vi.fn((name: string) => `id:${name}`),
      get: vi.fn(() => userStub),
    },
    CHANNEL: {
      idFromName: vi.fn((name: string) => `ch:${name}`),
      get: vi.fn(() => channelStub),
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

  // --- Channel tests ---

  describe("subscribe (channel)", () => {
    it("returns 401 when unauthenticated", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => null,
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "room-42" }),
        }),
        env,
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing channel name", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("allows public channels without authorizeChannel", async () => {
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ ok: true }),
      );
      const env = createMockEnvWithChannel(vi.fn(), channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "room-42" }),
        }),
        env,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(env.CHANNEL.idFromName).toHaveBeenCalledWith("room-42");
    });

    it("returns 403 for private channels without authorizeChannel", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "private-room-42" }),
        }),
        env,
      );

      expect(res.status).toBe(403);
    });

    it("returns 403 for unauthorized private channels", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
        authorizeChannel: async () => false,
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "private-room-42" }),
        }),
        env,
      );

      expect(res.status).toBe(403);
    });

    it("allows authorized private channels", async () => {
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ ok: true }),
      );
      const env = createMockEnvWithChannel(vi.fn(), channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
        authorizeChannel: async (userId, channel) => {
          return userId === "user-1" && channel === "private-room-42";
        },
      });

      const res = await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "private-room-42" }),
        }),
        env,
      );

      expect(res.status).toBe(200);
    });

    it("passes userId to the channel DO", async () => {
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ ok: true }),
      );
      const env = createMockEnvWithChannel(vi.fn(), channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await notifier.subscribe(
        new Request("https://example.com/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "room-42" }),
        }),
        env,
      );

      const req = channelStubFetch.mock.calls[0][0] as Request;
      expect(new URL(req.url).pathname).toBe("/subscribe");
      const body = await req.json();
      expect(body).toEqual({ userId: "user-1" });
    });

    it("throws on missing CHANNEL binding", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.subscribe(
          new Request("https://example.com/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: "room-42" }),
          }),
          createMockEnv(),
        ),
      ).rejects.toThrow("CHANNEL");
    });
  });

  describe("unsubscribe (channel)", () => {
    it("returns 401 when unauthenticated", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => null,
      });

      const env = createMockEnvWithChannel();
      const res = await notifier.unsubscribe(
        new Request("https://example.com/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "room-42" }),
        }),
        env,
      );
      expect(res.status).toBe(401);
    });

    it("removes user from the channel DO", async () => {
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ ok: true }),
      );
      const env = createMockEnvWithChannel(vi.fn(), channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const res = await notifier.unsubscribe(
        new Request("https://example.com/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "room-42" }),
        }),
        env,
      );

      expect(res.status).toBe(200);
      const req = channelStubFetch.mock.calls[0][0] as Request;
      expect(new URL(req.url).pathname).toBe("/unsubscribe");
      const body = await req.json();
      expect(body).toEqual({ userId: "user-1" });
    });
  });

  describe("sendToChannel", () => {
    it("sends to all channel members", async () => {
      const userStubFetch = vi.fn().mockResolvedValue(
        new Response("OK", { status: 200 }),
      );
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ members: ["user-1", "user-2", "user-3"] }),
      );
      const env = createMockEnvWithChannel(userStubFetch, channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await notifier.sendToChannel(env, "room-42", {
        type: "chat.message",
        data: { text: "hello" },
      } as any);

      // Should fetch members
      expect(env.CHANNEL.idFromName).toHaveBeenCalledWith("room-42");

      // Should send to all 3 members
      expect(userStubFetch).toHaveBeenCalledTimes(3);

      // All events should have the same id, ts, and channel
      const bodies = await Promise.all(
        userStubFetch.mock.calls.map(async (call: any) => JSON.parse(await call[0].text())),
      );
      const firstId = bodies[0].id;
      const firstTs = bodies[0].ts;
      for (const body of bodies) {
        expect(body.type).toBe("chat.message");
        expect(body.data).toEqual({ text: "hello" });
        expect(body.channel).toBe("room-42");
        expect(body.id).toBe(firstId);
        expect(body.ts).toBe(firstTs);
      }
    });

    it("throws on missing CHANNEL binding", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.sendToChannel(createMockEnv(), "room-42", {
          type: "test",
          data: {},
        } as any),
      ).rejects.toThrow("CHANNEL");
    });
  });

  describe("getChannelMembers", () => {
    it("returns the member list", async () => {
      const channelStubFetch = vi.fn().mockResolvedValue(
        Response.json({ members: ["user-1", "user-2"] }),
      );
      const env = createMockEnvWithChannel(vi.fn(), channelStubFetch);

      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      const members = await notifier.getChannelMembers(env, "room-42");
      expect(members).toEqual(["user-1", "user-2"]);
      expect(env.CHANNEL.idFromName).toHaveBeenCalledWith("room-42");
    });

    it("throws on missing CHANNEL binding", async () => {
      const notifier = createServerNotifier({
        authenticate: async () => "user-1",
      });

      await expect(
        notifier.getChannelMembers(createMockEnv(), "room-42"),
      ).rejects.toThrow("CHANNEL");
    });
  });
});
