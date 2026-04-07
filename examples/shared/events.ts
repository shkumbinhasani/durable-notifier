/**
 * Shared event map — import this in both your worker and your React app
 * to get end-to-end type safety.
 *
 * @example
 * ```ts
 * // server
 * import { createServerNotifier } from "durable-notifier/server";
 * import type { AppEvents } from "../shared/events";
 * const notifier = createServerNotifier<AppEvents>({ authenticate });
 *
 * // client
 * import { createNotifier } from "durable-notifier/client";
 * import type { AppEvents } from "../shared/events";
 * const notifier = createNotifier<AppEvents>("/ws", {
 *   channelEndpoint: "/channels",
 * });
 * ```
 */
export type AppEvents = {
  "order.updated": { orderId: string; status: string };
  "chat.message": { from: string; text: string };
};
