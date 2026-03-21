import { useState } from "react";
import { createNotifier } from "durable-notifier/client";

type MyEvents = {
  "order.updated": { orderId: string; status: string };
  "chat.message": { from: string; text: string };
};

// Instrument WebSocket to track total connections created and currently open
declare global {
  interface Window {
    __wsCreated: number;
    __wsOpen: number;
  }
}
window.__wsCreated = 0;
window.__wsOpen = 0;

const OriginalWebSocket = window.WebSocket;
window.WebSocket = class extends OriginalWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    window.__wsCreated++;
    let opened = false;
    this.addEventListener("open", () => {
      opened = true;
      window.__wsOpen++;
    });
    this.addEventListener("close", () => {
      if (opened) window.__wsOpen--;
    });
  }
} as typeof WebSocket;

// Point this at your deployed worker URL in production
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws?userId=test-user-1";

const notifier = createNotifier<MyEvents>(WS_URL);

function OrderListener() {
  notifier.useEvent("order.updated", (data) => {
    console.log("[OrderListener] order.updated:", data);
  });
  return <p data-testid="order-listener">OrderListener: subscribed to order.updated</p>;
}

function ChatListener() {
  const lastMessage = notifier.useLastEvent("chat.message");

  notifier.useEvent("chat.message", (data) => {
    console.log("[ChatListener] chat.message:", data);
  });

  return (
    <div data-testid="chat-listener">
      <p>ChatListener: subscribed to chat.message</p>
      {lastMessage && <pre data-testid="last-chat">{JSON.stringify(lastMessage, null, 2)}</pre>}
    </div>
  );
}

function StatusDisplay() {
  const status = notifier.useStatus();
  return <p data-testid="status">Status: {status}</p>;
}

export function App() {
  const [showOrder, setShowOrder] = useState(false);
  const [showChat, setShowChat] = useState(false);

  return (
    <div style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>durable-notifier React SDK Test</h1>

      <StatusDisplay />

      <section style={{ marginBottom: "1rem" }}>
        <h2>Controls</h2>
        <button data-testid="toggle-order" onClick={() => setShowOrder((v) => !v)}>
          {showOrder ? "Unmount" : "Mount"} OrderListener
        </button>{" "}
        <button data-testid="toggle-chat" onClick={() => setShowChat((v) => !v)}>
          {showChat ? "Unmount" : "Mount"} ChatListener
        </button>
      </section>

      <section>
        <h2>Active Hooks</h2>
        {!showOrder && !showChat && <p data-testid="no-hooks">No hooks mounted</p>}
        {showOrder && <OrderListener />}
        {showChat && <ChatListener />}
      </section>
    </div>
  );
}
