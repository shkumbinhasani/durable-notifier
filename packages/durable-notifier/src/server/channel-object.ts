import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object that manages membership for a single channel.
 *
 * Each channel maps to one `Channel` instance (via `idFromName(channelName)`).
 * The DO stores member user IDs in persistent storage and exposes endpoints
 * for subscribe, unsubscribe, and member listing.
 *
 * This class is exported so consumers can re-export it in their worker for
 * wrangler to discover.
 */
export class Channel extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/subscribe" && request.method === "POST") {
      let body: { userId: string };
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (typeof body.userId !== "string") {
        return new Response("Missing userId", { status: 400 });
      }
      await this.ctx.storage.put(`member:${body.userId}`, true);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      let body: { userId: string };
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (typeof body.userId !== "string") {
        return new Response("Missing userId", { status: 400 });
      }
      await this.ctx.storage.delete(`member:${body.userId}`);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/members" && request.method === "GET") {
      const all = await this.ctx.storage.list({ prefix: "member:" });
      const members = [...all.keys()].map((k) => k.slice("member:".length));
      return Response.json({ members });
    }

    return new Response("Not found", { status: 404 });
  }
}
