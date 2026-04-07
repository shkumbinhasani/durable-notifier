import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createServerNotifier,
  UserChannel,
  Channel,
  type NotifierEnv,
} from "durable-notifier/server";

type MyEvents = {
  "order.updated": { orderId: string; status: string };
  "chat.message": { from: string; text: string };
};

type Env = {
  Bindings: NotifierEnv;
};

const notifier = createServerNotifier<MyEvents>({
  authenticate: async (request) => {
    // In production, validate a JWT or session cookie here.
    // For this example, the userId is passed as a query parameter.
    const url = new URL(request.url);
    return url.searchParams.get("userId");
  },
  authorizeChannel: async (userId, channel) => {
    // In production, check if the user has access to this channel.
    // For this example, allow all private channel subscriptions.
    console.log(`Authorizing ${userId} for ${channel}`);
    return true;
  },
});

const app = new Hono<Env>();

app.use("*", cors());

// WebSocket upgrade endpoint
app.get("/ws", (c) => notifier.upgrade(c.req.raw, c.env));

// Channel subscribe/unsubscribe endpoints
app.post("/channels/subscribe", (c) => notifier.subscribe(c.req.raw, c.env));
app.post("/channels/unsubscribe", (c) => notifier.unsubscribe(c.req.raw, c.env));

// Push an event to a specific user
app.post("/send/:userId", async (c) => {
  const userId = c.req.param("userId");

  await notifier.sendToUser(c.env, userId, {
    type: "chat.message",
    data: { from: "server", text: "Hello from the worker!" },
  });

  return c.json({ ok: true });
});

// Push an event to a channel
app.post("/channels/:channel/send", async (c) => {
  const channel = c.req.param("channel");

  await notifier.sendToChannel(c.env, channel, {
    type: "chat.message",
    data: { from: "server", text: `Broadcast to ${channel}` },
  });

  return c.json({ ok: true });
});

// Get members of a channel
app.get("/channels/:channel/members", async (c) => {
  const channel = c.req.param("channel");
  const members = await notifier.getChannelMembers(c.env, channel);
  return c.json({ members });
});

app.get("/", (c) => c.text("durable-notifier basic-worker example"));

// Re-export the Durable Object classes for wrangler
export { UserChannel, Channel };
export default app;
