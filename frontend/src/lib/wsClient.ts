/** 会話セッションID（プロトコル上の sessionId） */
export type SessionId = string;
export type GenerationId = string;
export type BoundaryScope = "localhost" | "rfc1918";

export type AudioFormat = "pcm16" | "wav";
export type SampleRateHz = 16000 | 24000 | 48000;

export type AudioChunkMeta = {
  sessionId: SessionId;
  sequence: number;
  timestampMs: number;
  format: AudioFormat;
  sampleRateHz: SampleRateHz;
  channels: 1 | 2;
  byteLength: number;
};

export type AudioChunkPayload = {
  meta: AudioChunkMeta;
  data: ArrayBuffer;
};

export type MetricSnapshot = {
  generationId: GenerationId;
  asrMs?: number;
  llmMs?: number;
  ttsMs?: number;
  totalMs: number;
  timestampMs: number;
};

export type ClientEvent =
  | { type: "START_SESSION"; sessionId: SessionId }
  | { type: "STOP_SESSION"; sessionId: SessionId }
  | { type: "USER_SPEECH_START"; sessionId: SessionId; timestampMs: number }
  | { type: "USER_SPEECH_END"; sessionId: SessionId; timestampMs: number }
  | { type: "TEXT_INPUT"; sessionId: SessionId; text: string }
  | { type: "CANCEL_RESPONSE"; sessionId: SessionId; generationId: GenerationId }
  | { type: "AUDIO_CHUNK"; chunk: AudioChunkMeta }
  | { type: "PING"; sessionId: SessionId; timestampMs: number };

export type ServerEvent =
  | { type: "CONFIG"; sessionId: SessionId; audioChunkMs: number }
  | { type: "ASSISTANT_SPEAKING"; sessionId: SessionId; generationId: GenerationId }
  | { type: "ASSISTANT_STOPPED"; sessionId: SessionId; generationId: GenerationId }
  | {
      type: "ASSISTANT_TEXT";
      sessionId: SessionId;
      generationId: GenerationId;
      text: string;
      stale?: boolean;
    }
  | { type: "PARTIAL_TRANSCRIPT"; sessionId: SessionId; text: string }
  | { type: "FINAL_TRANSCRIPT"; sessionId: SessionId; text: string }
  | { type: "METRICS_UPDATE"; sessionId: SessionId; metrics: MetricSnapshot }
  | {
      type: "AUDIO_READY";
      sessionId: SessionId;
      generationId?: GenerationId;
      audioBase64: string;
      mimeType?: string;
      filename?: string;
    }
  | {
      type: "BOUNDARY_STATUS";
      sessionId: SessionId;
      scope: BoundaryScope;
      allowedRanges: string[];
    }
  | { type: "ERROR"; sessionId: SessionId; code: ErrorCode; message: string }
  | { type: "PONG"; sessionId: SessionId; timestampMs: number };

export type ErrorCode =
  | "PERMISSION_DENIED"
  | "DEVICE_UNAVAILABLE"
  | "ASR_FAILED"
  | "LLM_FAILED"
  | "TTS_FAILED"
  | "CHANNEL_DISCONNECTED"
  | "UNKNOWN";

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "reconnecting";

export type WSClientOptions = {
  url: string;
  reconnectDelayMs?: number;
  websocketFactory?: (url: string) => WebSocket;
  onEvent?: (event: ServerEvent) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (state: ConnectionState) => void;
};

const DEFAULT_RECONNECT_DELAY_MS = 1000;
const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSED = 3;

export class WSClient {
  private url: string;
  private reconnectDelayMs: number;
  private websocketFactory: (url: string) => WebSocket;
  private onEvent?: (event: ServerEvent) => void;
  private onError?: (error: Error) => void;
  private onConnectionChange?: (state: ConnectionState) => void;
  private socket: WebSocket | null = null;
  private state: ConnectionState = "idle";
  private queuedEvents: ClientEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private sessionId: SessionId | null = null;
  private sessionActive = false;

  constructor(options: WSClientOptions) {
    this.url = options.url;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.websocketFactory = options.websocketFactory ?? ((url) => new WebSocket(url));
    this.onEvent = options.onEvent;
    this.onError = options.onError;
    this.onConnectionChange = options.onConnectionChange;
  }

  /** WS接続を開始する（未接続時のみ）。 */
  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WS_READY_STATE_CONNECTING ||
        this.socket.readyState === WS_READY_STATE_OPEN)
    ) {
      return;
    }
    this.closedByUser = false;
    this.openSocket();
  }

  /** WS接続を明示的に切断し、再接続を止める。 */
  disconnect() {
    this.closedByUser = true;
    this.clearReconnectTimer();
    if (this.socket && this.socket.readyState !== WS_READY_STATE_CLOSED) {
      this.socket.close();
    }
    this.socket = null;
    this.setState("closed");
  }

  /** 受信ハンドラを更新する（再接続時も新しいハンドラを使用）。 */
  updateHandlers(handlers: Pick<WSClientOptions, "onEvent" | "onError" | "onConnectionChange">) {
    this.onEvent = handlers.onEvent;
    this.onError = handlers.onError;
    this.onConnectionChange = handlers.onConnectionChange;
  }

  /** 会話セッションIDを設定する（発行済みのIDを保持する用途）。 */
  setSessionId(sessionId: SessionId) {
    this.sessionId = sessionId;
  }

  /** 会話セッションを開始する。 */
  startSession(sessionId: SessionId) {
    this.sessionId = sessionId;
    this.sessionActive = true;
    this.sendEvent({ type: "START_SESSION", sessionId });
  }

  /** 会話セッションを停止する。 */
  stopSession() {
    if (!this.sessionId) {
      return;
    }
    this.sessionActive = false;
    this.sendEvent({ type: "STOP_SESSION", sessionId: this.sessionId });
  }

  /** ユーザー発話開始イベントを送信する。 */
  sendUserSpeechStart(timestampMs: number) {
    const sessionId = this.requireSession();
    this.sendEvent({ type: "USER_SPEECH_START", sessionId, timestampMs });
  }

  /** ユーザー発話終了イベントを送信する。 */
  sendUserSpeechEnd(timestampMs: number) {
    const sessionId = this.requireSession();
    this.sendEvent({ type: "USER_SPEECH_END", sessionId, timestampMs });
  }

  /** テキスト入力を送信する（空文字は無視）。 */
  sendTextInput(text: string) {
    if (text.trim().length === 0) {
      return;
    }
    const sessionId = this.requireSession();
    this.sendEvent({ type: "TEXT_INPUT", sessionId, text });
  }

  /** 生成中の応答をキャンセルする。 */
  cancelResponse(generationId: GenerationId) {
    const sessionId = this.requireSession();
    this.sendEvent({ type: "CANCEL_RESPONSE", sessionId, generationId });
  }

  /** 音声チャンクを送信する。 */
  sendAudioChunk(payload: AudioChunkPayload) {
    if (!this.socket || this.socket.readyState !== WS_READY_STATE_OPEN) {
      return;
    }
    const sessionId = payload.meta.sessionId || this.requireSession();
    const meta = {
      ...payload.meta,
      sessionId,
      byteLength: payload.data.byteLength,
    };
    this.socket.send(
      JSON.stringify({
        type: "AUDIO_CHUNK",
        chunk: meta,
      }),
    );
    try {
      this.socket.send(payload.data);
    } catch {
      // バイナリ送信に失敗した場合は破棄する。
    }
  }

  /** 接続疎通確認のPINGを送信する。 */
  ping(timestampMs: number) {
    const sessionId = this.requireSession();
    this.sendEvent({ type: "PING", sessionId, timestampMs });
  }

  private requireSession(): SessionId {
    if (!this.sessionId) {
      throw new Error("sessionId is required");
    }
    return this.sessionId;
  }

  private openSocket() {
    this.setState(this.state === "open" ? "reconnecting" : "connecting");
    const socket = this.websocketFactory(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.setState("open");
      this.ensureSessionStartQueued();
      this.flushQueue();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && typeof parsed.type === "string") {
          this.onEvent?.(parsed as ServerEvent);
        }
      } catch (error) {
        this.onError?.(new Error("invalid server event"));
      }
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      this.setState("closed");
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
      if (this.closedByUser) {
        return;
      }
      this.onError?.(new Error("websocket error"));
    });
  }

  private ensureSessionStartQueued() {
    if (!this.sessionActive || !this.sessionId) {
      return;
    }
    const hasStart = this.queuedEvents.some(
      (event) => event.type === "START_SESSION" && event.sessionId === this.sessionId,
    );
    if (!hasStart) {
      this.queuedEvents.unshift({
        type: "START_SESSION",
        sessionId: this.sessionId,
      });
    }
  }

  private sendEvent(event: ClientEvent) {
    if (this.socket && this.socket.readyState === WS_READY_STATE_OPEN) {
      this.socket.send(JSON.stringify(event));
      return;
    }
    this.queuedEvents.push(event);
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WS_READY_STATE_OPEN) {
      return;
    }
    for (const event of this.queuedEvents) {
      this.socket.send(JSON.stringify(event));
    }
    this.queuedEvents = [];
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) {
        this.openSocket();
      }
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: ConnectionState) {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.onConnectionChange?.(state);
  }
}
