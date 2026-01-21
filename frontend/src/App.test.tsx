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

  it("shows connection and session status labels", () => {
    render(<App />);
    expect(screen.getByText(/接続:\s*Idle/i)).toBeInTheDocument();
    expect(screen.getByText(/状態:\s*Idle/i)).toBeInTheDocument();
  });

  it("renders chat log empty state placeholder", () => {
    render(<App />);
    expect(
      screen.getByRole("region", { name: /チャットログ/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/まだ会話がありません。/i),
    ).toBeInTheDocument();
  });

  it("starts a session using the same session id from the voice button", () => {
    render(<App />);
    const client = wsInstances[0];
    const sessionId = client.setSessionId.mock.calls[0][0];

    fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));

    expect(client.startSession).toHaveBeenCalledWith(sessionId);
  });
});
