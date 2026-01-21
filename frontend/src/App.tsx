import { useEffect, useMemo, useRef, useState } from "react";
import "./app.css";
import { type ConnectionState, type ServerEvent, WSClient } from "./lib/wsClient";

type BoundaryView = {
  scope: string;
  allowedRanges: string[];
};

type UIState = "idle" | "listening" | "thinking" | "speaking";

type ChatSpeaker = "assistant" | "user";

type ChatMessage = {
  id: string;
  speaker: ChatSpeaker;
  text: string;
  timestamp: string;
  status: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    speaker: "assistant",
    text: "こんにちは。音声でもテキストでも、ここから対話できます。話したいことがあれば気軽にどうぞ。",
    timestamp: "00:02",
    status: "再生待機",
  },
  {
    id: "m2",
    speaker: "user",
    text: "今日は面接対策をしたいです。どんな質問が来そうか一緒に整理できますか？",
    timestamp: "00:12",
    status: "送信済み",
  },
  {
    id: "m3",
    speaker: "assistant",
    text:
      "了解しました。まずは自己紹介と志望動機の構成を作り、想定質問リストを一緒に作成しましょう。これまでの経歴や強みを教えてください。",
    timestamp: "00:24",
    status: "音声生成済み",
  },
];

const UI_STATE_LABEL: Record<UIState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  open: "Connected",
  closed: "Closed",
  reconnecting: "Reconnecting",
};

const resolveWebSocketUrl = () => {
  const envUrl = import.meta.env?.VITE_WS_ENDPOINT as string | undefined;
  if (envUrl) {
    return envUrl;
  }
  if (typeof window === "undefined") {
    return "ws://localhost:8080/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:8080/ws`;
};

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const getStatusTone = (state: UIState) => {
  if (state === "speaking") {
    return "accent";
  }
  if (state === "thinking") {
    return "warm";
  }
  if (state === "listening") {
    return "cool";
  }
  return "muted";
};

const getConnectionTone = (state: ConnectionState) => {
  if (state === "open") {
    return "cool";
  }
  if (state === "connecting" || state === "reconnecting") {
    return "warm";
  }
  return "muted";
};

export default function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId] = useState<string>(() => createSessionId());
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [boundary, setBoundary] = useState<BoundaryView | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [messages] = useState<ChatMessage[]>(() => INITIAL_MESSAGES);
  const clientRef = useRef<WSClient | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  useEffect(() => {
    const client = new WSClient({
      url: wsUrl,
      onEvent: (event: ServerEvent) => {
        if (event.type === "BOUNDARY_STATUS") {
          setBoundary({ scope: event.scope, allowedRanges: event.allowedRanges });
        }
        if (event.type === "ERROR") {
          setLastError(event.message);
          setUiState("idle");
        }
        if (event.type === "PARTIAL_TRANSCRIPT") {
          setUiState("listening");
        }
        if (event.type === "FINAL_TRANSCRIPT") {
          setUiState("thinking");
        }
        if (event.type === "ASSISTANT_SPEAKING") {
          setUiState("speaking");
        }
        if (event.type === "ASSISTANT_STOPPED") {
          setUiState("idle");
        }
      },
      onConnectionChange: (state) => setConnectionState(state),
      onError: (error) => setLastError(error.message),
    });
    client.setSessionId(sessionId);
    client.connect();
    clientRef.current = client;
    return () => client.disconnect();
  }, [sessionId, wsUrl]);

  const handleStart = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    setSessionActive(true);
    setUiState("listening");
    client.startSession(sessionId);
  };

  const handleStop = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    client.stopSession();
    setSessionActive(false);
    setUiState("idle");
  };

  const handleVoiceToggle = () => {
    if (sessionActive) {
      handleStop();
      return;
    }
    handleStart();
  };

  const connectionLabel = CONNECTION_LABEL[connectionState];
  const statusLabel = UI_STATE_LABEL[uiState];
  const boundaryLabel = boundary
    ? `${boundary.scope} (${boundary.allowedRanges.join(", ")})`
    : "Unknown";

  return (
    <main className="app-shell">
      <div className="app-backdrop" aria-hidden="true">
        <span className="orb orb-amber" />
        <span className="orb orb-jade" />
        <span className="orb orb-gold" />
        <span className="grain" />
      </div>

      <div className="app-content">
        <header className="app-header">
          <div className="title-block">
            <h1>OFFLINE VOICE CHAT</h1>
          </div>
          <div className="status-card">
            <div className="status-row">
              <span className={`status-dot status-dot--${getConnectionTone(connectionState)}`} />
              <span>接続: {connectionLabel}</span>
            </div>
            <div className="status-row">
              <span className={`status-dot status-dot--${getStatusTone(uiState)}`} />
              <span>状態: {statusLabel}</span>
            </div>
          </div>
        </header>

        <section className="chat-log" aria-label="チャットログ">
          {messages.map((message, index) => (
            <article
              key={message.id}
              className={`chat-bubble chat-bubble--${message.speaker} fade-up`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <p className="chat-role">
                {message.speaker === "assistant" ? "Assistant" : "You"}
              </p>
              <p className="chat-text">{message.text}</p>
              <div className="chat-meta">
                <span>{message.timestamp}</span>
                <span>{message.status}</span>
              </div>
            </article>
          ))}
        </section>

        <footer className="app-footer" aria-label="フッター">
          <section className="input-bar" aria-label="入力バー">
            <button className="icon-button" type="button" aria-label="添付">
              +
            </button>
            <label className="sr-only" htmlFor="chat-input">
              メッセージ
            </label>
            <input
              id="chat-input"
              className="chat-input"
              type="text"
              placeholder="お話してみましょう"
            />
            <button className="send-button" type="button">
              送信
            </button>
            <button
              className="voice-toggle"
              type="button"
              aria-pressed={sessionActive}
              onClick={handleVoiceToggle}
            >
              <span className="voice-indicator" aria-hidden="true" />
              {sessionActive ? "音声入力停止" : "音声入力開始"}
            </button>
          </section>
          <div className="footer-meta-row">
            <span className="metrics-hint">ASR 320ms | LLM 1.1s | TTS 240ms</span>
            <span className="footer-meta">Boundary: {boundaryLabel}</span>
          </div>
        </footer>
        {lastError ? <div className="error-banner">Error: {lastError}</div> : null}
      </div>
    </main>
  );
}
