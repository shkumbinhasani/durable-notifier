import type { EventMap, WireEvent } from "../shared/types";
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

/**
 * Create a server-side notifier for authenticated per-user realtime events.
 *
 * @typeParam M - An {@link EventMap} describing all event types and their payloads.
 * @param options - Configuration including the `authenticate` function.
 * @returns A {@link ServerNotifier} with `upgrade`, `sendToUser`, `sendToUsers`,
 *          `disconnectUser`, `getPresence`, and the `UserChannel` DO class.
 *
 * @example
 * ```ts
 * const notifier = createServerNotifier<MyEvents>({
 *   authenticate: async (request) => {
 *     const session = await getSession(request);
 *     return session?.user.id ?? null;
 *   },
 * });
 *
 * export { UserChannel } from "durable-notifier/server";
 * ```
 */
export function createServerNotifier<M extends EventMap = EventMap>(
  options: ServerNotifierOptions,
): ServerNotifier<M> {
  const { authenticate } = options;

  async function sendToUser<T extends keyof M & string>(
    env: NotifierEnv,
    userId: string,
    event: WireEvent<T> & { data: M[T] },
  ): Promise<void> {
    assertBinding(env);

    const id = env.USER_CHANNEL.idFromName(userId);
    const stub = env.USER_CHANNEL.get(id);

    const wire: WireEvent<T> = {
      type: event.type,
      data: event.data,
      id: event.id ?? crypto.randomUUID(),
      ts: event.ts ?? Date.now(),
    };

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

  return {
    UserChannel,

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
  };
}

export { UserChannel } from "./durable-object";
export type {
  AuthenticateFn,
  NotifierEnv,
  ServerNotifier,
  ServerNotifierOptions,
} from "./types";
export type { EventMap, WireEvent } from "../shared/types";
