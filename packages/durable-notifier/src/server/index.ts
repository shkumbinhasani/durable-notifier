import type { EventMap, WireEvent } from "../shared/types";
import { UserChannel } from "./durable-object";
import type {
  AuthenticateFn,
  NotifierEnv,
  ServerNotifier,
  ServerNotifierOptions,
} from "./types";

export function createServerNotifier<M extends EventMap = EventMap>(
  options: ServerNotifierOptions,
): ServerNotifier<M> {
  const { authenticate } = options;

  return {
    UserChannel,

    async upgrade(request: Request, env: NotifierEnv): Promise<Response> {
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
      return stub.fetch(new Request(doUrl.toString(), request));
    },

    async sendToUser<T extends keyof M & string>(
      env: NotifierEnv,
      userId: string,
      event: WireEvent<T> & { data: M[T] },
    ): Promise<void> {
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
