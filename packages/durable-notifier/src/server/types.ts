import type { EventMap, WireEvent } from "../shared/types";

/** Returns a userId string or null to reject the connection. */
export type AuthenticateFn = (
  request: Request,
) => string | null | Promise<string | null>;

export interface ServerNotifierOptions {
  authenticate: AuthenticateFn;
}

/** The Durable Object binding the consumer must add to their env. */
export interface NotifierEnv {
  USER_CHANNEL: DurableObjectNamespace;
}

export interface ServerNotifier<M extends EventMap = EventMap> {
  /** Handle an incoming WebSocket upgrade request. */
  upgrade(request: Request, env: NotifierEnv): Promise<Response>;

  /** Send an event to all of a user's active connections. */
  sendToUser<T extends keyof M & string>(
    env: NotifierEnv,
    userId: string,
    event: WireEvent<T> & { data: M[T] },
  ): Promise<void>;

  /** The Durable Object class to export from your worker. */
  UserChannel: typeof import("./durable-object").UserChannel;
}
