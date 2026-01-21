import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WSClient } from "./wsClient";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners: Record<string, Array<(event: any) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code: 1000 });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(payload: unknown) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: any) {
    for (const listener of this.listeners[type] || []) {
      listener(event);
    }
  }
}

const createMockSocket = (url: string) => new MockWebSocket(url) as unknown as WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WSClient", () => {
  it("queues events until the socket opens", () => {
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    client.startSession("session-1");

    expect(socket.sent).toHaveLength(0);

    socket.open();

    expect(socket.sent).toEqual([
      JSON.stringify({ type: "START_SESSION", sessionId: "session-1" }),
    ]);
  });

  it("reconnects and resumes the active session", () => {
    vi.useFakeTimers();
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
      reconnectDelayMs: 10,
    });

    client.connect();
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.open();

    client.startSession("session-1");
    expect(firstSocket.sent).toContain(
      JSON.stringify({ type: "START_SESSION", sessionId: "session-1" }),
    );

    firstSocket.close();

    vi.advanceTimersByTime(10);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.open();

    expect(secondSocket.sent).toContain(
      JSON.stringify({ type: "START_SESSION", sessionId: "session-1" }),
    );
  });

  it("dispatches server events to the handler", () => {
    const onEvent = vi.fn();
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
      onEvent,
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.receive({
      type: "BOUNDARY_STATUS",
      sessionId: "session-1",
      scope: "localhost",
      allowedRanges: ["127.0.0.1/8"],
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: "BOUNDARY_STATUS",
      sessionId: "session-1",
      scope: "localhost",
      allowedRanges: ["127.0.0.1/8"],
    });
  });

  it("sends audio chunk events with session context", () => {
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    client.sendAudioChunk({
      sessionId: "session-1",
      sequence: 1,
      timestampMs: 123,
      format: "pcm16",
      sampleRateHz: 16000,
      channels: 1,
      data: new ArrayBuffer(4),
    });

    expect(socket.sent).toEqual([
      JSON.stringify({
        type: "AUDIO_CHUNK",
        chunk: {
          sessionId: "session-1",
          sequence: 1,
          timestampMs: 123,
          format: "pcm16",
          sampleRateHz: 16000,
          channels: 1,
          data: {},
        },
      }),
    ]);
  });

  it("sends text input events with session context", () => {
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    client.setSessionId("session-1");
    client.sendTextInput("hello");

    expect(socket.sent).toContain(
      JSON.stringify({ type: "TEXT_INPUT", sessionId: "session-1", text: "hello" }),
    );
  });

  it("does not send empty text input", () => {
    const client = new WSClient({
      url: "ws://localhost/ws",
      websocketFactory: createMockSocket,
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    client.setSessionId("session-1");
    client.sendTextInput("   ");

    expect(socket.sent).toEqual([]);
  });
});
