import { DurableObject } from "cloudflare:workers";
import type { WireEvent } from "../shared/types";

/**
 * Durable Object that manages all WebSocket connections for a single user.
 *
 * Each user maps to one `UserChannel` instance (via `idFromName(userId)`).
 * The DO handles connection upgrades, event fanout, ping/pong, and presence.
 *
 * This class is exported so consumers can re-export it in their worker for
 * wrangler to discover.
 */
export class UserChannel extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/send" && request.method === "POST") {
      let event: WireEvent;
      try {
        event = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (typeof event.type !== "string") {
        return new Response("Missing event type", { status: 400 });
      }
      const sockets = this.ctx.getWebSockets();
      const message = JSON.stringify(event);
      for (const ws of sockets) {
        try {
          ws.send(message);
        } catch {
          // Socket is dead; close handler will fire.
        }
      }
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/disconnect" && request.method === "POST") {
      const body = await request.json<{ reason?: string }>().catch(() => ({}));
      const reason = (body as { reason?: string }).reason ?? "Disconnected by server";
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) {
        try {
          ws.close(1000, reason);
        } catch {
          // Already closed.
        }
      }
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/presence" && request.method === "GET") {
      const count = this.ctx.getWebSockets().length;
      return Response.json({ online: count > 0, connections: count });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    // Server-push only. If the client sends a ping, reply with pong.
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore malformed messages.
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Already closed.
    }
  }
}
