import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const wsInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  setSessionId: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("./lib/wsClient", () => {
  class WSClient {
    connect = vi.fn();
    disconnect = vi.fn();
    setSessionId = vi.fn();
    startSession = vi.fn();
    stopSession = vi.fn();

    constructor() {
      wsInstances.push(this);
    }
  }
  return { WSClient };
});

beforeEach(() => {
  wsInstances.length = 0;
});

describe("App", () => {
  it("renders heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /offline voice chat/i })).toBeInTheDocument();
  });

  it("connects on page load and sets a session id", () => {
    render(<App />);
    const client = wsInstances[0];
    expect(client.connect).toHaveBeenCalled();
    expect(client.setSessionId).toHaveBeenCalledTimes(1);
  });

  it("uses the same session id when starting a session", () => {
    render(<App />);
    const client = wsInstances[0];
    const sessionId = client.setSessionId.mock.calls[0][0];

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(client.startSession).toHaveBeenCalledWith(sessionId);
  });
});
