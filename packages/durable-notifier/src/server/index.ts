import type { EventMap, WireEvent } from "../shared/types";
import { Channel } from "./channel-object";
import { UserChannel } from "./durable-object";
import type {
  NotifierEnv,
  ServerNotifier,
  ServerNotifierOptions,
} from "./types";

function assertBinding(env: NotifierEnv): void {
  if (!env?.USER_CHANNEL) {
    throw new Error(
      'durable-notifier: missing "USER_CHANNEL" Durable Object binding in env. ' +
        "Add it to your wrangler.jsonc under durable_objects.bindings.",
    );
  }
}

function assertChannelBinding(env: NotifierEnv): asserts env is NotifierEnv & {
  CHANNEL: DurableObjectNamespace;
} {
  if (!env?.CHANNEL) {
    throw new Error(
      'durable-notifier: missing "CHANNEL" Durable Object binding in env. ' +
        "Add it to your wrangler.jsonc under durable_objects.bindings.",
    );
  }
}

/**
 * Create a server-side notifier for authenticated per-user realtime events.
 *
 * @typeParam M - An {@link EventMap} describing all event types and their payloads.
 * @param options - Configuration including the `authenticate` function.
 * @returns A {@link ServerNotifier} with user and channel methods,
 *          plus the `UserChannel` and `Channel` DO classes.
 *
 * @example
 * ```ts
 * const notifier = createServerNotifier<MyEvents>({
 *   authenticate: async (request) => {
 *     const session = await getSession(request);
 *     return session?.user.id ?? null;
 *   },
 *   authorizeChannel: async (userId, channel) => {
 *     // Check if user has access to this private channel
 *     return db.hasAccess(userId, channel);
 *   },
 * });
 *
 * export { UserChannel, Channel } from "durable-notifier/server";
 * ```
 */
export function createServerNotifier<M extends EventMap = EventMap>(
  options: ServerNotifierOptions,
): ServerNotifier<M> {
  const { authenticate, authorizeChannel } = options;

  /** Send a pre-formed wire event to a user's DO. */
  async function sendWireEvent(
    env: NotifierEnv,
    userId: string,
    wire: WireEvent,
  ): Promise<void> {
    assertBinding(env);

    const id = env.USER_CHANNEL.idFromName(userId);
    const stub = env.USER_CHANNEL.get(id);

    const res = await stub.fetch(
      new Request("https://do-internal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire),
      }),
    );

    if (!res.ok) {
      throw new Error(
        `Failed to send event to user "${userId}": ${res.status} ${await res.text()}`,
      );
    }
  }

  async function sendToUser<T extends keyof M & string>(
    env: NotifierEnv,
    userId: string,
    event: WireEvent<T> & { data: M[T] },
  ): Promise<void> {
    const wire: WireEvent<T> = {
      type: event.type,
      data: event.data,
      id: event.id ?? crypto.randomUUID(),
      ts: event.ts ?? Date.now(),
    };
    return sendWireEvent(env, userId, wire);
  }

  async function getChannelMembersInternal(
    env: NotifierEnv & { CHANNEL: DurableObjectNamespace },
    channel: string,
  ): Promise<string[]> {
    const channelId = env.CHANNEL.idFromName(channel);
    const stub = env.CHANNEL.get(channelId);

    const res = await stub.fetch(
      new Request("https://do-internal/members", { method: "GET" }),
    );
    const data = await res.json<{ members: string[] }>();
    return data.members;
  }

  return {
    UserChannel,
    Channel,

    async upgrade(request: Request, env: NotifierEnv): Promise<Response> {
      assertBinding(env);

      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const userId = await authenticate(request);
      if (!userId) {
        return new Response("Unauthorized", { status: 401 });
      }

      const id = env.USER_CHANNEL.idFromName(userId);
      const stub = env.USER_CHANNEL.get(id);

      const doUrl = new URL(request.url);
      doUrl.pathname = "/websocket";
      doUrl.search = "";
      return stub.fetch(
        new Request(doUrl.toString(), {
          method: request.method,
          headers: request.headers,
        }),
      );
    },

    sendToUser,

    async sendToUsers<T extends keyof M & string>(
      env: NotifierEnv,
      userIds: string[],
      event: WireEvent<T> & { data: M[T] },
    ): Promise<PromiseSettledResult<void>[]> {
      return Promise.allSettled(
        userIds.map((userId) => sendToUser(env, userId, event)),
      );
    },

    async disconnectUser(
      env: NotifierEnv,
      userId: string,
      reason?: string,
    ): Promise<void> {
      assertBinding(env);

      const id = env.USER_CHANNEL.idFromName(userId);
      const stub = env.USER_CHANNEL.get(id);

      await stub.fetch(
        new Request("https://do-internal/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
    },

    async getPresence(
      env: NotifierEnv,
      userId: string,
    ): Promise<boolean> {
      assertBinding(env);

      const id = env.USER_CHANNEL.idFromName(userId);
      const stub = env.USER_CHANNEL.get(id);

      const res = await stub.fetch(
        new Request("https://do-internal/presence", { method: "GET" }),
      );
      const data = await res.json<{ online: boolean }>();
      return data.online;
    },

    // --- Channel methods ---

    async subscribe(request: Request, env: NotifierEnv): Promise<Response> {
      assertChannelBinding(env);

      const userId = await authenticate(request);
      if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      let body: { channel?: string };
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      const channel = body.channel;
      if (!channel || typeof channel !== "string") {
        return Response.json(
          { error: "Missing or invalid channel name" },
          { status: 400 },
        );
      }

      // Private and presence channels require authorization
      if (channel.startsWith("private-") || channel.startsWith("presence-")) {
        if (!authorizeChannel) {
          return Response.json(
            { error: "Channel authorization not configured" },
            { status: 403 },
          );
        }
        const allowed = await authorizeChannel(userId, channel);
        if (!allowed) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
      }

      const channelId = env.CHANNEL.idFromName(channel);
      const stub = env.CHANNEL.get(channelId);

      await stub.fetch(
        new Request("https://do-internal/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
      );

      return Response.json({ ok: true });
    },

    async unsubscribe(request: Request, env: NotifierEnv): Promise<Response> {
      assertChannelBinding(env);

      const userId = await authenticate(request);
      if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      let body: { channel?: string };
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        );
      }

      const channel = body.channel;
      if (!channel || typeof channel !== "string") {
        return Response.json(
          { error: "Missing or invalid channel name" },
          { status: 400 },
        );
      }

      const channelId = env.CHANNEL.idFromName(channel);
      const stub = env.CHANNEL.get(channelId);

      await stub.fetch(
        new Request("https://do-internal/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
      );

      return Response.json({ ok: true });
    },

    async sendToChannel<T extends keyof M & string>(
      env: NotifierEnv,
      channel: string,
      event: WireEvent<T> & { data: M[T] },
    ): Promise<void> {
      assertChannelBinding(env);

      // Build wire event once — same id/ts for all recipients
      const wire: WireEvent<T> = {
        type: event.type,
        data: event.data,
        channel,
        id: event.id ?? crypto.randomUUID(),
        ts: event.ts ?? Date.now(),
      };

      const members = await getChannelMembersInternal(env, channel);
      await Promise.allSettled(
        members.map((userId) => sendWireEvent(env, userId, wire)),
      );
    },

    async getChannelMembers(
      env: NotifierEnv,
      channel: string,
    ): Promise<string[]> {
      assertChannelBinding(env);
      return getChannelMembersInternal(env, channel);
    },
  };
}

export { UserChannel } from "./durable-object";
export { Channel } from "./channel-object";
export type {
  AuthenticateFn,
  AuthorizeChannelFn,
  NotifierEnv,
  ServerNotifier,
  ServerNotifierOptions,
} from "./types";
export type { EventMap, WireEvent } from "../shared/types";
