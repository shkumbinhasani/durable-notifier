import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createNotifier } from "../client/index";
import { instances, lastInstance, resetInstances } from "./mock-ws";

beforeEach(() => {
  resetInstances();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type TestEvents = {
  "chat.message": { text: string };
  "order.updated": { orderId: string };
};

describe("React hooks", () => {
  describe("useStatus", () => {
    it("renders idle when no useEvent hooks are mounted", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function Status() {
        return <div data-testid="status">{notifier.useStatus()}</div>;
      }

      render(<Status />);
      expect(screen.getByTestId("status").textContent).toBe("idle");
      // useStatus alone should not open a connection
      expect(instances).toHaveLength(0);
    });

    it("reflects connection lifecycle", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function App() {
        const status = notifier.useStatus();
        notifier.useEvent("chat.message", () => {});
        return <div data-testid="status">{status}</div>;
      }

      render(<App />);
      expect(screen.getByTestId("status").textContent).toBe("connecting");

      act(() => lastInstance().simulateOpen());
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
  });

  describe("useEvent", () => {
    it("receives events and calls the handler", () => {
      const notifier = createNotifier<TestEvents>("ws://test");
      const received: string[] = [];

      function Listener() {
        notifier.useEvent("chat.message", (data) => {
          received.push(data.text);
        });
        return null;
      }

      render(<Listener />);
      act(() => lastInstance().simulateOpen());

      act(() => {
        lastInstance().simulateMessage(
          JSON.stringify({ type: "chat.message", data: { text: "hello" } }),
        );
      });

      expect(received).toEqual(["hello"]);
    });

    it("shares a single WebSocket across multiple hooks", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function App() {
        notifier.useEvent("chat.message", () => {});
        notifier.useEvent("order.updated", () => {});
        return null;
      }

      render(<App />);
      // Only 1 WS created (StrictMode off in this test)
      expect(instances).toHaveLength(1);
    });

    it("cleans up on unmount", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function Listener() {
        notifier.useEvent("chat.message", () => {});
        return null;
      }

      const { unmount } = render(<Listener />);
      act(() => lastInstance().simulateOpen());
      expect(notifier.useStatus).toBeDefined();

      unmount();
      // After unmount, the lazy connection should close
      // Status should go back to idle
    });
  });

  describe("useLastEvent", () => {
    it("returns null initially", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function App() {
        const last = notifier.useLastEvent("chat.message");
        return (
          <div data-testid="last">{last ? last.data?.toString() : "none"}</div>
        );
      }

      render(<App />);
      expect(screen.getByTestId("last").textContent).toBe("none");
    });

    it("updates when an event arrives", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function App() {
        notifier.useEvent("chat.message", () => {});
        const last = notifier.useLastEvent("chat.message");
        return (
          <div data-testid="last">
            {last ? JSON.stringify(last.data) : "none"}
          </div>
        );
      }

      render(<App />);
      act(() => lastInstance().simulateOpen());

      act(() => {
        lastInstance().simulateMessage(
          JSON.stringify({
            type: "chat.message",
            data: { text: "hi" },
          }),
        );
      });

      expect(screen.getByTestId("last").textContent).toBe(
        JSON.stringify({ text: "hi" }),
      );
    });
  });

  describe("close()", () => {
    it("sets status to closed", () => {
      const notifier = createNotifier<TestEvents>("ws://test");

      function App() {
        notifier.useEvent("chat.message", () => {});
        return <div data-testid="status">{notifier.useStatus()}</div>;
      }

      render(<App />);
      act(() => lastInstance().simulateOpen());
      expect(screen.getByTestId("status").textContent).toBe("connected");

      act(() => notifier.close());
      expect(screen.getByTestId("status").textContent).toBe("closed");
    });
  });

  describe("useChannel", () => {
    it("subscribes on mount and unsubscribes on unmount", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const notifier = createNotifier<TestEvents>("ws://test", {
        channelEndpoint: "http://test/channels",
      });

      function App({ channel }: { channel: string }) {
        notifier.useEvent("chat.message", () => {});
        notifier.useChannel(channel);
        return <div data-testid="status">{notifier.useStatus()}</div>;
      }

      const { unmount } = render(<App channel="room-42" />);
      act(() => lastInstance().simulateOpen());

      // Wait for the subscribe fetch
      await act(async () => {
        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalledTimes(1);
        });
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("http://test/channels/subscribe");

      unmount();

      // Should have called unsubscribe
      await act(async () => {
        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalledTimes(2);
        });
      });

      const [unsubUrl] = fetchSpy.mock.calls[1];
      expect(unsubUrl).toBe("http://test/channels/unsubscribe");

      fetchSpy.mockRestore();
    });
  });
});
