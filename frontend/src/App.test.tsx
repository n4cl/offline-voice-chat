import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type WSClientMock = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  setSessionId: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
  updateHandlers: ReturnType<typeof vi.fn>;
  options: {
    onEvent?: (event: unknown) => void;
    onError?: (error: Error) => void;
    onConnectionChange?: (state: string) => void;
  };
};

const { wsInstances, createClient } = vi.hoisted(() => {
  const wsInstances: WSClientMock[] = [];
  const createClient = (options: WSClientMock["options"]) => {
    const instance: WSClientMock = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      setSessionId: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn(),
      updateHandlers: vi.fn((handlers) => {
        instance.options = { ...instance.options, ...handlers };
      }),
      options,
    };
    wsInstances.push(instance);
    return instance;
  };
  return { wsInstances, createClient };
});

vi.mock("./lib/wsClientManager", () => {
  return {
    acquireWSClient: vi.fn((options: WSClientMock["options"]) => createClient(options)),
    releaseWSClient: vi.fn(),
  };
});

beforeEach(() => {
  wsInstances.length = 0;
  vi.clearAllMocks();
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

  it("shows and dismisses websocket error banner", () => {
    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onError?.(new Error("websocket error"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/WebSocket接続エラー/i);

    fireEvent.click(screen.getByRole("button", { name: /エラー通知を閉じる/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
