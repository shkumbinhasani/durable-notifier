import { vi } from "vitest";
import { MockWebSocket } from "./mock-ws";

// Replace globalThis.WebSocket with our mock
vi.stubGlobal("WebSocket", MockWebSocket);
