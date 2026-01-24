import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type WSClientMock = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  setSessionId: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
  sendTextInput: ReturnType<typeof vi.fn>;
  sendUserSpeechStart: ReturnType<typeof vi.fn>;
  sendUserSpeechEnd: ReturnType<typeof vi.fn>;
  sendAudioChunk: ReturnType<typeof vi.fn>;
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
      sendTextInput: vi.fn(),
      sendUserSpeechStart: vi.fn(),
      sendUserSpeechEnd: vi.fn(),
      sendAudioChunk: vi.fn(),
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

type AudioCaptureMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onSpeechStart: ReturnType<typeof vi.fn>;
  onSpeechEnd: ReturnType<typeof vi.fn>;
  onChunk: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  emitSpeechStart: (timestampMs: number) => void;
  emitSpeechEnd: (timestampMs: number) => void;
};

const { captureInstances, createCapture } = vi.hoisted(() => {
  const captureInstances: AudioCaptureMock[] = [];
  const createCapture = () => {
    const handlers: {
      speechStart?: (timestampMs: number) => void;
      speechEnd?: (timestampMs: number) => void;
    } = {};
    const instance: AudioCaptureMock = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      onSpeechStart: vi.fn((callback) => {
        handlers.speechStart = callback;
      }),
      onSpeechEnd: vi.fn((callback) => {
        handlers.speechEnd = callback;
      }),
      onChunk: vi.fn(),
      onError: vi.fn(),
      emitSpeechStart: (timestampMs: number) => handlers.speechStart?.(timestampMs),
      emitSpeechEnd: (timestampMs: number) => handlers.speechEnd?.(timestampMs),
    };
    captureInstances.push(instance);
    return instance;
  };
  return { captureInstances, createCapture };
});

vi.mock("./lib/wsClientManager", () => {
  return {
    acquireWSClient: vi.fn((options: WSClientMock["options"]) => createClient(options)),
    releaseWSClient: vi.fn(),
  };
});

vi.mock("./lib/audioCapture", () => {
  class AudioCapture {
    constructor() {
      return createCapture();
    }
  }
  return {
    AudioCapture,
  };
});

beforeEach(() => {
  wsInstances.length = 0;
  captureInstances.length = 0;
  vi.clearAllMocks();
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).AudioContext = class {
    resume = vi.fn();
  };
});

describe("App", () => {
  it("renders heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /offline voice chat/i })).toBeInTheDocument();
  });

  it("shows config warning when CONFIG is not received", () => {
    vi.useFakeTimers();
    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onConnectionChange?.("open");
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/音声設定/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/20ms/i);
    vi.useRealTimers();
  });

  it("does not show config warning when CONFIG arrives before timeout", () => {
    vi.useFakeTimers();
    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onConnectionChange?.("open");
      client.options.onEvent?.({
        type: "CONFIG",
        sessionId: "session-1",
        audioChunkMs: 25,
      });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows connection and session status labels", () => {
    render(<App />);
    expect(screen.getByText(/接続:\s*Idle/i)).toBeInTheDocument();
    expect(screen.getByText(/状態:\s*Idle/i)).toBeInTheDocument();
  });

  it("updates metrics hint when metrics update event arrives", () => {
    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onEvent?.({
        type: "METRICS_UPDATE",
        sessionId: "session-1",
        metrics: {
          generationId: "gen-1",
          asrMs: 120,
          llmMs: 340,
          ttsMs: 560,
          totalMs: 1020,
          timestampMs: 12345,
        },
      });
    });

    expect(screen.getByText(/ASR 120ms/i)).toBeInTheDocument();
    expect(screen.getByText(/LLM 340ms/i)).toBeInTheDocument();
    expect(screen.getByText(/TTS 560ms/i)).toBeInTheDocument();
    expect(screen.getByText(/Total 1.0s/i)).toBeInTheDocument();
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

  it("starts a session using the same session id from the voice button", async () => {
    render(<App />);
    const client = wsInstances[0];
    const sessionId = client.setSessionId.mock.calls[0][0];

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    expect(client.startSession).toHaveBeenCalledWith(sessionId);
  });

  it("shows error guidance and allows retry", async () => {
    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onEvent?.({
        type: "ERROR",
        sessionId: "s1",
        code: "ASR_FAILED",
        message: "asr failed",
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/asr failed/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/ASR/i);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /再試行/i }));
    });

    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows safe end when an error occurs", async () => {
    render(<App />);
    const client = wsInstances[0];

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    act(() => {
      client.options.onEvent?.({
        type: "ERROR",
        sessionId: "s1",
        code: "LLM_FAILED",
        message: "llm failed",
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /安全に終了/i }));
    });

    expect(client.stopSession).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends text input and clears the field", async () => {
    render(<App />);
    const client = wsInstances[0];

    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /送信/i }));
    });

    expect(client.sendTextInput).toHaveBeenCalledWith("hello");
    expect(input.value).toBe("");
  });

  it("does not send text when IME composition is active", async () => {
    render(<App />);
    const client = wsInstances[0];

    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "こんにちは" } });

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, {
      key: "Enter",
      isComposing: true,
      nativeEvent: { isComposing: true },
    });

    expect(client.sendTextInput).not.toHaveBeenCalled();
    expect(input.value).toBe("こんにちは");

    fireEvent.compositionEnd(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    });

    expect(client.sendTextInput).toHaveBeenCalledWith("こんにちは");
    expect(input.value).toBe("");
  });

  it("sends text when Cmd+Enter or Ctrl+Enter is pressed", async () => {
    render(<App />);
    const client = wsInstances[0];

    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });

    expect(client.sendTextInput).toHaveBeenCalledWith("hello");
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "world" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    });

    expect(client.sendTextInput).toHaveBeenCalledWith("world");
  });

  it("does not send text on Enter without modifiers", () => {
    render(<App />);
    const client = wsInstances[0];

    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(client.sendTextInput).not.toHaveBeenCalled();
    expect(input.value).toBe("line");
  });

  it("adjusts textarea height with an upper limit", () => {
    render(<App />);
    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;

    Object.defineProperty(input, "scrollHeight", {
      value: 40,
      configurable: true,
    });
    fireEvent.change(input, { target: { value: "line" } });
    expect(input.style.height).toBe("40px");

    Object.defineProperty(input, "scrollHeight", {
      value: 400,
      configurable: true,
    });
    fireEvent.change(input, { target: { value: "line\nline\nline\nline\nline\nline\nline" } });
    expect(parseInt(input.style.height, 10)).toBeLessThanOrEqual(200);
  });

  it("scrolls to the bottom when a new message is sent", async () => {
    render(<App />);
    const bottomMarker = screen.getByTestId("chat-bottom") as HTMLDivElement;
    const scrollIntoView = vi.fn();
    // eslint-disable-next-line no-param-reassign
    bottomMarker.scrollIntoView = scrollIntoView;

    const input = screen.getByLabelText(/メッセージ/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /送信/i }));
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("locks text input while voice session is active", async () => {
    render(<App />);
    const input = screen.getByLabelText(/メッセージ/i);
    const sendButton = screen.getByRole("button", { name: /送信/i });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  it("starts session after microphone permission is granted", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const resume = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = class {
      resume = resume;
    };

    render(<App />);
    const client = wsInstances[0];
    const sessionId = client.setSessionId.mock.calls[0][0];

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    expect(getUserMedia).toHaveBeenCalled();
    expect(client.startSession).toHaveBeenCalledWith(sessionId);
  });

  it("shows guidance when microphone permission is denied", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/マイク利用が拒否されました/i);
  });

  it("shows autoplay guidance when audio context cannot resume", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const resume = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = class {
      resume = resume;
    };

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/自動再生/i);
  });

  it("stops microphone tracks when the session is stopped", async () => {
    const stopTrack = vi.fn();
    const mockStream = { getTracks: () => [{ stop: stopTrack }] };
    const getUserMedia = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const resume = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = class {
      resume = resume;
    };

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力停止/i }));
    });

    expect(stopTrack).toHaveBeenCalled();
  });

  it("shows playback and download controls within the assistant message when audio is ready", () => {
    const createObjectURL = vi.fn(() => "blob:audio");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(global.URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(global.URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onEvent?.({
        type: "AUDIO_READY",
        sessionId: "session-1",
        audioBase64: "AA==",
        mimeType: "audio/wav",
        filename: "reply.wav",
      });
    });

    expect(screen.getByText(/音声応答が届きました。/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /コピー/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /再生/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/応答音声/i)).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: /音声をダウンロード/i });
    expect(downloadLink).toHaveAttribute("href", "blob:audio");
    expect(downloadLink).toHaveAttribute("download", "reply.wav");
  });

  it("shows assistant text response when ASSISTANT_TEXT arrives", async () => {
    render(<App />);
    const client = wsInstances[0];

    const input = screen.getByLabelText(/メッセージ/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /送信/i }));
    });

    expect(screen.getByText(/応答を生成しています/i)).toBeInTheDocument();

    act(() => {
      client.options.onEvent?.({
        type: "ASSISTANT_TEXT",
        sessionId: "session-1",
        generationId: "gen-1",
        text: "テキスト応答です。",
      });
    });

    const responseText = screen.getByText(/テキスト応答です。/i);
    expect(responseText).toBeInTheDocument();
    const bubble = responseText.closest("article");
    expect(bubble).not.toBeNull();
    expect(within(bubble as HTMLElement).getByText("応答")).toBeInTheDocument();
    expect(screen.queryByText(/応答を生成しています/i)).not.toBeInTheDocument();
  });

  it("marks stale assistant text as reference and ignores audio ready", () => {
    const createObjectURL = vi.fn(() => "blob:audio");
    Object.defineProperty(global.URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });

    render(<App />);
    const client = wsInstances[0];

    act(() => {
      client.options.onEvent?.({
        type: "ASSISTANT_TEXT",
        sessionId: "session-1",
        generationId: "gen-stale",
        text: "古い応答",
        stale: true,
      });
    });

    expect(screen.getByText(/古い応答/)).toBeInTheDocument();
    expect(screen.getByText(/参考/)).toBeInTheDocument();
    expect(screen.getByText(/状態:\s*Idle/i)).toBeInTheDocument();

    act(() => {
      client.options.onEvent?.({
        type: "AUDIO_READY",
        sessionId: "session-1",
        generationId: "gen-stale",
        audioBase64: "AA==",
        mimeType: "audio/wav",
        filename: "reply.wav",
      });
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /再生/i })).not.toBeInTheDocument();
  });

  it("adds a placeholder message when speech ends", async () => {
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    const capture = captureInstances[0];

    act(() => {
      capture.emitSpeechEnd(123);
    });

    expect(screen.getByText(/音声入力を受け付けました/i)).toBeInTheDocument();
  });

  it("replaces placeholder text when final transcript arrives", async () => {
    render(<App />);
    const client = wsInstances[0];

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /音声入力開始/i }));
    });

    const capture = captureInstances[0];

    act(() => {
      capture.emitSpeechEnd(123);
    });

    act(() => {
      client.options.onEvent?.({
        type: "FINAL_TRANSCRIPT",
        sessionId: "session-1",
        text: "hello voice",
      });
    });

    expect(screen.getByText(/hello voice/i)).toBeInTheDocument();
    expect(screen.queryByText(/音声入力を受け付けました/i)).not.toBeInTheDocument();
  });
});
