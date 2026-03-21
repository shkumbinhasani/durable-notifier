import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createServerNotifier,
  UserChannel,
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
});

const app = new Hono<Env>();

app.use("*", cors());

// WebSocket upgrade endpoint
app.get("/ws", (c) => notifier.upgrade(c.req.raw, c.env));

// Push an event to a specific user
app.post("/send/:userId", async (c) => {
  const userId = c.req.param("userId");

  await notifier.sendToUser(c.env, userId, {
    type: "chat.message",
    data: { from: "server", text: "Hello from the worker!" },
  });

  return c.json({ ok: true });
});

app.get("/", (c) => c.text("durable-notifier basic-worker example"));

// Re-export the Durable Object class for wrangler
export { UserChannel };
export default app;
